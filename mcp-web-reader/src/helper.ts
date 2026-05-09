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
  let s = html;

  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");

  s = s.replace(/<\/(p|div|section|article|header|footer|li|h1|h2|h3|h4|h5|h6)>/gi, "\n");
  s = s.replace(/<br\s*\/?>/gi, "\n");

  s = s.replace(/<[^>]+>/g, " ");
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
