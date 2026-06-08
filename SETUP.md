# How to Set Up local-ai-web

## Requirements

You need:

- LM Studio with MCP support.
- Docker or Docker Desktop.
- Node.js and npm.
- Internet access for initial package/browser downloads.
- A terminal:
  - Windows: PowerShell or Windows Terminal.
  - macOS/Linux: Terminal.

---

## Install Docker

### Windows

1. Enable virtualization in BIOS/UEFI if needed.
2. Install WSL 2 from PowerShell as Administrator:

```powershell
wsl --install
```

3. Restart Windows if prompted.
4. Install Docker Desktop for Windows:

```text
https://docs.docker.com/desktop/setup/install/windows-install/
```

5. Open Docker Desktop.
6. Verify Docker:

```powershell
docker --version
docker compose version
docker run --rm hello-world
```

### macOS

1. Download Docker Desktop for Mac:

```text
https://docs.docker.com/desktop/setup/install/mac-install/
```

2. Choose Apple Silicon or Intel version.
3. Open `Docker.dmg` and drag Docker into Applications.
4. Launch Docker Desktop.
5. Verify Docker:

```bash
docker --version
docker compose version
docker run --rm hello-world
```

### Ubuntu

Remove conflicting packages if present:

```bash
sudo apt remove $(dpkg --get-selections docker.io docker-compose docker-compose-v2 docker-doc podman-docker containerd runc | cut -f1)
```

Add Docker repository:

```bash
sudo apt update
sudo apt install ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
```

Install Docker:

```bash
sudo apt install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Verify Docker:

```bash
sudo systemctl status docker
sudo docker run hello-world
```

Optional: run Docker without `sudo`:

```bash
sudo usermod -aG docker $USER
newgrp docker
docker run --rm hello-world
```

---

## Install Node.js

Install Node.js LTS:

```text
https://nodejs.org/en/download
```

Verify:

```bash
node -v
npm -v
```

---

## Set Up SearXNG

From the project root:

```bash
mkdir -p searxng/config
```

Windows PowerShell:

```powershell
mkdir searxng
mkdir searxng\config
```

Create `docker-compose.yml`:

```yaml
services:
  searxng:
    image: searxng/searxng:latest
    container_name: searxng
    ports:
      - "127.0.0.1:${SEARXNG_PORT:-8080}:8080"
    volumes:
      - ./searxng/config:/etc/searxng
    environment:
      - SEARXNG_BASE_URL=http://127.0.0.1:${SEARXNG_PORT:-8080}/
      - INSTANCE_NAME=local-searxng
    restart: unless-stopped
```

Create `searxng/config/settings.yml`:

```yaml
use_default_settings: true

server:
  secret_key: "replace-this-with-a-long-random-string"
  bind_address: "0.0.0.0"
  port: 8080
  limiter: false
  image_proxy: false

search:
  formats:
    - html
    - json
```

Create `.env.example`:

```env
SEARXNG_PORT=8080
SEARXNG_URL=http://127.0.0.1:8080
# Optional: restrict SearXNG queries to specific engines to reduce 403/CAPTCHA noise.
# If empty, MCP falls back to: google,bing,wikipedia
SEARXNG_ENGINES=

REQUEST_TIMEOUT_MS=15000
MAX_FETCH_BYTES=524288
DEFAULT_MAX_CHARS=12000

RENDER_NAV_TIMEOUT_MS=30000
RENDER_NETWORK_IDLE_TIMEOUT_MS=10000
RENDER_EXTRA_WAIT_MS=1500
RENDER_SCROLL_STEPS=3
RENDER_SCROLL_DELAY_MS=800
RENDER_BLOCK_RESOURCE_TYPES=image,media,font

ALLOW_DOMAINS=
DEBUG_LOCAL_WEB_READER=0

ENABLE_CACHE=1
SEARCH_CACHE_TTL_MS=300000
FETCH_CACHE_TTL_MS=600000
RENDER_CACHE_TTL_MS=600000

CODE_WEB_CACHE_TTL_MS=300000
CODE_WEB_MAX_URLS=8
CODE_WEB_MAX_SNIPPETS=20
CODE_WEB_MAX_CHARS_PER_SNIPPET=3000
CODE_WEB_PREFERRED_DOMAINS=github.com,stackoverflow.com,stackexchange.com,developer.mozilla.org,learn.microsoft.com,docs.python.org

LEGAL_VN_CACHE_TTL_MS=600000
LEGAL_VN_MAX_URLS=8
LEGAL_VN_MAX_DOC_CHARS=30000
LEGAL_VN_OFFICIAL_DOMAINS=vbpl.vn,vanban.chinhphu.vn,congbao.chinhphu.vn,chinhphu.vn,quochoi.vn,gov.vn,dichvucong.gov.vn
LEGAL_VN_REFERENCE_DOMAINS=thuvienphapluat.vn,luatvietnam.vn

TRANSLATE_TIMEOUT_MS=15000
TRANSLATE_MAX_CHARS=8000
TRANSLATE_PROVIDERS=google,mymemory,duckduckgo
```

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Start SearXNG:

```bash
docker compose up -d
```

Test SearXNG JSON API:

```bash
curl "http://127.0.0.1:8080/search?q=test&format=json"
```

If you changed `SEARXNG_PORT`, use that port instead.

---

## Set Up MCP Server

Create the MCP project:

```bash
mkdir mcp-web-reader
cd mcp-web-reader

npm init -y
npm install @modelcontextprotocol/sdk@1.29.0 zod@^3.25.0
npm install playwright turndown jsdom @mozilla/readability
npm install -D typescript @types/node @types/turndown @types/jsdom
```

Install Playwright Chromium:

```bash
npx playwright install chromium
```

On Linux, if dependencies are missing:

```bash
npx playwright install --with-deps chromium
```

Replace `package.json`:

```json
{
  "name": "mcp-web-reader",
  "version": "1.0.0",
  "type": "module",
  "private": true,
  "scripts": {
    "build": "tsc",
    "build:watch": "tsc --watch",
    "start": "node dist/index.js",
    "print:mcp": "node scripts/print-mcp-config.js",
    "verify": "node scripts/verify.js"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.29.0",
    "@mozilla/readability": "^0.5.0",
    "jsdom": "^24.1.3",
    "playwright": "^1.59.1",
    "turndown": "^7.2.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/jsdom": "^28.0.1",
    "@types/node": "^22.0.0",
    "@types/turndown": "^5.0.5",
    "typescript": "^5.8.0"
  }
}
```

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

Create `src/cache.ts`:

```ts
type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const store = new Map<string, CacheEntry<unknown>>();

export function getCache<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;

  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }

  return entry.value as T;
}

export function setCache<T>(key: string, value: T, ttlMs: number): void {
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlMs
  });
}

export function clearCache(): number {
  const count = store.size;
  store.clear();
  return count;
}

export function cacheSize(): number {
  return store.size;
}
```

Create `src/extract.ts`:

```ts
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
```

Create `src/index.ts` from the project source code. This file should expose the following MCP tools:

```text
health_check
clear_cache
search_web
fetch_url
fetch_rendered_source
fetch_rendered_markdown
```

> Tip: Keep `index.ts` in source control instead of pasting it manually from the README. This README focuses on setup and usage.

Create `scripts/print-mcp-config.js`:

```js
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
        RENDER_NETWORK_IDLE_TIMEOUT_MS: process.env.RENDER_NETWORK_IDLE_TIMEOUT_MS || "10000",
        RENDER_EXTRA_WAIT_MS: process.env.RENDER_EXTRA_WAIT_MS || "1500",
        RENDER_SCROLL_STEPS: process.env.RENDER_SCROLL_STEPS || "3",
        RENDER_SCROLL_DELAY_MS: process.env.RENDER_SCROLL_DELAY_MS || "800",
        RENDER_BLOCK_RESOURCE_TYPES: process.env.RENDER_BLOCK_RESOURCE_TYPES || "image,media,font",
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
          "thuvienphapluat.vn,luatvietnam.vn",
        TRANSLATE_TIMEOUT_MS: process.env.TRANSLATE_TIMEOUT_MS || "15000",
        TRANSLATE_MAX_CHARS: process.env.TRANSLATE_MAX_CHARS || "8000",
        TRANSLATE_PROVIDERS:
          process.env.TRANSLATE_PROVIDERS || "google,mymemory,duckduckgo"
      }
    }
  }
};

console.log(JSON.stringify(config, null, 2));
console.error("");
console.error("Copy the JSON above into LM Studio:");
console.error("Program → Install → Edit mcp.json");
```

Create `scripts/verify.js`:

```js
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
```

Build and verify:

```bash
npm install
npx playwright install chromium
npm run build
npm run verify
npm run print:mcp
```

---

## Access the Web App

You can run the web app and SearXNG together using Docker Compose (Option 1) or run them manually for local development (Option 2).

### Option 1: Run with Docker Compose (Easiest)

From the project root directory, run:

```bash
docker compose up -d --build
```

This will automatically:
1. Build the Angular SPA frontend.
2. Build the TypeScript backend.
3. Install Chromium dependencies and Playwright.
4. Launch SearXNG and the web app server together in separate containers.

Once running, access the web interface at:
```text
http://localhost:3000
```

To stop the containers:
```bash
docker compose down
```

### Option 2: Run Manually (Local Development)

1. Start only the SearXNG service from the project root:
   ```bash
   docker compose up -d searxng
   ```

2. Build the Angular SPA frontend:
   ```bash
   cd mcp-web-reader/frontend
   npm run build
   cd ..
   ```

3. Start the local API server:
   ```bash
   npm run serve:api
   ```

Open the web app in your browser at `http://localhost:3000`.

### Swagger UI API Documentation

Regardless of how you start the server, you can access the OpenAPI Swagger documentation at:
```text
http://localhost:3000/docs
```

If you need to use a different port for manual local development:
- Linux/macOS: `API_PORT=3001 npm run serve:api`
- Windows PowerShell: `$env:API_PORT="3001"; npm run serve:api`

---

## Configure LM Studio

In LM Studio:

1. Open the right sidebar.
2. Go to **Program**.
3. Click **Install**.
4. Click **Edit mcp.json**.
5. Paste the JSON printed by:

```bash
npm run print:mcp
```

Restart LM Studio if the tools do not appear.
