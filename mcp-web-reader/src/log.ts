const DEBUG = process.env.DEBUG_LOCAL_WEB_READER === "1";

function debugLog(...args: unknown[]) {
  if (!DEBUG) return;
  console.error("[local-web-reader]", ...args);
}

export { debugLog };
