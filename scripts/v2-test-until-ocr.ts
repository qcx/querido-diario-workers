#!/usr/bin/env tsx

/**
 * V2 Spider Testing Script
 * Tests the complete v2 spider crawl → OCR pipeline
 * 
 * This script:
 * 1. Calls the /crawl endpoint with v2 spiders for the last 10 days
 * 2. Monitors gazette_registry and ocr_results tables
 * 3. Validates OCR results (markdown format + "Diário Oficial" text)
 * 4. Reports success/failure/no-results after 15 minutes or completion
 */

import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gte, lte, like, sql } from 'drizzle-orm';
import * as schema from '../src/services/database/schema';
import Database from 'better-sqlite3';
import type { D1Database } from '@cloudflare/workers-types';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

// ============================================================================
// V2 CONFIG RESOLUTION
// ============================================================================

interface V2TerritoryConfig {
  id: string;
  name: string;
  territoryId: string;
  stateCode: string;
  active: boolean;
  spiders: Array<{ spiderType: string; [key: string]: any }>;
}

function loadV2ConfigMap(): Map<string, string> {
  const configDir = join(process.cwd(), 'src', 'spiders', 'v2', 'configs');
  const map = new Map<string, string>();

  if (!existsSync(configDir)) {
    console.warn(`⚠️  V2 config directory not found: ${configDir}`);
    return map;
  }

  const files = readdirSync(configDir).filter(f => f.endsWith('.json'));

  for (const file of files) {
    try {
      const content = readFileSync(join(configDir, file), 'utf8');
      const territories: V2TerritoryConfig[] = JSON.parse(content);
      for (const territory of territories) {
        map.set(territory.id, territory.territoryId);
      }
    } catch {
      // skip malformed files
    }
  }

  return map;
}

const v2ConfigMap = loadV2ConfigMap();

function resolveCityConfig(cityId: string): CityConfig {
  const territoryId = v2ConfigMap.get(cityId);
  if (territoryId) {
    return { spiderId: cityId, territoryId };
  }
  return { spiderId: cityId, territoryId: cityId };
}

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface CityConfig {
  spiderId: string;
  territoryId: string;
}

interface CrawlApiRequest {
  cities: string[];
  startDate: string;
  endDate: string;
  version: 'v2';
}

interface CrawlApiResponse {
  success: boolean;
  tasksEnqueued: number;
  cities: string[];
  crawlJobId?: string;
  error?: string;
}

interface OcrResultInfo {
  id: string;
  gazetteId: string;
  textLength: number;
  hasMarkdown: boolean;
  hasDiarioOficial: boolean;
}

interface SuccessfulCity {
  spiderId: string;
  territoryId: string;
  gazetteCount: number;
  ocrResults: OcrResultInfo[];
}

interface FailedCity {
  spiderId: string;
  territoryId: string;
  reason: string;
  gazetteCount: number;
  hasGazette: boolean;
  hasOcr: boolean;
  ocrIssue?: string;
}

interface NoResultCity {
  spiderId: string;
  territoryId: string;
  reason: string;
}

interface TestResult {
  successful: SuccessfulCity[];
  failed: FailedCity[];
  noResults: NoResultCity[];
  summary: {
    totalCities: number;
    successful: number;
    failed: number;
    noResults: number;
    executionTimeMs: number;
    timedOut: boolean;
  };
}

interface CityStatus {
  spiderId: string;
  territoryId: string;
  gazetteCount: number;
  gazettes: Array<{
    id: string;
    publicationDate: string;
    pdfUrl: string;
  }>;
  ocrResults: OcrResultInfo[];
  complete: boolean;
  reason?: string;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_CITIES: CityConfig[] = [
  resolveCityConfig('sp_3550308'), // São Paulo
  resolveCityConfig('rj_3304557'), // Rio de Janeiro
  resolveCityConfig('mg_3106200'), // Belo Horizonte
];

const CONFIG = {
  apiUrl: process.env.API_URL || 'http://localhost:8787',
  localDbPath: process.env.LOCAL_DB_PATH,
  timeout: 15 * 60 * 1000, // 15 minutes
  pollInterval: 30 * 1000, // 30 seconds
  daysToCheck: 10,
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate date range for the last N days
 */
function getDateRange(days: number): { startDate: string; endDate: string } {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  return {
    startDate: startDate.toISOString().split('T')[0],
    endDate: endDate.toISOString().split('T')[0],
  };
}

/**
 * Format milliseconds to human-readable time
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Console logging with colors
 */
const log = {
  info: (msg: string, ...args: any[]) => console.log(`ℹ️  ${msg}`, ...args),
  success: (msg: string, ...args: any[]) => console.log(`✅ ${msg}`, ...args),
  error: (msg: string, ...args: any[]) => console.error(`❌ ${msg}`, ...args),
  warn: (msg: string, ...args: any[]) => console.warn(`⚠️  ${msg}`, ...args),
  progress: (msg: string, ...args: any[]) => console.log(`🔄 ${msg}`, ...args),
};

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Call the /crawl endpoint
 */
async function triggerCrawl(
  cities: string[],
  startDate: string,
  endDate: string
): Promise<CrawlApiResponse> {
  const url = `${CONFIG.apiUrl}/crawl`;
  const body: CrawlApiRequest = {
    cities,
    startDate,
    endDate,
    version: 'v2',
  };

  log.info(`Calling ${url}`);
  log.info(`Request body:`, JSON.stringify(body, null, 2));

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    return result as CrawlApiResponse;
  } catch (error) {
    throw new Error(`Failed to call /crawl endpoint: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ============================================================================
// DATABASE FUNCTIONS
// ============================================================================

/**
 * Create a D1Database adapter that wraps better-sqlite3
 */
function createD1Adapter(sqliteDb: Database.Database): D1Database {
  return {
    prepare: (query: string) => {
      const stmt = sqliteDb.prepare(query);
      const preparedStatement = {
        bind: (...values: any[]) => {
          const bound = stmt.bind(...values);
          return {
            bind: (...moreValues: any[]) => {
              return stmt.bind(...values, ...moreValues);
            },
            first: <T = unknown>() => {
              try {
                return bound.get() as T | null;
              } catch (err: any) {
                throw err;
              }
            },
            run: () => {
              try {
                bound.run();
                return { success: true, meta: {} };
              } catch (err: any) {
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
                return bound.raw(true).all() as unknown[][];
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
            throw err;
          }
        },
        all: <T = unknown>() => ({ results: stmt.all() as T[] }),
        raw: () => stmt.raw(true).all() as unknown[][],
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
    withSession: (sessionId: string) => {
      return createD1Adapter(sqliteDb);
    },
    dump: () => {
      return new ArrayBuffer(0);
    },
  } as unknown as D1Database;
}

/**
 * Parse .dev.vars file
 */
function parseDevVars(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const vars: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const [key, ...valueParts] = trimmed.split('=');
    if (key && valueParts.length > 0) {
      let value = valueParts.join('=').trim();
      // Remove quotes if present
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      vars[key.trim()] = value;
    }
  }

  return vars;
}

/**
 * Get D1 database connection from local SQLite file
 */
function getD1Binding(): D1Database {
  // Check environment variable first, then try .dev.vars file
  let dbPath = CONFIG.localDbPath;

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

  log.info(`📂 Connecting to local database: ${resolvedPath}`);

  // Open SQLite database
  const sqliteDb = new Database(resolvedPath);

  // Create D1 adapter
  const d1Db = createD1Adapter(sqliteDb);

  log.success('Connected to local D1 database');
  return d1Db;
}

/**
 * Setup database connection
 */
function setupDatabase() {
  const d1 = getD1Binding();
  const db = drizzle(d1, { schema });
  return db;
}

/**
 * Check city status in database
 */
async function checkCityStatus(
  db: ReturnType<typeof drizzle>,
  spiderId: string,
  territoryId: string,
  startDate: string,
  endDate: string
): Promise<CityStatus> {
  const status: CityStatus = {
    spiderId,
    territoryId,
    gazetteCount: 0,
    gazettes: [],
    ocrResults: [],
    complete: false,
  };

  try {
    // Get gazettes for this spider in the date range
    const gazettes = await db
      .select({
        id: schema.gazetteRegistry.id,
        publicationDate: schema.gazetteRegistry.publicationDate,
        pdfUrl: schema.gazetteRegistry.pdfUrl,
      })
      .from(schema.gazetteRegistry)
      .innerJoin(
        schema.gazetteCrawls,
        eq(schema.gazetteCrawls.gazetteId, schema.gazetteRegistry.id)
      )
      .where(
        and(
          like(schema.gazetteCrawls.spiderId, `${spiderId}%`),
          eq(schema.gazetteCrawls.territoryId, territoryId),
          gte(schema.gazetteRegistry.publicationDate, startDate),
          lte(schema.gazetteRegistry.publicationDate, endDate)
        )
      );

    status.gazetteCount = gazettes.length;
    status.gazettes = gazettes.map(g => ({
      id: g.id,
      publicationDate: g.publicationDate,
      pdfUrl: g.pdfUrl,
    }));

    // For each gazette, check OCR results
    for (const gazette of gazettes) {
      const ocrResults = await db
        .select({
          id: schema.ocrResults.id,
          extractedText: schema.ocrResults.extractedText,
          textLength: schema.ocrResults.textLength,
          processingMethod: schema.ocrResults.processingMethod,
          metadata: schema.ocrResults.metadata,
        })
        .from(schema.ocrResults)
        .where(
          and(
            eq(schema.ocrResults.documentType, 'gazette_registry'),
            eq(schema.ocrResults.documentId, gazette.id)
          )
        );

      for (const ocr of ocrResults) {
        // Check if OCR is in markdown format
        const hasMarkdown: boolean = ocr.processingMethod === 'mistral' ||
                           (!!ocr.metadata && ocr.metadata.includes('markdown'));
        
        // Check if OCR text contains "Diário Oficial"
        const hasDiarioOficial: boolean = ocr.extractedText.toLowerCase().includes('diário oficial');

        status.ocrResults.push({
          id: ocr.id,
          gazetteId: gazette.id,
          textLength: ocr.textLength,
          hasMarkdown,
          hasDiarioOficial,
        });
      }
    }

    // Check if complete: at least 1 gazette with valid OCR
    const validOcrResults = status.ocrResults.filter(
      ocr => ocr.hasMarkdown && ocr.hasDiarioOficial
    );
    status.complete = status.gazetteCount > 0 && validOcrResults.length > 0;

  } catch (error) {
    log.error(`Error checking status for ${spiderId}:`, error instanceof Error ? error.message : String(error));
  }

  return status;
}

/**
 * Monitor all cities until completion or timeout
 */
async function monitorCities(
  db: ReturnType<typeof drizzle>,
  cities: CityConfig[],
  startDate: string,
  endDate: string,
  timeoutMs: number
): Promise<Map<string, CityStatus>> {
  const startTime = Date.now();
  const statuses = new Map<string, CityStatus>();

  log.info(`Starting monitoring for ${cities.length} cities...`);
  log.info(`Timeout: ${formatDuration(timeoutMs)}`);
  log.info(`Poll interval: ${formatDuration(CONFIG.pollInterval)}`);
  log.info('');

  while (Date.now() - startTime < timeoutMs) {
    const elapsed = Date.now() - startTime;
    const remaining = timeoutMs - elapsed;

    log.progress(`Checking status... (${formatDuration(elapsed)} elapsed, ${formatDuration(remaining)} remaining)`);

    // Check status for all cities
    let allComplete = true;
    for (const city of cities) {
      const status = await checkCityStatus(
        db,
        city.spiderId,
        city.territoryId,
        startDate,
        endDate
      );
      
      statuses.set(city.spiderId, status);

      if (!status.complete) {
        allComplete = false;
      }

      // Log progress
      const ocrCount = status.ocrResults.length;
      const validOcrCount = status.ocrResults.filter(
        ocr => ocr.hasMarkdown && ocr.hasDiarioOficial
      ).length;

      log.info(
        `  ${city.spiderId}: ${status.gazetteCount} gazettes, ${ocrCount} OCR results (${validOcrCount} valid)`
      );
    }

    log.info('');

    if (allComplete) {
      log.success('All cities complete!');
      break;
    }

    // Wait before next poll
    if (Date.now() - startTime < timeoutMs) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.pollInterval));
    }
  }

  const totalElapsed = Date.now() - startTime;
  if (totalElapsed >= timeoutMs) {
    log.warn(`Timeout reached after ${formatDuration(totalElapsed)}`);
  } else {
    log.success(`Completed in ${formatDuration(totalElapsed)}`);
  }

  return statuses;
}

// ============================================================================
// RESULT PROCESSING
// ============================================================================

/**
 * Categorize results into successful/failed/noResults
 */
function categorizeResults(
  cities: CityConfig[],
  statuses: Map<string, CityStatus>,
  timedOut: boolean
): TestResult {
  const successful: SuccessfulCity[] = [];
  const failed: FailedCity[] = [];
  const noResults: NoResultCity[] = [];

  for (const city of cities) {
    const status = statuses.get(city.spiderId);

    if (!status) {
      noResults.push({
        spiderId: city.spiderId,
        territoryId: city.territoryId,
        reason: 'No status information available',
      });
      continue;
    }

    // Check if we have gazettes
    if (status.gazetteCount === 0) {
      noResults.push({
        spiderId: city.spiderId,
        territoryId: city.territoryId,
        reason: 'No gazettes found in the specified period',
      });
      continue;
    }

    // Check if we have OCR results
    if (status.ocrResults.length === 0) {
      failed.push({
        spiderId: city.spiderId,
        territoryId: city.territoryId,
        reason: 'Gazettes found but no OCR results',
        gazetteCount: status.gazetteCount,
        hasGazette: true,
        hasOcr: false,
      });
      continue;
    }

    // Check if OCR results are valid
    const validOcrResults = status.ocrResults.filter(
      ocr => ocr.hasMarkdown && ocr.hasDiarioOficial
    );

    if (validOcrResults.length === 0) {
      const issues: string[] = [];
      const missingMarkdown = status.ocrResults.filter(ocr => !ocr.hasMarkdown).length;
      const missingDiario = status.ocrResults.filter(ocr => !ocr.hasDiarioOficial).length;

      if (missingMarkdown > 0) {
        issues.push(`${missingMarkdown} OCR results not in markdown format`);
      }
      if (missingDiario > 0) {
        issues.push(`${missingDiario} OCR results missing "Diário Oficial" text`);
      }

      failed.push({
        spiderId: city.spiderId,
        territoryId: city.territoryId,
        reason: 'OCR results found but validation failed',
        gazetteCount: status.gazetteCount,
        hasGazette: true,
        hasOcr: true,
        ocrIssue: issues.join('; '),
      });
      continue;
    }

    // Success!
    successful.push({
      spiderId: city.spiderId,
      territoryId: city.territoryId,
      gazetteCount: status.gazetteCount,
      ocrResults: validOcrResults,
    });
  }

  return {
    successful,
    failed,
    noResults,
    summary: {
      totalCities: cities.length,
      successful: successful.length,
      failed: failed.length,
      noResults: noResults.length,
      executionTimeMs: 0, // Will be set by caller
      timedOut,
    },
  };
}

// ============================================================================
// OUTPUT FUNCTIONS
// ============================================================================

/**
 * Display results in console
 */
function displayResults(result: TestResult): void {
  console.log('\n' + '='.repeat(80));
  console.log('TEST RESULTS');
  console.log('='.repeat(80) + '\n');

  // Summary
  console.log('📊 SUMMARY');
  console.log('─'.repeat(40));
  console.log(`Total cities tested: ${result.summary.totalCities}`);
  console.log(`✅ Successful: ${result.summary.successful}`);
  console.log(`❌ Failed: ${result.summary.failed}`);
  console.log(`⚠️  No results: ${result.summary.noResults}`);
  console.log(`⏱️  Execution time: ${formatDuration(result.summary.executionTimeMs)}`);
  console.log(`⏰ Timed out: ${result.summary.timedOut ? 'Yes' : 'No'}`);
  console.log('');

  // Successful cities
  if (result.successful.length > 0) {
    console.log('✅ SUCCESSFUL CITIES');
    console.log('─'.repeat(40));
    for (const city of result.successful) {
      console.log(`\n${city.spiderId} (${city.territoryId})`);
      console.log(`  Gazettes: ${city.gazetteCount}`);
      console.log(`  Valid OCR results: ${city.ocrResults.length}`);
      for (const ocr of city.ocrResults) {
        console.log(`    - OCR ${ocr.id.substring(0, 8)}... (${ocr.textLength} chars, gazette: ${ocr.gazetteId.substring(0, 8)}...)`);
      }
    }
    console.log('');
  }

  // Failed cities
  if (result.failed.length > 0) {
    console.log('❌ FAILED CITIES');
    console.log('─'.repeat(40));
    for (const city of result.failed) {
      console.log(`\n${city.spiderId} (${city.territoryId})`);
      console.log(`  Reason: ${city.reason}`);
      console.log(`  Gazettes found: ${city.gazetteCount}`);
      console.log(`  Has gazette: ${city.hasGazette ? 'Yes' : 'No'}`);
      console.log(`  Has OCR: ${city.hasOcr ? 'Yes' : 'No'}`);
      if (city.ocrIssue) {
        console.log(`  OCR issue: ${city.ocrIssue}`);
      }
    }
    console.log('');
  }

  // No results cities
  if (result.noResults.length > 0) {
    console.log('⚠️  NO RESULTS');
    console.log('─'.repeat(40));
    for (const city of result.noResults) {
      console.log(`\n${city.spiderId} (${city.territoryId})`);
      console.log(`  Reason: ${city.reason}`);
    }
    console.log('');
  }

  console.log('='.repeat(80) + '\n');
}

/**
 * Save results to JSON file
 */
function saveResults(result: TestResult, filename: string): void {
  const outputPath = join(process.cwd(), filename);
  writeFileSync(outputPath, JSON.stringify(result, null, 2));
  
  log.success(`Results saved to ${outputPath}`);
}

// ============================================================================
// CLI FUNCTIONS
// ============================================================================

/**
 * Parse command line arguments
 */
function parseArgs(): {
  cities: CityConfig[];
  timeout: number;
  outputFile?: string;
  apiUrl?: string;
  dbPath?: string;
  days?: number;
  help: boolean;
} {
  const args = process.argv.slice(2);
  let cities = DEFAULT_CITIES;
  let timeout = CONFIG.timeout;
  let outputFile: string | undefined;
  let apiUrl: string | undefined;
  let dbPath: string | undefined;
  let days: number | undefined;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--cities':
        const cityIds = args[++i].split(',');
        cities = cityIds.map(id => resolveCityConfig(id.trim()));
        break;

      case '--timeout':
        timeout = parseInt(args[++i]) * 60 * 1000; // Convert minutes to ms
        break;

      case '--output':
        outputFile = args[++i];
        break;

      case '--api-url':
        apiUrl = args[++i];
        break;

      case '--db-path':
        dbPath = args[++i];
        break;

      case '--days':
        days = parseInt(args[++i]);
        break;

      case '--help':
      case '-h':
        help = true;
        break;
    }
  }

  return { cities, timeout, outputFile, apiUrl, dbPath, days, help };
}

/**
 * Show help message
 */
function showHelp(): void {
  console.log(`
🧪 V2 SPIDER TESTING SCRIPT

Tests the complete v2 spider crawl → OCR pipeline for specified cities.
City IDs (e.g. ac_acrelandia) are automatically resolved to their IBGE
territory IDs from the v2 config files in src/spiders/v2/configs/.

USAGE:
  npx tsx scripts/v2-test-until-ocr.ts [OPTIONS]

OPTIONS:
  --cities <ids>        Comma-separated list of city IDs (default: ${DEFAULT_CITIES.map(c => c.spiderId).join(',')})
  --api-url <url>       API endpoint URL (default: http://localhost:8787)
  --db-path <path>      Path to local SQLite database file (default: from .dev.vars)
  --days <n>            Number of days to check (default: 10)
  --timeout <minutes>   Timeout in minutes (default: 15)
  --output <file>       Save results to JSON file (default: display only)
  --help, -h           Show this help message

ENVIRONMENT VARIABLES:
  API_URL              API endpoint URL (overridden by --api-url)
  LOCAL_DB_PATH        Path to local SQLite database file (overridden by --db-path)

EXAMPLES:
  # Test default cities
  npx tsx scripts/v2-test-until-ocr.ts

  # Test AC cities against local dev server
  npx tsx scripts/v2-test-until-ocr.ts --cities ac_acrelandia,ac_rio_branco --api-url http://localhost:8787

  # Test with explicit DB path and last 5 days
  npx tsx scripts/v2-test-until-ocr.ts --cities ac_rio_branco --db-path .wrangler/state/v3/d1/miniflare-D1DatabaseObject/abc123.sqlite --days 5

  # Test specific cities with custom timeout
  npx tsx scripts/v2-test-until-ocr.ts --cities sp_3550308,rj_3304557 --timeout 20

  # Save results to file
  npx tsx scripts/v2-test-until-ocr.ts --output test-results.json

  # Test against production
  npx tsx scripts/v2-test-until-ocr.ts --api-url https://worker.example.com
`);
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

async function main(): Promise<void> {
  const startTime = Date.now();

  // Parse arguments
  const { cities, timeout, outputFile, apiUrl, dbPath, days, help } = parseArgs();

  if (apiUrl) {
    CONFIG.apiUrl = apiUrl;
  }
  if (dbPath) {
    CONFIG.localDbPath = dbPath;
  }
  if (days) {
    CONFIG.daysToCheck = days;
  }

  if (help) {
    showHelp();
    process.exit(0);
  }

  console.log('\n' + '='.repeat(80));
  console.log('🧪 V2 SPIDER TESTING SCRIPT');
  console.log('='.repeat(80) + '\n');

  log.info(`API URL: ${CONFIG.apiUrl}`);
  log.info(`Cities to test: ${cities.length}`);
  log.info(`Timeout: ${formatDuration(timeout)}`);
  log.info('');

  log.info('Resolved city configurations:');
  for (const city of cities) {
    const resolved = city.spiderId !== city.territoryId ? `→ territory ${city.territoryId}` : '(no v2 config found, using as-is)';
    log.info(`  ${city.spiderId} ${resolved}`);
  }
  log.info('');

  try {
    // Calculate date range
    const { startDate, endDate } = getDateRange(CONFIG.daysToCheck);
    log.info(`Date range: ${startDate} to ${endDate} (last ${CONFIG.daysToCheck} days)`);
    log.info('');

    // Setup database connection
    log.info('Setting up database connection...');
    const db = setupDatabase();
    log.info('');

    // Trigger crawl
    log.info('Triggering crawl...');
    const crawlResponse = await triggerCrawl(
      cities.map(c => c.spiderId),
      startDate,
      endDate
    );

    if (!crawlResponse.success) {
      throw new Error(`Crawl failed: ${crawlResponse.error}`);
    }

    log.success(`Crawl triggered successfully!`);
    log.info(`Tasks enqueued: ${crawlResponse.tasksEnqueued}`);
    log.info(`Crawl job ID: ${crawlResponse.crawlJobId}`);
    log.info('');

    // Monitor cities
    const statuses = await monitorCities(db, cities, startDate, endDate, timeout);

    // Categorize results
    const timedOut = Date.now() - startTime >= timeout;
    const result = categorizeResults(cities, statuses, timedOut);
    result.summary.executionTimeMs = Date.now() - startTime;

    // Display results
    displayResults(result);

    // Save to file if requested
    if (outputFile) {
      saveResults(result, outputFile);
    }

    // Exit with appropriate code
    const exitCode = result.summary.successful === result.summary.totalCities ? 0 : 1;
    process.exit(exitCode);

  } catch (error) {
    log.error('Test failed:', error instanceof Error ? error.message : String(error));
    
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    
    process.exit(1);
  }
}

// ============================================================================
// ENTRY POINT
// ============================================================================

// Check if this script is being run directly (ES module compatible)
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('v2-test-until-ocr.ts') ||
  process.argv[1].endsWith('v2-test-until-ocr.js')
);

if (isMainModule) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

export { main, checkCityStatus, categorizeResults };
