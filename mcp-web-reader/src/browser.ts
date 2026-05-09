import { type Browser, type BrowserContext, type Page } from "playwright";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { assertSafeUrl, isSafeRequestUrl, htmlToText } from "./helper.js";
import {
  RENDER_BLOCK_RESOURCE_TYPES,
  RENDER_NAV_TIMEOUT_MS,
  RENDER_NETWORK_IDLE_TIMEOUT_MS,
  RENDER_EXTRA_WAIT_MS,
  RENDER_SCROLL_STEPS,
  RENDER_SCROLL_DELAY_MS,
  REQUEST_TIMEOUT_MS,
  MAX_FETCH_BYTES
} from "./config.js";

chromium.use(stealth());

export type RenderRequestReport = {
  blockedRequestsCount: number;
  blockedPrivateNetworkRequests: number;
  blockedByResourceType: Record<string, number>;
  allowedRequestsCount: number;
};

export async function fetchWithSafety(
  rawUrl: string,
  redirectsLeft = 3
): Promise<{
  finalUrl: string;
  contentType: string;
  body: string;
}> {
  const url = await assertSafeUrl(rawUrl);

  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; LMStudioLocalWebReader/1.0; +local)",
      "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5"
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.headers.get("location")
  ) {
    if (redirectsLeft <= 0) {
      throw new Error("Too many redirects.");
    }

    const next = new URL(response.headers.get("location")!, url).toString();
    return fetchWithSafety(next, redirectsLeft - 1);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "";

  if (
    !contentType.includes("text/html") &&
    !contentType.includes("text/plain") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    throw new Error(`Unsupported content-type: ${contentType}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer).slice(0, MAX_FETCH_BYTES);
  const body = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  return {
    finalUrl: url.toString(),
    contentType,
    body
  };
}

export async function autoScroll(page: Page, steps: number, delayMs: number): Promise<void> {
  for (let i = 0; i < steps; i++) {
    await page.evaluate(() => {
      window.scrollBy(0, Math.floor(window.innerHeight * 0.85));
    });

    await page.waitForTimeout(delayMs);
  }

  await page.evaluate(() => {
    window.scrollTo(0, 0);
  });
}

let globalBrowserPromise: Promise<Browser> | null = null;

export async function getGlobalBrowser(): Promise<Browser> {
  if (!globalBrowserPromise) {
    globalBrowserPromise = chromium.launch({
      headless: true,
      args: [
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check"
      ]
    });
  }
  return globalBrowserPromise;
}

export async function closeGlobalBrowser() {
  if (globalBrowserPromise) {
    const browser = await globalBrowserPromise;
    await browser.close().catch(() => {});
    globalBrowserPromise = null;
  }
}

export async function createSafeBrowserPage(): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
  report: RenderRequestReport;
}> {
  const report: RenderRequestReport = {
    blockedRequestsCount: 0,
    blockedPrivateNetworkRequests: 0,
    blockedByResourceType: {},
    allowedRequestsCount: 0
  };

  const browser = await getGlobalBrowser();

  const context = await browser.newContext({
    javaScriptEnabled: true,
    ignoreHTTPSErrors: false,
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/120 Safari/537.36 LMStudioLocalWebReader/1.0",
    viewport: {
      width: 1365,
      height: 900
    }
  });

  await context.route("**/*", async (route) => {
    const req = route.request();
    const reqUrl = req.url();
    const resourceType = req.resourceType();

    if (RENDER_BLOCK_RESOURCE_TYPES.has(resourceType)) {
      report.blockedRequestsCount++;
      report.blockedByResourceType[resourceType] =
        (report.blockedByResourceType[resourceType] || 0) + 1;

      return route.abort();
    }

    const safe = await isSafeRequestUrl(reqUrl);

    if (!safe) {
      report.blockedRequestsCount++;
      report.blockedPrivateNetworkRequests++;
      return route.abort();
    }

    report.allowedRequestsCount++;
    return route.continue();
  });

  const page = await context.newPage();

  return {
    browser,
    context,
    page,
    report
  };
}

export async function renderUrlToSource(
  rawUrl: string,
  options: {
    maxTextChars: number;
    maxHtmlChars: number;
    includeText: boolean;
    includeHtml: boolean;
    waitMs?: number;
    scrollSteps?: number;
  }
): Promise<{
  requestedUrl: string;
  finalUrl: string;
  title: string;
  text?: string;
  renderedHtml?: string;
  requestReport: RenderRequestReport;
}> {
  const safeUrl = await assertSafeUrl(rawUrl);

  const { context, page, report } = await createSafeBrowserPage();

  try {
    await page.goto(safeUrl.toString(), {
      waitUntil: "domcontentloaded",
      timeout: RENDER_NAV_TIMEOUT_MS
    });

    try {
      await page.waitForLoadState("networkidle", {
        timeout: RENDER_NETWORK_IDLE_TIMEOUT_MS
      });
    } catch {
      // Some SPAs keep network connections open. Continue with current DOM.
    }

    const extraWait = options.waitMs ?? RENDER_EXTRA_WAIT_MS;

    if (extraWait > 0) {
      await page.waitForTimeout(extraWait);
    }

    const scrollSteps = options.scrollSteps ?? RENDER_SCROLL_STEPS;

    if (scrollSteps > 0) {
      await autoScroll(page, scrollSteps, RENDER_SCROLL_DELAY_MS);
    }

    const title = await page.title().catch(() => "");

    const result: {
      requestedUrl: string;
      finalUrl: string;
      title: string;
      text?: string;
      renderedHtml?: string;
      requestReport: RenderRequestReport;
    } = {
      requestedUrl: rawUrl,
      finalUrl: page.url(),
      title,
      requestReport: report
    };

    if (options.includeText) {
      let text = "";

      try {
        text = await page.locator("body").innerText({ timeout: 5000 });
      } catch {
        const html = await page.content();
        text = htmlToText(html);
      }

      result.text = text
        .replace(/\n{3,}/g, "\n\n")
        .trim()
        .slice(0, options.maxTextChars);
    }

    if (options.includeHtml) {
      const html = await page.content();
      result.renderedHtml = html.slice(0, options.maxHtmlChars);
    }

    return result;
  } finally {
    await context.close().catch(() => { });
  }
}
