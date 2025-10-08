/**
 * Drizzle Database Client for D1
 * Provides type-safe database operations using Drizzle ORM
 */

import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';
import { randomUUID } from 'crypto';
import * as schema from './schema';
import { logger } from '../../utils/logger';

export interface D1DatabaseEnv {
  DB: D1Database;
}

export class DrizzleDatabaseClient {
  private db: DrizzleD1Database<typeof schema>;

  constructor(d1Database: D1Database) {
    this.db = drizzle(d1Database, { schema });
  }

  /**
   * Initialize database client from Cloudflare D1 binding
   */
  static fromD1(env: D1DatabaseEnv): DrizzleDatabaseClient {
    if (!env.DB) {
      throw new Error('D1 database binding (DB) not available in environment');
    }
    return new DrizzleDatabaseClient(env.DB);
  }

  /**
   * Get the Drizzle database instance for direct queries
   */
  getDb(): DrizzleD1Database<typeof schema> {
    return this.db;
  }

  /**
   * Generate a new UUID for primary keys
   */
  generateId(): string {
    return randomUUID();
  }

  /**
   * Get current ISO timestamp
   */
  getCurrentTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Parse JSON safely with fallback
   */
  parseJson<T>(jsonString: string, fallback: T): T {
    try {
      const parsed = JSON.parse(jsonString);
      return parsed as T;
    } catch (error) {
      logger.warn('Failed to parse JSON, using fallback', {
        jsonString: jsonString.substring(0, 100),
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return fallback;
    }
  }

  /**
   * Stringify JSON safely
   */
  stringifyJson(obj: unknown): string {
    try {
      return JSON.stringify(obj);
    } catch (error) {
      logger.error('Failed to stringify JSON', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return '{}';
    }
  }

  /**
   * Execute multiple operations in a batch (D1's transaction equivalent)
   */
  async batch<T = unknown>(operations: unknown[]): Promise<T[]> {
    try {
      const results = await this.db.batch(operations);
      return results;
    } catch (error) {
      logger.error('Batch operation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Health check for database connection
   */
  async healthCheck(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
    try {
      const start = Date.now();
      
      // Simple query to test database connectivity
      await this.db.select({ count: schema.crawlJobs.id }).from(schema.crawlJobs).limit(1);
      
      const latency = Date.now() - start;
      return { healthy: true, latency };
    } catch (error) {
      return { 
        healthy: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Get database statistics
   */
  async getStats(): Promise<{
    tablesCount: number;
    recordsCounts: Record<string, number>;
  }> {
    try {
      const [
        crawlJobsCount,
        gazettesCount,
        ocrResultsCount,
        analysisCount,
        errorsCount
      ] = await Promise.all([
        this.db.select({ count: schema.crawlJobs.id }).from(schema.crawlJobs),
        this.db.select({ count: schema.gazetteRegistry.id }).from(schema.gazetteRegistry),
        this.db.select({ count: schema.ocrResults.id }).from(schema.ocrResults),
        this.db.select({ count: schema.analysisResults.id }).from(schema.analysisResults),
        this.db.select({ count: schema.errorLogs.id }).from(schema.errorLogs)
      ]);

      return {
        tablesCount: 9, // Number of tables we have
        recordsCounts: {
          crawl_jobs: crawlJobsCount.length,
          gazette_registry: gazettesCount.length,
          ocr_results: ocrResultsCount.length,
          analysis_results: analysisCount.length,
          error_logs: errorsCount.length
        }
      };
    } catch (error) {
      logger.error('Failed to get database stats', { error });
      throw error;
    }
  }
}

/**
 * Get database client instance for Cloudflare Workers
 */
export function getDatabase(env: D1DatabaseEnv): DrizzleDatabaseClient {
  return DrizzleDatabaseClient.fromD1(env);
}

// Export schema for use in repositories
export { schema };
