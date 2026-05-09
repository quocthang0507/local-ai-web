import { DEBUG } from "./config.js";

export function debugLog(...args: unknown[]) {
  if (!DEBUG) return;
  console.error("[local-web-reader]", ...args);
}
