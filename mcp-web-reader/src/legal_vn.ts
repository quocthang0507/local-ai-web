import { PDFParse } from "pdf-parse";
import { fetchWithSafety, renderUrlToSource } from "./browser.js";
import { getCache, setCache } from "./cache.js";
import {
  ENABLE_CACHE,
  FETCH_CACHE_TTL_MS,
  LEGAL_VN_CACHE_TTL_MS,
  LEGAL_VN_MAX_DOC_CHARS,
  LEGAL_VN_MAX_URLS,
  LEGAL_VN_OFFICIAL_DOMAINS,
  LEGAL_VN_REFERENCE_DOMAINS,
  SEARXNG_ENGINES
} from "./config.js";
import { htmlToMarkdown } from "./extract.js";
import { htmlToText, makeCacheKey } from "./helper.js";
import { searxngSearch } from "./searxng.js";
import * as cheerio from "cheerio";

export type VietnamLegalMode = "law" | "administrative" | "procedure" | "all";
export type VietnamLegalTimeRange = "day" | "week" | "month" | "year";
export type VietnamLegalSourceTier = "official" | "reference" | "other";

export type VietnamLegalSearchOptions = {
  query: string;
  maxResults?: number;
  mode?: VietnamLegalMode;
  timeRange?: VietnamLegalTimeRange;
  includeUnofficial?: boolean;
};

export type VietnamLegalFetchOptions = {
  url: string;
  maxChars?: number;
  render?: boolean;
};

export type VietnamLegalContextOptions = {
  question: string;
  maxSources?: number;
  fetchTopDocuments?: number;
  maxCharsPerDocument?: number;
  mode?: VietnamLegalMode;
  timeRange?: VietnamLegalTimeRange;
  includeUnofficial?: boolean;
};

const LEGAL_DOC_TYPES = [
  "Hiến pháp",
  "Bộ luật",
  "Luật",
  "Pháp lệnh",
  "Nghị quyết",
  "Nghị định",
  "Quyết định",
  "Chỉ thị",
  "Thông tư",
  "Thông tư liên tịch",
  "Công văn",
  "Kế hoạch",
  "Thông báo"
];

const AUTHORITIES = [
  "Quốc hội",
  "Ủy ban Thường vụ Quốc hội",
  "Chính phủ",
  "Thủ tướng Chính phủ",
  "Văn phòng Chính phủ",
  "Bộ Tư pháp",
  "Bộ Nội vụ",
  "Bộ Tài chính",
  "Bộ Công an",
  "Bộ Quốc phòng",
  "Bộ Y tế",
  "Bộ Giáo dục và Đào tạo",
  "Bộ Lao động - Thương binh và Xã hội",
  "Bộ Khoa học và Công nghệ",
  "Bộ Công Thương",
  "Bộ Xây dựng",
  "Bộ Nông nghiệp và Môi trường",
  "Ủy ban nhân dân"
];

function normalizeText(text: string): string {
  return text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hostMatchesDomain(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function sourceTierFromUrl(url: string): VietnamLegalSourceTier {
  try {
    const hostname = new URL(url).hostname.toLowerCase();

    if (LEGAL_VN_OFFICIAL_DOMAINS.some((domain) => hostMatchesDomain(hostname, domain))) {
      return "official";
    }

    if (LEGAL_VN_REFERENCE_DOMAINS.some((domain) => hostMatchesDomain(hostname, domain))) {
      return "reference";
    }

    return "other";
  } catch {
    return "other";
  }
}

export function isOfficialVietnamLegalSource(url: string): boolean {
  return sourceTierFromUrl(url) === "official";
}

function detectDocumentNumber(query: string): string | undefined {
  const patterns = [
    /\b(\d{1,4}\s*\/\s*\d{4}\s*\/\s*[A-ZĐA-Z-]{2,30})\b/iu,
    /\b(\d{1,4}\s*\/\s*[A-ZĐA-Z-]{2,30})\b/iu
  ];

  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match?.[1]) return cleanDocumentNumber(match[1]);
  }

  return undefined;
}

function cleanDocumentNumber(value: string): string {
  const strict = value.match(/\d{1,4}\s*\/\s*(?:\d{4}\s*\/\s*)?[0-9A-ZĐa-zđ-]{2,30}/u);
  if (strict?.[0]) {
    return strict[0].replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/").trim();
  }

  return value
    .replace(/\s+/g, " ")
    .replace(/\s*\/\s*/g, "/")
    .split(/\s+(?:ngày|về|của|ban hành|quy định)\b/iu)[0]
    .replace(/[.,;:]+$/g, "")
    .trim();
}

function extractLegalHtmlContent(html: string, url: string): {
  title: string;
  text: string;
  markdown: string;
} {
  const $ = cheerio.load(html);
  const title = $("title").first().text().replace(/\s+/g, " ").trim();

  $("script, style, noscript, iframe, canvas, svg, header, footer, nav").remove();

  const selectors = [
    ".Content",
    ".document-detail .Detail",
    ".document-detail",
    ".DocumentDetail",
    "article",
    "main"
  ];

  let selectedHtml = "";
  for (const selector of selectors) {
    const node = $(selector).first();
    const text = node.text().replace(/\s+/g, " ").trim();
    if (node.length && text.length >= 80) {
      selectedHtml = $.html(node);
      break;
    }
  }

  if (!selectedHtml) {
    selectedHtml = $("body").html() || html;
  }

  const documentHtml = `<!doctype html><html><head><title>${title}</title></head><body>${selectedHtml}</body></html>`;
  const extracted = htmlToMarkdown(documentHtml, url);

  return {
    title: extracted.title || title,
    text: normalizeText(htmlToText(selectedHtml)),
    markdown: extracted.markdown
  };
}

function searchModeTerms(mode: VietnamLegalMode): string[] {
  if (mode === "administrative") {
    return [
      "văn bản hành chính",
      "thể thức kỹ thuật trình bày văn bản hành chính",
      "mẫu văn bản hành chính"
    ];
  }

  if (mode === "procedure") {
    return [
      "thủ tục hành chính",
      "dịch vụ công",
      "hồ sơ biểu mẫu"
    ];
  }

  if (mode === "law") {
    return [
      "văn bản quy phạm pháp luật",
      "hiệu lực văn bản",
      "văn bản hợp nhất"
    ];
  }

  return ["văn bản pháp luật", "văn bản hành chính", "thủ tục hành chính"];
}

export function rewriteVietnamLegalQueries(
  query: string,
  mode: VietnamLegalMode = "all"
): string[] {
  const base = query.trim().replace(/[?？]\s*$/, "");
  const documentNumber = detectDocumentNumber(base);
  const terms = searchModeTerms(mode);

  const queries = [
    `${base} ${terms[0]}`,
    `${base} site:vbpl.vn`,
    `${base} site:vanban.chinhphu.vn`,
    `${base} site:congbao.chinhphu.vn`
  ];

  if (mode === "procedure") {
    queries.push(`${base} site:dichvucong.gov.vn`);
  }

  if (mode === "administrative") {
    queries.push(`${base} site:chinhphu.vn`);
  }

  if (documentNumber) {
    queries.unshift(`"${documentNumber}" site:vbpl.vn`);
    queries.unshift(`"${documentNumber}" site:vanban.chinhphu.vn`);
  }

  return Array.from(new Set(queries)).slice(0, 6);
}

function scoreVietnamLegalResult(result: {
  title: string;
  url: string;
  snippet: string;
}, query: string): number {
  let score = 0;
  const tier = sourceTierFromUrl(result.url);
  const title = result.title.toLowerCase();
  const snippet = result.snippet.toLowerCase();
  const lowerUrl = result.url.toLowerCase();

  if (tier === "official") score += 40;
  if (tier === "reference") score += 10;

  try {
    const hostname = new URL(result.url).hostname.toLowerCase();
    if (hostMatchesDomain(hostname, "vbpl.vn")) score += 15;
    if (hostMatchesDomain(hostname, "vanban.chinhphu.vn")) score += 12;
    if (hostMatchesDomain(hostname, "congbao.chinhphu.vn")) score += 12;
    if (hostMatchesDomain(hostname, "quochoi.vn")) score += 10;
    if (hostMatchesDomain(hostname, "dichvucong.gov.vn")) score += 8;
  } catch {
    // URL parsing errors are handled by lower base score.
  }

  if (lowerUrl.includes("docid=") || lowerUrl.includes("/pages/vanban")) score += 8;
  if (lowerUrl.endsWith(".pdf") || lowerUrl.includes("/filedata/")) score += 5;
  if (title.includes("văn bản") || title.includes("nghị định") || title.includes("thông tư")) score += 4;
  if (snippet.includes("hiệu lực") || snippet.includes("ngày ban hành")) score += 4;

  const documentNumber = detectDocumentNumber(query);
  if (documentNumber && `${title} ${snippet} ${lowerUrl}`.includes(documentNumber.toLowerCase())) {
    score += 20;
  }

  for (const token of query.toLowerCase().split(/\s+/).filter((t) => t.length >= 4)) {
    if (title.includes(token)) score += 2;
    if (snippet.includes(token)) score += 1;
  }

  return score;
}

export async function searchVietnamLegal(options: VietnamLegalSearchOptions) {
  const query = options.query;
  const maxResults = options.maxResults ?? 8;
  const mode = options.mode ?? "all";
  const includeUnofficial = options.includeUnofficial ?? false;
  const rewrittenQueries = rewriteVietnamLegalQueries(query, mode);

  const cacheKey = makeCacheKey("search_vietnam_legal", {
    query,
    maxResults,
    mode,
    timeRange: options.timeRange || "",
    includeUnofficial,
    engines: SEARXNG_ENGINES.join(","),
    officialDomains: LEGAL_VN_OFFICIAL_DOMAINS.join(",")
  });

  if (ENABLE_CACHE) {
    const cached = getCache<any>(cacheKey);
    if (cached) return { ...cached, cache: { hit: true, key: cacheKey } };
  }

  const allResults: Array<{ title: string; url: string; snippet: string }> = [];
  await Promise.allSettled(
    rewrittenQueries.map(async (q) => {
      try {
        const results = await searxngSearch(q, Math.max(maxResults, 5), options.timeRange, SEARXNG_ENGINES);
        for (const result of results) {
          if (result.url) allResults.push(result);
        }
      } catch {
        // Ignore failed query variants.
      }
    })
  );

  const seen = new Set<string>();
  const deduped = allResults.filter((result) => {
    if (seen.has(result.url)) return false;
    seen.add(result.url);
    return true;
  });

  const ranked = deduped
    .map((result) => ({
      title: result.title,
      url: result.url,
      snippet: result.snippet,
      source: (() => {
        try {
          return new URL(result.url).hostname;
        } catch {
          return "";
        }
      })(),
      sourceTier: sourceTierFromUrl(result.url),
      score: scoreVietnamLegalResult(result, query)
    }))
    .filter((result) => includeUnofficial || result.sourceTier === "official")
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(maxResults, LEGAL_VN_MAX_URLS));

  const output = {
    query,
    mode,
    backend: "searxng",
    engines: SEARXNG_ENGINES,
    officialDomains: LEGAL_VN_OFFICIAL_DOMAINS,
    includeUnofficial,
    rewrittenQueries,
    results: ranked,
    guidance: [
      "Prefer official sources and cite exact URLs.",
      "Check effective status, amendments, replacements, and the issue date before giving a legal conclusion.",
      "Do not treat search snippets as legal authority; fetch the document text first."
    ],
    cache: { hit: false, key: cacheKey, ttlMs: LEGAL_VN_CACHE_TTL_MS }
  };

  if (ENABLE_CACHE) setCache(cacheKey, output, LEGAL_VN_CACHE_TTL_MS);

  return output;
}

function findFirstDate(text: string): string | undefined {
  const slashDate = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{4})\b/u);
  if (slashDate) return toIsoDate(slashDate[3], slashDate[2], slashDate[1]);

  const viDate = text.match(/ngày\s+(\d{1,2})\s+tháng\s+(\d{1,2})\s+năm\s+(\d{4})/iu);
  if (viDate) return toIsoDate(viDate[3], viDate[2], viDate[1]);

  return undefined;
}

function findDateNearKeywords(text: string, keywords: string[]): string | undefined {
  const lower = text.toLowerCase();

  for (const keyword of keywords) {
    const index = lower.indexOf(keyword.toLowerCase());
    if (index >= 0) {
      const windowText = text.slice(index, index + 260);
      const date = findFirstDate(windowText);
      if (date) return date;
    }
  }

  return undefined;
}

function toIsoDate(year: string, month: string, day: string): string | undefined {
  const yyyy = Number(year);
  const mm = Number(month);
  const dd = Number(day);
  if (!yyyy || !mm || !dd || mm < 1 || mm > 12 || dd < 1 || dd > 31) return undefined;
  return `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

export function extractVietnamLegalMetadata(text: string, url: string, title = "") {
  const normalized = normalizeText(`${title}\n${text}`);
  const firstChunk = normalized.slice(0, 10000);
  const titleAndText = `${title}\n${firstChunk}`;
  const lower = titleAndText.toLowerCase();

  const documentType = LEGAL_DOC_TYPES.find((type) => lower.includes(type.toLowerCase()));

  const numberFromLabel = firstChunk.match(/(?:Số|So)\s*[:.]?\s*([0-9][0-9A-ZĐđ./ -]{1,50})/iu);
  const numberFromAny = firstChunk.match(/\b(\d{1,4}\s*\/\s*\d{4}\s*\/\s*[A-ZĐA-Z-]{2,30})\b/iu);
  const documentNumber = numberFromLabel?.[1]
    ? cleanDocumentNumber(numberFromLabel[1])
    : numberFromAny?.[1]
      ? cleanDocumentNumber(numberFromAny[1])
      : detectDocumentNumber(title);

  const authority = AUTHORITIES.find((item) => lower.includes(item.toLowerCase()));
  const issuedDate = findDateNearKeywords(firstChunk, ["ngày ban hành", "ban hành", "ngày"]);
  const effectiveDate = findDateNearKeywords(firstChunk, [
    "có hiệu lực",
    "hiệu lực thi hành",
    "kể từ ngày",
    "áp dụng từ ngày"
  ]);

  const statusSignals = Array.from(
    new Set(
      ["còn hiệu lực", "hết hiệu lực", "ngưng hiệu lực", "bãi bỏ", "thay thế", "sửa đổi", "bổ sung"]
        .filter((signal) => lower.includes(signal))
    )
  );

  const citations = extractVietnamLegalCitations(normalized);

  return {
    title: title || undefined,
    url,
    sourceTier: sourceTierFromUrl(url),
    documentType,
    documentNumber,
    authority,
    issuedDate,
    effectiveDate,
    statusSignals,
    citations,
    confidence: "heuristic"
  };
}

function extractVietnamLegalCitations(text: string): string[] {
  const citations = new Set<string>();
  const pattern = /(Hiến pháp|Bộ luật|Luật|Pháp lệnh|Nghị quyết|Nghị định|Quyết định|Chỉ thị|Thông tư|Công văn)(?:\s+số)?\s+[0-9][0-9A-ZĐđ./ -]{2,50}/giu;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) && citations.size < 25) {
    citations.add(cleanDocumentNumber(match[0]));
  }

  return Array.from(citations);
}

export function selectRelevantLegalExcerpt(text: string, query: string, maxChars: number): string {
  const normalized = normalizeText(text);
  if (normalized.length <= maxChars) return normalized;

  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}/-]/gu, ""))
    .filter((token) => token.length >= 4);

  const paragraphs = normalized
    .split(/\n{1,2}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length >= 40);

  const scored = paragraphs
    .map((paragraph, index) => {
      const lower = paragraph.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (lower.includes(token)) score += 3;
      }
      if (/^(điều|khoản|điểm|chương|mục)\s+/iu.test(paragraph)) score += 2;
      if (lower.includes("hiệu lực") || lower.includes("trách nhiệm") || lower.includes("hồ sơ")) score += 1;
      return { paragraph, index, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = (scored.length > 0 ? scored : paragraphs.map((paragraph, index) => ({ paragraph, index, score: 0 })))
    .slice(0, 12)
    .sort((a, b) => a.index - b.index);

  let output = "";
  for (const item of selected) {
    const next = output ? `${output}\n\n${item.paragraph}` : item.paragraph;
    if (next.length > maxChars) break;
    output = next;
  }

  return output || normalized.slice(0, maxChars);
}

export async function fetchVietnamLegalDocument(options: VietnamLegalFetchOptions) {
  const maxChars = options.maxChars ?? LEGAL_VN_MAX_DOC_CHARS;
  const render = options.render ?? false;
  const cacheKey = makeCacheKey("fetch_vietnam_legal_document", {
    url: options.url,
    maxChars,
    render
  });

  if (ENABLE_CACHE) {
    const cached = getCache<any>(cacheKey);
    if (cached) return { ...cached, cache: { hit: true, key: cacheKey } };
  }

  let finalUrl = options.url;
  let title = "";
  let text = "";
  let markdown: string | undefined;
  let contentType = "";
  let mode = "static";

  if (render) {
    const rendered = await renderUrlToSource(options.url, {
      includeHtml: true,
      includeText: true,
      maxHtmlChars: 400000,
      maxTextChars: Math.max(maxChars, 10000),
      waitMs: 1200,
      scrollSteps: 2
    });
    finalUrl = rendered.finalUrl;
    const extracted = extractLegalHtmlContent(rendered.renderedHtml || "", finalUrl);
    title = extracted.title || rendered.title;
    text = extracted.text || normalizeText(rendered.text || "");
    markdown = extracted.markdown;
    contentType = "text/html; rendered=true";
    mode = "rendered";
  } else {
    const fetched = await fetchWithSafety(options.url);
    finalUrl = fetched.finalUrl;
    contentType = fetched.contentType;

    if (contentType.includes("application/pdf")) {
      const parser = new PDFParse({ data: fetched.buffer });
      const textData = await parser.getText();
      text = normalizeText(textData.text);
      title = extractTitleFromText(text) || "";
      mode = "pdf";
    } else {
      const extracted = extractLegalHtmlContent(fetched.body, finalUrl);
      title = extracted.title || "";
      markdown = extracted.markdown;
      text = extracted.text;
      mode = "html";
    }
  }

  const metadata = extractVietnamLegalMetadata(text, finalUrl, title);
  const output = {
    mode,
    requestedUrl: options.url,
    finalUrl,
    sourceTier: sourceTierFromUrl(finalUrl),
    contentType,
    title,
    metadata,
    text: text.slice(0, maxChars),
    markdown: markdown ? markdown.slice(0, maxChars) : undefined,
    safety: "Official status is inferred only from source domain and page text. Verify legal effect before relying on the answer.",
    cache: { hit: false, key: cacheKey, ttlMs: FETCH_CACHE_TTL_MS }
  };

  if (ENABLE_CACHE) setCache(cacheKey, output, FETCH_CACHE_TTL_MS);

  return output;
}

function extractTitleFromText(text: string): string | undefined {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line.length >= 12 && line.length <= 240);
}

export async function buildVietnamLegalContext(options: VietnamLegalContextOptions) {
  const maxSources = options.maxSources ?? 5;
  const fetchTopDocuments = options.fetchTopDocuments ?? 2;
  const maxCharsPerDocument = options.maxCharsPerDocument ?? 8000;
  const mode = options.mode ?? "all";

  const cacheKey = makeCacheKey("vietnam_legal_qa_context", {
    question: options.question,
    maxSources,
    fetchTopDocuments,
    maxCharsPerDocument,
    mode,
    timeRange: options.timeRange || "",
    includeUnofficial: options.includeUnofficial ?? false
  });

  if (ENABLE_CACHE) {
    const cached = getCache<any>(cacheKey);
    if (cached) return { ...cached, cache: { hit: true, key: cacheKey } };
  }

  const search = await searchVietnamLegal({
    query: options.question,
    maxResults: maxSources,
    mode,
    timeRange: options.timeRange,
    includeUnofficial: options.includeUnofficial
  });

  const documents = [];
  const resultsToFetch = search.results.slice(0, Math.max(0, Math.min(fetchTopDocuments, 3)));

  for (const result of resultsToFetch) {
    try {
      const fetched = await Promise.race([
        fetchVietnamLegalDocument({
          url: result.url,
          maxChars: Math.max(maxCharsPerDocument, 3000),
          render: false
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("per-document timeout")), 18000)
        )
      ]);

      documents.push({
        url: fetched.finalUrl,
        title: fetched.title || result.title,
        sourceTier: fetched.sourceTier,
        metadata: fetched.metadata,
        excerpt: selectRelevantLegalExcerpt(fetched.text || "", options.question, maxCharsPerDocument),
        textChars: (fetched.text || "").length
      });
    } catch (err: any) {
      documents.push({
        url: result.url,
        title: result.title,
        sourceTier: result.sourceTier,
        error: err?.message || String(err)
      });
    }
  }

  const output = {
    question: options.question,
    mode,
    search,
    documents,
    answerGuidance: [
      "Answer in Vietnamese unless the user asks otherwise.",
      "Base legal conclusions on fetched document text, not search snippets.",
      "Cite source URLs next to each legal statement.",
      "State uncertainty when effective status, amendments, or replacements are not found.",
      "Do not present the response as a substitute for advice from a qualified Vietnamese lawyer or competent authority."
    ],
    cache: { hit: false, key: cacheKey, ttlMs: LEGAL_VN_CACHE_TTL_MS }
  };

  if (ENABLE_CACHE) setCache(cacheKey, output, LEGAL_VN_CACHE_TTL_MS);

  return output;
}
