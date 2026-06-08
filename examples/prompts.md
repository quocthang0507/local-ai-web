# Example Prompts

## Search only

Use search_web to find 5 sources about "LM Studio MCP tools" and list URLs.

## Search with Time Range

Use search_web to find recent news about "Model Context Protocol" from the past week.

## Code Search

Use search_code_web to find Python code examples for converting Lunar calendar to Solar calendar. Extract the best code snippet and explain how it works.

Use search_code_web to find TypeScript examples for implementing an MCP tool with zod input validation. Prefer official docs and GitHub examples.

## Vietnam Legal/Admin Q&A

Use vietnam_legal_qa_context to answer: "Thể thức trình bày văn bản hành chính hiện nay được quy định bởi văn bản nào, và cần lưu ý gì về số ký hiệu, ngày tháng?" Cite official URLs.

Use search_vietnam_legal to find official sources for "Nghị định 30/2020/NĐ-CP công tác văn thư", then use fetch_vietnam_legal_document on the best result and summarize its metadata.

Use vietnam_legal_qa_context with mode=procedure to answer: "Hồ sơ cấp phiếu lý lịch tư pháp trực tuyến gồm những gì?" Cite official public-service or ministry sources.

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

## Debug & Maintenance

Run health_check and tell me whether local-ai-web is ready.

Run cache_stats to see memory usage, and use clear_cache if memory is too high.

Use close_browser to close the background Playwright browser instance and free up memory.
