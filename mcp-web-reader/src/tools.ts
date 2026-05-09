import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, htmlToText, makeCacheKey } from './helper.js';
import { debugLog } from './log.js';
import { getCache, setCache, clearCache, cacheSize, cacheStats } from './cache.js';
import { htmlToMarkdown } from './extract.js';
import { getGlobalBrowser, closeGlobalBrowser, fetchWithSafety, renderUrlToSource } from './browser.js';
import { searxngSearch } from './searxng.js';
import { fetchSnippetsFromUrl, scoreSnippet, truncateCode, rewriteQueries, filterUrls } from './code_web.js';
import { ENABLE_CACHE, SEARXNG_URL, SEARXNG_ENGINES, SEARXNG_REQUEST_HEADERS, REQUEST_TIMEOUT_MS, DEFAULT_MAX_CHARS, FETCH_CACHE_TTL_MS, SEARCH_CACHE_TTL_MS, RENDER_CACHE_TTL_MS, CODE_WEB_MAX_URLS, CODE_WEB_MAX_SNIPPETS, CODE_WEB_MAX_CHARS_PER_SNIPPET, CODE_WEB_CACHE_TTL_MS, CODE_WEB_PREFERRED_DOMAINS } from './config.js';

export function registerTools(server: McpServer) {
server.registerTool(
  "health_check",
  { description: "Check whether MCP server, SearXNG, Playwright Chromium, and cache are ready." },
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
        headers: SEARXNG_REQUEST_HEADERS,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });

      checks.searxng = res.ok ? "ok" : `error_http_${res.status}`;
    } catch (err: any) {
      checks.searxng = `error: ${err?.message || String(err)}`;
    }

    try {
      const browser = await getGlobalBrowser();
      const context = await browser.newContext();
      await context.close();

      checks.playwright = "ok";
    } catch (err: any) {
      checks.playwright = `error: ${err?.message || String(err)}`;
    }

    return textResult(checks);
  }
);

server.registerTool(
  "clear_cache",
  { description: "Clear in-memory search/fetch/render cache." },
  async () => {
    const cleared = clearCache();

    return textResult({
      clearedEntries: cleared,
      cacheSize: cacheSize()
    });
  }
);

server.registerTool(
  "cache_stats",
  { description: "Show in-memory cache statistics." },
  async () => {
    return textResult(cacheStats());
  }
);

server.registerTool(
  "close_browser",
  { description: "Close the background browser to free up memory." },
  async () => {
    await closeGlobalBrowser();
    return textResult("Browser closed successfully.");
  }
);

server.registerTool(
  "search_web",
  {
    description: "Search the web using local SearXNG. Returns title, url, snippet, and source.",
    inputSchema: {
    query: z.string().min(1).max(500).describe("Search query"),
    max_results: z.number().int().min(1).max(10).default(5),
    language: z.string().max(20).optional().describe("Optional language code, e.g. en, vi"),
    time_range: z.enum(["day", "week", "month", "year"]).optional().describe("Optional time range for recent results")
    }
  },
  async ({ query, max_results, language, time_range }) => {
    debugLog("search_web", { query, max_results, language, time_range });

    const cacheKey = makeCacheKey("search_web", {
      query,
      max_results,
      language: language || "",
      time_range: time_range || "",
      engines: SEARXNG_ENGINES.join(",")
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

    if (time_range) {
      endpoint.searchParams.set("time_range", time_range);
    }

    if (SEARXNG_ENGINES.length > 0) {
      endpoint.searchParams.set("engines", SEARXNG_ENGINES.join(","));
    }

    const response = await fetch(endpoint, {
      headers: SEARXNG_REQUEST_HEADERS,
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
      engines: SEARXNG_ENGINES,
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

server.registerTool(
  "fetch_url",
  {
    description: "Fetch and extract readable text from static HTML/text URL. Blocks localhost/private IPs and limits content size.",
    inputSchema: {
    url: z.string().url().describe("URL to fetch"),
    max_chars: z.number().int().min(1000).max(30000).default(DEFAULT_MAX_CHARS)
    }
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

server.registerTool(
  "fetch_rendered_source",
  {
    description: "Render a JavaScript-heavy SPA page in headless Chromium and return rendered DOM source and/or visible text.",
    inputSchema: {
    url: z.string().url().describe("URL to render with Chromium"),
    include_text: z.boolean().default(true).describe("Return visible body text after JS render"),
    include_html: z.boolean().default(true).describe("Return rendered DOM HTML source after JS render"),
    max_text_chars: z.number().int().min(1000).max(80000).default(20000),
    max_html_chars: z.number().int().min(1000).max(200000).default(60000),
    wait_ms: z.number().int().min(0).max(20000).optional().describe("Extra wait after networkidle"),
    scroll_steps: z.number().int().min(0).max(20).optional().describe("Auto-scroll steps for lazy-loaded SPA content")
    }
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

server.registerTool(
  "fetch_rendered_markdown",
  {
    description: "Render a JavaScript-heavy page and return cleaned Markdown extracted from the rendered DOM.",
    inputSchema: {
    url: z.string().url().describe("URL to render"),
    max_chars: z.number().int().min(1000).max(80000).default(30000),
    wait_ms: z.number().int().min(0).max(20000).optional(),
    scroll_steps: z.number().int().min(0).max(20).optional()
    }
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

server.registerTool(
  "search_code_web",
  {
    description: "Search code snippets from the internet (via SearXNG), fetch pages, extract code blocks, rank and return best snippets.",
    inputSchema: {
    query: z.string().min(1).max(500),
    max_snippets: z.number().int().min(1).max(50).default(10),
    language_hint: z.string().max(50).optional().describe("Optional: e.g. typescript, python, rust"),
    }
  },
  async ({ query, max_snippets, language_hint }) => {
    const enhancedQueries = rewriteQueries(query);

    const cacheKey = `search_code_web:${JSON.stringify({ query, enhancedQueries, max_snippets, language_hint: language_hint || "", engines: SEARXNG_ENGINES })}`;

    if (ENABLE_CACHE) {
      const cached = getCache<any>(cacheKey);
      if (cached) return textResult({ ...cached, cache: { hit: true } });
    }

    // 1) Search via SearXNG API in parallel
    const allResults: Array<{ title: string; url: string; snippet: string }> = [];
    await Promise.allSettled(
      enhancedQueries.map(async (q) => {
        try {
          const rs = await searxngSearch(q, 5, undefined, SEARXNG_ENGINES);
          for (const r of rs) {
            if (r.url) allResults.push(r);
          }
        } catch {
          // ignore failed query
        }
      })
    );

    // Dedup URLs and filter/score them
    const allUrls = Array.from(new Set(allResults.map(r => r.url).filter(Boolean)));
    const urls = filterUrls(allUrls, CODE_WEB_PREFERRED_DOMAINS, CODE_WEB_MAX_URLS);

    // 2) Fetch pages & extract snippets in parallel (with concurrency limit)
    const snippets: Array<{
      url: string;
      source: string;
      lang?: string;
      code: string;
      score: number;
    }> = [];

    const concurrencyLimit = 4;
    const PER_URL_TIMEOUT_MS = 12000; // cap each URL so the whole tool stays under MCP timeout
    for (let i = 0; i < urls.length; i += concurrencyLimit) {
      const batch = urls.slice(i, i + concurrencyLimit);
      await Promise.allSettled(
        batch.map(async (url) => {
          try {
            const blocks = await Promise.race([
              fetchSnippetsFromUrl(url),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("per-url timeout")), PER_URL_TIMEOUT_MS)
              )
            ]);
            for (const b of blocks) {
              if (snippets.length >= CODE_WEB_MAX_SNIPPETS) continue;

              // optional strict language filter
              if (language_hint && b.lang && b.lang.toLowerCase() !== language_hint.toLowerCase()) {
                continue;
              }

              const code = truncateCode(b.code, CODE_WEB_MAX_CHARS_PER_SNIPPET);
              const score = scoreSnippet(url, code, b.lang);

              snippets.push({
                url,
                source: (() => { try { return new URL(url).hostname; } catch { return ""; } })(),
                lang: b.lang,
                code,
                score
              });
            }
          } catch {
            // ignore
          }
        })
      );
    }

    // 3) Rank and return top
    snippets.sort((a, b) => b.score - a.score);
    const final = snippets.slice(0, max_snippets);

    const output = {
      query,
      engines: SEARXNG_ENGINES,
      urls_considered: urls.length,
      snippets_found: snippets.length,
      results: final,
      cache: { hit: false, ttlMs: CODE_WEB_CACHE_TTL_MS }
    };

    if (ENABLE_CACHE) setCache(cacheKey, output, CODE_WEB_CACHE_TTL_MS);

    return textResult(output);
  }
);

}