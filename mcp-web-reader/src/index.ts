import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import dns from "node:dns/promises";
import net from "node:net";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { htmlToMarkdown } from "./extract.js";
import {
  getCache,
  setCache,
  clearCache,
  cacheSize,
  cacheStats
} from "./cache.js";

const SEARXNG_URL = process.env.SEARXNG_URL || "http://127.0.0.1:8080";

const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || "15000");
const MAX_FETCH_BYTES = Number(process.env.MAX_FETCH_BYTES || String(512 * 1024));
const DEFAULT_MAX_CHARS = Number(process.env.DEFAULT_MAX_CHARS || "12000");

const RENDER_NAV_TIMEOUT_MS = Number(process.env.RENDER_NAV_TIMEOUT_MS || "30000");
const RENDER_NETWORK_IDLE_TIMEOUT_MS = Number(process.env.RENDER_NETWORK_IDLE_TIMEOUT_MS || "10000");
const RENDER_EXTRA_WAIT_MS = Number(process.env.RENDER_EXTRA_WAIT_MS || "1500");
const RENDER_SCROLL_STEPS = Number(process.env.RENDER_SCROLL_STEPS || "3");
const RENDER_SCROLL_DELAY_MS = Number(process.env.RENDER_SCROLL_DELAY_MS || "800");

const ENABLE_CACHE = process.env.ENABLE_CACHE !== "0";
const SEARCH_CACHE_TTL_MS = Number(process.env.SEARCH_CACHE_TTL_MS || "300000");
const FETCH_CACHE_TTL_MS = Number(process.env.FETCH_CACHE_TTL_MS || "600000");
const RENDER_CACHE_TTL_MS = Number(process.env.RENDER_CACHE_TTL_MS || "600000");

const DEBUG = process.env.DEBUG_LOCAL_WEB_READER === "1";

const RENDER_BLOCK_RESOURCE_TYPES = new Set(
  (process.env.RENDER_BLOCK_RESOURCE_TYPES || "image,media,font")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

const ALLOW_DOMAINS = (process.env.ALLOW_DOMAINS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

type RenderRequestReport = {
  blockedRequestsCount: number;
  blockedPrivateNetworkRequests: number;
  blockedByResourceType: Record<string, number>;
  allowedRequestsCount: number;
};

function debugLog(...args: unknown[]) {
  if (!DEBUG) return;
  console.error("[local-web-reader]", ...args);
}

function textResult(obj: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2)
      }
    ]
  };
}

function normalizeCacheInput(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return value.trim();
  return JSON.stringify(value);
}

function makeCacheKey(prefix: string, parts: Record<string, unknown>): string {
  const normalized = Object.keys(parts)
    .sort()
    .map((key) => `${key}=${normalizeCacheInput(parts[key])}`)
    .join("&");

  return `${prefix}:${normalized}`;
}

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;

  const [a, b] = parts;

  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;

  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  if (lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80")) return true;

  return false;
}

async function assertSafeUrl(rawUrl: string): Promise<URL> {
  const url = new URL(rawUrl);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http/https URLs are allowed.");
  }

  const hostname = url.hostname.toLowerCase();

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0"
  ) {
    throw new Error("Localhost URLs are blocked.");
  }

  if (ALLOW_DOMAINS.length > 0) {
    const allowed = ALLOW_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith("." + d)
    );

    if (!allowed) {
      throw new Error(`Domain not allowed: ${hostname}`);
    }
  }

  const ipVersion = net.isIP(hostname);

  if (ipVersion === 4 && isPrivateIPv4(hostname)) {
    throw new Error("Private IPv4 URLs are blocked.");
  }

  if (ipVersion === 6 && isPrivateIPv6(hostname)) {
    throw new Error("Private IPv6 URLs are blocked.");
  }

  const addresses = await dns.lookup(hostname, { all: true });

  for (const addr of addresses) {
    if (addr.family === 4 && isPrivateIPv4(addr.address)) {
      throw new Error(`Resolved to blocked private IPv4: ${addr.address}`);
    }

    if (addr.family === 6 && isPrivateIPv6(addr.address)) {
      throw new Error(`Resolved to blocked private IPv6: ${addr.address}`);
    }
  }

  return url;
}

async function isSafeRequestUrl(rawUrl: string): Promise<boolean> {
  try {
    await assertSafeUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}

async function fetchWithSafety(
  rawUrl: string,
  redirectsLeft = 3
): Promise<{
  finalUrl: string;
  contentType: string;
  body: string;
}> {
  const url = await assertSafeUrl(rawUrl);

  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; LMStudioLocalWebReader/1.0; +local)",
      "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5"
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.headers.get("location")
  ) {
    if (redirectsLeft <= 0) {
      throw new Error("Too many redirects.");
    }

    const next = new URL(response.headers.get("location")!, url).toString();
    return fetchWithSafety(next, redirectsLeft - 1);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";

  if (
    !contentType.includes("text/html") &&
    !contentType.includes("text/plain") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    throw new Error(`Unsupported content-type: ${contentType}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer).slice(0, MAX_FETCH_BYTES);
  const body = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  return {
    finalUrl: url.toString(),
    contentType,
    body
  };
}

function decodeBasicEntities(text: string): string {
  return text
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'");
}

function htmlToText(html: string): string {
  let s = html;

  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");

  s = s.replace(/<\/(p|div|section|article|header|footer|li|h1|h2|h3|h4|h5|h6)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");

  s = s.replace(/<[^>]+>/g, " ");
  s = decodeBasicEntities(s);

  s = s
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");

  return s;
}

async function autoScroll(page: Page, steps: number, delayMs: number): Promise<void> {
  for (let i = 0; i < steps; i++) {
    await page.evaluate(() => {
      window.scrollBy(0, Math.floor(window.innerHeight * 0.85));
    });

    await page.waitForTimeout(delayMs);
  }

  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
}

async function createSafeBrowserPage(): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
  report: RenderRequestReport;
}> {
  const report: RenderRequestReport = {
    blockedRequestsCount: 0,
    blockedPrivateNetworkRequests: 0,
    blockedByResourceType: {},
    allowedRequestsCount: 0
  };

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });

  const context = await browser.newContext({
    javaScriptEnabled: true,
    ignoreHTTPSErrors: false,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120 Safari/537.36 LMStudioLocalWebReader/1.0",
    viewport: {
      width: 1365,
      height: 900
    }
  });

  await context.route("**/*", async (route) => {
    const req = route.request();
    const reqUrl = req.url();
    const resourceType = req.resourceType();

    if (RENDER_BLOCK_RESOURCE_TYPES.has(resourceType)) {
      report.blockedRequestsCount++;
      report.blockedByResourceType[resourceType] =
        (report.blockedByResourceType[resourceType] || 0) + 1;

      return route.abort();
    }

    const safe = await isSafeRequestUrl(reqUrl);

    if (!safe) {
      report.blockedRequestsCount++;
      report.blockedPrivateNetworkRequests++;
      return route.abort();
    }

    report.allowedRequestsCount++;
    return route.continue();
  });

  const page = await context.newPage();

  return {
    browser,
    context,
    page,
    report
  };
}

async function renderUrlToSource(
  rawUrl: string,
  options: {
    maxTextChars: number;
    maxHtmlChars: number;
    includeText: boolean;
    includeHtml: boolean;
    waitMs?: number;
    scrollSteps?: number;
  }
): Promise<{
  requestedUrl: string;
  finalUrl: string;
  title: string;
  text?: string;
  renderedHtml?: string;
  requestReport: RenderRequestReport;
}> {
  const safeUrl = await assertSafeUrl(rawUrl);

  const { browser, context, page, report } = await createSafeBrowserPage();

  try {
    await page.goto(safeUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: RENDER_NAV_TIMEOUT_MS
    });

    try {
      await page.waitForLoadState("networkidle", {
        timeout: RENDER_NETWORK_IDLE_TIMEOUT_MS
      });
    } catch {
      // Some SPAs keep network connections open. Continue with current DOM.
    }

    const extraWait = options.waitMs ?? RENDER_EXTRA_WAIT_MS;

    if (extraWait > 0) {
      await page.waitForTimeout(extraWait);
    }

    const scrollSteps = options.scrollSteps ?? RENDER_SCROLL_STEPS;

    if (scrollSteps > 0) {
      await autoScroll(page, scrollSteps, RENDER_SCROLL_DELAY_MS);
    }

    const title = await page.title().catch(() => "");

    const result: {
      requestedUrl: string;
      finalUrl: string;
      title: string;
      text?: string;
      renderedHtml?: string;
      requestReport: RenderRequestReport;
    } = {
      requestedUrl: rawUrl,
      finalUrl: page.url(),
      title,
      requestReport: report
    };

    if (options.includeText) {
      let text = "";

      try {
        text = await page.locator("body").innerText({ timeout: 5000 });
      } catch {
        const html = await page.content();
        text = htmlToText(html);
      }

      result.text = text
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, options.maxTextChars);
    }

    if (options.includeHtml) {
      const html = await page.content();
      result.renderedHtml = html.slice(0, options.maxHtmlChars);
    }

    return result;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

const server = new McpServer({
  name: "local-web-reader",
  version: "1.0.0"
});

server.tool(
  "health_check",
  "Check whether MCP server, SearXNG, Playwright Chromium, and cache are ready.",
  {},
  async () => {
    const checks: Record<string, unknown> = {
      mcp: "ok",
      searxng: "unknown",
      playwright: "unknown",
      searxngUrl: SEARXNG_URL,
      cacheEnabled: ENABLE_CACHE,
      cacheSize: cacheSize()
    };

    try {
      const endpoint = new URL("/search", SEARXNG_URL);
      endpoint.searchParams.set("q", "test");
      endpoint.searchParams.set("format", "json");

      const res = await fetch(endpoint, {
        headers: {
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });

      checks.searxng = res.ok ? "ok" : `error_http_${res.status}`;
    } catch (err: any) {
      checks.searxng = `error: ${err?.message || String(err)}`;
    }

    try {
      const browser = await chromium.launch({
        headless: true
      });

      await browser.close();

      checks.playwright = "ok";
    } catch (err: any) {
      checks.playwright = `error: ${err?.message || String(err)}`;
    }

    return textResult(checks);
  }
);

server.tool(
  "clear_cache",
  "Clear in-memory search/fetch/render cache.",
  {},
  async () => {
    const cleared = clearCache();

    return textResult({
      clearedEntries: cleared,
      cacheSize: cacheSize()
    });
  }
);

server.tool(
  "cache_stats",
  "Show in-memory cache statistics.",
  {},
  async () => {
    return textResult(cacheStats());
  }
);

server.tool(
  "search_web",
  "Search the web using local SearXNG. Returns title, url, snippet, and source.",
  {
    query: z.string().min(1).describe("Search query"),
    max_results: z.number().int().min(1).max(10).default(5),
    language: z.string().optional().describe("Optional language code, e.g. en, vi")
  },
  async ({ query, max_results, language }) => {
    debugLog("search_web", { query, max_results, language });

    const cacheKey = makeCacheKey("search_web", {
      query,
      max_results,
      language: language || ""
    });

    if (ENABLE_CACHE) {
      const cached = getCache<Record<string, unknown>>(cacheKey);

      if (cached) {
        return textResult({
          ...cached,
          cache: {
            hit: true,
            key: cacheKey
          }
        });
      }
    }

    const endpoint = new URL("/search", SEARXNG_URL);
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("format", "json");

    if (language) {
      endpoint.searchParams.set("language", language);
    }

    const response = await fetch(endpoint, {
      headers: {
        Accept: "application/json"
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (!response.ok) {
      throw new Error(`SearXNG error: HTTP ${response.status}`);
    }

    const data: any = await response.json();
    const results = Array.isArray(data.results) ? data.results : [];

    const compact = results.slice(0, max_results).map((r: any) => ({
      title: r.title || "",
      url: r.url || "",
      snippet: r.content || "",
      source: (() => {
        try {
          return new URL(r.url).hostname;
        } catch {
          return "";
        }
      })()
    }));

    const output = {
      query,
      backend: "searxng",
      results: compact,
      note:
        "Use fetch_url for static pages. Use fetch_rendered_source or fetch_rendered_markdown for SPA pages.",
      cache: {
        hit: false,
        key: cacheKey,
        ttlMs: SEARCH_CACHE_TTL_MS
      }
    };

    if (ENABLE_CACHE) {
      setCache(cacheKey, output, SEARCH_CACHE_TTL_MS);
    }

    return textResult(output);
  }
);

server.tool(
  "fetch_url",
  "Fetch and extract readable text from static HTML/text URL. Blocks localhost/private IPs and limits content size.",
  {
    url: z.string().url().describe("URL to fetch"),
    max_chars: z.number().int().min(1000).max(30000).default(DEFAULT_MAX_CHARS)
  },
  async ({ url, max_chars }) => {
    debugLog("fetch_url", { url, max_chars });

    const cacheKey = makeCacheKey("fetch_url", {
      url,
      max_chars
    });

    if (ENABLE_CACHE) {
      const cached = getCache<Record<string, unknown>>(cacheKey);

      if (cached) {
        return textResult({
          ...cached,
          cache: {
            hit: true,
            key: cacheKey
          }
        });
      }
    }

    const fetched = await fetchWithSafety(url);
    const text = htmlToText(fetched.body).slice(0, max_chars);

    const output = {
      mode: "static_fetch",
      requestedUrl: url,
      finalUrl: fetched.finalUrl,
      contentType: fetched.contentType,
      text,
      safety:
        "Private/local network URLs are blocked. Content is truncated before sending to the model.",
      cache: {
        hit: false,
        key: cacheKey,
        ttlMs: FETCH_CACHE_TTL_MS
      }
    };

    if (ENABLE_CACHE) {
      setCache(cacheKey, output, FETCH_CACHE_TTL_MS);
    }

    return textResult(output);
  }
);

server.tool(
  "fetch_rendered_source",
  "Render a JavaScript-heavy SPA page in headless Chromium and return rendered DOM source and/or visible text.",
  {
    url: z.string().url().describe("URL to render with Chromium"),
    include_text: z.boolean().default(true).describe("Return visible body text after JS render"),
    include_html: z.boolean().default(true).describe("Return rendered DOM HTML source after JS render"),
    max_text_chars: z.number().int().min(1000).max(80000).default(20000),
    max_html_chars: z.number().int().min(1000).max(200000).default(60000),
    wait_ms: z.number().int().min(0).max(20000).optional().describe("Extra wait after networkidle"),
    scroll_steps: z.number().int().min(0).max(20).optional().describe("Auto-scroll steps for lazy-loaded SPA content")
  },
  async ({
    url,
    include_text,
    include_html,
    max_text_chars,
    max_html_chars,
    wait_ms,
    scroll_steps
  }) => {
    debugLog("fetch_rendered_source", {
      url,
      include_text,
      include_html,
      max_text_chars,
      max_html_chars,
      wait_ms,
      scroll_steps
    });

    const cacheKey = makeCacheKey("fetch_rendered_source", {
      url,
      include_text,
      include_html,
      max_text_chars,
      max_html_chars,
      wait_ms: wait_ms ?? "",
      scroll_steps: scroll_steps ?? ""
    });

    if (ENABLE_CACHE) {
      const cached = getCache<Record<string, unknown>>(cacheKey);

      if (cached) {
        return textResult({
          ...cached,
          cache: {
            hit: true,
            key: cacheKey
          }
        });
      }
    }

    const rendered = await renderUrlToSource(url, {
      includeText: include_text,
      includeHtml: include_html,
      maxTextChars: max_text_chars,
      maxHtmlChars: max_html_chars,
      waitMs: wait_ms,
      scrollSteps: scroll_steps
    });

    const output = {
      mode: "rendered_source",
      ...rendered,
      safety:
        "Rendered with headless Chromium. Local/private network requests are blocked. Images/media/fonts are blocked by default. Output is truncated before sending to the model.",
      cache: {
        hit: false,
        key: cacheKey,
        ttlMs: RENDER_CACHE_TTL_MS
      }
    };

    if (ENABLE_CACHE) {
      setCache(cacheKey, output, RENDER_CACHE_TTL_MS);
    }

    return textResult(output);
  }
);

server.tool(
  "fetch_rendered_markdown",
  "Render a JavaScript-heavy page and return cleaned Markdown extracted from the rendered DOM.",
  {
    url: z.string().url().describe("URL to render"),
    max_chars: z.number().int().min(1000).max(80000).default(30000),
    wait_ms: z.number().int().min(0).max(20000).optional(),
    scroll_steps: z.number().int().min(0).max(20).optional()
  },
  async ({ url, max_chars, wait_ms, scroll_steps }) => {
    debugLog("fetch_rendered_markdown", {
      url,
      max_chars,
      wait_ms,
      scroll_steps
    });

    const cacheKey = makeCacheKey("fetch_rendered_markdown", {
      url,
      max_chars,
      wait_ms: wait_ms ?? "",
      scroll_steps: scroll_steps ?? ""
    });

    if (ENABLE_CACHE) {
      const cached = getCache<Record<string, unknown>>(cacheKey);

      if (cached) {
        return textResult({
          ...cached,
          cache: {
            hit: true,
            key: cacheKey
          }
        });
      }
    }

    const rendered = await renderUrlToSource(url, {
      includeText: false,
      includeHtml: true,
      maxTextChars: 1000,
      maxHtmlChars: 200000,
      waitMs: wait_ms,
      scrollSteps: scroll_steps
    });

    const extracted = htmlToMarkdown(rendered.renderedHtml || "", rendered.finalUrl);

    const output = {
      mode: "rendered_markdown",
      requestedUrl: rendered.requestedUrl,
      finalUrl: rendered.finalUrl,
      title: extracted.title || rendered.title,
      excerpt: extracted.excerpt,
      byline: extracted.byline,
      markdown: extracted.markdown.slice(0, max_chars),
      requestReport: rendered.requestReport,
      safety:
        "Rendered with headless Chromium. Private/local network requests are blocked. Markdown is truncated before sending to the model.",
      cache: {
        hit: false,
        key: cacheKey,
        ttlMs: RENDER_CACHE_TTL_MS
      }
    };

    if (ENABLE_CACHE) {
      setCache(cacheKey, output, RENDER_CACHE_TTL_MS);
    }

    return textResult(output);
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);