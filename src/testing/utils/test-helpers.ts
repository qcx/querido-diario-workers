/**
 * Test helper utilities
 */

import { SpiderConfig, DateRange } from '../../types';
import { format, subDays } from 'date-fns';

/**
 * Creates a date range for testing
 */
export function createDateRange(days: number = 7): DateRange {
  const end = new Date();
  const start = subDays(end, days);

  return {
    start: format(start, 'yyyy-MM-dd'),
    end: format(end, 'yyyy-MM-dd'),
  };
}

/**
 * Creates a mock spider config for testing
 */
export function createMockSpiderConfig(overrides?: Partial<SpiderConfig>): SpiderConfig {
  return {
    id: 'test_city',
    name: 'Test City',
    territoryId: '1234567',
    spiderType: 'doem',
    startDate: '2020-01-01',
    config: {
      type: 'doem',
      stateCityUrlPart: 'test/city',
    },
    ...overrides,
  };
}

/**
 * Sleeps for a specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retries a function with exponential backoff
 */
export async function retry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

/**
 * Chunks an array into smaller arrays
 */
export function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];

  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }

  return chunks;
}

/**
 * Shuffles an array randomly
 */
export function shuffle<T>(array: T[]): T[] {
  const shuffled = [...array];

  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return shuffled;
}

/**
 * Samples N random items from an array
 */
export function sample<T>(array: T[], count: number): T[] {
  const shuffled = shuffle(array);
  return shuffled.slice(0, Math.min(count, array.length));
}

/**
 * Groups items by a key function
 */
export function groupBy<T, K extends string | number>(
  array: T[],
  keyFn: (item: T) => K
): Record<K, T[]> {
  const groups: Record<K, T[]> = {} as Record<K, T[]>;

  for (const item of array) {
    const key = keyFn(item);

    if (!groups[key]) {
      groups[key] = [];
    }

    groups[key].push(item);
  }

  return groups;
}

/**
 * Calculates percentage
 */
export function percentage(value: number, total: number): number {
  if (total === 0) {
    return 0;
  }

  return (value / total) * 100;
}

/**
 * Formats bytes to human-readable format
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Formats duration in milliseconds
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  } else if (ms < 3600000) {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(0);
    return `${minutes}m ${seconds}s`;
  } else {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  }
}

/**
 * Validates URL format
 */
export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validates date format (YYYY-MM-DD)
 */
export function isValidDate(date: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(date)) {
    return false;
  }

  const d = new Date(date);
  return d instanceof Date && !isNaN(d.getTime());
}

/**
 * Validates IBGE territory ID (7 digits)
 */
export function isValidTerritoryId(territoryId: string): boolean {
  return /^\d{7}$/.test(territoryId);
}

/**
 * Extracts domain from URL
 */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * Rate limiter class
 */
export class RateLimiter {
  private queue: Array<() => void> = [];
  private running = 0;
  private lastExecution = 0;

  constructor(
    private maxConcurrent: number,
    private minInterval: number
  ) {}

  /**
   * Executes a function with rate limiting
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.waitForSlot();

    this.running++;

    try {
      const result = await fn();
      return result;
    } finally {
      this.running--;
      this.processQueue();
    }
  }

  /**
   * Waits for an available slot
   */
  private waitForSlot(): Promise<void> {
    return new Promise((resolve) => {
      const tryExecute = () => {
        const now = Date.now();
        const timeSinceLastExecution = now - this.lastExecution;

        if (
          this.running < this.maxConcurrent &&
          timeSinceLastExecution >= this.minInterval
        ) {
          this.lastExecution = now;
          resolve();
        } else {
          this.queue.push(tryExecute);
        }
      };

      tryExecute();
    });
  }

  /**
   * Processes the queue
   */
  private processQueue(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        setTimeout(next, this.minInterval);
      }
    }
  }
}
