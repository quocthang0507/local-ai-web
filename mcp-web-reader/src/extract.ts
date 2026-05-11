import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";
// @ts-ignore
import { gfm } from "turndown-plugin-gfm";

export interface ExtractionResult {
  title: string;
  markdown: string;
  excerpt?: string;
  byline?: string;
  siteName?: string;
  lang?: string;
  publishedTime?: string;
}

/**
 * Resolve relative URLs to absolute URLs in the DOM
 */
function resolveUrls(doc: Document, baseUrl: string) {
  const links = doc.querySelectorAll("a");
  links.forEach((link) => {
    try {
      const href = link.getAttribute("href");
      if (href) {
        link.setAttribute("href", new URL(href, baseUrl).href);
      }
    } catch {
      // ignore invalid URLs
    }
  });

  const imgs = doc.querySelectorAll("img");
  imgs.forEach((img) => {
    try {
      const src = img.getAttribute("src");
      if (src) {
        img.setAttribute("src", new URL(src, baseUrl).href);
      }
    } catch {
      // ignore
    }
  });
}

/**
 * Clean DOM of common boilerplate and noise
 */
function cleanDom(doc: Document) {
  const selectors = [
    "script",
    "style",
    "noscript",
    "iframe",
    "canvas",
    "svg",
    "footer",
    "header",
    "nav",
    "aside",
    ".ads",
    ".advertisement",
    ".social-share",
    ".comments-section"
  ];
  selectors.forEach((s) => {
    doc.querySelectorAll(s).forEach((el) => el.remove());
  });
}

export function htmlToMarkdown(html: string, url: string): ExtractionResult {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  // Pre-processing: Resolve relative URLs before Readability strips them or Turndown processes them
  resolveUrls(doc, url);

  // Platform specific cleaning/tweaks
  const hostname = new URL(url).hostname;
  if (hostname.includes("reddit.com")) {
    // Reddit often has nested shadows or weird structures, but Readability usually handles the main post.
    // We can remove some known reddit clutter.
    doc.querySelectorAll('faceplate-tracker, shreddit-async-loader').forEach(el => el.remove());
  }

  const reader = new Readability(doc);
  const article = reader.parse();

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    emDelimiter: "_"
  });

  // Use GFM plugin for tables, strikethrough, etc.
  turndown.use(gfm);

  // Custom rule to ensure we don't lose links during conversion if they are inside complex blocks
  turndown.addRule('absoluteLinks', {
    filter: ['a'],
    replacement: function (content, node: any) {
      const href = node.getAttribute('href');
      if (href) {
        return `[${content}](${href})`;
      }
      return content;
    }
  });

  if (article?.content) {
    return {
      title: article.title || "",
      markdown: turndown.turndown(article.content),
      excerpt: article.excerpt || undefined,
      byline: article.byline || undefined,
      siteName: article.siteName || undefined,
      lang: article.lang || undefined,
      publishedTime: article.publishedTime || undefined
    };
  }

  // Fallback to body if Readability fails
  cleanDom(doc);
  return {
    title: doc.title || "",
    markdown: turndown.turndown(doc.body?.innerHTML || html)
  };
}