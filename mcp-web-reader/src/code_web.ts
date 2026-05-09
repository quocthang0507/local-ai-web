import { fetchWithSafety, renderUrlToSource } from "./browser.js";
import { htmlToMarkdown } from "./extract.js";
import { decodeBasicEntities } from "./helper.js";

export type WebCodeSnippet = {
  url: string;
  source: string;     // hostname
  lang?: string;      // from ```lang
  code: string;       // cleaned
  score: number;      // heuristic score
  title?: string;     // optional
};

function splitCsv(s: string): string[] {
  return s.split(",").map(x => x.trim()).filter(Boolean);
}

export function preferredDomains(): string[] {
  return splitCsv(process.env.CODE_WEB_PREFERRED_DOMAINS || "");
}

export function rewriteQueries(q: string): string[] {
  const base = q.trim();

  // Step-back rewrite: biến query thành dạng retrieval-friendly [1](https://dev.to/yaruyng/query-rewrite-in-rag-systems-why-it-matters-and-how-it-works-3mmd)
  const expanded = base
    .replace(/\?.*$/, "") // remove question noise

  return [
    `${expanded} code example`,
    `${expanded} implementation`,
    `${expanded} github example`,
    `${expanded} stackoverflow solution`,
    `${expanded} snippet`,
  ];
}

export function filterUrls(urls: string[], preferred: string[], maxUrls: number): string[] {
  const uniq = Array.from(new Set(urls));

  return uniq
    .map(url => ({
      url,
      score: scoreDomain(url)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, maxUrls)
    .map(x => x.url);
}

// Extract fenced code blocks from markdown
export function extractFencedCodeBlocks(md: string): Array<{ lang?: string; code: string }> {
  const blocks: Array<{ lang?: string; code: string }> = [];
  const re = /```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g;

  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) {
    const lang = (m[1] || "").trim() || undefined;
    const code = (m[2] || "").trim();
    if (code) {
      if (code.length < 20) continue; // bỏ snippet quá nhỏ
      if (code.length > 5000) continue; // bỏ snippet quá lớn
      blocks.push({ lang, code });
    }
  }
  return blocks;
}

// Optional: Extract <pre><code> blocks from HTML string (fallback if you use rendered HTML)
export function extractPreCodeBlocksFromHtml(html: string): string[] {
  const blocks: string[] = [];

  // Pattern 1: <pre><code>...</code></pre> (Stack Overflow, docs sites)
  const re1 = /<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi;
  let m: RegExpExecArray | null;
  while ((m = re1.exec(html))) {
    const code = decodeBasicEntities((m[1] || "").replace(/<[^>]+>/g, "")).trim();
    if (code && code.length >= 20 && code.length <= 10000) blocks.push(code);
  }

  if (blocks.length > 0) return blocks;

  // Pattern 2: bare <pre>...</pre> (GitHub syntax-highlighted <span>, many blogs)
  // Strip inner HTML tags to recover plain code text.
  const re2 = /<pre[^>]*>([\s\S]*?)<\/pre>/gi;
  while ((m = re2.exec(html))) {
    const code = decodeBasicEntities((m[1] || "").replace(/<[^>]+>/g, "")).trim();
    if (code && code.length >= 20 && code.length <= 10000) blocks.push(code);
  }

  return blocks;
}

export function truncateSnippet(code: string, maxChars: number): string {
  if (code.length <= maxChars) return code;
  return code.slice(0, maxChars) + "\n/* …truncated… */";
}

export function detectLanguage(query: string): string | undefined {
  if (query.includes("python")) return "python";
  if (query.includes("node") || query.includes("express")) return "javascript";
  if (query.includes("golang")) return "go";
  return undefined;
}

function hostMatchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

export function scoreDomain(url: string): number {
  const lowerUrl = url.toLowerCase();
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostMatchesDomain(hostname, "github.com")) return 5;
    if (hostMatchesDomain(hostname, "gist.github.com")) return 5;
    if (hostMatchesDomain(hostname, "stackoverflow.com")) return 4;
    if (hostMatchesDomain(hostname, "stackexchange.com")) return 4;
    if (hostMatchesDomain(hostname, "gitlab.com")) return 3;
    if (hostMatchesDomain(hostname, "bitbucket.org")) return 3;
  } catch {
    // Keep heuristic fallback behavior for malformed/non-absolute URLs.
  }

  if (lowerUrl.includes("docs") || lowerUrl.includes("developer")) return 3;
  return 1;
}

export function githubToRaw(url: string): string {
  try {
    const u = new URL(url);

    // Support for gist.github.com
    if (u.hostname === "gist.github.com") {
      const parts = u.pathname.split("/").filter(Boolean);
      // format: /user/id or just /id
      if (parts.length >= 2) {
        return `https://gist.githubusercontent.com/${parts[0]}/${parts[1]}/raw`;
      } else if (parts.length === 1) {
        return `https://gist.githubusercontent.com/anonymous/${parts[0]}/raw`;
      }
      return url;
    }

    // Support for github.com
    if (u.hostname !== "github.com") return url;

    const parts = u.pathname.split("/");

    // format: /user/repo/blob/branch/path or /user/repo/raw/branch/path
    if (parts.length > 5 && (parts[3] === "blob" || parts[3] === "raw")) {
      const user = parts[1];
      const repo = parts[2];
      const branch = parts[4];
      const filePath = parts.slice(5).join("/");

      return `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${filePath}`;
    }

    return url;
  } catch {
    return url;
  }
}

export function isProbablyRawCodeUrl(url: string): boolean {
  return (
    url.startsWith("https://raw.githubusercontent.com/") ||
    url.startsWith("https://gist.githubusercontent.com/")
  );
}

function isHostOrSubdomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function scoreSnippet(url: string, code: string, lang?: string): number {
  let score = 0;

  const host = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } })();

  if (
    isHostOrSubdomain(host, "github.com") ||
    isHostOrSubdomain(host, "raw.githubusercontent.com") ||
    isHostOrSubdomain(host, "gist.github.com") ||
    isHostOrSubdomain(host, "gist.githubusercontent.com")
  ) {
    score += 5;
  }
  if (isHostOrSubdomain(host, "stackoverflow.com") || isHostOrSubdomain(host, "stackexchange.com")) score += 4;
  if (
    isHostOrSubdomain(host, "developer.mozilla.org") ||
    isHostOrSubdomain(host, "learn.microsoft.com") ||
    host.startsWith("docs.") ||
    isHostOrSubdomain(host, "gitlab.com")
  ) {
    score += 3;
  }

  const lines = code.split(/\r?\n/).length;
  if (lines >= 5 && lines <= 80) score += 3;
  if (lines > 200) score -= 2;

  if (/\b(import|require\(|def|class|function)\b/.test(code)) score += 2;
  if (lang) score += 1;

  return score;
}

export function truncateCode(code: string, maxChars: number): string {
  if (code.length <= maxChars) return code;
  return code.slice(0, maxChars) + "\n/* …truncated… */";
}

export async function fetchSnippetsFromUrl(url: string): Promise<Array<{ lang?: string; code: string }>> {
  const finalUrl = githubToRaw(url);

  // 1) GitHub raw → treat entire response as code
  if (isProbablyRawCodeUrl(finalUrl)) {
    const fetched = await fetchWithSafety(finalUrl);
    const code = fetched.body;
    return code.trim() ? [{ code, lang: undefined }] : [];
  }

  // 2) For normal pages: try plain HTTP fetch first (fast; most code sites serve HTML directly),
  //    then fall back to Playwright for JS-rendered pages only if needed.
  let html = "";
  let finalRenderedUrl = finalUrl;

  try {
    const fetched = await fetchWithSafety(finalUrl);
    html = fetched.body;
    finalRenderedUrl = fetched.finalUrl || finalUrl;
  } catch {
    // Plain fetch failed (e.g. redirect to HTTPS, 403) — try Playwright
    try {
      const rendered = await renderUrlToSource(finalUrl, {
        includeText: false,
        includeHtml: true,
        maxTextChars: 1000,
        maxHtmlChars: 200000,
        waitMs: 500,
        scrollSteps: 0
      });
      html = rendered.renderedHtml || "";
      finalRenderedUrl = rendered.finalUrl || finalUrl;
    } catch {
      return [];
    }
  }

  if (!html) return [];

  // 3) Try HTML extraction FIRST — Readability (used by htmlToMarkdown) strips <pre> blocks,
  //    so we must pull code from raw HTML before any Readability pass.
  //    This handles GitHub (<div class="highlight"><pre><span>…</span></pre>),
  //    Stack Overflow (<pre><code>…</code></pre>), and most blog/tutorial sites.
  const htmlBlocks = extractPreCodeBlocksFromHtml(html);
  if (htmlBlocks.length > 0) {
    return htmlBlocks.map(code => ({ code, lang: undefined }));
  }

  // 4) If no <pre> blocks found and the page might be JS-rendered, try Playwright
  const looksLikeSpa = html.includes('<div id="root">') || html.includes('<div id="app">') ||
    (html.includes('<script') && !html.includes('<pre'));
  if (looksLikeSpa) {
    try {
      const rendered = await renderUrlToSource(finalUrl, {
        includeText: false,
        includeHtml: true,
        maxTextChars: 1000,
        maxHtmlChars: 200000,
        waitMs: 500,
        scrollSteps: 0
      });
      const spaHtml = rendered.renderedHtml || "";
      const spaBlocks = extractPreCodeBlocksFromHtml(spaHtml);
      if (spaBlocks.length > 0) return spaBlocks.map(code => ({ code, lang: undefined }));
      finalRenderedUrl = rendered.finalUrl || finalRenderedUrl;
      if (spaHtml) {
        const extracted = htmlToMarkdown(spaHtml, finalRenderedUrl);
        return extractFencedCodeBlocks(extracted.markdown || "");
      }
    } catch { /* ignore */ }
  }

  // 5) Final fallback: convert static HTML to markdown
  const extracted = htmlToMarkdown(html, finalRenderedUrl);
  const md = extracted.markdown || "";
  return extractFencedCodeBlocks(md);
}