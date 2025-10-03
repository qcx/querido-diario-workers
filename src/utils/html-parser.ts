import * as cheerio from 'cheerio';

export type CheerioAPI = ReturnType<typeof cheerio.load>;
export type Cheerio = ReturnType<CheerioAPI>;

/**
 * Loads HTML content into a Cheerio instance
 * @param html HTML content
 * @returns Cheerio API instance
 */
export function loadHTML(html: string): CheerioAPI {
  return cheerio.load(html);
}

/**
 * Extracts text content from an element, trimmed
 * @param $ Cheerio API
 * @param selector CSS selector
 * @returns Trimmed text or null
 */
export function getText($: CheerioAPI, selector: string): string | null {
  const text = $(selector).text().trim();
  return text || null;
}

/**
 * Extracts an attribute value from an element
 * @param $ Cheerio API
 * @param selector CSS selector
 * @param attr Attribute name
 * @returns Attribute value or null
 */
export function getAttr($: CheerioAPI, selector: string, attr: string): string | null {
  return $(selector).attr(attr) || null;
}

/**
 * Extracts text using a regex pattern
 * @param text Text to search
 * @param pattern Regex pattern
 * @param groupIndex Capture group index (default: 1)
 * @returns Matched text or null
 */
export function extractWithRegex(
  text: string,
  pattern: RegExp,
  groupIndex: number = 1
): string | null {
  const match = text.match(pattern);
  return match ? match[groupIndex] : null;
}
