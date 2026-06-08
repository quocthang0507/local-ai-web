export const SEARXNG_URL = process.env.SEARXNG_URL || "http://127.0.0.1:8080";
const RAW_SEARXNG_ENGINES = (process.env.SEARXNG_ENGINES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const DEFAULT_SEARXNG_ENGINES = ["google", "bing", "wikipedia"];
export const USING_DEFAULT_SEARXNG_ENGINES = RAW_SEARXNG_ENGINES.length === 0;
export const SEARXNG_ENGINES = USING_DEFAULT_SEARXNG_ENGINES
  ? DEFAULT_SEARXNG_ENGINES
  : RAW_SEARXNG_ENGINES;

export const SEARXNG_REQUEST_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "X-Forwarded-For": "127.0.0.1",
  "X-Real-IP": "127.0.0.1"
};

export const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || "15000");
export const MAX_FETCH_BYTES = Number(process.env.MAX_FETCH_BYTES || String(512 * 1024));
export const DEFAULT_MAX_CHARS = Number(process.env.DEFAULT_MAX_CHARS || "12000");

export const RENDER_NAV_TIMEOUT_MS = Number(process.env.RENDER_NAV_TIMEOUT_MS || "30000");
export const RENDER_NETWORK_IDLE_TIMEOUT_MS = Number(process.env.RENDER_NETWORK_IDLE_TIMEOUT_MS || "10000");
export const RENDER_EXTRA_WAIT_MS = Number(process.env.RENDER_EXTRA_WAIT_MS || "1500");
export const RENDER_SCROLL_STEPS = Number(process.env.RENDER_SCROLL_STEPS || "3");
export const RENDER_SCROLL_DELAY_MS = Number(process.env.RENDER_SCROLL_DELAY_MS || "800");

export const ENABLE_CACHE = process.env.ENABLE_CACHE !== "0";
export const SEARCH_CACHE_TTL_MS = Number(process.env.SEARCH_CACHE_TTL_MS || "300000");
export const FETCH_CACHE_TTL_MS = Number(process.env.FETCH_CACHE_TTL_MS || "600000");
export const RENDER_CACHE_TTL_MS = Number(process.env.RENDER_CACHE_TTL_MS || "600000");

export const DEBUG = process.env.DEBUG_LOCAL_WEB_READER === "1";

export const CODE_WEB_CACHE_TTL_MS = Number(process.env.CODE_WEB_CACHE_TTL_MS || "300000");
export const CODE_WEB_MAX_URLS = Number(process.env.CODE_WEB_MAX_URLS || "5");
export const CODE_WEB_MAX_SNIPPETS = Number(process.env.CODE_WEB_MAX_SNIPPETS || "20");
export const CODE_WEB_MAX_CHARS_PER_SNIPPET = Number(process.env.CODE_WEB_MAX_CHARS_PER_SNIPPET || "3000");

export const RENDER_BLOCK_RESOURCE_TYPES = new Set(
  (process.env.RENDER_BLOCK_RESOURCE_TYPES || "image,media,font")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

export const ALLOW_DOMAINS = (process.env.ALLOW_DOMAINS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const CODE_WEB_PREFERRED_DOMAINS = (process.env.CODE_WEB_PREFERRED_DOMAINS || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const LEGAL_VN_CACHE_TTL_MS = Number(process.env.LEGAL_VN_CACHE_TTL_MS || "600000");
export const LEGAL_VN_MAX_URLS = Number(process.env.LEGAL_VN_MAX_URLS || "8");
export const LEGAL_VN_MAX_DOC_CHARS = Number(process.env.LEGAL_VN_MAX_DOC_CHARS || "30000");

export const LEGAL_VN_OFFICIAL_DOMAINS = (
  process.env.LEGAL_VN_OFFICIAL_DOMAINS ||
  "vbpl.vn,vanban.chinhphu.vn,congbao.chinhphu.vn,chinhphu.vn,quochoi.vn,gov.vn,dichvucong.gov.vn"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const LEGAL_VN_REFERENCE_DOMAINS = (
  process.env.LEGAL_VN_REFERENCE_DOMAINS ||
  "thuvienphapluat.vn,luatvietnam.vn"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

export const TRANSLATE_TIMEOUT_MS = Number(process.env.TRANSLATE_TIMEOUT_MS || "15000");
export const TRANSLATE_MAX_CHARS = Number(process.env.TRANSLATE_MAX_CHARS || "8000");

export const TRANSLATE_PROVIDERS = (
  process.env.TRANSLATE_PROVIDERS || "google,mymemory,duckduckgo,lingva"
)
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

