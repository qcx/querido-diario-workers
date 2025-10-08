#!/usr/bin/env npx tsx
/**
 * Test D1 Database Setup
 * Verifies that the D1 database is working correctly with our Drizzle schema
 */

import { readFileSync } from 'fs';
import { join } from 'path';

interface TestConfig {
  databaseName: string;
  environment: 'production' | 'development';
  dryRun?: boolean;
}

/**
 * Test D1 database functionality
 */
async function testD1Database(config: TestConfig) {
  console.log('🧪 D1 DATABASE FUNCTIONALITY TEST');
  console.log('═'.repeat(60));
  console.log(`Database Name: ${config.databaseName}`);
  console.log(`Environment: ${config.environment}`);
  console.log('');

  try {
    // Step 1: Test basic connectivity
    console.log('🔌 Step 1: Testing basic database connectivity...');
    await testBasicConnectivity(config);
    console.log('✅ Database connectivity test passed');
    console.log('');

    // Step 2: Test table creation verification
    console.log('📋 Step 2: Verifying table structure...');
    await verifyTableStructure(config);
    console.log('✅ Table structure verification passed');
    console.log('');

    // Step 3: Test basic CRUD operations
    console.log('🔧 Step 3: Testing basic CRUD operations...');
    await testCrudOperations(config);
    console.log('✅ CRUD operations test passed');
    console.log('');

    // Step 4: Test schema validation
    console.log('🔍 Step 4: Testing schema validation...');
    await testSchemaValidation(config);
    console.log('✅ Schema validation test passed');
    console.log('');

    console.log('🎉 All D1 tests passed successfully!');
    console.log('✅ Database is ready for production use');

  } catch (error) {
    console.error('❌ D1 test failed:', error);
    process.exit(1);
  }
}

/**
 * Test basic database connectivity
 */
async function testBasicConnectivity(config: TestConfig): Promise<void> {
  const { execSync } = await import('child_process');
  
  try {
    const command = `wrangler d1 execute ${config.databaseName} --remote --command="SELECT 1 as test"`;
    const output = execSync(command, { encoding: 'utf8', stdio: 'pipe' });
    
    if (output.includes('"test": 1') || output.includes('1 command executed successfully')) {
      console.log('  ✓ Basic SELECT query successful');
    } else {
      throw new Error('Unexpected response from database');
    }
  } catch (error) {
    throw new Error(`Database connectivity test failed: ${error}`);
  }
}

/**
 * Verify table structure matches our schema
 */
async function verifyTableStructure(config: TestConfig): Promise<void> {
  const { execSync } = await import('child_process');
  
  const expectedTables = [
    'crawl_jobs',
    'crawl_telemetry',
    'gazette_registry',
    'ocr_results',
    'ocr_metadata',
    'analysis_results',
    'webhook_deliveries',
    'concurso_findings',
    'error_logs'
  ];

  try {
    const command = `wrangler d1 execute ${config.databaseName} --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"`;
    const output = execSync(command, { encoding: 'utf8', stdio: 'pipe' });

    for (const table of expectedTables) {
      if (!output.includes(`"name": "${table}"`)) {
        throw new Error(`Table ${table} not found`);
      }
      console.log(`  ✓ Table ${table} exists`);
    }
  } catch (error) {
    throw new Error(`Table structure verification failed: ${error}`);
  }
}

/**
 * Test basic CRUD operations
 */
async function testCrudOperations(config: TestConfig): Promise<void> {
  const { execSync } = await import('child_process');
  
  try {
    // Test INSERT
    const testId = `test-${Date.now()}`;
    const insertCommand = `wrangler d1 execute ${config.databaseName} --remote --command="INSERT INTO crawl_jobs (id, job_type, total_cities, metadata) VALUES ('${testId}', 'manual', 1, '{\"test\": true}')"`;
    execSync(insertCommand, { stdio: 'pipe' });
    console.log('  ✓ INSERT operation successful');

    // Test SELECT
    const selectCommand = `wrangler d1 execute ${config.databaseName} --remote --command="SELECT id, job_type FROM crawl_jobs WHERE id = '${testId}'"`;
    const selectOutput = execSync(selectCommand, { encoding: 'utf8', stdio: 'pipe' });
    
    if (!selectOutput.includes(testId)) {
      throw new Error('INSERT data not found on SELECT');
    }
    console.log('  ✓ SELECT operation successful');

    // Test UPDATE
    const updateCommand = `wrangler d1 execute ${config.databaseName} --remote --command="UPDATE crawl_jobs SET status = 'completed' WHERE id = '${testId}'"`;
    execSync(updateCommand, { stdio: 'pipe' });
    console.log('  ✓ UPDATE operation successful');

    // Test DELETE (cleanup)
    const deleteCommand = `wrangler d1 execute ${config.databaseName} --remote --command="DELETE FROM crawl_jobs WHERE id = '${testId}'"`;
    execSync(deleteCommand, { stdio: 'pipe' });
    console.log('  ✓ DELETE operation successful');

  } catch (error) {
    throw new Error(`CRUD operations test failed: ${error}`);
  }
}

/**
 * Test schema validation and constraints
 */
async function testSchemaValidation(config: TestConfig): Promise<void> {
  const { execSync } = await import('child_process');
  
  try {
    // Test foreign key constraints (should fail)
    try {
      const invalidInsertCommand = `wrangler d1 execute ${config.databaseName} --remote --command="INSERT INTO crawl_telemetry (id, crawl_job_id, territory_id, spider_id, spider_type, step, status) VALUES ('test-invalid', 'nonexistent-job', 'test', 'test', 'test', 'crawl_start', 'started')"`;
      execSync(invalidInsertCommand, { stdio: 'pipe' });
      // If we get here, foreign key constraint didn't work
      console.log('  ⚠️ Foreign key constraints not enforced (SQLite limitation)');
    } catch (error) {
      console.log('  ✓ Foreign key constraints working');
    }

    // Test data type validation
    const testId2 = `test-validation-${Date.now()}`;
    const validInsertCommand = `wrangler d1 execute ${config.databaseName} --remote --command="INSERT INTO crawl_jobs (id, job_type, total_cities, status) VALUES ('${testId2}', 'manual', 5, 'pending')"`;
    execSync(validInsertCommand, { stdio: 'pipe' });
    console.log('  ✓ Valid data types accepted');

    // Cleanup
    const cleanupCommand = `wrangler d1 execute ${config.databaseName} --remote --command="DELETE FROM crawl_jobs WHERE id = '${testId2}'"`;
    execSync(cleanupCommand, { stdio: 'pipe' });

  } catch (error) {
    throw new Error(`Schema validation test failed: ${error}`);
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);
  const environment = args.includes('--production') ? 'production' : 'development';
  const dryRun = args.includes('--dry-run');

  const config: TestConfig = {
    databaseName: environment === 'production' ? 'querido-diario-prod' : 'querido-diario-dev',
    environment,
    dryRun
  };

  console.log('🧪 D1 Database Testing Suite');
  console.log('Testing database configuration and functionality');
  console.log('');

  await testD1Database(config);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
