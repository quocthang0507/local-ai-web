import express from "express";
import swaggerUi from "swagger-ui-express";
import cors from "cors";
import { swaggerDocument } from "./swagger.js";
import { cacheSize, clearCache, cacheStats, getCache, setCache } from "./cache.js";
import { closeGlobalBrowser, getGlobalBrowser, fetchWithSafety, renderUrlToSource } from "./browser.js";
import { SEARXNG_URL, ENABLE_CACHE, SEARXNG_REQUEST_HEADERS, REQUEST_TIMEOUT_MS, SEARXNG_ENGINES, FETCH_CACHE_TTL_MS, RENDER_CACHE_TTL_MS, SEARCH_CACHE_TTL_MS, CODE_WEB_MAX_URLS, CODE_WEB_MAX_SNIPPETS, CODE_WEB_MAX_CHARS_PER_SNIPPET, CODE_WEB_CACHE_TTL_MS, CODE_WEB_PREFERRED_DOMAINS } from "./config.js";
import { makeCacheKey, htmlToText } from "./helper.js";
import { htmlToMarkdown } from "./extract.js";
import { extractTables, extractMetadata } from "./structured.js";
import { rewriteQueries, filterUrls, fetchSnippetsFromUrl, truncateCode, scoreSnippet } from "./code_web.js";
import { searxngSearch } from "./searxng.js";
import { PDFParse } from "pdf-parse";

const app = express();
const port = process.env.API_PORT || 3000;

app.use(cors());
app.use(express.json());

// Mount Swagger UI
app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Routes
app.get("/health", async (req, res) => {
  const checks: Record<string, unknown> = {
    api: "ok",
    searxng: "unknown",
    playwright: "unknown",
    cacheEnabled: ENABLE_CACHE,
    cacheSize: cacheSize()
  };

  try {
    const endpoint = new URL("/search", SEARXNG_URL);
    endpoint.searchParams.set("q", "test");
    endpoint.searchParams.set("format", "json");

    const response = await fetch(endpoint, {
      headers: SEARXNG_REQUEST_HEADERS,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    checks.searxng = response.ok ? "ok" : `error_http_${response.status}`;
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

  res.json(checks);
});

app.get("/cache/stats", (req, res) => {
  res.json(cacheStats());
});

app.post("/cache/clear", (req, res) => {
  const cleared = clearCache();
  res.json({ clearedEntries: cleared, cacheSize: cacheSize() });
});

app.post("/browser/close", async (req, res) => {
  await closeGlobalBrowser();
  res.json({ status: "Browser closed successfully." });
});

app.post("/api/search", async (req, res) => {
  const { query, max_results = 5, language, time_range } = req.body;
  if (!query) return res.status(400).json({ error: "query is required" });

  const cacheKey = makeCacheKey("search_web", { query, max_results, language: language || "", time_range: time_range || "", engines: SEARXNG_ENGINES.join(",") });

  if (ENABLE_CACHE) {
    const cached = getCache<any>(cacheKey);
    if (cached) return res.json({ ...cached, cache: { hit: true, key: cacheKey } });
  }

  try {
    const endpoint = new URL("/search", SEARXNG_URL);
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("format", "json");
    if (language) endpoint.searchParams.set("language", language);
    if (time_range) endpoint.searchParams.set("time_range", time_range);
    if (SEARXNG_ENGINES.length > 0) endpoint.searchParams.set("engines", SEARXNG_ENGINES.join(","));

    const response = await fetch(endpoint, {
      headers: SEARXNG_REQUEST_HEADERS,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });

    if (!response.ok) return res.status(response.status).json({ error: `SearXNG error: HTTP ${response.status}` });

    const data: any = await response.json();
    const results = Array.isArray(data.results) ? data.results : [];

    const compact = results.slice(0, max_results).map((r: any) => ({
      title: r.title || "",
      url: r.url || "",
      snippet: r.content || "",
      source: (() => { try { return new URL(r.url).hostname; } catch { return ""; } })()
    }));

    const output = { query, backend: "searxng", engines: SEARXNG_ENGINES, results: compact, cache: { hit: false, key: cacheKey, ttlMs: SEARCH_CACHE_TTL_MS } };
    if (ENABLE_CACHE) setCache(cacheKey, output, SEARCH_CACHE_TTL_MS);
    res.json(output);
  } catch (err: any) {
    res.status(500).json({ error: `search_web failed: ${err?.message || String(err)}` });
  }
});

app.post("/api/fetch/static", async (req, res) => {
  const { url, max_chars = 12000 } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });

  const cacheKey = makeCacheKey("fetch_url", { url, max_chars });
  if (ENABLE_CACHE) {
    const cached = getCache<any>(cacheKey);
    if (cached) return res.json({ ...cached, cache: { hit: true, key: cacheKey } });
  }

  try {
    const fetched = await fetchWithSafety(url);
    const text = htmlToText(fetched.body).slice(0, max_chars);
    const output = { mode: "static_fetch", requestedUrl: url, finalUrl: fetched.finalUrl, contentType: fetched.contentType, text, cache: { hit: false, key: cacheKey, ttlMs: FETCH_CACHE_TTL_MS } };
    if (ENABLE_CACHE) setCache(cacheKey, output, FETCH_CACHE_TTL_MS);
    res.json(output);
  } catch (err: any) {
    res.status(500).json({ error: `fetch_url failed: ${err?.message || String(err)}` });
  }
});

app.post("/api/fetch/rendered/source", async (req, res) => {
  const { url, include_text = true, include_html = true, max_text_chars = 20000, max_html_chars = 60000, wait_ms, scroll_steps } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });

  const cacheKey = makeCacheKey("fetch_rendered_source", { url, include_text, include_html, max_text_chars, max_html_chars, wait_ms: wait_ms ?? "", scroll_steps: scroll_steps ?? "" });
  if (ENABLE_CACHE) {
    const cached = getCache<any>(cacheKey);
    if (cached) return res.json({ ...cached, cache: { hit: true, key: cacheKey } });
  }

  try {
    const rendered = await renderUrlToSource(url, { includeText: include_text, includeHtml: include_html, maxTextChars: max_text_chars, maxHtmlChars: max_html_chars, waitMs: wait_ms, scrollSteps: scroll_steps });
    const output = { mode: "rendered_source", ...rendered, cache: { hit: false, key: cacheKey, ttlMs: RENDER_CACHE_TTL_MS } };
    if (ENABLE_CACHE) setCache(cacheKey, output, RENDER_CACHE_TTL_MS);
    res.json(output);
  } catch (err: any) {
    res.status(500).json({ error: `fetch_rendered_source failed: ${err?.message || String(err)}` });
  }
});

app.post("/api/fetch/rendered/markdown", async (req, res) => {
  const { url, max_chars = 30000, wait_ms, scroll_steps } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });

  const cacheKey = makeCacheKey("fetch_rendered_markdown", { url, max_chars, wait_ms: wait_ms ?? "", scroll_steps: scroll_steps ?? "" });
  if (ENABLE_CACHE) {
    const cached = getCache<any>(cacheKey);
    if (cached) return res.json({ ...cached, cache: { hit: true, key: cacheKey } });
  }

  try {
    const rendered = await renderUrlToSource(url, { includeText: false, includeHtml: true, maxTextChars: 1000, maxHtmlChars: 200000, waitMs: wait_ms, scrollSteps: scroll_steps });
    const extracted = htmlToMarkdown(rendered.renderedHtml || "", rendered.finalUrl);
    const output = { mode: "rendered_markdown", requestedUrl: rendered.requestedUrl, finalUrl: rendered.finalUrl, title: extracted.title || rendered.title, excerpt: extracted.excerpt, byline: extracted.byline, markdown: extracted.markdown.slice(0, max_chars), requestReport: rendered.requestReport, cache: { hit: false, key: cacheKey, ttlMs: RENDER_CACHE_TTL_MS } };
    if (ENABLE_CACHE) setCache(cacheKey, output, RENDER_CACHE_TTL_MS);
    res.json(output);
  } catch (err: any) {
    res.status(500).json({ error: `fetch_rendered_markdown failed: ${err?.message || String(err)}` });
  }
});

app.post("/api/fetch/document", async (req, res) => {
  const { url, max_chars = 12000 } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });

  const cacheKey = makeCacheKey("fetch_document", { url, max_chars });
  if (ENABLE_CACHE) {
    const cached = getCache<any>(cacheKey);
    if (cached) return res.json({ ...cached, cache: { hit: true, key: cacheKey } });
  }

  try {
    const fetched = await fetchWithSafety(url);
    if (fetched.contentType.includes("application/pdf")) {
      const parser = new PDFParse({ data: fetched.buffer });
      const textData = await parser.getText();
      const info = await parser.getInfo();
      const output = { mode: "pdf_extraction", requestedUrl: url, finalUrl: fetched.finalUrl, numPages: textData.pages.length, metadata: info.metadata, info: info.info, text: textData.text.slice(0, max_chars), cache: { hit: false, ttlMs: FETCH_CACHE_TTL_MS } };
      if (ENABLE_CACHE) setCache(cacheKey, output, FETCH_CACHE_TTL_MS);
      return res.json(output);
    }
    res.status(400).json({ error: `Unsupported document content-type: ${fetched.contentType}.` });
  } catch (err: any) {
    res.status(500).json({ error: `fetch_document failed: ${err?.message || String(err)}` });
  }
});

app.post("/api/extract/structured", async (req, res) => {
  const { url, render = false, max_table_chars = 12000 } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });

  const cacheKey = makeCacheKey("extract_structured_data", { url, render, max_table_chars });
  if (ENABLE_CACHE) {
    const cached = getCache<any>(cacheKey);
    if (cached) return res.json({ ...cached, cache: { hit: true, key: cacheKey } });
  }

  try {
    let html = "";
    let finalUrl = url;
    if (render) {
      const rendered = await renderUrlToSource(url, { includeHtml: true, includeText: false, maxHtmlChars: 500000, maxTextChars: 1000 });
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

    const output = { requestedUrl: url, finalUrl, tables: truncatedTables, metadata, cache: { hit: false, ttlMs: FETCH_CACHE_TTL_MS } };
    if (ENABLE_CACHE) setCache(cacheKey, output, FETCH_CACHE_TTL_MS);
    res.json(output);
  } catch (err: any) {
    res.status(500).json({ error: `extract_structured_data failed: ${err?.message || String(err)}` });
  }
});

app.post("/api/search/code", async (req, res) => {
  const { query, max_snippets = 10, language_hint } = req.body;
  if (!query) return res.status(400).json({ error: "query is required" });

  const enhancedQueries = rewriteQueries(query);
  const cacheKey = `search_code_web:${JSON.stringify({ query, enhancedQueries, max_snippets, language_hint: language_hint || "", engines: SEARXNG_ENGINES })}`;

  if (ENABLE_CACHE) {
    const cached = getCache<any>(cacheKey);
    if (cached) return res.json({ ...cached, cache: { hit: true } });
  }

  try {
    const allResults: Array<{ title: string; url: string; snippet: string }> = [];
    await Promise.allSettled(
      enhancedQueries.map(async (q) => {
        try {
          const rs = await searxngSearch(q, 5, undefined, SEARXNG_ENGINES);
          for (const r of rs) {
            if (r.url) allResults.push(r);
          }
        } catch { }
      })
    );

    const allUrls = Array.from(new Set(allResults.map(r => r.url).filter(Boolean)));
    const urls = filterUrls(allUrls, CODE_WEB_PREFERRED_DOMAINS, CODE_WEB_MAX_URLS);

    const snippets: Array<any> = [];
    const concurrencyLimit = 4;
    const PER_URL_TIMEOUT_MS = 12000;
    for (let i = 0; i < urls.length; i += concurrencyLimit) {
      const batch = urls.slice(i, i + concurrencyLimit);
      await Promise.allSettled(
        batch.map(async (url) => {
          try {
            const blocks = await Promise.race([
              fetchSnippetsFromUrl(url),
              new Promise<never>((_, reject) => setTimeout(() => reject(new Error("per-url timeout")), PER_URL_TIMEOUT_MS))
            ]);
            for (const b of blocks) {
              if (snippets.length >= CODE_WEB_MAX_SNIPPETS) continue;
              if (language_hint && b.lang && b.lang.toLowerCase() !== language_hint.toLowerCase()) continue;
              const code = truncateCode(b.code, CODE_WEB_MAX_CHARS_PER_SNIPPET);
              const score = scoreSnippet(url, code, b.lang);
              snippets.push({ url, source: (() => { try { return new URL(url).hostname; } catch { return ""; } })(), lang: b.lang, code, score });
            }
          } catch { }
        })
      );
    }

    snippets.sort((a, b) => b.score - a.score);
    const final = snippets.slice(0, max_snippets);

    const output = { query, engines: SEARXNG_ENGINES, urls_considered: urls.length, snippets_found: snippets.length, results: final, cache: { hit: false, ttlMs: CODE_WEB_CACHE_TTL_MS } };
    if (ENABLE_CACHE) setCache(cacheKey, output, CODE_WEB_CACHE_TTL_MS);
    res.json(output);
  } catch (err: any) {
    res.status(500).json({ error: `search_code_web failed: ${err?.message || String(err)}` });
  }
});

app.listen(port, () => {
  console.log(`API Server listening at http://localhost:${port}`);
  console.log(`Swagger UI available at http://localhost:${port}/docs`);
});
