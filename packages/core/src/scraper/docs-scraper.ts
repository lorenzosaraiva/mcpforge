export interface ScrapedDocPage {
  url: string;
  content: string;
}

export interface ScrapeDocsOptions {
  maxPages?: number;
  timeoutMs?: number;
  userAgent?: string;
  logger?: (message: string) => void;
}

const DEFAULT_MAX_PAGES = 20;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_USER_AGENT =
  "mcpforge/0.1.0 (+https://github.com/example/mcpforge; docs scraper for API extraction)";

const DOC_LINK_HINTS = ["/api/", "/reference/", "/docs/", "/endpoints/"];
const NOISE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".mp4",
  ".mp3",
  ".woff",
  ".woff2",
  ".ttf",
  ".css",
  ".js",
]);

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripUnwantedTags(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, " ")
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, " ");
}

function htmlToText(fragment: string): string {
  const withBreaks = fragment
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|main|h1|h2|h3|h4|h5|h6|li|ul|ol|pre|code|table|tr)>/gi, "\n");

  const noTags = withBreaks.replace(/<[^>]+>/g, " ");
  return normalizeWhitespace(decodeHtmlEntities(noTags));
}

function collectSections(html: string): string[] {
  const sections: string[] = [];
  const patterns = [
    /<main\b[^>]*>([\s\S]*?)<\/main>/gi,
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi,
    /<div\b[^>]*class=["'][^"']*(content|docs|reference|endpoint)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi,
    /<section\b[^>]*class=["'][^"']*(content|docs|reference|endpoint)[^"']*["'][^>]*>([\s\S]*?)<\/section>/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html)) !== null) {
      const section = match[2] ?? match[1];
      if (section && section.trim()) {
        sections.push(section);
      }
    }
  }

  return sections;
}

function extractMeaningfulContent(html: string): string {
  const cleanedHtml = stripUnwantedTags(html);
  const candidates = collectSections(cleanedHtml)
    .map((section) => htmlToText(section))
    .filter((section) => section.length > 40);

  if (candidates.length > 0) {
    return candidates.sort((left, right) => right.length - left.length)[0] ?? "";
  }

  const bodyMatch = cleanedHtml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
  const fallback = htmlToText(bodyMatch?.[1] ?? cleanedHtml);
  return fallback;
}

function shouldFollowLink(url: URL, baseOrigin: string): boolean {
  if (!["http:", "https:"].includes(url.protocol)) {
    return false;
  }
  if (url.origin !== baseOrigin) {
    return false;
  }

  const lowerPath = url.pathname.toLowerCase();
  for (const extension of NOISE_EXTENSIONS) {
    if (lowerPath.endsWith(extension)) {
      return false;
    }
  }

  return DOC_LINK_HINTS.some((hint) => lowerPath.includes(hint));
}

function extractCandidateLinks(html: string, pageUrl: URL, baseOrigin: string): string[] {
  const links = new Set<string>();
  const hrefRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1]?.trim();
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("javascript:")) {
      continue;
    }

    try {
      const resolved = new URL(href, pageUrl);
      resolved.hash = "";
      if (!shouldFollowLink(resolved, baseOrigin)) {
        continue;
      }
      links.add(resolved.toString());
    } catch {
      // Ignore malformed links.
    }
  }

  const openApiUrlRegex = /(https?:\/\/[^\s"'<> ,]+(?:openapi|swagger)[^\s"'<> ,]*\.(?:json|ya?ml))/gi;
  while ((match = openApiUrlRegex.exec(html)) !== null) {
    const candidate = match[1];
    if (!candidate) {
      continue;
    }
    try {
      const resolved = new URL(candidate, pageUrl);
      resolved.hash = "";
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
        continue;
      }
      if (resolved.origin !== baseOrigin) {
        continue;
      }
      links.add(resolved.toString());
    } catch {
      // Ignore malformed links.
    }
  }

  const openApiRelativeRegex = /(["'])(\/[^\s"'<>]*(?:openapi|swagger)[^\s"'<>]*\.(?:json|ya?ml))\1/gi;
  while ((match = openApiRelativeRegex.exec(html)) !== null) {
    const relativeUrl = match[2];
    if (!relativeUrl) {
      continue;
    }
    try {
      const resolved = new URL(relativeUrl, pageUrl);
      resolved.hash = "";
      links.add(resolved.toString());
    } catch {
      // Ignore malformed links.
    }
  }

  const scriptSrcRegex = /<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
  while ((match = scriptSrcRegex.exec(html)) !== null) {
    const src = match[1]?.trim();
    if (!src) {
      continue;
    }
    const lower = src.toLowerCase();
    const looksLikeApiBootstrapScript =
      lower.includes("swagger-initializer") ||
      lower.includes("openapi") ||
      lower.includes("api-docs");
    if (!looksLikeApiBootstrapScript) {
      continue;
    }

    try {
      const resolved = new URL(src, pageUrl);
      resolved.hash = "";
      if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
        continue;
      }
      links.add(resolved.toString());
    } catch {
      // Ignore malformed script URLs.
    }
  }

  return [...links];
}

async function fetchHtml(url: string, options: ScrapeDocsOptions): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": options.userAgent ?? DEFAULT_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    return await response.text();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error instanceof Error ? error : new Error("Unknown network error");
  } finally {
    clearTimeout(timeout);
  }
}

export async function scrapeDocsFromUrl(
  url: string,
  options: ScrapeDocsOptions = {},
): Promise<ScrapedDocPage[]> {
  let rootUrl: URL;
  try {
    rootUrl = new URL(url);
  } catch {
    throw new Error(`Invalid URL: "${url}"`);
  }

  const logger = options.logger ?? (() => {});
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;

  const queue: string[] = [rootUrl.toString()];
  const visited = new Set<string>();
  const pages: ScrapedDocPage[] = [];

  while (queue.length > 0 && pages.length < maxPages) {
    const currentUrl = queue.shift();
    if (!currentUrl || visited.has(currentUrl)) {
      continue;
    }
    visited.add(currentUrl);

    let html: string;
    try {
      html = await fetchHtml(currentUrl, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      if (pages.length === 0) {
        throw new Error(`Failed to fetch documentation page ${currentUrl}: ${message}`);
      }
      logger(`[mcpforge] Skipping ${currentUrl}: ${message}`);
      continue;
    }

    const content = extractMeaningfulContent(html);
    if (content.length > 0) {
      pages.push({ url: currentUrl, content });
    } else {
      logger(`[mcpforge] No meaningful content extracted from ${currentUrl}`);
    }

    if (pages.length >= maxPages) {
      break;
    }

    const currentPageUrl = new URL(currentUrl);
    const candidates = extractCandidateLinks(html, currentPageUrl, rootUrl.origin);
    for (const candidate of candidates) {
      if (visited.has(candidate) || queue.includes(candidate)) {
        continue;
      }
      if (pages.length + queue.length >= maxPages) {
        break;
      }
      queue.push(candidate);
    }
  }

  if (pages.length === 0) {
    throw new Error("Failed to extract documentation content from the provided URL.");
  }

  return pages;
}
