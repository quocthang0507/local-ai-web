# local-ai-web

Local web search and web reading tools for local LLMs running in **LM Studio**.

## `local-ai-web` adds a small MCP server to LM Studio so your local model can:

- Search the web through a local SearXNG instance.
- Read normal static HTML pages.
- Render JavaScript-heavy SPA pages with Playwright Chromium.
- Extract visible text, rendered HTML, and cleaned Markdown.
- Block localhost/private-network requests to reduce SSRF risk.

## Web Code Search (Internet)

This project now supports **real-time code search from the Internet** via the `search_code_web` tool.

It allows local LLMs (Qwen, Llama, etc.) to:
- find real-world code examples from GitHub / StackOverflow / docs
- extract working code snippets
- reduce hallucination significantly

👉 Works completely local + private (self-hosted SearXNG)

> This project is for local research and personal productivity. It does not bypass login pages, paywalls, CAPTCHA, or website access controls.

---

## Table of Contents

- [Architecture](#architecture)
- [Features](#features)
- [Project Structure](#project-structure)
- [How to Set Up](SETUP.md)
- [How to Use](USAGE.md)
- [Development Workflow](#development-workflow)
- [Troubleshooting](#troubleshooting)
- [Security Notes](#security-notes)
- [Limitations](#limitations)
- [Useful Links](#useful-links)
- [License](#license)

---

## Architecture

The system uses a Retrieval-Augmented pipeline for code search:

```mermaid
flowchart TD
    A[User Query] --> B[Query Rewriting]
    B --> C[SearXNG Search]
    C --> D[URL Filtering]
    D --> E[Fetch Page]
    E --> F[Code Extraction]
    F --> G[Ranking]
    G --> H[LLM Response]
````

This design ensures:

*   ✅ up-to-date code retrieval
*   ✅ reduced hallucination
*   ✅ better real-world examples

SearXNG runs in Docker. The MCP server runs locally with Node.js and is launched by LM Studio through `mcp.json`.

---

## Features

### `health_check`

Checks whether the MCP server, SearXNG, and Playwright Chromium are ready.

### `search_web`

Searches the web through local SearXNG and returns compact results. Supports time range filtering (`day`, `week`, `month`, `year`) for finding recent information:

```json
{
  "title": "...",
  "url": "...",
  "snippet": "...",
  "source": "example.com"
}
```

### `fetch_url`

Fetches normal static HTML or plain text pages.

Use this for:

- Static documentation pages.
- Server-rendered blogs.
- Simple HTML pages.

### `fetch_rendered_source`

Renders JavaScript-heavy pages in headless Chromium and returns visible text and/or rendered DOM HTML.

Use this for:

- React apps.
- Vue apps.
- Angular apps.
- Next.js/Nuxt pages.
- SPA pages where normal HTTP fetch only returns an empty shell.

### `fetch_rendered_markdown`

Renders a page with Chromium, extracts the main content, and converts it to Markdown.

This is usually the best tool for LLM summarization.

### `fetch_document`

Fetches and extracts raw text from PDF files and other supported documents.

Use this for:
- Research papers (PDFs).
- Manuals and technical documentation.

### `extract_structured_data`

Extracts high-fidelity data that often gets lost in standard text conversion. Automatically detects HTML tables and converts them to Markdown, and extracts JSON-LD metadata. Supports an optional `render` flag for SPAs.

Use this for:
- Extracting tables of data (e.g., pricing, specifications).
- Reading product or recipe metadata.

### OpenAPI API Server

Includes a standalone Express server providing REST APIs and a Swagger UI for executing all web search and reading features independently of LM Studio.

### `clear_cache`

Clears in-memory cache.

### `cache_stats`

Shows in-memory cache statistics (e.g. memory usage, cache size).

### `close_browser`

Closes the background Playwright Chromium browser instance to free up memory.

### `search_code_web`

  - Web code search
  - multi-query search via SearXNG
  - GitHub raw code extraction
  - StackOverflow snippet extraction
  - automatic ranking (best snippet first)

---

## Project Structure

Recommended structure:

```text
local-ai-web/
├─ README.md
├─ SECURITY.md
├─ .env.example
├─ .gitignore
├─ docker-compose.yml
├─ searxng/
│  └─ config/
│     └─ settings.yml
├─ mcp-web-reader/
│  ├─ package.json
│  ├─ tsconfig.json
│  ├─ src/
│  │  ├─ index.ts          # Server entry point
│  │  ├─ browser.ts        # Playwright browser management
│  │  ├─ tools.ts          # MCP tool definitions & handlers
│  │  ├─ searxng.ts        # SearXNG API client
│  │  ├─ code_web.ts       # Code search & extraction logic
│  │  ├─ structured.ts     # Table & Metadata extraction
│  │  ├─ cache.ts          # In-memory caching
│  │  ├─ extract.ts        # HTML to Markdown/Text extraction
│  │  ├─ config.ts         # Environment configuration
│  │  ├─ helper.ts         # Utility functions
│  │  ├─ security.ts       # SSRF & domain filtering
│  │  ├─ log.ts            # Logging utilities
│  │  ├─ http.ts           # Standalone API Server
│  │  └─ swagger.ts        # OpenAPI Specification
│  └─ scripts/
│     ├─ print-mcp-config.js
│     └─ verify.js
└─ examples/
   ├─ prompts.md
   ├─ mcp.windows.json
   ├─ mcp.macos.json
   └─ mcp.linux.json
```

## How to Set Up

Please refer to [SETUP.md](SETUP.md) for detailed instructions on:
- Requirements
- Installing Docker
- Installing Node.js
- Setting up SearXNG
- Setting up the MCP Server
- Configuring LM Studio

---

## How to Use

Please refer to [USAGE.md](USAGE.md) for detailed instructions on:
- Searching code snippets
- Recommended System Prompts
- GitHub Raw Optimization
- Example prompts for each feature
```

---

## Development Workflow

Start SearXNG:

```bash
docker compose up -d
```

Stop SearXNG:

```bash
docker compose down
```

Rebuild MCP after code changes:

```bash
cd mcp-web-reader
npm run build
```

Watch TypeScript changes:

```bash
npm run build:watch
```

`build:watch` rebuilds `dist/index.js`, but the running MCP process still needs to be restarted or reconnected in LM Studio.

---

## Troubleshooting

### `TS7016: Could not find a declaration file for module 'jsdom'`

```bash
npm install -D @types/jsdom
npm run build
```

### SearXNG returns `403 Forbidden` for JSON

Make sure `searxng/config/settings.yml` contains:

```yaml
search:
  formats:
    - html
    - json
```

Restart SearXNG:

```bash
docker compose restart searxng
```

### SearXNG logs many `403` / `Too many request` / `CAPTCHA` engine errors

Some upstream engines rate-limit or CAPTCHA data-center/shared IPs aggressively.
You can limit MCP queries to a smaller set of engines:

```env
SEARXNG_ENGINES=google,bing
```

Then restart MCP (or reconnect in LM Studio).

If `SEARXNG_ENGINES` is not set, MCP automatically uses `google,bing,wikipedia`.

### Port 8080 is already in use

Edit `.env`:

```env
SEARXNG_PORT=8888
SEARXNG_URL=http://127.0.0.1:8888
```

Restart:

```bash
docker compose down
docker compose up -d
```

Regenerate LM Studio config:

```bash
cd mcp-web-reader
npm run print:mcp
```

### LM Studio does not show tools

```bash
cd mcp-web-reader
npm run build
npm run print:mcp
```

Make sure `mcp.json` uses the absolute path to `dist/index.js`.

### Playwright browser is missing

```bash
npx playwright install chromium
```

Linux:

```bash
npx playwright install --with-deps chromium
```

### Static fetch returns an empty shell

Use `fetch_rendered_source` or `fetch_rendered_markdown`.

### Rendered fetch misses lazy-loaded content

Try higher `wait_ms` and `scroll_steps`:

```text
Use fetch_rendered_markdown with wait_ms=5000 and scroll_steps=8.
```

---

## Security Notes

Do not add shell or filesystem tools to this MCP server unless you fully understand the risk.

Keep SearXNG bound to `127.0.0.1` unless you know what you are doing.

For high-trust workflows, set `ALLOW_DOMAINS`:

```env
ALLOW_DOMAINS=lmstudio.ai,github.com,docs.searxng.org
```

Treat every web page as untrusted input.

---

## Limitations

This project cannot reliably extract:

- Login-only content.
- CAPTCHA-protected content.
- Heavily anti-bot-protected content.
- Paywalled content.
- Canvas/WebGL-only text.
- Content requiring complex user interaction.
- Some websites block scraping
- Dynamic sites may require rendering
- Not all pages contain clean code blocks
- GitHub directories / issues are ignored

It does not bypass website access controls.

---

## Useful Links

- LM Studio MCP docs: https://lmstudio.ai/docs/app/mcp
- SearXNG Search API: https://docs.searxng.org/dev/search_api.html
- Docker Desktop: https://docs.docker.com/get-started/introduction/get-docker-desktop/
- Docker Engine Ubuntu: https://docs.docker.com/engine/install/ubuntu/
- Node.js downloads: https://nodejs.org/en/download
- MCP TypeScript SDK: https://www.npmjs.com/package/@modelcontextprotocol/sdk
- Playwright: https://playwright.dev/docs/intro

---

## License

[MIT](LICENSE)
