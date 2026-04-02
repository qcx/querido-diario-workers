/**
 * Drizzle Database Client for D1
 * Provides type-safe database operations using Drizzle ORM
 */
import { drizzle, DrizzleD1Database } from 'drizzle-orm/d1';
import { randomUUID } from 'crypto';
import { count } from 'drizzle-orm';
import * as schema from './schema';
import { logger } from '../../utils/logger';

export interface D1DatabaseEnv {
  DB: D1Database;
}

export class DatabaseClient {
  private db: DrizzleD1Database<typeof schema>;
  private dialect: 'sqlite' | 'postgres' = 'sqlite';

  constructor(d1Database: D1Database) {
    this.db = drizzle(d1Database, { schema });
  }

  getDialect(): 'sqlite' | 'postgres' {
    return this.dialect;
  }

  static fromD1(env: D1DatabaseEnv): DatabaseClient {
    if (!env.DB) {
      throw new Error('D1 database binding (DB) not available in environment');
    }
    return new DatabaseClient(env.DB);
  }

  getDb(): DrizzleD1Database<typeof schema> {
    return this.db;
  }

  generateId(): string {
    return randomUUID();
  }

  getCurrentTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Parse JSON safely with fallback and optional validation
   */
  parseJson<T>(
    jsonString: string,
    fallback: T,
    validate?: (value: unknown) => value is T
  ): T {
    try {
      const parsed: unknown = JSON.parse(jsonString);
      
      if (validate && !validate(parsed)) {
        logger.warn('JSON parsed but failed validation, using fallback', {
          jsonString: jsonString.substring(0, 100)
        });
        return fallback;
      }
      
      return parsed as T;
    } catch (error) {
      logger.warn('Failed to parse JSON, using fallback', {
        jsonString: jsonString.substring(0, 100),
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return fallback;
    }
  }

  stringifyJson(obj: unknown): string {
    try {
      return JSON.stringify(obj);
    } catch (error) {
      logger.error('Failed to stringify JSON', error as Error);
      return '{}';
    }
  }

  /**
   * Execute multiple operations in a batch (D1's transaction equivalent)
   * Properly typed to preserve individual operation result types
   */
  async batch<T extends readonly any[]>(
    operations: readonly [...T]
  ): Promise<{ [K in keyof T]: Awaited<T[K]> }> {
    try {
      const results = await this.db.batch(operations as any);
      return results as { [K in keyof T]: Awaited<T[K]> };
    } catch (error) {
      logger.error('Batch operation failed', error as Error);
      throw error;
    }
  }

  async healthCheck(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
    try {
      const start = Date.now();
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
        this.db.select({ count: count() }).from(schema.crawlJobs),
        this.db.select({ count: count() }).from(schema.gazetteRegistry),
        this.db.select({ count: count() }).from(schema.ocrResults),
        this.db.select({ count: count() }).from(schema.analysisResults),
        this.db.select({ count: count() }).from(schema.errorLogs)
      ]);

      return {
        tablesCount: 9,
        recordsCounts: {
          crawl_jobs: Number(crawlJobsCount[0]?.count ?? 0),
          gazette_registry: Number(gazettesCount[0]?.count ?? 0),
          ocr_results: Number(ocrResultsCount[0]?.count ?? 0),
          analysis_results: Number(analysisCount[0]?.count ?? 0),
          error_logs: Number(errorsCount[0]?.count ?? 0)
        }
      };
    } catch (error) {
      logger.error('Failed to get database stats', { error });
      throw error;
    }
  }
}

export function getDatabase(env: D1DatabaseEnv): DatabaseClient {
  return DatabaseClient.fromD1(env);
}

export { schema };