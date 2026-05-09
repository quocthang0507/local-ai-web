# Example Prompts

## Search only

Use search_web to find 5 sources about "LM Studio MCP tools" and list URLs.

## Static page

Use fetch_url to read this page and summarize it:
https://example.com/article

## SPA page

Use fetch_rendered_source to render this SPA page and extract visible text:
https://example.com

## Rendered Markdown

Use fetch_rendered_markdown to read this page, then summarize the key points with source URL:
https://example.com

## Research workflow

Search the web for "SearXNG JSON API". Pick the 3 most relevant URLs. Use fetch_url for static pages and fetch_rendered_markdown for SPA pages. Summarize findings with citations.

## Debug

Run health_check and tell me whether local-ai-web is ready.
