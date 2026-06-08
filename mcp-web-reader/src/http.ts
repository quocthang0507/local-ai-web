import express from "express";
import swaggerUi from "swagger-ui-express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { swaggerDocument } from "./swagger.js";
import { cacheSize, clearCache, cacheStats, getCache, setCache } from "./cache.js";
import { closeGlobalBrowser, getGlobalBrowser, fetchWithSafety, renderUrlToSource } from "./browser.js";
import { SEARXNG_URL, ENABLE_CACHE, SEARXNG_REQUEST_HEADERS, REQUEST_TIMEOUT_MS, SEARXNG_ENGINES, FETCH_CACHE_TTL_MS, RENDER_CACHE_TTL_MS, SEARCH_CACHE_TTL_MS, CODE_WEB_MAX_URLS, CODE_WEB_MAX_SNIPPETS, CODE_WEB_MAX_CHARS_PER_SNIPPET, CODE_WEB_CACHE_TTL_MS, CODE_WEB_PREFERRED_DOMAINS } from "./config.js";
import { makeCacheKey, htmlToText } from "./helper.js";
import { htmlToMarkdown } from "./extract.js";
import { extractTables, extractMetadata } from "./structured.js";
import { searchCodeWeb, githubToRaw, isGitHubRepoUrl, isGitHubFileUrl, isGistUrl } from "./code_web.js";
import { searchVietnamLegal, fetchVietnamLegalDocument, buildVietnamLegalContext } from "./legal_vn.js";
import { translateText } from "./translate.js";
import { searxngSearch } from "./searxng.js";
import { PDFParse } from "pdf-parse";
import * as cheerio from "cheerio";

const app = express();
const port = process.env.API_PORT || 3000;
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "public");

app.use(cors());
app.use(express.json());
app.use(express.static(publicDir));

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

app.post("/api/translate", async (req, res) => {
  const {
    text,
    source_lang = "auto",
    target_lang = "vi",
    provider = "auto"
  } = req.body;

  if (!text) return res.status(400).json({ error: "text is required" });

  const cacheKey = makeCacheKey("translate_text", {
    text,
    source_lang,
    target_lang,
    provider
  });

  if (ENABLE_CACHE) {
    const cached = getCache<any>(cacheKey);
    if (cached) return res.json({ ...cached, cache: { hit: true, key: cacheKey } });
  }

  try {
    const output = await translateText({
      text,
      sourceLang: source_lang,
      targetLang: target_lang,
      provider
    });

    const cachedOutput = {
      ...output,
      cache: { hit: false, key: cacheKey, ttlMs: FETCH_CACHE_TTL_MS }
    };

    if (ENABLE_CACHE) setCache(cacheKey, cachedOutput, FETCH_CACHE_TTL_MS);
    res.json(cachedOutput);
  } catch (err: any) {
    res.status(500).json({ error: `translate failed: ${err?.message || String(err)}` });
  }
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

  const finalUrl = githubToRaw(url);
  const cacheKey = makeCacheKey("fetch_url", { url: finalUrl, max_chars });
  if (ENABLE_CACHE) {
    const cached = getCache<any>(cacheKey);
    if (cached) return res.json({ ...cached, cache: { hit: true, key: cacheKey } });
  }

  try {
    const fetched = await fetchWithSafety(finalUrl);
    let text = "";
    if (isGitHubFileUrl(url) || isGistUrl(url)) {
      text = fetched.body.slice(0, max_chars);
    } else {
      text = htmlToText(fetched.body).slice(0, max_chars);
    }
    const output = { mode: "static_fetch", requestedUrl: url, finalUrl: fetched.finalUrl, contentType: fetched.contentType, text, cache: { hit: false, key: cacheKey, ttlMs: FETCH_CACHE_TTL_MS } };
    if (ENABLE_CACHE) setCache(cacheKey, output, FETCH_CACHE_TTL_MS);
    res.json(output);
  } catch (err: any) {
    res.status(500).json({ error: `fetch_url failed: ${err?.message || String(err)}` });
  }
});

app.post("/api/fetch/markdown", async (req, res) => {
  const { url, max_chars = 30000 } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });

  const finalUrl = githubToRaw(url);
  const cacheKey = makeCacheKey("fetch_markdown", { url: finalUrl, max_chars });
  if (ENABLE_CACHE) {
    const cached = getCache<any>(cacheKey);
    if (cached) return res.json({ ...cached, cache: { hit: true, key: cacheKey } });
  }

  try {
    const fetched = await fetchWithSafety(finalUrl);
    let output: any;

    if (isGitHubFileUrl(url) || isGistUrl(url)) {
      const ext = url.split(".").pop() || "";
      const code = fetched.body.slice(0, max_chars);
      output = {
        mode: "static_markdown",
        requestedUrl: url,
        finalUrl: fetched.finalUrl,
        contentType: fetched.contentType,
        markdown: "```" + ext + "\n" + code + "\n```"
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
        markdown: extracted.markdown.slice(0, max_chars)
      };
    }

    output.cache = { hit: false, key: cacheKey, ttlMs: FETCH_CACHE_TTL_MS };
    if (ENABLE_CACHE) setCache(cacheKey, output, FETCH_CACHE_TTL_MS);
    res.json(output);
  } catch (err: any) {
    res.status(500).json({ error: `fetch_markdown failed: ${err?.message || String(err)}` });
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

app.post("/api/list/github", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });

  if (!isGitHubRepoUrl(url)) {
    return res.status(400).json({ error: "Invalid GitHub repository or tree URL." });
  }

  const cacheKey = makeCacheKey("list_github_repo", { url });
  if (ENABLE_CACHE) {
    const cached = getCache<any>(cacheKey);
    if (cached) return res.json({ ...cached, cache: { hit: true } });
  }

  try {
    const rendered = await renderUrlToSource(url, { includeHtml: true, includeText: false, maxHtmlChars: 500000, maxTextChars: 1000, waitMs: 1000 });
    const $ = cheerio.load(rendered.renderedHtml || "");
    const items: Array<any> = [];

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

    const output = { url, finalUrl: rendered.finalUrl, repo: url.split('/').slice(0, 5).join('/'), items, cache: { hit: false, key: cacheKey, ttlMs: FETCH_CACHE_TTL_MS } };
    if (ENABLE_CACHE) setCache(cacheKey, output, FETCH_CACHE_TTL_MS);
    res.json(output);
  } catch (err: any) {
    res.status(500).json({ error: `list_github_repo failed: ${err?.message || String(err)}` });
  }
});

app.post("/api/search/code", async (req, res) => {
  const { query, max_snippets = 10, language_hint } = req.body;
  if (!query) return res.status(400).json({ error: "query is required" });

  try {
    res.json(await searchCodeWeb({ query, maxSnippets: max_snippets, languageHint: language_hint }));
  } catch (err: any) {
    res.status(500).json({ error: `search_code_web failed: ${err?.message || String(err)}` });
  }
});

app.post("/api/search/vietnam-legal", async (req, res) => {
  const {
    query,
    max_results = 5,
    mode = "all",
    time_range,
    include_unofficial = false
  } = req.body;

  if (!query) return res.status(400).json({ error: "query is required" });

  try {
    res.json(
      await searchVietnamLegal({
        query,
        maxResults: max_results,
        mode,
        timeRange: time_range,
        includeUnofficial: include_unofficial
      })
    );
  } catch (err: any) {
    res.status(500).json({ error: `search_vietnam_legal failed: ${err?.message || String(err)}` });
  }
});

app.post("/api/fetch/vietnam-legal", async (req, res) => {
  const { url, max_chars = 30000, render = false } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });

  try {
    res.json(await fetchVietnamLegalDocument({ url, maxChars: max_chars, render }));
  } catch (err: any) {
    res.status(500).json({ error: `fetch_vietnam_legal_document failed: ${err?.message || String(err)}` });
  }
});

app.post("/api/context/vietnam-legal", async (req, res) => {
  const {
    question,
    max_sources = 5,
    fetch_top_documents = 2,
    max_chars_per_document = 8000,
    mode = "all",
    time_range,
    include_unofficial = false
  } = req.body;

  if (!question) return res.status(400).json({ error: "question is required" });

  try {
    res.json(
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
    res.status(500).json({ error: `vietnam_legal_qa_context failed: ${err?.message || String(err)}` });
  }
});

// Helper function to render a beautiful HTML error page for server-side issues
function renderServerError(statusCode: number, title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <title>${statusCode} - ${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css">
  <style>
    body {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #f7f8fa;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      margin: 0;
      color: #172033;
    }
    .error-card {
      max-width: 480px;
      width: 100%;
      text-align: center;
      padding: 40px 32px;
      background: #ffffff;
      border: 1px solid #d8dee8;
      border-radius: 12px;
      box-shadow: 0 18px 45px rgba(39, 50, 72, 0.08);
    }
    .error-code {
      font-size: 72px;
      font-weight: 800;
      color: #be123c;
      line-height: 1;
      margin: 0 0 16px 0;
    }
    .error-title {
      font-size: 24px;
      font-weight: 700;
      margin: 0 0 12px 0;
    }
    .error-message {
      font-size: 15px;
      color: #647083;
      line-height: 1.6;
      margin: 0 0 28px 0;
    }
    .home-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 10px 20px;
      border-radius: 8px;
      background: #2563eb;
      color: #ffffff;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      border: 0;
      transition: background 0.2s ease;
    }
    .home-btn:hover {
      background: #1d4ed8;
      color: #ffffff;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="error-card">
    <div class="error-code">${statusCode}</div>
    <h1 class="error-title">${title}</h1>
    <p class="error-message">${message}</p>
    <a href="/" class="home-btn">Quay lại Trang chủ</a>
  </div>
</body>
</html>`;
}

// Fallback for unmatched API routes
app.use("/api", (req, res) => {
  res.status(404).json({ error: "API endpoint không tồn tại hoặc phương thức không hợp lệ." });
});

// Define list of valid Angular frontend client routes
const validClientRoutes = ["/", "/results", "/translate", "/error"];

// Fallback to index.html for Angular SPA client-side routing, or return 404 for unknown routes/assets
app.get("*splat", (req, res) => {
  const hasExtension = path.extname(req.path) !== "";
  const cleanPath = req.path.replace(/\/$/, "") || "/";

  if (hasExtension) {
    res.status(404).send(renderServerError(404, "Không tìm thấy tài nguyên", `Tài nguyên tĩnh '${req.path}' không tồn tại trên máy chủ.`));
  } else if (validClientRoutes.includes(cleanPath)) {
    res.sendFile(path.join(publicDir, "index.html"));
  } else {
    res.status(404).send(renderServerError(404, "Không tìm thấy trang", `Đường dẫn '${req.path}' không tồn tại hoặc đã bị di chuyển.`));
  }
});

// Global Error Handler Middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Internal Server Error:", err);
  const statusCode = err.status || err.statusCode || 500;
  const title = statusCode === 404 ? "Không Tìm Thấy" : "Lỗi Máy Chủ Nội Bộ";
  const message = err.message || "Đã xảy ra lỗi không xác định trên máy chủ.";

  if (req.originalUrl.startsWith("/api/")) {
    return res.status(statusCode).json({ error: message });
  }
  res.status(statusCode).send(renderServerError(statusCode, title, message));
});

app.listen(port, () => {
  console.log(`Web app available at http://localhost:${port}`);
  console.log(`API Server listening at http://localhost:${port}`);
  console.log(`Swagger UI available at http://localhost:${port}/docs`);
});
