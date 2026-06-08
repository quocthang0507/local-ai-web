const form = document.querySelector("#searchForm");
const queryInput = document.querySelector("#queryInput");
const timeRange = document.querySelector("#timeRange");
const maxResults = document.querySelector("#maxResults");
const includeUnofficial = document.querySelector("#includeUnofficial");
const referenceFilter = document.querySelector("#referenceFilter");
const translationFilters = Array.from(document.querySelectorAll(".translation-filter"));
const sourceLang = document.querySelector("#sourceLang");
const targetLang = document.querySelector("#targetLang");
const translateProvider = document.querySelector("#translateProvider");
const resultsList = document.querySelector("#resultsList");
const resultCount = document.querySelector("#resultCount");
const detailPane = document.querySelector("#detailPane");
const statusText = document.querySelector("#statusText");
const healthButton = document.querySelector("#healthButton");
const healthPill = document.querySelector("#healthPill");
const modeTabs = Array.from(document.querySelectorAll(".mode-tab"));

const state = {
  mode: "web",
  results: [],
  activeIndex: -1,
  searchController: null
};

const modeCopy = {
  web: {
    label: "Web",
    detailLabel: "Trang web"
  },
  code: {
    label: "Mã nguồn",
    detailLabel: "Đoạn mã"
  },
  legal: {
    label: "Văn bản pháp luật",
    detailLabel: "Văn bản pháp luật"
  },
  procedure: {
    label: "Thủ tục hành chính",
    detailLabel: "Thủ tục hành chính"
  },
  pdf: {
    label: "PDF",
    detailLabel: "Tài liệu PDF"
  },
  translate: {
    label: "Dịch thuật",
    detailLabel: "Bản dịch"
  }
};

function createEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#icon-${name}`);
  svg.append(use);
  return svg;
}

function truncate(text, max = 220) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1)}…`;
}

function formatUrl(url) {
  try {
    const parsed = new URL(url);
    const path = `${parsed.hostname}${parsed.pathname}`.replace(/\/$/, "");
    return path.length > 96 ? `${path.slice(0, 95)}…` : path;
  } catch {
    return truncate(url, 96);
  }
}

function isSafeHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isTableSeparator(line) {
  return /^\s*\|?[\s:-]+\|[\s|:-]*\s*$/.test(line);
}

function splitTableLine(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function appendInlineMarkdown(parent, text) {
  const pattern = /(!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\))/g;
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) {
      parent.append(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    if (match[2] !== undefined && match[3]) {
      const img = createEl("img", "markdown-image");
      img.src = match[3];
      img.alt = match[2] || "";
      img.loading = "lazy";
      img.decoding = "async";
      parent.append(img);
    } else if (match[4]) {
      const code = createEl("code", "inline-code", match[4]);
      parent.append(code);
    } else if (match[5]) {
      const strong = createEl("strong", null, match[5]);
      parent.append(strong);
    } else if (match[6]) {
      const em = createEl("em", null, match[6]);
      parent.append(em);
    } else if (match[7] && match[8]) {
      const link = createEl("a", null, match[7]);
      link.href = match[8];
      link.target = "_blank";
      link.rel = "noreferrer";
      parent.append(link);
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parent.append(document.createTextNode(text.slice(lastIndex)));
  }
}

function buildParagraph(lines) {
  const paragraph = createEl("p");
  appendInlineMarkdown(paragraph, lines.join(" ").replace(/\s+/g, " ").trim());
  return paragraph;
}

function buildImage(line) {
  const match = line.match(/^\s*!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)\s*$/);
  if (!match || !isSafeHttpUrl(match[2])) return null;

  const figure = createEl("figure", "markdown-figure");
  const image = createEl("img", "markdown-image");
  image.src = match[2];
  image.alt = match[1] || "";
  image.loading = "lazy";
  image.decoding = "async";
  figure.append(image);

  if (match[1]) {
    figure.append(createEl("figcaption", null, match[1]));
  }

  return figure;
}

function buildList(lines, ordered) {
  const list = createEl(ordered ? "ol" : "ul");

  lines.forEach((line) => {
    const itemText = line.replace(ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/, "");
    const item = createEl("li");
    appendInlineMarkdown(item, itemText);
    list.append(item);
  });

  return list;
}

function buildTable(lines) {
  const table = createEl("table");
  const thead = createEl("thead");
  const tbody = createEl("tbody");
  const headers = splitTableLine(lines[0]);

  const headerRow = createEl("tr");
  headers.forEach((header) => {
    const cell = createEl("th");
    appendInlineMarkdown(cell, header);
    headerRow.append(cell);
  });
  thead.append(headerRow);

  lines.slice(2).forEach((line) => {
    const row = createEl("tr");
    splitTableLine(line).forEach((value) => {
      const cell = createEl("td");
      appendInlineMarkdown(cell, value);
      row.append(cell);
    });
    tbody.append(row);
  });

  table.append(thead, tbody);
  return table;
}

function buildHtmlTable(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const sourceTable = doc.querySelector("table");
  if (!sourceTable) return null;

  const table = createEl("table");
  const rows = Array.from(sourceTable.querySelectorAll("tr"));

  rows.forEach((sourceRow, rowIndex) => {
    const row = createEl("tr");
    const cells = Array.from(sourceRow.querySelectorAll("th,td"));

    cells.forEach((sourceCell) => {
      const tag = sourceCell.tagName.toLowerCase() === "th" || rowIndex === 0 ? "th" : "td";
      const cell = createEl(tag);
      const link = sourceCell.querySelector("a[href]");
      if (link) {
        const href = link.getAttribute("href") || "";
        if (/^https?:\/\//i.test(href)) {
          const anchor = createEl("a", null, link.textContent?.trim() || href);
          anchor.href = href;
          anchor.target = "_blank";
          anchor.rel = "noreferrer";
          cell.append(anchor);
        } else {
          cell.textContent = sourceCell.textContent?.replace(/\s+/g, " ").trim() || "";
        }
      } else {
        cell.textContent = sourceCell.textContent?.replace(/\s+/g, " ").trim() || "";
      }
      row.append(cell);
    });

    table.append(row);
  });

  return table;
}

function renderMarkdown(markdown) {
  const root = createEl("div", "markdown-body");
  const lines = String(markdown || "").replace(/\r/g, "").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    const image = buildImage(line);
    if (image) {
      root.append(image);
      i++;
      continue;
    }

    if (/^\s*<table[\s>]/i.test(line)) {
      const htmlLines = [line];
      i++;
      while (i < lines.length && !/<\/table>/i.test(lines[i - 1])) {
        htmlLines.push(lines[i]);
        i++;
      }
      const table = buildHtmlTable(htmlLines.join("\n"));
      if (table) root.append(table);
      continue;
    }

    const fence = line.match(/^```([A-Za-z0-9_+-]*)\s*$/);
    if (fence) {
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;

      const pre = createEl("pre", "code-block");
      const code = createEl("code", null, codeLines.join("\n"));
      if (fence[1]) code.dataset.lang = fence[1];
      pre.append(code);
      root.append(pre);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = Math.min(heading[1].length + 2, 6);
      const h = createEl(`h${level}`);
      appendInlineMarkdown(h, heading[2].trim());
      root.append(h);
      i++;
      continue;
    }

    if (i + 1 < lines.length && line.includes("|") && isTableSeparator(lines[i + 1])) {
      const tableLines = [line, lines[i + 1]];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        tableLines.push(lines[i]);
        i++;
      }
      root.append(buildTable(tableLines));
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const listLines = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        listLines.push(lines[i]);
        i++;
      }
      root.append(buildList(listLines, false));
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const listLines = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        listLines.push(lines[i]);
        i++;
      }
      root.append(buildList(listLines, true));
      continue;
    }

    if (/^\s*>\s+/.test(line)) {
      const quote = createEl("blockquote");
      const quoteLines = [];
      while (i < lines.length && /^\s*>\s+/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s+/, ""));
        i++;
      }
      appendInlineMarkdown(quote, quoteLines.join(" "));
      root.append(quote);
      continue;
    }

    const paragraphLines = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^```/.test(lines[i]) &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !/^\s*>\s+/.test(lines[i])
    ) {
      if (i + 1 < lines.length && lines[i].includes("|") && isTableSeparator(lines[i + 1])) break;
      paragraphLines.push(lines[i]);
      i++;
    }

    if (paragraphLines.length > 0) {
      root.append(buildParagraph(paragraphLines));
    } else {
      i++;
    }
  }

  if (!root.childElementCount) {
    root.append(createEl("p", null, "Không có nội dung để hiển thị."));
  }

  return root;
}

function setStatus(text) {
  statusText.textContent = text;
}

function setBusy(isBusy) {
  const submit = form.querySelector("button[type='submit']");
  submit.disabled = isBusy;
  queryInput.disabled = isBusy;
}

function updateModeUI() {
  modeTabs.forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.mode === state.mode);
  });

  const legalMode = state.mode === "legal" || state.mode === "procedure";
  const translateMode = state.mode === "translate";
  referenceFilter.classList.toggle("hidden", !legalMode);
  translationFilters.forEach((filter) => filter.classList.toggle("hidden", !translateMode));
  queryInput.placeholder = legalMode
    ? "Tìm văn bản, số hiệu, thủ tục, hồ sơ..."
    : translateMode
      ? "Nhập văn bản cần dịch..."
    : state.mode === "code"
      ? "Tìm ví dụ mã nguồn, thư viện, lỗi, implementation..."
      : state.mode === "pdf"
        ? "Tìm tài liệu PDF, báo cáo, văn bản đính kèm..."
        : "Tìm mã nguồn, văn bản pháp luật, thủ tục hành chính...";
}

async function fetchJson(path, payload, options = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: options.signal
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.error) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }

  return data;
}

function detectLanguageHint(query) {
  const lower = query.toLowerCase();
  if (lower.includes("typescript") || lower.includes("ts ")) return "typescript";
  if (lower.includes("python") || lower.includes("django") || lower.includes("fastapi")) return "python";
  if (lower.includes("javascript") || lower.includes("node") || lower.includes("express")) return "javascript";
  if (lower.includes("golang") || lower.includes(" go ")) return "go";
  if (lower.includes("rust")) return "rust";
  if (lower.includes("java ") || lower.includes("spring")) return "java";
  return undefined;
}

function buildSearchRequest(query) {
  const max = Number(maxResults.value || 8);
  const range = timeRange.value || undefined;

  if (state.mode === "code") {
    return {
      path: "/api/search/code",
      payload: {
        query,
        max_snippets: max,
        language_hint: detectLanguageHint(query)
      }
    };
  }

  if (state.mode === "translate") {
    return {
      path: "/api/translate",
      payload: {
        text: query,
        source_lang: sourceLang.value || "auto",
        target_lang: targetLang.value || "vi",
        provider: translateProvider.value || "auto"
      }
    };
  }

  if (state.mode === "legal" || state.mode === "procedure") {
    return {
      path: "/api/search/vietnam-legal",
      payload: {
        query,
        max_results: max,
        mode: state.mode === "procedure" ? "procedure" : "law",
        time_range: range,
        include_unofficial: includeUnofficial.checked
      }
    };
  }

  return {
    path: "/api/search",
    payload: {
      query: state.mode === "pdf" ? `${query} filetype:pdf` : query,
      max_results: max,
      time_range: range
    }
  };
}

function normalizeResults(data) {
  if (state.mode === "translate") {
    return [{
      id: "translation-result",
      mode: "translate",
      title: `Dịch sang ${data.targetLang || targetLang.value || "vi"}`,
      url: "",
      source: data.provider || data.providerMode || "translation",
      snippet: truncate(data.translatedText, 260),
      translatedText: data.translatedText || "",
      originalText: data.text || queryInput.value.trim(),
      provider: data.provider,
      providerMode: data.providerMode,
      sourceLang: data.detectedSourceLang || data.sourceLang,
      targetLang: data.targetLang,
      alternativesTried: data.alternativesTried || []
    }];
  }

  if (state.mode === "code") {
    return (data.results || []).map((item, index) => ({
      id: `${index}-${item.url}`,
      mode: "code",
      title: `${item.lang || "Code"} · ${item.source || "source"}`,
      url: item.url,
      source: item.source,
      snippet: truncate(item.code, 260),
      code: item.code || "",
      lang: item.lang,
      score: item.score
    }));
  }

  if (state.mode === "legal" || state.mode === "procedure") {
    return (data.results || []).map((item, index) => ({
      id: `${index}-${item.url}`,
      mode: state.mode,
      title: item.title || item.url,
      url: item.url,
      source: item.source,
      snippet: item.snippet || "",
      sourceTier: item.sourceTier,
      score: item.score
    }));
  }

  return (data.results || []).map((item, index) => ({
    id: `${index}-${item.url}`,
    mode: state.mode,
    title: item.title || item.url,
    url: item.url,
    source: item.source,
    snippet: item.snippet || ""
  }));
}

function renderLoadingResults() {
  resultsList.replaceChildren();
  const box = createEl("div", "loading-state");
  box.append(createEl("div", "spinner"));
  box.append(createEl("h2", null, "Đang tìm kiếm"));
  box.append(createEl("p", null, modeCopy[state.mode].label));
  resultsList.append(box);
  resultCount.textContent = "0";
}

function renderEmptyResults(message = "Không có kết quả phù hợp.") {
  resultsList.replaceChildren();
  const box = createEl("div", "empty-results");
  box.append(createIcon("search"));
  box.append(createEl("h2", null, "Không có kết quả"));
  box.append(createEl("p", null, message));
  resultsList.append(box);
  resultCount.textContent = "0";
}

function renderError(target, title, message) {
  target.replaceChildren();
  const box = createEl("div", "error-state");
  box.append(createIcon("file"));
  box.append(createEl("h2", null, title));
  box.append(createEl("p", null, message));
  target.append(box);
}

function renderResults() {
  resultsList.replaceChildren();
  resultCount.textContent = String(state.results.length);

  if (state.results.length === 0) {
    renderEmptyResults();
    return;
  }

  state.results.forEach((result, index) => {
    const button = createEl("button", "result-item");
    button.type = "button";
    button.dataset.index = String(index);
    button.classList.toggle("active", index === state.activeIndex);

    const title = createEl("h2", "result-title", result.title);
    const url = createEl("div", "result-url", formatUrl(result.url));
    const snippet = createEl("p", "result-snippet");
    appendInlineMarkdown(snippet, result.snippet || "Không có mô tả.");
    const tags = createEl("div", "tag-row");

    tags.append(createEl("span", "tag", modeCopy[result.mode].label));
    if (result.lang) tags.append(createEl("span", "tag code", result.lang));
    if (result.sourceTier === "official") tags.append(createEl("span", "tag official", "Chính thức"));
    if (result.sourceTier === "reference") tags.append(createEl("span", "tag warn", "Tham khảo"));
    if (result.score !== undefined) tags.append(createEl("span", "tag", `Điểm ${Math.round(result.score)}`));

    button.append(title, url, snippet, tags);
    button.addEventListener("click", () => openResult(index));
    resultsList.append(button);
  });
}

function setDetailLoading(result) {
  detailPane.replaceChildren();
  const box = createEl("div", "loading-state");
  box.append(createEl("div", "spinner"));
  box.append(createEl("h2", null, "Đang tải nội dung"));
  box.append(createEl("p", null, truncate(result.title, 120)));
  detailPane.append(box);
}

function renderDetail(data) {
  detailPane.replaceChildren();
  const content = createEl("div", "detail-content");

  content.append(createEl("div", "detail-kicker", data.kicker));
  content.append(createEl("h2", "detail-title", data.title || "Không có tiêu đề"));

  if (data.url) {
    const link = createEl("a", "detail-url", formatUrl(data.url));
    link.href = data.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.prepend(createIcon("open"));
    content.append(link);
  }

  if (data.tags?.length) {
    const tags = createEl("div", "tag-row");
    data.tags.forEach((tag) => tags.append(createEl("span", `tag ${tag.className || ""}`.trim(), tag.text)));
    content.append(tags);
  }

  if (data.meta?.length) {
    const meta = createEl("div", "detail-meta");
    data.meta.forEach((item) => {
      const value = Array.isArray(item.value) ? item.value.join(", ") : item.value;
      if (!value) return;
      const block = createEl("div", "meta-item");
      block.append(createEl("span", "meta-label", item.label));
      block.append(createEl("span", "meta-value", value));
      meta.append(block);
    });
    if (meta.childElementCount > 0) content.append(meta);
  }

  if (data.code !== undefined) {
    const pre = createEl("pre", "code-block");
    const code = createEl("code", null, data.code || "");
    pre.append(code);
    content.append(pre);
  } else if (data.markdown) {
    content.append(renderMarkdown(data.markdown));
  } else {
    content.append(createEl("p", "detail-text", data.text || "Không có nội dung để hiển thị."));
  }

  detailPane.append(content);
}

async function openResult(index) {
  const result = state.results[index];
  if (!result) return;

  state.activeIndex = index;
  renderResults();

  if (result.mode === "code") {
    renderDetail({
      kicker: modeCopy.code.detailLabel,
      title: result.title,
      url: result.url,
      tags: [
        { text: result.lang || "code", className: "code" },
        { text: result.source || "source" }
      ],
      code: result.code
    });
    return;
  }

  if (result.mode === "translate") {
    renderTranslationDetail(result);
    return;
  }

  setDetailLoading(result);

  try {
    if (result.mode === "legal" || result.mode === "procedure") {
      const data = await fetchJson("/api/fetch/vietnam-legal", {
        url: result.url,
        max_chars: 24000,
        render: false
      });
      renderLegalDetail(result, data);
      return;
    }

    if (result.mode === "pdf") {
      const data = await fetchJson("/api/fetch/document", {
        url: result.url,
        max_chars: 30000
      });
      renderDetail({
        kicker: modeCopy.pdf.detailLabel,
        title: data.info?.Title || result.title,
        url: data.finalUrl || result.url,
        meta: [
          { label: "Số trang", value: data.numPages ? String(data.numPages) : "" },
          { label: "Loại nội dung", value: data.contentType || "PDF" }
        ],
        text: data.text
      });
      return;
    }

    const data = await fetchWebDetail(result.url);
    renderDetail({
      kicker: modeCopy.web.detailLabel,
      title: data.title || result.title,
      url: data.finalUrl || result.url,
      meta: [
        { label: "Nguồn", value: result.source || "" },
        { label: "Loại nội dung", value: data.contentType || data.mode || "" }
      ],
      markdown: data.markdown,
      text: data.text || ""
    });
  } catch (err) {
    renderError(detailPane, "Không tải được nội dung", err.message || String(err));
  }
}

function renderLegalDetail(result, data) {
  const metadata = data.metadata || {};
  renderDetail({
    kicker: modeCopy[result.mode].detailLabel,
    title: data.title || metadata.title || result.title,
    url: data.finalUrl || result.url,
    tags: [
      {
        text: metadata.sourceTier === "official" ? "Nguồn chính thức" : "Nguồn tham khảo",
        className: metadata.sourceTier === "official" ? "official" : "warn"
      },
      { text: metadata.confidence ? `Metadata ${metadata.confidence}` : "Metadata" }
    ],
    meta: [
      { label: "Loại văn bản", value: metadata.documentType },
      { label: "Số hiệu", value: metadata.documentNumber },
      { label: "Cơ quan", value: metadata.authority },
      { label: "Ngày ban hành", value: metadata.issuedDate },
      { label: "Ngày hiệu lực", value: metadata.effectiveDate },
      { label: "Tín hiệu hiệu lực", value: metadata.statusSignals },
      { label: "Văn bản được viện dẫn", value: metadata.citations?.slice(0, 8) }
    ],
    text: data.text || data.markdown || result.snippet
  });
}

function renderTranslationDetail(result) {
  const lines = [
    "### Bản dịch",
    result.translatedText || "Không có bản dịch.",
    "",
    "### Nguyên văn",
    result.originalText || ""
  ];

  renderDetail({
    kicker: modeCopy.translate.detailLabel,
    title: result.title,
    tags: [
      { text: result.provider || "provider" },
      { text: `${result.sourceLang || "auto"} → ${result.targetLang || ""}`.trim(), className: "code" }
    ],
    meta: [
      { label: "Provider", value: result.provider },
      { label: "Chế độ provider", value: result.providerMode },
      { label: "Nguồn", value: result.sourceLang },
      { label: "Đích", value: result.targetLang },
      {
        label: "Fallback đã thử",
        value: result.alternativesTried?.map((item) => `${item.provider}: ${item.error}`)
      }
    ],
    markdown: lines.join("\n")
  });
}

async function fetchWebDetail(url) {
  try {
    return await fetchJson("/api/fetch/markdown", { url, max_chars: 36000 });
  } catch {
    try {
      return await fetchJson("/api/fetch/static", { url, max_chars: 24000 });
    } catch {
      return await fetchJson("/api/fetch/rendered/markdown", {
        url,
        max_chars: 36000,
        wait_ms: 1000,
        scroll_steps: 2
      });
    }
  }
}

async function runSearch(event) {
  event?.preventDefault();
  const query = queryInput.value.trim();
  if (!query) {
    renderEmptyResults("Nhập từ khóa để bắt đầu.");
    queryInput.focus();
    return;
  }

  if (state.searchController) state.searchController.abort();
  state.searchController = new AbortController();
  state.activeIndex = -1;
  setBusy(true);
  setStatus(`Đang tìm trong ${modeCopy[state.mode].label}...`);
  renderLoadingResults();

  try {
    const request = buildSearchRequest(query);
    const data = await fetchJson(request.path, request.payload, {
      signal: state.searchController.signal
    });
    state.results = normalizeResults(data);
    renderResults();
    if (state.mode === "translate" && state.results.length > 0) {
      openResult(0);
    }
    setStatus(`${state.results.length} kết quả · ${modeCopy[state.mode].label}`);
  } catch (err) {
    if (err.name === "AbortError") return;
    state.results = [];
    resultCount.textContent = "0";
    renderError(resultsList, "Tìm kiếm thất bại", err.message || String(err));
    setStatus("Có lỗi khi tìm kiếm");
  } finally {
    setBusy(false);
  }
}

async function checkHealth() {
  healthPill.textContent = "Đang kiểm tra";
  healthPill.classList.remove("ok", "error");

  try {
    const response = await fetch("/health");
    const data = await response.json();
    const ok = data.api === "ok" && data.searxng === "ok";
    const searxngStatus = data.searxng === "ok" ? "OK" : "lỗi";
    const playwrightStatus = data.playwright === "ok" ? "OK" : "chưa sẵn sàng";
    healthPill.textContent = ok ? "API OK" : "API lỗi";
    healthPill.classList.toggle("ok", ok);
    healthPill.classList.toggle("error", !ok);
    setStatus(`SearXNG: ${searxngStatus}; Playwright: ${playwrightStatus}`);
  } catch (err) {
    healthPill.textContent = "API lỗi";
    healthPill.classList.add("error");
    setStatus(err.message || String(err));
  }
}

modeTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    state.mode = tab.dataset.mode;
    updateModeUI();
    if (queryInput.value.trim()) runSearch();
  });
});

form.addEventListener("submit", runSearch);
healthButton.addEventListener("click", checkHealth);
updateModeUI();
