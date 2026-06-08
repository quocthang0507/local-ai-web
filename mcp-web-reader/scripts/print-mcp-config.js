#!/usr/bin/env node

import path from "node:path";
import process from "node:process";
import fs from "node:fs";

const cwd = process.cwd();
const indexPath = path.resolve(cwd, "dist", "index.js");

if (!fs.existsSync(indexPath)) {
  console.error("dist/index.js not found. Run: npm run build");
  process.exit(1);
}

const isWindows = process.platform === "win32";

const config = {
  mcpServers: {
    "local-web-reader": {
      command: "node",
      args: [indexPath],
      env: {
        SEARXNG_URL: process.env.SEARXNG_URL || "http://127.0.0.1:8080",
        REQUEST_TIMEOUT_MS: process.env.REQUEST_TIMEOUT_MS || "15000",
        MAX_FETCH_BYTES: process.env.MAX_FETCH_BYTES || "524288",
        DEFAULT_MAX_CHARS: process.env.DEFAULT_MAX_CHARS || "12000",
        RENDER_NAV_TIMEOUT_MS: process.env.RENDER_NAV_TIMEOUT_MS || "30000",
        RENDER_NETWORK_IDLE_TIMEOUT_MS:
          process.env.RENDER_NETWORK_IDLE_TIMEOUT_MS || "10000",
        RENDER_EXTRA_WAIT_MS: process.env.RENDER_EXTRA_WAIT_MS || "1500",
        RENDER_SCROLL_STEPS: process.env.RENDER_SCROLL_STEPS || "3",
        RENDER_SCROLL_DELAY_MS: process.env.RENDER_SCROLL_DELAY_MS || "800",
        RENDER_BLOCK_RESOURCE_TYPES:
          process.env.RENDER_BLOCK_RESOURCE_TYPES || "image,media,font",
        ALLOW_DOMAINS: process.env.ALLOW_DOMAINS || "",
        DEBUG_LOCAL_WEB_READER: process.env.DEBUG_LOCAL_WEB_READER || "0",
        ENABLE_CACHE: process.env.ENABLE_CACHE || "1",
        SEARCH_CACHE_TTL_MS: process.env.SEARCH_CACHE_TTL_MS || "300000",
        FETCH_CACHE_TTL_MS: process.env.FETCH_CACHE_TTL_MS || "600000",
        RENDER_CACHE_TTL_MS: process.env.RENDER_CACHE_TTL_MS || "600000",
        CODE_WEB_CACHE_TTL_MS: process.env.CODE_WEB_CACHE_TTL_MS || "300000",
        CODE_WEB_MAX_URLS: process.env.CODE_WEB_MAX_URLS || "8",
        CODE_WEB_MAX_SNIPPETS: process.env.CODE_WEB_MAX_SNIPPETS || "20",
        CODE_WEB_MAX_CHARS_PER_SNIPPET:
          process.env.CODE_WEB_MAX_CHARS_PER_SNIPPET || "3000",
        CODE_WEB_PREFERRED_DOMAINS:
          process.env.CODE_WEB_PREFERRED_DOMAINS ||
          "github.com,stackoverflow.com,stackexchange.com,developer.mozilla.org,learn.microsoft.com,docs.python.org",
        LEGAL_VN_CACHE_TTL_MS: process.env.LEGAL_VN_CACHE_TTL_MS || "600000",
        LEGAL_VN_MAX_URLS: process.env.LEGAL_VN_MAX_URLS || "8",
        LEGAL_VN_MAX_DOC_CHARS: process.env.LEGAL_VN_MAX_DOC_CHARS || "30000",
        LEGAL_VN_OFFICIAL_DOMAINS:
          process.env.LEGAL_VN_OFFICIAL_DOMAINS ||
          "vbpl.vn,vanban.chinhphu.vn,congbao.chinhphu.vn,chinhphu.vn,quochoi.vn,gov.vn,dichvucong.gov.vn",
        LEGAL_VN_REFERENCE_DOMAINS:
          process.env.LEGAL_VN_REFERENCE_DOMAINS ||
          "thuvienphapluat.vn,luatvietnam.vn"
      }
    }
  }
};

console.log(JSON.stringify(config, null, 2));

console.error("");
console.error("Copy the JSON above into LM Studio:");
console.error("Program → Install → Edit mcp.json");
console.error("");
console.error(
  isWindows
    ? "Windows path detected."
    : "macOS/Linux path detected."
);
