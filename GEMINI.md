# Project Instructions: local-ai-web

This file contains foundational mandates for the development and maintenance of the `local-ai-web` project.

## Security Posture

The following GitHub security features are enabled for this repository and must be respected in all development activities:

- **Security Policy**: [Enabled] A comprehensive `SECURITY.md` is maintained.
- **Security Advisories**: [Enabled] Vulnerabilities must be disclosed via internal advisories first.
- **Private Vulnerability Reporting**: [Enabled] Allows researchers to report issues privately.
- **Dependabot Alerts**: [Enabled] Dependency updates must be reviewed and merged promptly.
- **Code Scanning Alerts**: [Enabled] Static analysis (GitHub Actions) is active.
- **Secret Scanning Alerts**: [Enabled] Prevents leaks of credentials.

### Mandatory Security Controls
- **SSRF Prevention**: All outbound HTTP requests MUST use the `assertSafeUrl` or `isSafeRequestUrl` checks found in `mcp-web-reader/src/helper.ts`.
- **Browser Isolation**: Playwright instances must use the routing rules in `mcp-web-reader/src/browser.ts` to block private network access.
- **Content Security**: All web-fetched content must be treated as untrusted. Truncation and sanitization (via `html-to-text` or `turndown`) are mandatory before passing data to an LLM.

## Architectural Conventions

- **MCP Protocol**: Use the `@modelcontextprotocol/sdk` for tool registration.
- **Configuration**: Use `mcp-web-reader/src/config.ts` for all environment-based settings. Do not hardcode timeouts or URLs.
- **Error Handling**: Tools should return clean error messages through `textResult` rather than throwing raw exceptions to the MCP client where possible, unless it's a fatal error.
- **Caching**: Utilize the in-memory cache in `mcp-web-reader/src/cache.ts` to minimize redundant fetches and reduce load on SearXNG/Target sites.

## Development Workflow

- **Build**: `npm run build` in `mcp-web-reader/`.
- **Verify**: Use `npm run verify` to check dependencies and basic sanity.
- **Test**: `npm test` runs a standalone test client to verify tool responses.
- **Mandatory Feature Workflow**: When adding new tools or features, you MUST:
  1. Add corresponding integration tests targeting real-world URLs in `mcp-web-reader/test_mcp.js`.
  2. Update `README.md` to document the new feature, including its description in the "Features" list, any modifications to the "Project Structure" or "Recommended System Prompt", and specific "How to Use" example prompts.

## Future Roadmap (High Priority)
- [ ] **Visual Feedback**: Add `capture_screenshot` tool to Playwright browser.
- [ ] **Persistent Cache**: Migrate from in-memory Map to SQLite.
- [x] **PDF Support**: Add PDF parsing to `fetch_url`. (Implemented via `fetch_document`)
- [x] **Structured Data**: Add specific tools for table extraction and JSON-LD metadata. (Implemented via `extract_structured_data`)
