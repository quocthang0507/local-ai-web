const form = document.querySelector("#searchForm");
const queryInput = document.querySelector("#queryInput");
const timeRange = document.querySelector("#timeRange");
const maxResults = document.querySelector("#maxResults");
const includeUnofficial = document.querySelector("#includeUnofficial");
const referenceFilter = document.querySelector("#referenceFilter");
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
  referenceFilter.classList.toggle("hidden", !legalMode);
  queryInput.placeholder = legalMode
    ? "Tìm văn bản, số hiệu, thủ tục, hồ sơ..."
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
    const snippet = createEl("p", "result-snippet", result.snippet || "Không có mô tả.");
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
      text: data.markdown || data.text || ""
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

async function fetchWebDetail(url) {
  try {
    return await fetchJson("/api/fetch/static", { url, max_chars: 24000 });
  } catch {
    return await fetchJson("/api/fetch/rendered/markdown", {
      url,
      max_chars: 24000,
      wait_ms: 1000,
      scroll_steps: 2
    });
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
