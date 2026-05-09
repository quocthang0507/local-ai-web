#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";
import { closeGlobalBrowser } from "./browser.js";

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

// Start server via stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);