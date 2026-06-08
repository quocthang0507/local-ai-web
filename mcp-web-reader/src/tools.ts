import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { textResult, htmlToText, makeCacheKey } from './helper.js';
import { debugLog } from './log.js';
import { getCache, setCache, clearCache, cacheSize, cacheStats } from './cache.js';
import { htmlToMarkdown, ExtractionResult } from './extract.js';
import { getGlobalBrowser, closeGlobalBrowser, fetchWithSafety, renderUrlToSource } from './browser.js';
import { searxngSearch } from './searxng.js';
import { searchCodeWeb, githubToRaw, isGitHubRepoUrl, isGitHubFileUrl, isGistUrl } from './code_web.js';
import { searchVietnamLegal, fetchVietnamLegalDocument, buildVietnamLegalContext } from './legal_vn.js';
import { ENABLE_CACHE, SEARXNG_URL, SEARXNG_ENGINES, SEARXNG_REQUEST_HEADERS, REQUEST_TIMEOUT_MS, DEFAULT_MAX_CHARS, FETCH_CACHE_TTL_MS, SEARCH_CACHE_TTL_MS, RENDER_CACHE_TTL_MS, CODE_WEB_MAX_URLS, CODE_WEB_MAX_SNIPPETS, CODE_WEB_MAX_CHARS_PER_SNIPPET, CODE_WEB_CACHE_TTL_MS, CODE_WEB_PREFERRED_DOMAINS } from './config.js';
import { PDFParse } from 'pdf-parse';
import { extractTables, extractMetadata } from './structured.js';
import * as cheerio from 'cheerio';

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
    description: "Search the web using local SearXNG. Best for finding general information, news, or locating specific site URLs. Example: 'latest news on MCP protocol', 'who is the CEO of Google?'. Supports time ranges like 'day' or 'month' for fresh results.",
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

    try {
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
        return textResult({ error: `SearXNG error: HTTP ${response.status}` });
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
    } catch (err: any) {
      return textResult({ error: `search_web failed: ${err?.message || String(err)}` });
    }
  }
);

server.registerTool(
  "fetch_url",
  {
    description: "Fetch and extract readable plain text from a URL. Best for raw data, simple HTML, or plain text files. Automatically handles GitHub/Gist file URLs by fetching the raw source (e.g., 'https://github.com/user/repo/blob/main/index.js' -> returns raw JS). Example: 'Summarize the text from https://example.com/api-docs'.",
    inputSchema: {
    url: z.string().url().describe("URL to fetch"),
    max_chars: z.number().int().min(1000).max(30000).default(DEFAULT_MAX_CHARS)
    }
  },
  async ({ url, max_chars }) => {
    debugLog("fetch_url", { url, max_chars });

    const finalUrl = githubToRaw(url);
    const cacheKey = makeCacheKey("fetch_url", {
      url: finalUrl,
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

    try {
      const fetched = await fetchWithSafety(finalUrl);
      let text = "";
      
      if (isGitHubFileUrl(url) || isGistUrl(url)) {
        // For raw code, don't use htmlToText which might mess up formatting
        text = fetched.body.slice(0, max_chars);
      } else {
        text = htmlToText(fetched.body).slice(0, max_chars);
      }

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
    } catch (err: any) {
      return textResult({ error: `fetch_url failed: ${err?.message || String(err)}` });
    }
  }
);

server.registerTool(
  "fetch_markdown",
  {
    description: "Fetch and extract cleaned Markdown from static HTML URL. Recommended for articles, blogs, and documentation where preserving structure (headings, lists) is important. Example: 'Convert this blog post to markdown: https://example.com/blog/123'. Automatically wraps GitHub/Gist code in markdown code blocks.",
    inputSchema: {
    url: z.string().url().describe("URL to fetch"),
    max_chars: z.number().int().min(1000).max(80000).default(DEFAULT_MAX_CHARS)
    }
  },
  async ({ url, max_chars }) => {
    debugLog("fetch_markdown", { url, max_chars });

    const finalUrl = githubToRaw(url);
    const cacheKey = makeCacheKey("fetch_markdown", {
      url: finalUrl,
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

    try {
      const fetched = await fetchWithSafety(finalUrl);
      
      let output: any;

      if (isGitHubFileUrl(url) || isGistUrl(url)) {
        // If it's a code file, return it wrapped in markdown code block
        const ext = url.split('.').pop() || "";
        const code = fetched.body.slice(0, max_chars);
        output = {
          mode: "static_markdown",
          requestedUrl: url,
          finalUrl: fetched.finalUrl,
          contentType: fetched.contentType,
          markdown: "```" + ext + "\n" + code + "\n```",
          safety: "Private/local network URLs are blocked. Content is truncated before sending to the model."
        };
      } else {
        const extracted = htmlToMarkdown(fetched.body, fetched.finalUrl);
        output = {
          mode: "static_markdown",
          requestedUrl: url,
          finalUrl: fetched.finalUrl,
          contentType: fetched.contentType,
          title: extracted.title,
          excerpt: extracted.excerpt,
          byline: extracted.byline,
          siteName: extracted.siteName,
          lang: extracted.lang,
          publishedTime: extracted.publishedTime,
          markdown: extracted.markdown.slice(0, max_chars),
          safety:
            "Private/local network URLs are blocked. Content is truncated before sending to the model."
        };
      }

      output.cache = {
        hit: false,
        key: cacheKey,
        ttlMs: FETCH_CACHE_TTL_MS
      };

      if (ENABLE_CACHE) {
        setCache(cacheKey, output, FETCH_CACHE_TTL_MS);
      }

      return textResult(output);
    } catch (err: any) {
      return textResult({ error: `fetch_markdown failed: ${err?.message || String(err)}` });
    }
  }
);

server.registerTool(
  "fetch_rendered_source",
  {
    description: "Render a JavaScript-heavy SPA page (React, Vue, etc.) and return rendered HTML/text. Use this when fetch_url returns an empty page. Example: 'Render the content of this dashboard: https://app.example.com'. Supports auto-scrolling for lazy-loaded content.",
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

    try {
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
    } catch (err: any) {
      return textResult({ error: `fetch_rendered_source failed: ${err?.message || String(err)}` });
    }
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

    try {
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
        siteName: extracted.siteName,
        lang: extracted.lang,
        publishedTime: extracted.publishedTime,
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
    } catch (err: any) {
      return textResult({ error: `fetch_rendered_markdown failed: ${err?.message || String(err)}` });
    }
  }
);

server.registerTool(
  "search_code_web",
  {
    description: "Search for code snippets, implementations, and examples across the web (GitHub, StackOverflow, docs). Example: 'Python script to upload file to S3', 'Express JWT middleware example'. Ranks results based on relevance and code quality.",
    inputSchema: {
    query: z.string().min(1).max(500),
    max_snippets: z.number().int().min(1).max(50).default(10),
    language_hint: z.string().max(50).optional().describe("Optional: e.g. typescript, python, rust"),
    }
  },
  async ({ query, max_snippets, language_hint }) => {
    try {
      return textResult(
        await searchCodeWeb({
          query,
          maxSnippets: max_snippets,
          languageHint: language_hint
        })
      );
    } catch (err: any) {
      return textResult({ error: `search_code_web failed: ${err?.message || String(err)}` });
    }
  }
);

server.registerTool(
  "search_vietnam_legal",
  {
    description: "Search official Vietnamese legal, administrative-document, and public-procedure sources. Uses official domains by default (vbpl.vn, vanban.chinhphu.vn, congbao.chinhphu.vn, gov.vn, quochoi.vn). Use before answering Vietnam law or administrative document questions.",
    inputSchema: {
      query: z.string().min(1).max(700).describe("Vietnamese legal/admin query or document number"),
      max_results: z.number().int().min(1).max(10).default(5),
      mode: z.enum(["law", "administrative", "procedure", "all"]).default("all"),
      time_range: z.enum(["day", "week", "month", "year"]).optional(),
      include_unofficial: z.boolean().default(false).describe("If true, include reference sites such as thuvienphapluat.vn or luatvietnam.vn after official sources.")
    }
  },
  async ({ query, max_results, mode, time_range, include_unofficial }) => {
    try {
      return textResult(
        await searchVietnamLegal({
          query,
          maxResults: max_results,
          mode,
          timeRange: time_range,
          includeUnofficial: include_unofficial
        })
      );
    } catch (err: any) {
      return textResult({ error: `search_vietnam_legal failed: ${err?.message || String(err)}` });
    }
  }
);

server.registerTool(
  "fetch_vietnam_legal_document",
  {
    description: "Fetch a Vietnamese legal/admin document URL and extract text, Markdown, and heuristic metadata such as document number, type, authority, issue date, effective-date signals, and citations. Best after search_vietnam_legal.",
    inputSchema: {
      url: z.string().url().describe("Official document URL, HTML page, or PDF URL"),
      max_chars: z.number().int().min(1000).max(80000).default(30000),
      render: z.boolean().default(false).describe("Render with Playwright for JavaScript-heavy official pages.")
    }
  },
  async ({ url, max_chars, render }) => {
    try {
      return textResult(
        await fetchVietnamLegalDocument({
          url,
          maxChars: max_chars,
          render
        })
      );
    } catch (err: any) {
      return textResult({ error: `fetch_vietnam_legal_document failed: ${err?.message || String(err)}` });
    }
  }
);

server.registerTool(
  "vietnam_legal_qa_context",
  {
    description: "Build source-backed context for Vietnamese law, administrative document, or public-procedure Q&A. Searches official sources, fetches top documents, and returns relevant excerpts plus answer guidance. It does not provide legal advice by itself.",
    inputSchema: {
      question: z.string().min(1).max(1000).describe("Vietnamese legal/admin question"),
      max_sources: z.number().int().min(1).max(8).default(5),
      fetch_top_documents: z.number().int().min(0).max(3).default(2),
      max_chars_per_document: z.number().int().min(1000).max(30000).default(8000),
      mode: z.enum(["law", "administrative", "procedure", "all"]).default("all"),
      time_range: z.enum(["day", "week", "month", "year"]).optional(),
      include_unofficial: z.boolean().default(false)
    }
  },
  async ({
    question,
    max_sources,
    fetch_top_documents,
    max_chars_per_document,
    mode,
    time_range,
    include_unofficial
  }) => {
    try {
      return textResult(
        await buildVietnamLegalContext({
          question,
          maxSources: max_sources,
          fetchTopDocuments: fetch_top_documents,
          maxCharsPerDocument: max_chars_per_document,
          mode,
          timeRange: time_range,
          includeUnofficial: include_unofficial
        })
      );
    } catch (err: any) {
      return textResult({ error: `vietnam_legal_qa_context failed: ${err?.message || String(err)}` });
    }
  }
);

server.registerTool(
  "fetch_document",
  {
    description: "Fetch and extract text from a PDF or other supported document URL. SSRF protected.",
    inputSchema: {
      url: z.string().url().describe("URL to the document (e.g. .pdf)"),
      max_chars: z.number().int().min(1000).max(80000).default(DEFAULT_MAX_CHARS)
    }
  },
  async ({ url, max_chars }) => {
    debugLog("fetch_document", { url, max_chars });

    const cacheKey = makeCacheKey("fetch_document", { url, max_chars });

    if (ENABLE_CACHE) {
      const cached = getCache<any>(cacheKey);
      if (cached) return textResult({ ...cached, cache: { hit: true } });
    }

    try {
      const fetched = await fetchWithSafety(url);

      if (fetched.contentType.includes("application/pdf")) {
        const parser = new PDFParse({ data: fetched.buffer });
        const textData = await parser.getText();
        const info = await parser.getInfo();

        const output = {
          mode: "pdf_extraction",
          requestedUrl: url,
          finalUrl: fetched.finalUrl,
          numPages: textData.pages.length,
          metadata: info.metadata,
          info: info.info,
          text: textData.text.slice(0, max_chars),
          safety: "Content is truncated before sending to the model.",
          cache: { hit: false, ttlMs: FETCH_CACHE_TTL_MS }
        };
        if (ENABLE_CACHE) setCache(cacheKey, output, FETCH_CACHE_TTL_MS);
        return textResult(output);
      }

      return textResult({
        error: `Unsupported document content-type: ${fetched.contentType}. Use fetch_url for HTML/text.`
      });
    } catch (err: any) {
      return textResult({ error: `fetch_document failed: ${err?.message || String(err)}` });
    }
  }
);

server.registerTool(
  "extract_structured_data",
  {
    description: "Extract HTML tables (as Markdown) and JSON-LD metadata from a URL. Best for pricing tables, product specs, or structured SEO data. Example: 'Get the pricing table from https://example.com/pricing'.",
    inputSchema: {
      url: z.string().url().describe("URL to extract from"),
      render: z.boolean().default(false).describe("If true, use Playwright to render JS before extraction"),
      max_table_chars: z.number().int().min(1000).max(80000).default(DEFAULT_MAX_CHARS)
    }
  },
  async ({ url, render, max_table_chars }) => {
    debugLog("extract_structured_data", { url, render, max_table_chars });

    const cacheKey = makeCacheKey("extract_structured_data", { url, render, max_table_chars });

    if (ENABLE_CACHE) {
      const cached = getCache<any>(cacheKey);
      if (cached) return textResult({ ...cached, cache: { hit: true } });
    }

    try {
      let html = "";
      let finalUrl = url;

      if (render) {
        const rendered = await renderUrlToSource(url, {
          includeHtml: true,
          includeText: false,
          maxHtmlChars: 500000,
          maxTextChars: 1000
        });
        html = rendered.renderedHtml || "";
        finalUrl = rendered.finalUrl;
      } else {
        const fetched = await fetchWithSafety(url);
        html = fetched.body;
        finalUrl = fetched.finalUrl;
      }

      const allTables = extractTables(html);
      const metadata = extractMetadata(html);

      const truncatedTables = [];
      let currentChars = 0;
      for (const t of allTables) {
        if (currentChars + t.length > max_table_chars) break;
        truncatedTables.push(t);
        currentChars += t.length;
      }

      const output = {
        requestedUrl: url,
        finalUrl,
        tables: truncatedTables,
        metadata,
        safety: "Content is truncated before sending to the model.",
        cache: { hit: false, ttlMs: FETCH_CACHE_TTL_MS }
      };

      if (ENABLE_CACHE) setCache(cacheKey, output, FETCH_CACHE_TTL_MS);

      return textResult(output);
    } catch (err: any) {
      return textResult({ error: `extract_structured_data failed: ${err?.message || String(err)}` });
    }
  }
);

server.registerTool(
  "list_github_repo",
  {
    description: "List files and directories in a GitHub repository or subdirectory. Best for exploring a project's structure before reading specific files. Example: 'List the contents of https://github.com/google/mcp-sdk-typescript'.",
    inputSchema: {
      url: z.string().url().describe("GitHub repository or tree URL (e.g. https://github.com/user/repo)"),
    }
  },
  async ({ url }) => {
    debugLog("list_github_repo", { url });

    if (!isGitHubRepoUrl(url)) {
      return textResult({ error: "Invalid GitHub repository or tree URL. Must be like https://github.com/user/repo or https://github.com/user/repo/tree/branch/path" });
    }

    const cacheKey = makeCacheKey("list_github_repo", { url });
    if (ENABLE_CACHE) {
      const cached = getCache<any>(cacheKey);
      if (cached) return textResult({ ...cached, cache: { hit: true } });
    }

    try {
      // Use Playwright to scrape the file list
      const rendered = await renderUrlToSource(url, {
        includeHtml: true,
        includeText: false,
        maxHtmlChars: 500000,
        maxTextChars: 1000,
        waitMs: 1000
      });

      const $ = cheerio.load(rendered.renderedHtml || "");
      const items: Array<{ name: string; type: 'file' | 'directory'; url: string }> = [];

      // Modern GitHub UI (React-based)
      $('div[role="row"]').each((_, row) => {
        const link = $(row).find('a[href*="/blob/"], a[href*="/tree/"]').first();
        if (link.length) {
          const href = link.attr('href') || "";
          const name = link.text().trim();
          const type = href.includes("/blob/") ? 'file' : 'directory';
          const fullUrl = new URL(href, "https://github.com").toString();
          if (name && name !== ".." && !name.includes("Permalink")) {
             items.push({ name, type, url: fullUrl });
          }
        }
      });

      // Fallback for older/other parts of UI
      if (items.length === 0) {
        $('.js-navigation-item').each((_, item) => {
          const link = $(item).find('.js-navigation-open').first();
          if (link.length) {
            const href = link.attr('href') || "";
            const name = link.text().trim();
            const type = href.includes("/blob/") ? 'file' : 'directory';
            const fullUrl = new URL(href, "https://github.com").toString();
            if (name && name !== ".." && !items.find(i => i.name === name)) {
              items.push({ name, type, url: fullUrl });
            }
          }
        });
      }

      const output = {
        url,
        finalUrl: rendered.finalUrl,
        repo: url.split('/').slice(0, 5).join('/'),
        items,
        cache: { hit: false, key: cacheKey, ttlMs: FETCH_CACHE_TTL_MS }
      };

      if (ENABLE_CACHE) {
        setCache(cacheKey, output, FETCH_CACHE_TTL_MS);
      }

      return textResult(output);
    } catch (err: any) {
      return textResult({ error: `list_github_repo failed: ${err?.message || String(err)}` });
    }
  }
);

}
