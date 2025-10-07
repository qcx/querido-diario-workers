/**
 * Verify Database Improvements Script
 * Checks if all database improvements are working correctly
 */

async function verifyDatabaseImprovements() {
  console.log('🔍 DATABASE IMPROVEMENTS VERIFICATION');
  console.log('=====================================\n');

  const queries = [
    {
      name: 'OCR Metadata Population',
      query: `
        SELECT 
          COUNT(*) as total_records,
          COUNT(CASE WHEN status = 'success' THEN 1 END) as successful,
          COUNT(CASE WHEN status = 'failure' THEN 1 END) as failed,
          AVG(processing_time_ms) as avg_processing_time_ms,
          MAX(completed_at) as last_processed
        FROM ocr_metadata
        WHERE completed_at > NOW() - INTERVAL '1 day'
      `,
      check: (result: any) => result.total_records > 0,
      message: (result: any) => 
        result.total_records > 0 
          ? `✅ Found ${result.total_records} OCR metadata records (${result.successful} successful, ${result.failed} failed)`
          : '❌ No OCR metadata records found - table not being populated'
    },
    {
      name: 'Duplicate Analysis Prevention',
      query: `
        SELECT 
          ocr_job_id, 
          COUNT(*) as duplicate_count,
          array_agg(job_id) as analysis_job_ids
        FROM analysis_results 
        GROUP BY ocr_job_id 
        HAVING COUNT(*) > 1
        ORDER BY duplicate_count DESC
        LIMIT 5
      `,
      check: (result: any) => result.length === 0,
      message: (result: any) => 
        result.length === 0 
          ? '✅ No duplicate analysis records found'
          : `❌ Found ${result.length} OCR jobs with duplicate analysis: ${result.map((r: any) => r.ocr_job_id).join(', ')}`
    },
    {
      name: 'Crawl Job Completion Status',
      query: `
        SELECT 
          id,
          status,
          total_cities,
          completed_cities,
          failed_cities,
          CASE 
            WHEN status = 'completed' AND completed_at IS NULL THEN 'Missing completion time'
            WHEN status = 'running' AND created_at < NOW() - INTERVAL '2 hours' THEN 'Stuck in running'
            ELSE 'OK'
          END as issue
        FROM crawl_jobs
        WHERE created_at > NOW() - INTERVAL '1 day'
        ORDER BY created_at DESC
      `,
      check: (result: any) => result.every((r: any) => r.issue === 'OK'),
      message: (result: any) => {
        const issues = result.filter((r: any) => r.issue !== 'OK');
        return issues.length === 0
          ? `✅ All ${result.length} crawl jobs have correct status`
          : `❌ Found ${issues.length} crawl jobs with issues: ${issues.map((r: any) => `${r.id} (${r.issue})`).join(', ')}`;
      }
    },
    {
      name: 'Territory ID in Concurso Findings',
      query: `
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN territory_id = 'unknown' THEN 1 END) as unknown_territory,
          COUNT(CASE WHEN territory_id != 'unknown' THEN 1 END) as valid_territory,
          array_agg(DISTINCT territory_id) as territories
        FROM concurso_findings
        WHERE created_at > NOW() - INTERVAL '1 day'
      `,
      check: (result: any) => result.unknown_territory === 0,
      message: (result: any) => 
        result.total === 0 
          ? '⚠️  No concurso findings in the last day to verify'
          : result.unknown_territory === 0
            ? `✅ All ${result.total} concurso findings have valid territory IDs: ${result.territories.join(', ')}`
            : `❌ Found ${result.unknown_territory} of ${result.total} concurso findings with 'unknown' territory ID`
    },
    {
      name: 'Webhook Deliveries (if subscriptions exist)',
      query: `
        SELECT 
          COUNT(*) as total_deliveries,
          COUNT(CASE WHEN status = 'sent' THEN 1 END) as successful,
          COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
          COUNT(DISTINCT subscription_id) as active_subscriptions
        FROM webhook_deliveries
        WHERE created_at > NOW() - INTERVAL '1 day'
      `,
      check: (result: any) => true, // Always pass, just informational
      message: (result: any) => 
        result.total_deliveries === 0
          ? '⚠️  No webhook deliveries found - check if subscriptions are configured'
          : `✅ Found ${result.total_deliveries} webhook deliveries (${result.successful} successful, ${result.failed} failed) for ${result.active_subscriptions} subscriptions`
    }
  ];

  console.log('Running verification queries...\n');

  for (const { name, query, check, message } of queries) {
    console.log(`📊 ${name}:`);
    console.log(`Query preview: ${query.trim().split('\\n')[0]}...`);
    console.log('Result: [Would execute query in production]');
    console.log('Status: [Would show pass/fail based on check function]');
    console.log('');
  }

  console.log('\n📋 VERIFICATION SQL QUERIES:');
  console.log('============================');
  console.log('Copy and run these queries in your database:\n');

  queries.forEach(({ name, query }, index) => {
    console.log(`-- ${index + 1}. ${name}`);
    console.log(query.trim());
    console.log('');
  });
}

// Display the verification info
verifyDatabaseImprovements();
