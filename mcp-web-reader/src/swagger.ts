export const swaggerDocument = {
  openapi: "3.1.0",
  info: {
    title: "local-ai-web API",
    version: "1.0.0",
    description: "REST APIs for local-ai-web web reading and searching capabilities."
  },
  servers: [
    {
      url: "/",
      description: "Current Server"
    }
  ],
  paths: {
    "/health": {
      get: {
        summary: "Health Check",
        description: "Check whether MCP server, SearXNG, Playwright Chromium, and cache are ready.",
        responses: {
          "200": {
            description: "Successful response"
          }
        }
      }
    },
    "/cache/stats": {
      get: {
        summary: "Cache Stats",
        description: "Show in-memory cache statistics.",
        responses: {
          "200": {
            description: "Successful response"
          }
        }
      }
    },
    "/cache/clear": {
      post: {
        summary: "Clear Cache",
        description: "Clear in-memory search/fetch/render cache.",
        responses: {
          "200": {
            description: "Successful response"
          }
        }
      }
    },
    "/browser/close": {
      post: {
        summary: "Close Browser",
        description: "Close the background browser to free up memory.",
        responses: {
          "200": {
            description: "Successful response"
          }
        }
      }
    },
    "/api/search": {
      post: {
        summary: "Search Web",
        description: "Search the web using local SearXNG. Returns title, url, snippet, and source.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  query: { type: "string" },
                  max_results: { type: "integer", default: 5 },
                  language: { type: "string" },
                  time_range: { type: "string", enum: ["day", "week", "month", "year"] }
                },
                required: ["query"]
              }
            }
          }
        },
        responses: {
          "200": { description: "Successful response" }
        }
      }
    },
    "/api/fetch/static": {
      post: {
        summary: "Fetch URL",
        description: "Fetch and extract readable text from static HTML/text URL.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  url: { type: "string" },
                  max_chars: { type: "integer", default: 12000 }
                },
                required: ["url"]
              }
            }
          }
        },
        responses: {
          "200": { description: "Successful response" }
        }
      }
    },
    "/api/fetch/rendered/source": {
      post: {
        summary: "Fetch Rendered Source",
        description: "Render a JavaScript-heavy SPA page in headless Chromium and return rendered DOM source and/or visible text.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  url: { type: "string" },
                  include_text: { type: "boolean", default: true },
                  include_html: { type: "boolean", default: true },
                  max_text_chars: { type: "integer", default: 20000 },
                  max_html_chars: { type: "integer", default: 60000 },
                  wait_ms: { type: "integer" },
                  scroll_steps: { type: "integer" }
                },
                required: ["url"]
              }
            }
          }
        },
        responses: {
          "200": { description: "Successful response" }
        }
      }
    },
    "/api/fetch/rendered/markdown": {
      post: {
        summary: "Fetch Rendered Markdown",
        description: "Render a JavaScript-heavy page and return cleaned Markdown extracted from the rendered DOM.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  url: { type: "string" },
                  max_chars: { type: "integer", default: 30000 },
                  wait_ms: { type: "integer" },
                  scroll_steps: { type: "integer" }
                },
                required: ["url"]
              }
            }
          }
        },
        responses: {
          "200": { description: "Successful response" }
        }
      }
    },
    "/api/fetch/document": {
      post: {
        summary: "Fetch Document",
        description: "Fetch and extract text from a PDF or other supported document URL. SSRF protected.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  url: { type: "string" },
                  max_chars: { type: "integer", default: 12000 }
                },
                required: ["url"]
              }
            }
          }
        },
        responses: {
          "200": { description: "Successful response" }
        }
      }
    },
    "/api/extract/structured": {
      post: {
        summary: "Extract Structured Data",
        description: "Extract tables (as Markdown) and JSON-LD metadata from a URL.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  url: { type: "string" },
                  render: { type: "boolean", default: false },
                  max_table_chars: { type: "integer", default: 12000 }
                },
                required: ["url"]
              }
            }
          }
        },
        responses: {
          "200": { description: "Successful response" }
        }
      }
    },
    "/api/search/code": {
      post: {
        summary: "Search Code Web",
        description: "Search code snippets from the internet (via SearXNG), fetch pages, extract code blocks, rank and return best snippets.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  query: { type: "string" },
                  max_snippets: { type: "integer", default: 10 },
                  language_hint: { type: "string" }
                },
                required: ["query"]
              }
            }
          }
        },
        responses: {
          "200": { description: "Successful response" }
        }
      }
    }
  }
};
