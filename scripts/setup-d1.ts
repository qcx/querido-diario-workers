#!/usr/bin/env npx tsx
/**
 * D1 Database Setup Script
 * Creates D1 database and applies schema using Cloudflare MCP
 */

import { readFileSync } from 'fs';
import { join } from 'path';

interface SetupConfig {
  databaseName: string;
  environment: 'production' | 'development' | 'staging';
  dryRun?: boolean;
}

/**
 * Setup D1 database with schema
 */
async function setupD1Database(config: SetupConfig) {
  console.log('🚀 D1 DATABASE SETUP');
  console.log('═'.repeat(60));
  console.log(`Database Name: ${config.databaseName}`);
  console.log(`Environment: ${config.environment}`);
  console.log(`Dry Run: ${config.dryRun ? 'YES' : 'NO'}`);
  console.log('');

  try {
    // Step 1: Create D1 Database
    console.log('📊 Step 1: Creating D1 Database...');
    if (!config.dryRun) {
      // Note: This would use Cloudflare MCP to create the database
      // For now, we'll provide instructions
      console.log('⚠️  Please create D1 database manually using:');
      console.log(`   wrangler d1 create ${config.databaseName}-${config.environment}`);
      console.log('   Then update wrangler.jsonc with the database_id');
    } else {
      console.log('⏭️  Skipped (dry run)');
    }
    console.log('');

    // Step 2: Apply Schema
    console.log('📝 Step 2: Applying Database Schema...');
    
    // Read the D1 schema file
    const schemaPath = join(process.cwd(), 'database', 'schema-d1.sql');
    let schemaSQL: string;
    
    try {
      schemaSQL = readFileSync(schemaPath, 'utf8');
      console.log(`✅ Schema file loaded: ${schemaPath}`);
    } catch (error) {
      throw new Error(`Failed to read schema file: ${schemaPath}`);
    }

    if (!config.dryRun) {
      console.log('⚠️  Please apply schema manually using:');
      console.log(`   wrangler d1 execute ${config.databaseName}-${config.environment} --file=database/schema-d1.sql`);
      console.log('   Or use the Cloudflare MCP tools when available');
    } else {
      console.log('⏭️  Skipped (dry run)');
    }
    console.log('');

    // Step 3: Verify Tables
    console.log('✓ Step 3: Verification Steps...');
    console.log('After applying schema, verify with:');
    console.log(`   wrangler d1 execute ${config.databaseName}-${config.environment} --command="SELECT name FROM sqlite_master WHERE type='table'"`);
    console.log('');

    // Step 4: Update Configuration
    console.log('⚙️  Step 4: Configuration Updates...');
    console.log('1. Update wrangler.jsonc with the actual database_id');
    console.log('2. Deploy workers with updated configuration');
    console.log('3. Test database connectivity');
    console.log('');

    console.log('🎉 D1 setup process completed!');
    console.log('');
    
    // Display next steps
    console.log('📋 NEXT STEPS:');
    console.log('1. Create the D1 database using wrangler CLI');
    console.log('2. Apply the schema using wrangler d1 execute');
    console.log('3. Update wrangler.jsonc with the database ID');
    console.log('4. Update repositories to use Drizzle client');
    console.log('5. Test the migration with sample data');
    console.log('');

  } catch (error) {
    console.error('❌ D1 setup failed:', error);
    process.exit(1);
  }
}

/**
 * Generate Drizzle migration files
 */
async function generateMigrations() {
  console.log('🔄 Generating Drizzle migrations...');
  
  try {
    const { execSync } = await import('child_process');
    
    // Generate migration files from schema
    execSync('bun run db:generate', { stdio: 'inherit' });
    console.log('✅ Migration files generated successfully');
    
  } catch (error) {
    console.error('❌ Failed to generate migrations:', error);
    throw error;
  }
}

/**
 * CLI interface
 */
async function main() {
  const args = process.argv.slice(2);
  const environment = args.includes('--production') ? 'production' : 
                     args.includes('--staging') ? 'staging' : 'development';
  const dryRun = args.includes('--dry-run');
  const generateOnly = args.includes('--generate-only');

  const config: SetupConfig = {
    databaseName: 'querido-diario',
    environment,
    dryRun
  };

  if (generateOnly) {
    await generateMigrations();
    return;
  }

  console.log('🔧 D1 Database Setup for Querido Diário Workers');
  console.log('');

  // Generate migrations first
  await generateMigrations();
  console.log('');

  // Then setup database
  await setupD1Database(config);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
