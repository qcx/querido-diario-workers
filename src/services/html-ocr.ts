/**
 * HTML OCR Service
 * Handles text extraction from HTML pages when URLs return HTML instead of PDF
 * Includes support for meta tag redirect following
 */

import TurndownService from 'turndown';
import sanitizeHtml from 'sanitize-html';
import { parseHTML } from 'linkedom';
import puppeteer from '@cloudflare/puppeteer';
import { logger } from '../utils';

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 30000;

/**
 * Result of HTML text extraction
 */
export interface HtmlExtractionResult {
  /** Extracted and converted text (markdown format) */
  text: string;
  /** Number of redirects followed */
  redirectCount: number;
  /** Final URL after redirects */
  finalUrl: string;
}

/**
 * Extracts redirect URL from HTML meta tag
 * Supports: <meta http-equiv="refresh" content="0;url=...">
 */
function extractMetaRedirect(html: string, currentUrl: string): string | null {
  try {
    // Match meta refresh tags with various formats
    // Examples:
    // <meta http-equiv="refresh" content="0;url=http://example.com">
    // <meta http-equiv="refresh" content="0; URL=http://example.com">
    // <meta http-equiv='refresh' content='5;url=http://example.com'>
    const metaRegex = /<meta[^>]*http-equiv\s*=\s*["']refresh["'][^>]*content\s*=\s*["']([^"']+)["']/i;
    const match = html.match(metaRegex);
    
    if (!match) {
      return null;
    }
    
    const content = match[1];
    
    // Extract URL from content attribute
    // Format: "0;url=..." or "0; URL=..."
    const urlMatch = content.match(/url\s*=\s*([^;'">\s]+)/i);
    
    if (!urlMatch) {
      return null;
    }
    
    let redirectUrl = urlMatch[1].trim();
    
    // Handle relative URLs
    if (redirectUrl.startsWith('/')) {
      const baseUrl = new URL(currentUrl);
      redirectUrl = `${baseUrl.protocol}//${baseUrl.host}${redirectUrl}`;
    } else if (!redirectUrl.startsWith('http')) {
      const baseUrl = new URL(currentUrl);
      const basePath = baseUrl.pathname.substring(0, baseUrl.pathname.lastIndexOf('/') + 1);
      redirectUrl = `${baseUrl.protocol}//${baseUrl.host}${basePath}${redirectUrl}`;
    }
    
    return redirectUrl;
  } catch (error) {
    logger.warn('Failed to extract meta redirect', {
      error: error instanceof Error ? error.message : String(error),
      url: currentUrl,
    });
    return null;
  }
}

/**
 * Check if content is HTML
 */
export function isHtmlContent(contentType: string | null, content: string): boolean {
  // Check content type header
  if (contentType) {
    if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
      return true;
    }
  }
  
  // Fallback: check content itself
  const trimmed = content.trim().toLowerCase();
  return trimmed.startsWith('<!doctype html') || 
         trimmed.startsWith('<html') ||
         trimmed.startsWith('<?xml') && trimmed.includes('<html');
}

/**
 * Fetch URL with redirect following
 */
async function fetchWithRedirects(
  url: string,
  jobId: string,
  redirectCount: number = 0
): Promise<{ html: string; finalUrl: string; redirectCount: number }> {
  if (redirectCount >= MAX_REDIRECTS) {
    throw new Error(`Maximum redirect limit (${MAX_REDIRECTS}) reached`);
  }
  
  logger.info(`Fetching URL (redirect ${redirectCount}/${MAX_REDIRECTS})`, {
    jobId,
    url,
    redirectCount,
  });
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:108.0) Gecko/20100101 Firefox/108.0',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  const html = await response.text();
  const contentType = response.headers.get('content-type');
  
  // Verify it's actually HTML
  if (!isHtmlContent(contentType, html)) {
    throw new Error(`Content is not HTML (Content-Type: ${contentType})`);
  }
  
  // Check for meta refresh redirect
  const redirectUrl = extractMetaRedirect(html, url);
  
  if (redirectUrl) {
    // Avoid infinite loops - check if redirect points to same URL
    if (redirectUrl === url) {
      logger.warn('Meta redirect points to same URL, ignoring', {
        jobId,
        url,
      });
      return { html, finalUrl: url, redirectCount };
    }
    
    logger.info('Following meta refresh redirect', {
      jobId,
      from: url,
      to: redirectUrl,
      redirectCount: redirectCount + 1,
    });
    
    // Recursively follow redirect
    return fetchWithRedirects(redirectUrl, jobId, redirectCount + 1);
  }
  
  return { html, finalUrl: url, redirectCount };
}

/**
 * Extract main content from HTML, removing head and non-content sections
 */
function extractMainContent(html: string): string {
  // Parse HTML with linkedom for better content extraction
  const { document } = parseHTML(html);
  
  // Remove non-content elements before extraction
  const elementsToRemove = [
    'script',
    'style',
    'noscript',
    'iframe'
  ];
  
  elementsToRemove.forEach(selector => {
    const elements = document.querySelectorAll(selector);
    elements.forEach(el => el.remove());
  });
  
  // Fallback: try to extract just the body content with regex
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) {
    return bodyMatch[1];
  }
  
  // If no body tag, return as-is (might be an HTML fragment)
  return html;
}

/**
 * Clean and sanitize HTML content
 */
function sanitizeHtmlContent(html: string): string {
  // First, extract main content to remove head section
  const mainContent = extractMainContent(html);

  console.log('mainContent', mainContent);
  
  return sanitizeHtml(mainContent, {
    // Allow almost all content tags
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'article', 'section', 'header', 'footer', 'main', 'aside',
      'figure', 'figcaption', 'img', 'picture',
      'details', 'summary',
      'dl', 'dt', 'dd',
      'address', 'time',
      'div', 'span', 'blockquote', 'pre', 
      'ul', 'ol', 'li',
      'table', 'thead', 'tbody', 'tr', 'td', 'th',
      'strong', 'b', 'em', 'i', 'u', 's', 'strike',
      'a',
      'article', 'section', 'header', 'footer', 'main', 'aside',
      'figure', 'figcaption', 'img', 'picture',
      'details', 'summary',
      'dl', 'dt', 'dd',
      'address', 'time',
    ]),
    allowedAttributes: {
      '*': ['class', 'id'], // Keep class and id for better structure preservation
      'a': ['href', 'title', 'name'],
      'img': ['src', 'alt', 'title'],
      'table': ['border', 'cellpadding', 'cellspacing'],
      'td': ['colspan', 'rowspan'],
      'th': ['colspan', 'rowspan'],
      'time': ['datetime'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'data'],
    // Only exclude clearly non-content elements (already removed in extractMainContent)
    exclusiveFilter: (frame: any) => {
      // Remove elements with common non-content class/id patterns
      const classNames = frame.attribs?.class || '';
      const id = frame.attribs?.id || '';
      const combined = `${classNames} ${id}`.toLowerCase();
      
      return (
        combined.includes('advertisement') ||
        combined.includes('banner') ||
        combined.includes('cookie') ||
        combined.includes('modal') ||
        combined.includes('popup')
      );
    },
  });
}

/**
 * Convert HTML to markdown text
 */
function htmlToMarkdown(html: string): string {
  // Parse HTML with linkedom to provide DOM implementation for Workers
  const { document } = parseHTML(html);
  
  // Create TurndownService with linkedom's document
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });
  
  // Add custom rules for better conversion
  turndownService.addRule('removeImages', {
    filter: 'img',
    replacement: () => '', // Remove images, keep only text
  });
  
  turndownService.addRule('preserveLineBreaks', {
    filter: 'br',
    replacement: () => '\n',
  });
  
  // Pass the document element (body) to turndown
  return turndownService.turndown(document.documentElement);
}

/**
 * Process HTML URL and extract text
 * Main entry point for HTML-based OCR
 */
export async function processHtmlToText(
  url: string,
  jobId: string
): Promise<HtmlExtractionResult> {
  logger.info('Starting HTML text extraction', {
    jobId,
    url,
  });
  
  try {
    // Fetch HTML with redirect following
    const { html, finalUrl, redirectCount } = await fetchWithRedirects(url, jobId);
    
    if (redirectCount > 0) {
      logger.info('Followed meta redirects', {
        jobId,
        originalUrl: url,
        finalUrl,
        redirectCount,
      });
    }
    
    // Sanitize HTML
    const cleanHtml = sanitizeHtmlContent(html);
    
    // Convert to markdown
    const markdown = htmlToMarkdown(cleanHtml);
    
    // Clean up extra whitespace
    const text = markdown
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n\n');
    
    if (!text || text.length < 50) {
      throw new Error('Extracted text is too short or empty');
    }
    
    logger.info('HTML text extraction completed', {
      jobId,
      finalUrl,
      redirectCount,
      textLength: text.length,
    });
    
    return {
      text,
      redirectCount,
      finalUrl,
    };
  } catch (error) {
    logger.error('HTML text extraction failed', error as Error, {
      jobId,
      url,
    });
    throw error;
  }
}

/**
 * Process HTML URL using browser rendering (for JavaScript-heavy pages)
 * Falls back to regular fetch if browser is not available
 */
export async function processHtmlWithBrowser(
  url: string,
  jobId: string,
  browser?: Fetcher
): Promise<HtmlExtractionResult> {
  logger.info('Starting browser-based HTML extraction', {
    jobId,
    url,
    hasBrowser: !!browser,
  });
  
  if (!browser) {
    // Fallback to regular fetch-based extraction
    logger.warn('No browser available, falling back to fetch-based extraction');
    return processHtmlToText(url, jobId);
  }
  
  let browserInstance = null;
  let page = null;
  
  try {
    // Launch browser
    browserInstance = await puppeteer.launch(browser);
    page = await browserInstance.newPage();
    
    // Navigate and wait for content to load
    await page.goto(url, { 
      waitUntil: 'networkidle0',  // Wait until network is idle
      timeout: 30000 
    });
    
    // Wait for main content to appear (adjust selector as needed)
    // Try multiple selectors for robustness
    try {
      await page.waitForSelector('main, article, .content, #content', {
        timeout: 10000
      });
    } catch (e) {
      logger.warn('Content selector not found, proceeding anyway', { jobId, url });
    }
    
    // Get the rendered HTML
    const html = await page.content();
    
    logger.info('Browser rendered HTML successfully', {
      jobId,
      url,
      htmlLength: html.length,
    });
    
    // Close browser resources early
    await page.close();
    await browserInstance.close();
    page = null;
    browserInstance = null;
    
    // Process the rendered HTML with existing extraction logic
    const cleanHtml = sanitizeHtmlContent(html);
    const markdown = htmlToMarkdown(cleanHtml);
    
    const text = markdown
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .join('\n\n');
    
    if (!text || text.length < 50) {
      throw new Error('Extracted text is too short or empty after browser rendering');
    }
    
    return {
      text,
      redirectCount: 0,
      finalUrl: url,
    };
    
  } catch (error) {
    logger.error('Browser-based HTML extraction failed', error as Error, {
      jobId,
      url,
    });
    throw error;
  } finally {
    // Cleanup
    if (page) {
      try {
        await page.close();
      } catch (e) {
        logger.warn('Error closing page', { error: String(e) });
      }
    }
    if (browserInstance) {
      try {
        await browserInstance.close();
      } catch (e) {
        logger.warn('Error closing browser', { error: String(e) });
      }
    }
  }
}

/**
 * Check if a URL returns HTML content (without full processing)
 * Used for initial detection before processing
 */
export async function detectHtmlContent(url: string, jobId: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'HEAD', // Use HEAD first for efficiency
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:108.0) Gecko/20100101 Firefox/108.0',
      },
      signal: AbortSignal.timeout(10000),
    });
    
    const contentType = response.headers.get('content-type');
    
    if (contentType && (contentType.includes('text/html') || contentType.includes('application/xhtml'))) {
      return true;
    }
    
    // If HEAD doesn't give clear answer, try GET with small read
    if (!contentType || contentType.includes('application/octet-stream')) {
      const getResponse = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:108.0) Gecko/20100101 Firefox/108.0',
        },
        signal: AbortSignal.timeout(10000),
      });
      
      const text = await getResponse.text();
      return isHtmlContent(getResponse.headers.get('content-type'), text.substring(0, 1000));
    }
    
    return false;
  } catch (error) {
    logger.warn('HTML detection failed, assuming not HTML', {
      jobId,
      url,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

