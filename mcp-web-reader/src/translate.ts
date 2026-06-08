import { TRANSLATE_MAX_CHARS, TRANSLATE_PROVIDERS, TRANSLATE_TIMEOUT_MS } from "./config.js";

export type TranslateProvider = "auto" | "google" | "mymemory" | "duckduckgo" | "lingva";

export type TranslateOptions = {
  text: string;
  sourceLang?: string;
  targetLang: string;
  provider?: TranslateProvider;
};

type ProviderResult = {
  provider: Exclude<TranslateProvider, "auto">;
  translatedText: string;
  detectedSourceLang?: string;
  raw?: unknown;
};

function normalizeLang(lang: string | undefined, fallback: string): string {
  const value = (lang || fallback).trim().toLowerCase();
  if (value === "auto" || value === "detect") return "auto";
  return value;
}

function assertTranslateInput(options: TranslateOptions) {
  if (!options.text?.trim()) {
    throw new Error("text is required");
  }

  if (!options.targetLang?.trim()) {
    throw new Error("target_lang is required");
  }

  if (options.text.length > TRANSLATE_MAX_CHARS) {
    throw new Error(`Text is too long. Max ${TRANSLATE_MAX_CHARS} characters.`);
  }
}

function chunkText(text: string, maxChars: number): string[] {
  const normalized = text.replace(/\r/g, "");
  const paragraphs = normalized.split(/(\n{2,})/);
  const chunks: string[] = [];
  let current = "";

  for (const part of paragraphs) {
    if ((current + part).length <= maxChars) {
      current += part;
      continue;
    }

    if (current.trim()) {
      chunks.push(current);
      current = "";
    }

    if (part.length <= maxChars) {
      current = part;
      continue;
    }

    for (let i = 0; i < part.length; i += maxChars) {
      chunks.push(part.slice(i, i + maxChars));
    }
  }

  if (current.trim()) chunks.push(current);
  return chunks.length ? chunks : [text];
}

async function fetchJson(url: URL): Promise<any> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "local-ai-web-translate/1.0"
    },
    signal: AbortSignal.timeout(TRANSLATE_TIMEOUT_MS)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

async function translateWithGoogle(options: TranslateOptions): Promise<ProviderResult> {
  const sourceLang = normalizeLang(options.sourceLang, "auto");
  const targetLang = normalizeLang(options.targetLang, "vi");
  const chunks = chunkText(options.text, 4500);
  const translatedChunks: string[] = [];
  let detectedSourceLang: string | undefined;

  for (const chunk of chunks) {
    const endpoint = new URL("https://translate.googleapis.com/translate_a/single");
    endpoint.searchParams.set("client", "gtx");
    endpoint.searchParams.set("sl", sourceLang);
    endpoint.searchParams.set("tl", targetLang);
    endpoint.searchParams.set("dt", "t");
    endpoint.searchParams.set("q", chunk);

    const data = await fetchJson(endpoint);
    const translated = Array.isArray(data?.[0])
      ? data[0].map((segment: any[]) => segment?.[0] || "").join("")
      : "";

    if (!translated) {
      throw new Error("Google returned an empty translation");
    }

    translatedChunks.push(translated);
    if (!detectedSourceLang && typeof data?.[2] === "string") {
      detectedSourceLang = data[2];
    }
  }

  return {
    provider: "google",
    translatedText: translatedChunks.join(""),
    detectedSourceLang
  };
}

async function translateWithMyMemory(options: TranslateOptions): Promise<ProviderResult> {
  const sourceLang = normalizeLang(options.sourceLang, "en");
  const targetLang = normalizeLang(options.targetLang, "vi");

  if (sourceLang === "auto") {
    throw new Error("MyMemory requires source_lang; use google or set a source language");
  }

  const chunks = chunkText(options.text, 450);
  const translatedChunks: string[] = [];
  let lastRaw: unknown;

  for (const chunk of chunks) {
    const endpoint = new URL("https://api.mymemory.translated.net/get");
    endpoint.searchParams.set("q", chunk);
    endpoint.searchParams.set("langpair", `${sourceLang}|${targetLang}`);

    const data = await fetchJson(endpoint);
    lastRaw = data;
    const translated = data?.responseData?.translatedText;

    if (!translated || data?.responseStatus >= 400) {
      throw new Error(data?.responseDetails || "MyMemory returned an empty translation");
    }

    translatedChunks.push(translated);
  }

  return {
    provider: "mymemory",
    translatedText: translatedChunks.join(""),
    detectedSourceLang: sourceLang,
    raw: lastRaw
  };
}

async function translateWithDuckDuckGo(options: TranslateOptions): Promise<ProviderResult> {
  const targetLang = normalizeLang(options.targetLang, "vi");
  const sourceLang = normalizeLang(options.sourceLang, "auto");
  const query = sourceLang === "auto"
    ? `translate ${options.text} to ${targetLang}`
    : `translate from ${sourceLang} to ${targetLang}: ${options.text}`;

  const endpoint = new URL("https://api.duckduckgo.com/");
  endpoint.searchParams.set("q", query);
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("no_redirect", "1");
  endpoint.searchParams.set("no_html", "1");
  endpoint.searchParams.set("skip_disambig", "1");

  const data = await fetchJson(endpoint);
  const translated = data?.Answer || data?.AbstractText || "";

  if (!translated) {
    throw new Error("DuckDuckGo Instant Answer did not return a translation");
  }

  return {
    provider: "duckduckgo",
    translatedText: translated,
    detectedSourceLang: sourceLang === "auto" ? undefined : sourceLang,
    raw: data
  };
}

async function translateWithLingva(options: TranslateOptions): Promise<ProviderResult> {
  const sourceLang = normalizeLang(options.sourceLang, "auto");
  const targetLang = normalizeLang(options.targetLang, "vi");
  const chunks = chunkText(options.text, 1000);
  const translatedChunks: string[] = [];
  let detectedSourceLang: string | undefined;

  for (const chunk of chunks) {
    const url = `https://lingva.ml/api/v1/${sourceLang}/${targetLang}/${encodeURIComponent(chunk)}`;
    const endpoint = new URL(url);
    const data = await fetchJson(endpoint);
    const translated = data?.translation;

    if (!translated) {
      throw new Error("Lingva returned an empty translation");
    }

    translatedChunks.push(translated);
    if (!detectedSourceLang && data?.info?.detectedSource) {
      detectedSourceLang = data.info.detectedSource;
    }
  }

  return {
    provider: "lingva",
    translatedText: translatedChunks.join(""),
    detectedSourceLang
  };
}

function providerOrder(provider: TranslateProvider): Array<Exclude<TranslateProvider, "auto">> {
  if (provider !== "auto") return [provider];

  const configured = TRANSLATE_PROVIDERS.filter((p): p is Exclude<TranslateProvider, "auto"> =>
    p === "google" || p === "mymemory" || p === "duckduckgo" || p === "lingva"
  );

  return configured.length ? configured : ["google", "mymemory", "duckduckgo", "lingva"];
}

async function runProvider(provider: Exclude<TranslateProvider, "auto">, options: TranslateOptions) {
  if (provider === "google") return translateWithGoogle(options);
  if (provider === "mymemory") return translateWithMyMemory(options);
  if (provider === "lingva") return translateWithLingva(options);
  return translateWithDuckDuckGo(options);
}

export async function translateText(options: TranslateOptions) {
  assertTranslateInput(options);

  const provider = options.provider || "auto";
  const errors: Array<{ provider: string; error: string }> = [];

  for (const candidate of providerOrder(provider)) {
    try {
      const result = await runProvider(candidate, options);

      return {
        text: options.text,
        translatedText: result.translatedText,
        sourceLang: normalizeLang(options.sourceLang, "auto"),
        detectedSourceLang: result.detectedSourceLang,
        targetLang: normalizeLang(options.targetLang, "vi"),
        provider: result.provider,
        providerMode: provider,
        alternativesTried: errors,
        privacy:
          "Input text is sent to the selected external translation provider. Do not send secrets or sensitive personal data."
      };
    } catch (err: any) {
      errors.push({
        provider: candidate,
        error: err?.message || String(err)
      });
    }
  }

  throw new Error(`All translation providers failed: ${errors.map((e) => `${e.provider}: ${e.error}`).join("; ")}`);
}
