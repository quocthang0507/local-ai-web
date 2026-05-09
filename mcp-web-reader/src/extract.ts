import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import TurndownService from "turndown";

export function htmlToMarkdown(html: string, url: string): {
  title: string;
  markdown: string;
  excerpt?: string;
  byline?: string;
} {
  const dom = new JSDOM(html, { url });
  const reader = new Readability(dom.window.document);
  const article = reader.parse();

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced"
  });

  if (article?.content) {
    return {
      title: article.title || "",
      markdown: turndown.turndown(article.content),
      excerpt: article.excerpt || undefined,
      byline: article.byline || undefined
    };
  }

  return {
    title: dom.window.document.title || "",
    markdown: turndown.turndown(dom.window.document.body?.innerHTML || html)
  };
}