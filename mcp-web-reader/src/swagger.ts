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
        description: "Search the web using local SearXNG. Best for general queries, news, or site discovery.",
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
                required: ["query"],
                example: {
                  query: "latest news on MCP protocol",
                  max_results: 3,
                  time_range: "week"
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Successful response" }
        }
      }
    },
    "/api/translate": {
      post: {
        summary: "Translate Text",
        description: "Translate text using free/no-key external providers: auto, Google unofficial, MyMemory, or DuckDuckGo Instant Answer best-effort.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  source_lang: { type: "string", default: "auto" },
                  target_lang: { type: "string", default: "vi" },
                  provider: { type: "string", enum: ["auto", "google", "mymemory", "duckduckgo"], default: "auto" }
                },
                required: ["text"],
                example: {
                  text: "Hello, how can I help you today?",
                  source_lang: "auto",
                  target_lang: "vi",
                  provider: "auto"
                }
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
        description: "Fetch and extract readable text from a URL. Automatically handles GitHub/Gist file URLs by fetching the raw source.",
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
                required: ["url"],
                example: {
                  url: "https://github.com/google/mcp-sdk-typescript/blob/main/README.md",
                  max_chars: 5000
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Successful response" }
        }
      }
    },
    "/api/fetch/markdown": {
      post: {
        summary: "Fetch Markdown",
        description: "Fetch and extract cleaned Markdown from a static HTML URL. Recommended for optimized web UI display and article/documentation pages.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  url: { type: "string" },
                  max_chars: { type: "integer", default: 30000 }
                },
                required: ["url"],
                example: {
                  url: "https://example.com",
                  max_chars: 12000
                }
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
                required: ["url"],
                example: {
                  url: "https://app.example.com/dashboard",
                  wait_ms: 2000,
                  scroll_steps: 2
                }
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
                required: ["url"],
                example: {
                  url: "https://www.reddit.com/r/LocalLLaMA/",
                  max_chars: 10000
                }
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
                required: ["url"],
                example: {
                  url: "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf"
                }
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
        description: "Extract HTML tables (as Markdown) and JSON-LD metadata from a URL.",
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
                required: ["url"],
                example: {
                  url: "https://en.wikipedia.org/wiki/Comparison_of_relational_database_management_systems",
                  max_table_chars: 20000
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Successful response" }
        }
      }
    },
    "/api/list/github": {
      post: {
        summary: "List GitHub Repository",
        description: "List files and directories in a GitHub repository or subdirectory.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  url: { type: "string" }
                },
                required: ["url"],
                example: {
                  url: "https://github.com/google/mcp-sdk-typescript"
                }
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
        description: "Search for code snippets, implementations, and examples across the web (GitHub, StackOverflow, official docs).",
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
                required: ["query"],
                example: {
                  query: "Express JWT middleware example",
                  language_hint: "javascript"
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Successful response" }
        }
      }
    },
    "/api/search/vietnam-legal": {
      post: {
        summary: "Search Vietnam Legal Sources",
        description: "Search official Vietnamese legal, administrative-document, and public-procedure sources. Official sources are preferred by default.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  query: { type: "string" },
                  max_results: { type: "integer", default: 5 },
                  mode: { type: "string", enum: ["law", "administrative", "procedure", "all"], default: "all" },
                  time_range: { type: "string", enum: ["day", "week", "month", "year"] },
                  include_unofficial: { type: "boolean", default: false }
                },
                required: ["query"],
                example: {
                  query: "Nghị định 30/2020/NĐ-CP thể thức văn bản hành chính",
                  max_results: 5,
                  mode: "administrative"
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Successful response" }
        }
      }
    },
    "/api/fetch/vietnam-legal": {
      post: {
        summary: "Fetch Vietnam Legal Document",
        description: "Fetch a Vietnamese legal/admin document URL and extract text, Markdown, and heuristic legal metadata.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  url: { type: "string" },
                  max_chars: { type: "integer", default: 30000 },
                  render: { type: "boolean", default: false }
                },
                required: ["url"],
                example: {
                  url: "https://vanban.chinhphu.vn/default.aspx?docid=99777&pageid=27160",
                  max_chars: 12000
                }
              }
            }
          }
        },
        responses: {
          "200": { description: "Successful response" }
        }
      }
    },
    "/api/context/vietnam-legal": {
      post: {
        summary: "Build Vietnam Legal QA Context",
        description: "Search official sources, fetch top documents, and return source-backed excerpts plus answer guidance for Vietnamese law/admin Q&A.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  question: { type: "string" },
                  max_sources: { type: "integer", default: 5 },
                  fetch_top_documents: { type: "integer", default: 2 },
                  max_chars_per_document: { type: "integer", default: 8000 },
                  mode: { type: "string", enum: ["law", "administrative", "procedure", "all"], default: "all" },
                  time_range: { type: "string", enum: ["day", "week", "month", "year"] },
                  include_unofficial: { type: "boolean", default: false }
                },
                required: ["question"],
                example: {
                  question: "Cách trình bày số ký hiệu và phần căn cứ trong văn bản hành chính theo quy định hiện hành?",
                  mode: "administrative",
                  fetch_top_documents: 2
                }
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
