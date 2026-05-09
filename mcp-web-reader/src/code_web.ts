import { fetchWithSafety, renderUrlToSource } from "./browser.js";
import { htmlToMarkdown } from "./extract.js";

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
  const re = /<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const code = (m[1] || "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .trim();
    if (code) blocks.push(code);
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

export function scoreDomain(url: string): number {
  if (url.includes("github.com")) return 5;
  if (url.includes("stackoverflow.com")) return 4;
  if (url.includes("stackexchange.com")) return 4;
  if (url.includes("docs") || url.includes("developer")) return 3;
  return 1;
}

export function githubToRaw(url: string): string {
  try {
    const u = new URL(url);

    // chỉ xử lý github
    if (u.hostname !== "github.com") return url;

    const parts = u.pathname.split("/");

    // format: /user/repo/blob/branch/path
    // index:   0  empty
    //          1  user
    //          2  repo
    //          3  blob
    //          4  branch
    //          5+ path

    if (parts.length > 5 && parts[3] === "blob") {
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
  return url.startsWith("https://raw.githubusercontent.com/");
}

function isHostOrSubdomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function scoreSnippet(url: string, code: string, lang?: string): number {
  let score = 0;

  const host = (() => { try { return new URL(url).hostname.toLowerCase(); } catch { return ""; } })();

  if (isHostOrSubdomain(host, "github.com") || isHostOrSubdomain(host, "raw.githubusercontent.com")) score += 5;
  if (isHostOrSubdomain(host, "stackoverflow.com") || isHostOrSubdomain(host, "stackexchange.com")) score += 4;
  if (isHostOrSubdomain(host, "developer.mozilla.org") || isHostOrSubdomain(host, "learn.microsoft.com") || host.startsWith("docs.")) score += 3;

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

  // 2) For normal pages: use Playwright render to get real DOM
  const rendered = await renderUrlToSource(finalUrl, {
    includeText: false,
    includeHtml: true,
    maxTextChars: 1000,
    maxHtmlChars: 200000,
    waitMs: 2000,
    scrollSteps: 2
  });

  const html = rendered.renderedHtml || "";
  if (!html) return [];

  // Convert to markdown (main content)
  const extracted = htmlToMarkdown(html, rendered.finalUrl);
  const md = extracted.markdown || "";

  // Extract markdown fenced blocks first
  const fenced = extractFencedCodeBlocks(md);

  // Fallback: extract <pre><code> from HTML if markdown doesn’t contain fences
  if (fenced.length === 0) {
    const pre = extractPreCodeBlocksFromHtml(html);
    return pre.map(code => ({ code, lang: undefined }));
  }

  return fenced;
}