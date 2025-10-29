/**
 * URL Resolution Utility
 * Resolves URLs to their final destination by following HTTP redirects
 */

import { logger } from './logger';
import { loadHTML } from './html-parser';

export interface UrlResolverOptions {
  maxRedirects?: number;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

const DEFAULT_MAX_REDIRECTS = 10;
const DEFAULT_TIMEOUT = 15000; // 15 seconds
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY = 1000;

/**
 * Extracts the URL from an HTML meta refresh tag
 * @param html HTML content to parse
 * @param baseUrl Base URL for resolving relative URLs
 * @returns The extracted URL or null if no meta refresh found
 */
function extractMetaRefreshUrl(html: string, baseUrl: string): string | null {
  try {
    const $ = loadHTML(html);
    
    // Look for meta refresh tag (case-insensitive)
    const metaRefresh = $('meta[http-equiv]').filter((_, el) => {
      const httpEquiv = $(el).attr('http-equiv');
      return httpEquiv?.toLowerCase() === 'refresh';
    }).first();
    
    if (metaRefresh.length === 0) {
      return null;
    }
    
    const content = metaRefresh.attr('content');
    if (!content) {
      return null;
    }
    
    // Parse content attribute: "delay; url=TARGET_URL" or "delay;url=TARGET_URL"
    // Also handle variations like "0; URL=/path" or just "url=/path"
    const urlMatch = content.match(/url\s*=\s*['"]?([^'"]+)['"]?/i);
    if (!urlMatch || !urlMatch[1]) {
      return null;
    }
    
    const refreshUrl = urlMatch[1].trim();
    
    // Resolve relative URLs against base URL
    const absoluteUrl = new URL(refreshUrl, baseUrl).toString();
    
    return absoluteUrl;
  } catch (error) {
    logger.warn('Failed to parse HTML for meta refresh', {
      error: (error as Error).message,
      baseUrl
    });
    return null;
  }
}

/**
 * Resolves a URL to its final destination by following redirects
 * @param url The URL to resolve
 * @param options Resolution options
 * @returns The final resolved URL
 * @throws Error if resolution fails
 */
export async function resolveFinalUrl(
  url: string,
  options: UrlResolverOptions = {}
): Promise<string> {
  const {
    maxRedirects = DEFAULT_MAX_REDIRECTS,
    timeout = DEFAULT_TIMEOUT,
    retries = DEFAULT_RETRIES,
    retryDelay = DEFAULT_RETRY_DELAY,
  } = options;

  let lastError: Error | null = null;

  // Retry loop
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const finalUrl = await resolveUrlWithRedirects(url, maxRedirects, timeout);
      
      // Log if URL was redirected
      if (finalUrl !== url) {
        logger.debug('URL resolved after redirects', {
          originalUrl: url,
          finalUrl,
          attempt: attempt + 1
        });
      }
      
      return finalUrl;
    } catch (error) {
      lastError = error as Error;
      
      // Don't retry on most client errors, but allow 429 (rate limit) to retry with backoff
      if (error instanceof Error) {
        const msg = error.message || '';
        if (/HTTP\s+429\b/.test(msg)) {
          // 429 is retriable - continue to retry logic
        } else if (/HTTP\s+4\d{2}\b/.test(msg)) {
          throw error;
        }
      }

      // Don't retry on too many redirects
      if (error instanceof Error && error.message.includes('Too many redirects')) {
        throw error;
      }

      // Wait before retrying (except on last attempt)
      if (attempt < retries) {
        logger.debug('URL resolution failed, retrying', {
          url,
          attempt: attempt + 1,
          error: (error as Error).message
        });
        await sleep(retryDelay * (attempt + 1)); // Exponential backoff
      }
    }
  }

  const errorMessage = `Failed to resolve URL after ${retries + 1} attempts: ${lastError?.message}`;
  logger.error(
    'URL resolution failed',
    lastError ?? new Error(errorMessage),
    { url }
  );
  throw new Error(errorMessage);
}

/**
 * Internal function to resolve URL by following redirects
 */
async function resolveUrlWithRedirects(
  url: string,
  maxRedirects: number,
  timeout: number
): Promise<string> {
  const isPrivateHost = (host: string) => {
    // IPv4
    if (/^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return true;
    // IPv6 localhost/link-local/ULA
    if (host === '::1' || host.startsWith('fe80:') || host.toLowerCase().startsWith('fc') || host.toLowerCase().startsWith('fd')) return true;
    // Common local hostnames
    if (host === 'localhost' || host.endsWith('.local')) return true;
    return false;
  };
  const assertSafe = (u: string) => {
    let parsed: URL;
    try { parsed = new URL(u); } catch { throw new Error(`Blocked invalid URL: ${u}`); }
    if (!/^https?:$/.test(parsed.protocol)) throw new Error(`Blocked non-http(s) URL: ${u}`);
    if (isPrivateHost(parsed.hostname)) throw new Error(`Blocked private/localhost URL: ${u}`);
  };
  
  let currentUrl = url;
  let redirectCount = 0;
  const redirectChain: string[] = [url];

  while (redirectCount < maxRedirects) {
    assertSafe(currentUrl);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      // Use HEAD request to check for redirects (lightweight)
      let response = await fetch(currentUrl, {
        method: 'HEAD',
        redirect: 'manual', // Handle redirects manually
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:108.0) Gecko/20100101 Firefox/108.0',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Fallback: some servers don't implement HEAD correctly
      if (response.status === 405 || response.status === 501) {
        logger.debug('HEAD not supported; retrying with GET (no body)', {
          url: currentUrl,
          status: response.status,
        });
        const fbController = new AbortController();
        const fbTimeoutId = setTimeout(() => fbController.abort(), timeout);
        try {
          response = await fetch(currentUrl, {
            method: 'GET',
            redirect: 'manual',
            headers: {
              'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:108.0) Gecko/20100101 Firefox/108.0',
              'Range': 'bytes=0-0',
            },
            signal: fbController.signal,
          });
        } finally {
          clearTimeout(fbTimeoutId);
        }
      }

      // Check for redirect status codes
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('Location');
        
        if (!location) {
          throw new Error(`Redirect response (${response.status}) without Location header`);
        }

        // Handle relative URLs
        const nextUrl = new URL(location, currentUrl).toString();
        assertSafe(nextUrl);
        
        redirectChain.push(nextUrl);
        currentUrl = nextUrl;
        redirectCount++;
        
        logger.debug('Following redirect', {
          from: redirectChain[redirectChain.length - 2],
          to: nextUrl,
          status: response.status,
          redirectCount
        });
        
        continue;
      }

      // Check for client/server errors
      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Check for HTML meta refresh redirects (only for 2xx responses)
      if (response.status >= 200 && response.status < 300) {
        const contentType = response.headers.get('Content-Type');
        
        // Only check HTML responses for meta refresh
        if (contentType && contentType.toLowerCase().includes('text/html')) {
          logger.debug('Detected HTML response, checking for meta refresh', {
            url: currentUrl,
            contentType
          });
          
          // Fetch the HTML content (need GET instead of HEAD) with its own timeout
          const htmlController = new AbortController();
          const htmlTimeoutId = setTimeout(() => htmlController.abort(), timeout);
          let htmlResponse: Response | undefined;
          try {
            htmlResponse = await fetch(currentUrl, {
              method: 'GET',
              redirect: 'manual',
              headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:108.0) Gecko/20100101 Firefox/108.0',
              },
              signal: htmlController.signal,
            });
          } finally {
            clearTimeout(htmlTimeoutId);
          }
            
          try {
            // Read only the first 50KB to avoid memory issues
            // Meta tags are typically in the <head> section at the beginning
            const reader = htmlResponse?.body?.getReader();
            let htmlChunk = '';
            let bytesRead = 0;
            const maxBytes = 50 * 1024; // 50KB
            const decoder = new TextDecoder();
            
            if (reader) {
              while (bytesRead < maxBytes) {
                const { done, value } = await reader.read();
                if (done) break;
                
                htmlChunk += decoder.decode(value);
                bytesRead += value.length;
                
                // Stop early if we've found the closing </head> tag
                if (htmlChunk.includes('</head>')) {
                  break;
                }
              }
              
              // Cancel the reader to free resources
              await reader.cancel();
            }
            
            // Check for meta refresh
            const metaRefreshUrl = extractMetaRefreshUrl(htmlChunk, currentUrl);
            
            if (metaRefreshUrl) {
              redirectChain.push(metaRefreshUrl);
              currentUrl = metaRefreshUrl;
              redirectCount++;
              
              logger.debug('Following meta refresh redirect', {
                from: redirectChain[redirectChain.length - 2],
                to: metaRefreshUrl,
                redirectCount
              });
              
              continue;
            }
          } catch (htmlError) {
            // Log but don't fail - treat as final URL if we can't parse HTML
            logger.warn('Failed to check for meta refresh', {
              url: currentUrl,
              error: (htmlError as Error).message
            });
          }
        }
      }

      // Success - no more redirects
      if (redirectCount > 0) {
        logger.info('URL resolution completed', {
          originalUrl: url,
          finalUrl: currentUrl,
          redirectCount,
          redirectChain: redirectChain.length > 3 ? 
            [...redirectChain.slice(0, 2), '...', redirectChain[redirectChain.length - 1]] : 
            redirectChain
        });
      }
      
      return currentUrl;
    } catch (error) {
      clearTimeout(timeoutId);
      
      // Handle timeout
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${timeout}ms`);
      }
      
      throw error;
    }
  }

  // Too many redirects
  const errorMessage = `Too many redirects (${maxRedirects}) while resolving URL`;
  logger.warn(errorMessage, {
    url,
    redirectChain: redirectChain.length > 5 ? 
      [...redirectChain.slice(0, 3), '...', ...redirectChain.slice(-2)] : 
      redirectChain
  });
  throw new Error(errorMessage);
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Batch resolve multiple URLs
 * @param urls Array of URLs to resolve
 * @param options Resolution options
 * @returns Map of original URL to resolved URL (skips failed resolutions)
 */
export async function resolveFinalUrlsBatch(
  urls: string[],
  options: UrlResolverOptions = {}
): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  
  // Process in parallel with concurrency limit
  const concurrencyLimit = 5;
  for (let i = 0; i < urls.length; i += concurrencyLimit) {
    const batch = urls.slice(i, i + concurrencyLimit);
    const promises = batch.map(async (url) => {
      try {
        const resolvedUrl = await resolveFinalUrl(url, options);
        results.set(url, resolvedUrl);
      } catch (error) {
        logger.warn('Failed to resolve URL in batch', {
          url,
          error: (error as Error).message
        });
        // Don't add to results - will be filtered out
      }
    });
    
    await Promise.all(promises);
  }
  
  return results;
}

