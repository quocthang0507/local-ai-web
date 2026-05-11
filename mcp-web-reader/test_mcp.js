import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function runTests() {
    console.log("Starting MCP Server Test Suite...");
    
    // We don't need to spawn a separate process because StdioClientTransport 
    // itself launches the command as a child process.
    const transport = new StdioClientTransport({
        command: "node",
        args: ["dist/index.js"],
        env: { ...process.env, DEBUG_LOCAL_WEB_READER: "1" }
    });

    const client = new Client({
        name: "test-client",
        version: "1.0.0"
    }, {
        capabilities: {
            tools: {}
        }
    });

    await client.connect(transport);
    console.log("✅ Connected to MCP Server via StdioTransport\n");

    let passed = 0;
    let failed = 0;

    async function runTest(testName, toolName, args, timeoutMs = 30000, expectedKey = null) {
        console.log(`\n⏳ Running Test: ${testName} (Tool: ${toolName})`);
        const start = Date.now();
        try {
            const result = await client.callTool({
                name: toolName,
                arguments: args
            }, {
                timeout: timeoutMs
            });
            const duration = Date.now() - start;
            
            // Extract text response
            const textContent = result.content.find(c => c.type === 'text')?.text;
            if (!textContent) {
                throw new Error("No text content in response");
            }

            let data;
            try {
                data = JSON.parse(textContent);
            } catch (e) {
                // Not JSON, maybe an error string
                data = { errorString: textContent };
            }

            if (expectedKey && expectedKey !== 'expect_error' && data[expectedKey] === undefined) {
                if (data.error) {
                    throw new Error(`Tool returned internal error: ${data.error}`);
                }
                if (data.errorString) {
                    throw new Error(`Tool returned error string: ${data.errorString}`);
                }
                throw new Error(`Expected key '${expectedKey}' missing from response`);
            }

            if (result.isError) {
                if (expectedKey === 'expect_error') {
                    console.log(`✅ [${duration}ms] Passed (Got expected error)`);
                    passed++;
                    return data;
                } else {
                    throw new Error(`Tool returned isError flag: ${textContent}`);
                }
            }

            if (expectedKey === 'expect_error' && !result.isError) {
                // If it didn't return isError but the string says error, we also accept it
                if (data.errorString || data.error) {
                    console.log(`✅ [${duration}ms] Passed (Got expected error string/json)`);
                    passed++;
                    return data;
                }
                throw new Error("Expected an error but got success.");
            }

            console.log(`✅ [${duration}ms] Passed`);
            passed++;
            return data;
        } catch (e) {
            const duration = Date.now() - start;
            console.log(`❌ [${duration}ms] Failed: ${e.stack || e.message}`);
            failed++;
            return null;
        }
    }

    // --- TEST SUITE --- //

    // 1. System Info / Health
    await runTest("Health Check", "health_check", {}, 10000, "mcp");
    await runTest("Cache Stats (Initial)", "cache_stats", {}, 5000, "entries");

    // 2. Web Search
    await runTest("Basic Web Search", "search_web", {
        query: "Model Context Protocol",
        max_results: 3
    }, 15000, "results");

    await runTest("Web Search with Language", "search_web", {
        query: "thời tiết hôm nay",
        max_results: 2,
        language: "vi"
    }, 15000, "results");

    await runTest("Web Search with Time Range", "search_web", {
        query: "latest AI news",
        max_results: 2,
        time_range: "day"
    }, 15000, "results");

    // 3. Static Fetching
    await runTest("Fetch URL (Static - Example)", "fetch_url", {
        url: "https://example.com",
        max_chars: 2000
    }, 15000, "text");

    await runTest("Fetch URL (Static - Hacker News)", "fetch_url", {
        url: "https://news.ycombinator.com/",
        max_chars: 5000
    }, 15000, "text");

    await runTest("Fetch URL (Static - GitHub Raw JSON)", "fetch_url", {
        url: "https://raw.githubusercontent.com/npm/cli/latest/package.json",
        max_chars: 2000
    }, 15000, "text");

    await runTest("Fetch Blocked URL (Safety Localhost)", "fetch_url", {
        url: "http://localhost:8080",
    }, 15000, "expect_error"); // This should fail or return an error gracefully

    await runTest("Fetch Blocked URL (Safety Metadata IP SSRF)", "fetch_url", {
        url: "http://169.254.169.254/latest/meta-data/",
    }, 15000, "expect_error"); // SSRF block check

    // 3.5 Markdown Fetching
    await runTest("Fetch Markdown (Static - Hacker News)", "fetch_markdown", {
        url: "https://news.ycombinator.com/",
        max_chars: 10000
    }, 15000, "markdown");

    await runTest("Fetch Markdown (Static - Wikipedia)", "fetch_markdown", {
        url: "https://en.wikipedia.org/wiki/Model_Context_Protocol",
        max_chars: 20000
    }, 20000, "markdown");

    // 4. Rendered Fetching
    await runTest("Fetch Rendered Source (Example)", "fetch_rendered_source", {
        url: "https://example.com",
        include_text: true,
        include_html: false,
        max_text_chars: 1000
    }, 45000, "text");

    await runTest("Fetch Rendered Source (React.dev SPA)", "fetch_rendered_source", {
        url: "https://react.dev/",
        include_text: true,
        include_html: false,
        max_text_chars: 2000,
        wait_ms: 2000
    }, 45000, "text");

    await runTest("Fetch Rendered Source with Scrolling (SPA)", "fetch_rendered_source", {
        url: "https://example.com",
        include_text: false,
        include_html: true,
        max_html_chars: 1000,
        scroll_steps: 2,
        wait_ms: 1000
    }, 45000, "renderedHtml");

    await runTest("Fetch Rendered Markdown (Example)", "fetch_rendered_markdown", {
        url: "https://example.com",
        max_chars: 1000,
        wait_ms: 500
    }, 45000, "markdown");

    await runTest("Fetch Rendered Markdown (GitHub Docs)", "fetch_rendered_markdown", {
        url: "https://docs.github.com/en",
        max_chars: 2000,
        wait_ms: 1000
    }, 45000, "markdown");

    // 5. Code Web Search
    await runTest("Search Code Web (Python)", "search_code_web", {
        query: "binary search algorithm",
        max_snippets: 3,
        language_hint: "python"
    }, 60000, "results");

    await runTest("Search Code Web (No Language Hint)", "search_code_web", {
        query: "fetch api javascript example",
        max_snippets: 2
    }, 60000, "results");

    // 6. PDF & Structured Data Extraction
    await runTest("Fetch Document (PDF)", "fetch_document", {
        url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
    }, 30000, "text");

    await runTest("Extract Structured Data (Tables)", "extract_structured_data", {
        url: "https://en.wikipedia.org/wiki/List_of_ISO_3166_country_codes",
        render: false
    }, 30000, "tables");

    await runTest("Extract Structured Data (Rendered Tables)", "extract_structured_data", {
        url: "https://en.wikipedia.org/wiki/List_of_ISO_3166_country_codes",
        render: true
    }, 45000, "tables");

    // 7. Cache Check & Clear
    await runTest("Cache Stats (After runs)", "cache_stats", {}, 5000, "entries");
    await runTest("Clear Cache", "clear_cache", {}, 5000, "clearedEntries");
    await runTest("Cache Stats (After clear)", "cache_stats", {}, 5000, "entries");

    // 7. Cleanup
    await runTest("Close Browser", "close_browser", {}, 10000, null);

    // --- SUMMARY --- //
    console.log(`\n================================`);
    console.log(`TEST RUN COMPLETE`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total:  ${passed + failed}`);
    console.log(`================================\n`);

    // close client
    await transport.close();
}

runTests().catch(e => {
    console.error("Test suite crashed:", e);
    process.exit(1);
});
