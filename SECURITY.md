# Security Policy

`local-ai-web` is designed to be a secure bridge between local LLMs and the public internet. Security is a top priority to prevent malicious web content from interacting with your local network.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | ✅ Yes             |
| < 0.2   | ❌ No              |

## Threat Model

The project addresses the following primary risks:
- **SSRF (Server-Side Request Forgery)**: Preventing the model from being tricked into accessing local services (e.g., router admin panels, local databases).
- **Prompt Injection**: Mitigating risks where web content contains "instructions" for the LLM.
- **Resource Exhaustion**: Preventing malicious pages from consuming excessive CPU/Memory via complex JS or infinite redirects.

## Built-in Protections

### 1. Robust SSRF Prevention
We implement a multi-layer check for every URL:
- **Protocol Validation**: Only `http:` and `https:` are allowed.
- **Port Filtering**: Only default ports (80, 443) are allowed.
- **Static Blocklist**: Direct access to `localhost`, `127.0.0.1`, `0.0.0.0`, and cloud metadata IPs (e.g., `169.254.169.254`) is blocked.
- **DNS Resolution Validation**: Before fetching, the hostname is resolved to all IP addresses. If ANY resolved IP belongs to a private/local range, the request is aborted. This prevents "DNS Rebinding" style attacks.

### 2. Browser Sandbox & Hardening
In rendered mode (Playwright):
- **Resource Blocking**: Images, media, and fonts are blocked by default to reduce tracking and attack surface.
- **Navigation Timeouts**: Strict limits on how long a page can take to load or execute scripts.
- **Domain Filtering**: Use the `ALLOW_DOMAINS` environment variable to restrict the server to only trust specific domains.

## Security Configuration

You can harden your instance using these `.env` variables:

| Variable | Description |
| -------- | ----------- |
| `ALLOW_DOMAINS` | Comma-separated list (e.g., `github.com,stackoverflow.com`). If set, ALL other domains are blocked. |
| `RENDER_BLOCK_RESOURCE_TYPES` | Default: `image,media,font`. Restricts what the headless browser fetches. |
| `MAX_FETCH_BYTES` | Limits the size of static pages to prevent memory exhaustion. |

## Recommended Best Practices

1. **Keep SearXNG Private**: Ensure your SearXNG container is bound to `127.0.0.1` and not exposed to the public internet.
2. **Untrusted Data**: Always treat web-fetched content as untrusted data. Do not allow the LLM to execute code directly from the web without review.
3. **Least Privilege**: Do not run the MCP server with administrative/root privileges.

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not** open a public GitHub issue. Instead, please report it via [GitHub Private Vulnerability Reporting](https://docs.github.com/en/code-security/security-advisories/guidelines-for-reporting-a-vulnerability-to-a-repository-owner) or contact the maintainer directly if an email is provided.

We aim to acknowledge and address all critical security issues promptly.
