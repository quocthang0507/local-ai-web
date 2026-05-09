#!/usr/bin/env node

import fs from "node:fs";
import { spawnSync } from "node:child_process";

const searxngUrl = process.env.SEARXNG_URL || "http://127.0.0.1:8080";

function ok(label) {
  console.log(`✅ ${label}`);
}

function fail(label, detail) {
  console.error(`❌ ${label}`);
  if (detail) console.error(detail);
  process.exitCode = 1;
}

async function main() {
  const node = spawnSync("node", ["-v"], { encoding: "utf8" });
  if (node.status === 0) ok(`Node ${node.stdout.trim()}`);
  else fail("Node.js not found");

  const npm = spawnSync("npm", ["-v"], { encoding: "utf8" });
  if (npm.status === 0) ok(`npm ${npm.stdout.trim()}`);
  else fail("npm not found");

  if (fs.existsSync("dist/index.js")) ok("dist/index.js exists");
  else fail("dist/index.js not found. Run npm run build.");

  try {
    const endpoint = new URL("/search", searxngUrl);
    endpoint.searchParams.set("q", "test");
    endpoint.searchParams.set("format", "json");

    const res = await fetch(endpoint);
    if (res.ok) ok(`SearXNG JSON API ok: ${endpoint.toString()}`);
    else fail(`SearXNG returned HTTP ${res.status}`, endpoint.toString());
  } catch (err) {
    fail("SearXNG check failed", err?.message || String(err));
  }

  const pw = spawnSync("npx", ["playwright", "--version"], {
    encoding: "utf8",
    shell: process.platform === "win32"
  });

  if (pw.status === 0) ok(pw.stdout.trim());
  else fail("Playwright not available. Run: npm install playwright && npx playwright install chromium");
}

main();