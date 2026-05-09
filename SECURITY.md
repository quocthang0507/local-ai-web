# Security Policy

`local-ai-web` is a local web search and reading MCP server for LM Studio.

## Threat Model

The main risks are:

- Prompt injection from web pages.
- SSRF attempts through malicious URLs or redirects.
- Browser automation loading unwanted network resources.
- Users accidentally exposing local services.

## Built-in Protections

The MCP server blocks:

- localhost
- 127.0.0.0/8
- 10.0.0.0/8
- 172.16.0.0/12
- 192.168.0.0/16
- 169.254.0.0/16
- common local/private IPv6 ranges

Rendered browser mode also blocks image, media, and font resources by default.

## Recommended Use

- Treat all web content as untrusted data.
- Do not add filesystem or shell tools to this MCP unless you fully understand the risks.
- Keep SearXNG bound to 127.0.0.1.
- Use ALLOW_DOMAINS for high-trust workflows.
- Do not use this project to bypass login, paywalls, CAPTCHA, or access controls.

## Reporting Issues

Please open a GitHub issue with reproduction steps.
