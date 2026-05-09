import dns from "node:dns/promises";
import net from "node:net";
import { convert } from "html-to-text";
import { ALLOW_DOMAINS, DEBUG } from "./config.js";

export function decodeBasicEntities(text: string): string {
  return text
	.replaceAll("&nbsp;", " ")
	.replaceAll("&amp;", "&")
	.replaceAll("&lt;", "<")
	.replaceAll("&gt;", ">")
	.replaceAll("&quot;", "\"")
	.replaceAll("&#39;", "'");
}

export function htmlToText(html: string): string {
  let s = convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "noscript", format: "skip" }
    ]
  });

  s = decodeBasicEntities(s);

  s = s
	.split("\n")
	.map((line) => line.replace(/\s+/g, " ").trim())
	.filter(Boolean)
	.join("\n");

  return s;
}

export function normalizeCacheInput(value: unknown): string {
  if (value === undefined) return "";
  if (value === null) return "null";
  if (typeof value === "string") return value.trim();
  return JSON.stringify(value);
}

export function textResult(obj: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2)
      }
    ]
  };
}

export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;

  const [a, b] = parts;

  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 0) return true;

  return false;
}

export function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();

  if (lower === "::1") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  if (lower.startsWith("fe80")) return true;

  return false;
}

export function makeCacheKey(prefix: string, parts: Record<string, unknown>): string {
  const normalized = Object.keys(parts)
    .sort()
    .map((key) => `${key}=${normalizeCacheInput(parts[key])}`)
    .join("&");

  return `${prefix}:${normalized}`;
}

export async function assertSafeUrl(rawUrl: string): Promise<URL> {
  const url = new URL(rawUrl);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http/https URLs are allowed.");
  }

  if (url.port !== "" && url.port !== "80" && url.port !== "443") {
    throw new Error("Only default ports (80, 443) are allowed.");
  }

  const hostname = url.hostname.toLowerCase();

  if (hostname === "169.254.169.254") {
    throw new Error("Metadata IPs are blocked.");
  }

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0"
  ) {
    throw new Error("Localhost URLs are blocked.");
  }

  if (ALLOW_DOMAINS.length > 0) {
    const allowed = ALLOW_DOMAINS.some(
      (d) => hostname === d || hostname.endsWith("." + d)
    );

    if (!allowed) {
      throw new Error(`Domain not allowed: ${hostname}`);
    }
  }

  const ipVersion = net.isIP(hostname);

  if (ipVersion === 4 && isPrivateIPv4(hostname)) {
    throw new Error("Private IPv4 URLs are blocked.");
  }

  if (ipVersion === 6 && isPrivateIPv6(hostname)) {
    throw new Error("Private IPv6 URLs are blocked.");
  }

  const addresses = await dns.lookup(hostname, { all: true });

  for (const addr of addresses) {
    if (addr.family === 4 && isPrivateIPv4(addr.address)) {
      throw new Error(`Resolved to blocked private IPv4: ${addr.address}`);
    }

    if (addr.family === 6 && isPrivateIPv6(addr.address)) {
      throw new Error(`Resolved to blocked private IPv6: ${addr.address}`);
    }
  }

  return url;
}

export async function isSafeRequestUrl(rawUrl: string): Promise<boolean> {
  try {
    await assertSafeUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}
