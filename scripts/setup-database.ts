#!/usr/bin/env npx tsx
/**
 * Database Connection Test
 * Test the database connection using the postgres package directly
 */

import postgres from 'postgres';

const PROJECT_ID = 'kdeughydterrjgadogqy';
const DB_HOST = `db.${PROJECT_ID}.supabase.co`;
const DB_PORT = '5432';
const DB_NAME = 'postgres';
const DB_USER = 'postgres';

// Note: You need to set the SUPABASE_DB_PASSWORD environment variable
const DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD;

if (!DB_PASSWORD) {
  console.error('❌ Please set SUPABASE_DB_PASSWORD environment variable');
  console.error('   export SUPABASE_DB_PASSWORD="your-db-password"');
  process.exit(1);
}

const CONNECTION_STRING = `postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;

async function testConnection() {
  console.log('🔍 Testing database connection...');
  console.log(`Host: ${DB_HOST}`);
  console.log(`Database: ${DB_NAME}`);
  
  const sql = postgres(CONNECTION_STRING, {
    max: 1, // Single connection for testing
    idle_timeout: 20,
  });

  try {
    // Test basic connectivity
    const result = await sql`SELECT 1 as test, NOW() as timestamp`;
    console.log('✅ Database connection successful!');
    console.log('Response:', result[0]);

    // Test our schema
    console.log('\n🔍 Checking database schema...');
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('crawl_jobs', 'gazette_registry', 'ocr_results', 'analysis_results')
      ORDER BY table_name
    `;
    
    console.log('✅ Found tables:', tables.map(t => t.table_name).join(', '));
    
    // Test a simple insert/select
    console.log('\n🔍 Testing basic operations...');
    const testJob = await sql`
      INSERT INTO crawl_jobs (job_type, total_cities, metadata)
      VALUES ('manual', 1, '{"test": true}')
      RETURNING id, created_at
    `;
    
    console.log('✅ Insert test successful:', testJob[0]);
    
    // Clean up test data
    await sql`DELETE FROM crawl_jobs WHERE id = ${testJob[0].id}`;
    console.log('✅ Cleanup completed');

  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  } finally {
    await sql.end();
  }

  console.log('\n🎉 Database is ready for production!');
  console.log('\n📋 To set secrets for workers:');
  console.log(`export DATABASE_URL="${CONNECTION_STRING.replace(DB_PASSWORD, '[YOUR_PASSWORD]')}"`);
  console.log('wrangler secret put DATABASE_URL --config wrangler.jsonc');
  console.log('wrangler secret put DATABASE_URL --config wrangler-ocr.jsonc');
  console.log('wrangler secret put DATABASE_URL --config wrangler-analysis.jsonc');
  console.log('wrangler secret put DATABASE_URL --config wrangler-webhook.jsonc');
}

// ES module - always run when executed directly
testConnection();
