#!/usr/bin/env npx tsx
/**
 * Import Data Script Runner
 * Runs import scripts locally using the local SQLite database directly
 * 
 * Usage:
 *   npm run import:ocr       - Import OCR results
 *   npm run import:gazette   - Import gazette registry
 *   npm run import:all       - Import both
 */

import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import Database from 'better-sqlite3';
import type { D1Database } from '@cloudflare/workers-types';

/**
 * Create a D1Database adapter that wraps better-sqlite3
 * This allows us to use drizzle with the local SQLite file directly
 */
function createD1Adapter(sqliteDb: Database.Database): D1Database {
  // Create a D1Database-compatible adapter
  // Note: We use type assertion because the full D1Database interface has async methods
  // that we simulate with sync better-sqlite3 calls
  return {
    prepare: (query: string) => {
      const stmt = sqliteDb.prepare(query);
      const preparedStatement = {
        bind: (...values: any[]) => {
          const bound = stmt.bind(...values);
          return {
            bind: (...moreValues: any[]) => {
              // Chain bind calls
              return stmt.bind(...values, ...moreValues);
            },
            first: <T = unknown>() => {
              try {
                return bound.get() as T | null;
              } catch (err: any) {
                // Preserve better-sqlite3 error format
                throw err;
              }
            },
            run: () => {
              try {
                bound.run();
                return { success: true, meta: {} };
              } catch (err: any) {
                // Preserve better-sqlite3 error format for constraint violations
                throw err;
              }
            },
            all: <T = unknown>() => {
              try {
                return { results: bound.all() as T[] };
              } catch (err: any) {
                throw err;
              }
            },
            raw: () => {
              try {
                return bound.raw() as unknown[][];
              } catch (err: any) {
                throw err;
              }
            },
          };
        },
        first: <T = unknown>() => {
          try {
            return stmt.get() as T | null;
          } catch (err: any) {
            throw err;
          }
        },
        run: () => {
          try {
            stmt.run();
            return { success: true, meta: {} };
          } catch (err: any) {
            // Preserve better-sqlite3 error format for constraint violations
            throw err;
          }
        },
        all: <T = unknown>() => ({ results: stmt.all() as T[] }),
        raw: () => stmt.raw() as unknown[][],
      };
      return preparedStatement;
    },
    exec: (query: string) => {
      sqliteDb.exec(query);
      return { count: 0, duration: 0 };
    },
    batch: (statements: any[]) => {
      const results = statements.map((stmt) => {
        if (typeof stmt === 'function') {
          const prepared = stmt();
          return prepared.run();
        }
        return { success: true, meta: {} };
      });
      return results;
    },
    // Additional D1Database methods (stubs for compatibility)
    withSession: (sessionId: string) => {
      // Not needed for local development
      return createD1Adapter(sqliteDb);
    },
    dump: () => {
      // Return empty buffer for now - dump functionality not needed for imports
      return new ArrayBuffer(0);
    },
  } as unknown as D1Database;
}

/**
 * Parse .dev.vars file (simple key=value format)
 */
function parseDevVars(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, 'utf8');
  const vars: Record<string, string> = {};
  
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue;
    
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      // Remove quotes from value if present
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || 
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }
  }
  
  return vars;
}

/**
 * Get D1 database connection from local SQLite file
 */
function getD1Binding(): D1Database {
  // Check environment variable first, then try .dev.vars file
  let dbPath = process.env.LOCAL_DB_PATH;
  
  if (!dbPath) {
    const devVarsPath = join(process.cwd(), '.dev.vars');
    if (existsSync(devVarsPath)) {
      const vars = parseDevVars(devVarsPath);
      dbPath = vars.LOCAL_DB_PATH;
    }
  }
  
  if (!dbPath) {
    throw new Error(
      'LOCAL_DB_PATH not found. Please set it in:\n' +
      '  - Environment variable: LOCAL_DB_PATH\n' +
      '  - Or in .dev.vars file: LOCAL_DB_PATH="path/to/database.sqlite"'
    );
  }

  // Resolve the path (handle relative paths)
  const resolvedPath = dbPath.startsWith('/') 
    ? dbPath 
    : join(process.cwd(), dbPath);

  if (!existsSync(resolvedPath)) {
    throw new Error(
      `Local database file not found: ${resolvedPath}\n` +
      `Make sure you've run 'wrangler dev' at least once to create the local database.\n` +
      `You can find the database path by running: find .wrangler -name "*.sqlite"`
    );
  }

  console.log(`📂 Connecting to local database: ${resolvedPath}`);
  
  // Open SQLite database
  const sqliteDb = new Database(resolvedPath);
  
  // Create D1 adapter
  const d1Db = createD1Adapter(sqliteDb);
  
  console.log('✅ Connected to local D1 database');
  return d1Db;
}

/**
 * Run OCR import
 */
async function importOcr() {
  console.log('📥 Importing OCR Results...');
  console.log('═'.repeat(60));
  
  const db = getD1Binding();
  
  try {
    // Import the OCR import script
    const importOcrModule = await import('../data/ocr_results/import-ocr.ts');
    
    await importOcrModule.default.run({ DB: db });
  } catch (error) {
    console.error('❌ OCR import failed:', error);
    throw error;
  }
}

/**
 * Run Gazette Registry import
 */
async function importGazette() {
  console.log('📥 Importing Gazette Registry...');
  console.log('═'.repeat(60));
  
  const db = getD1Binding();
  
  try {
    // Import the gazette import script
    const importGazetteModule = await import('../data/gazette_registry/import-gazette.ts');
    
    await importGazetteModule.default.run({ DB: db });
  } catch (error) {
    console.error('❌ Gazette registry import failed:', error);
    throw error;
  }
}

/**
 * Run both imports
 */
async function importAll() {
  console.log('📥 Importing All Data...');
  console.log('═'.repeat(60));
  
  const db = getD1Binding();
  
  try {
    // Import gazette registry first (it's a dependency)
    console.log('\n1️⃣ Importing Gazette Registry...\n');
    const importGazetteModule = await import('../data/gazette_registry/import-gazette.ts');
    await importGazetteModule.default.run({ DB: db });
    
    console.log('\n\n2️⃣ Importing OCR Results...\n');
    const importOcrModule = await import('../data/ocr_results/import-ocr.ts');
    await importOcrModule.default.run({ DB: db });
    
    console.log('\n🎉 All imports completed successfully!');
  } catch (error) {
    console.error('❌ Import failed:', error);
    throw error;
  }
}

/**
 * Main CLI
 */
async function main() {
  const command = process.argv[2];
  
  try {
    switch (command) {
      case 'ocr':
        await importOcr();
        break;
      case 'gazette':
        await importGazette();
        break;
      case 'all':
        await importAll();
        break;
      default:
        console.log('📋 Usage:');
        console.log('  npm run import:ocr       - Import OCR results');
        console.log('  npm run import:gazette  - Import gazette registry');
        console.log('  npm run import:all       - Import both');
        console.log('');
        console.log('Or run directly:');
        console.log('  npx tsx scripts/import-data.ts <ocr|gazette|all>');
        process.exit(1);
    }
  } catch (error) {
    console.error('❌ Import script failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

