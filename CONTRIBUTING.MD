# Contributing to local-ai-web

First off, thank you for considering contributing to `local-ai-web`! It's people like you that make the local AI ecosystem better.

## Getting Started

### Prerequisites
- Node.js (v18+)
- Docker (for SearXNG)
- LM Studio (for testing with a real LLM)

### Setup
1. Fork the repository.
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/local-ai-web.git
   cd local-ai-web
   ```
3. Install dependencies for the MCP server:
   ```bash
   cd mcp-web-reader
   npm install
   npx playwright install chromium
   ```

## Development Workflow

### Building
The project is written in TypeScript. Always build before testing:
```bash
npm run build
```

### Testing
We have a test suite that simulates an MCP client:
```bash
# Ensure you have built the project first
npm run test
```
This script tests various tools including `health_check`, `search_web`, `fetch_url`, and `search_code_web`.

### Verifying Environment
You can verify if your local SearXNG and Playwright are correctly configured:
```bash
npm run verify
```

## Project Structure

The MCP server is located in `mcp-web-reader/src/` and is modularized:

- `index.ts`: Entry point, tool registration.
- `tools.ts`: Logic for each MCP tool.
- `browser.ts`: Playwright browser instance management.
- `searxng.ts`: Interaction with the SearXNG API.
- `code_web.ts`: Specialized logic for web code search.
- `cache.ts`: In-memory caching.
- `extract.ts`: HTML to Markdown/Text extraction.
- `config.ts`: Environment variable management.
- `helper.ts`: Utility functions.
- `security.ts`: SSRF protection and domain filtering.
- `log.ts`: Logging utilities.

## Adding a New Tool

If you want to add a new tool:
1. Define the tool's schema and logic in `src/tools.ts`.
2. Register the tool in `src/index.ts` using `server.tool()`.
3. Add a test case in `test_mcp.js`.
4. Update the `README.md` if necessary.

## Pull Request Process

1. Create a new branch for your feature or bugfix.
2. Ensure all tests pass (`npm run test`).
3. Update documentation if you added new features.
4. Submit a PR with a clear description of your changes.

## Security

Please do not report security vulnerabilities through public GitHub issues. See [SECURITY.md](SECURITY.md) for our security policy.
