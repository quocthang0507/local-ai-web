#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { closeGlobalBrowser } from "./browser.js";
import { SEARXNG_ENGINES, USING_DEFAULT_SEARXNG_ENGINES } from "./config.js";

// Initialize server
const server = new McpServer({
  name: "local-web-reader",
  version: "1.0.0"
});

// Graceful shutdown
process.on("SIGINT", closeGlobalBrowser);
process.on("SIGTERM", closeGlobalBrowser);

// Register all MCP tools
registerTools(server);

if (USING_DEFAULT_SEARXNG_ENGINES) {
  console.error(
    `[local-web-reader] SEARXNG_ENGINES is not set. Using default engine allowlist: ${SEARXNG_ENGINES.join(",")}`
  );
} else {
  console.error(`[local-web-reader] Using restricted SearXNG engines: ${SEARXNG_ENGINES.join(",")}`);
}

// Start server via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);