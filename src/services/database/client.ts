/**
 * PostgreSQL Database Client with Hyperdrive Integration
 * Manages database connections for Cloudflare Workers via Hyperdrive
 */

import postgres from 'postgres';
import { logger } from '../../utils';

export interface DatabaseConfig {
  connectionString: string;
  maxConnections?: number;
  idleTimeout?: number;
  retryCount?: number;
}

export interface DatabaseEnv {
  DATABASE_URL?: string;
}

export class DatabaseClient {
  private sql: postgres.Sql | null = null;
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  /**
   * Initialize database connection using direct PostgreSQL connection
   */
  static fromConnectionString(env: DatabaseEnv): DatabaseClient {
    if (!env.DATABASE_URL) {
      throw new Error('DATABASE_URL not available in environment');
    }

    const config: DatabaseConfig = {
      connectionString: env.DATABASE_URL,
      maxConnections: 10, // Reduced for direct connections
      idleTimeout: 30,
      retryCount: 3,
    };

    return new DatabaseClient(config);
  }

  /**
   * Get or create database connection
   */
  getConnection(): postgres.Sql {
    if (!this.sql) {
      this.sql = postgres(this.config.connectionString, {
        max: this.config.maxConnections || 20,
        idle_timeout: this.config.idleTimeout || 30,
        max_lifetime: 60 * 30, // 30 minutes
        onnotice: (notice) => {
          logger.info('PostgreSQL notice', { notice: notice.message });
        },
        onparameter: (key, value) => {
          logger.debug('PostgreSQL parameter', { key, value });
        },
      });
    }
    return this.sql;
  }

  /**
   * Execute a query with automatic retry logic
   */
  async query<T = any>(
    queryText: string | postgres.PendingQuery<postgres.Row[]>,
    params?: any[]
  ): Promise<T[]> {
    const sql = this.getConnection();
    const maxRetries = this.config.retryCount || 3;
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        let result;
        if (typeof queryText === 'string') {
          result = await sql.unsafe(queryText, params);
        } else {
          result = await queryText;
        }
        
        logger.debug('Database query executed successfully', {
          attempt,
          rowCount: result.length
        });
        
        return result as T[];
      } catch (error) {
        lastError = error as Error;
        
        logger.warn('Database query failed', {
          attempt,
          maxRetries,
          error: lastError.message,
          queryText: typeof queryText === 'string' ? queryText.substring(0, 100) : 'template'
        });

        // Don't retry on syntax errors or constraint violations
        if (lastError.message.includes('syntax error') || 
            lastError.message.includes('violates') ||
            lastError.message.includes('duplicate key')) {
          throw lastError;
        }

        // Wait before retry (exponential backoff)
        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError!;
  }

  /**
   * Execute a single query (template literal)
   */
  async queryTemplate<T = any>(template: TemplateStringsArray, ...values: any[]): Promise<T[]> {
    const sql = this.getConnection();
    return this.query(sql(template, ...values));
  }

  /**
   * Execute query within a transaction
   */
  async transaction<T>(callback: (sql: postgres.Sql) => Promise<T>): Promise<T> {
    const sql = this.getConnection();
    return sql.begin(callback);
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.sql) {
      await this.sql.end();
      this.sql = null;
      logger.info('Database connection closed');
    }
  }

  /**
   * Health check for database connection
   */
  async healthCheck(): Promise<{ healthy: boolean; latency?: number; error?: string }> {
    try {
      const start = Date.now();
      await this.query('SELECT 1 as health_check');
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
   * Get current database statistics
   */
  async getStats(): Promise<{
    activeConnections: number;
    maxConnections: number;
    databaseSize: string;
  }> {
    const result = await this.query(`
      SELECT 
        (SELECT count(*) FROM pg_stat_activity WHERE state = 'active') as active_connections,
        (SELECT setting::int FROM pg_settings WHERE name = 'max_connections') as max_connections,
        (SELECT pg_size_pretty(pg_database_size(current_database()))) as database_size
    `);

    return result[0] as any;
  }
}

/**
 * Get database client instance (creates new instance per request for Cloudflare Workers isolation)
 */
export function getDatabase(env: DatabaseEnv): DatabaseClient {
  return DatabaseClient.fromConnectionString(env);
}

/**
 * Initialize database client for testing
 */
export function initTestDatabase(connectionString: string): DatabaseClient {
  return new DatabaseClient({ connectionString });
}
