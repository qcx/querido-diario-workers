/**
 * HTTP client with retry logic
 */

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

const DEFAULT_TIMEOUT = 30000; // 30 seconds
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 1000; // 1 second

/**
 * Fetches a URL with retry logic
 * @param url URL to fetch
 * @param options Fetch options
 * @returns Response text
 */
export async function fetchWithRetry(
  url: string,
  options: FetchOptions = {}
): Promise<string> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeout = DEFAULT_TIMEOUT,
    retries = DEFAULT_RETRIES,
    retryDelay = DEFAULT_RETRY_DELAY,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:108.0) Gecko/20100101 Firefox/108.0',
          ...headers,
        },
        body,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.text();
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

      // Wait before retrying (except on last attempt)
      if (attempt < retries) {
        await sleep(retryDelay * (attempt + 1)); // Exponential backoff
      }
    }
  }

  throw new Error(
    `Failed to fetch ${url} after ${retries + 1} attempts: ${lastError?.message}`
  );
}

/**
 * Sleep for a specified duration
 * @param ms Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetches HTML content from a URL
 * @param url URL to fetch
 * @returns HTML content
 */
export async function fetchHTML(url: string): Promise<string> {
  return fetchWithRetry(url, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
}
