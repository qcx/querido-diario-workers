#!/usr/bin/env tsx

/**
 * Disable Old Workers Script
 * Provides instructions for disabling old worker queue consumers
 */

console.log('🔧 DISABLE OLD WORKER QUEUE CONSUMERS');
console.log('═'.repeat(60));
console.log('');
console.log('This script provides instructions for safely disabling');
console.log('old worker queue consumers while Goodfellow takes over.');
console.log('');
console.log('⚠️  IMPORTANT: Do this AFTER Goodfellow is deployed and stable');
console.log('');

console.log('📋 DISABLE ORDER (one at a time, 30 min apart):');
console.log('');

console.log('1️⃣  WEBHOOK WORKER');
console.log('   Via Cloudflare Dashboard:');
console.log('   - Go to Workers & Pages → querido-diario-webhook-worker');
console.log('   - Settings → Triggers → Queue Consumers');
console.log('   - Disable "querido-diario-webhook-queue" consumer');
console.log('   ⏰ Wait 30 minutes and monitor');
console.log('');

console.log('2️⃣  ANALYSIS WORKER');
console.log('   Via Cloudflare Dashboard:');
console.log('   - Go to Workers & Pages → querido-diario-analysis-worker');
console.log('   - Settings → Triggers → Queue Consumers');
console.log('   - Disable "querido-diario-analysis-queue" consumer');
console.log('   ⏰ Wait 30 minutes and monitor');
console.log('');

console.log('3️⃣  OCR WORKER');
console.log('   Via Cloudflare Dashboard:');
console.log('   - Go to Workers & Pages → querido-diario-ocr-worker');
console.log('   - Settings → Triggers → Queue Consumers');
console.log('   - Disable "gazette-ocr-queue" consumer');
console.log('   ⏰ Wait 30 minutes and monitor');
console.log('');

console.log('4️⃣  MAIN WORKER (Queue only - keep HTTP)');
console.log('   Via Cloudflare Dashboard:');
console.log('   - Go to Workers & Pages → querido-diario-worker');
console.log('   - Settings → Triggers → Queue Consumers');
console.log('   - Disable "gazette-crawl-queue" consumer');
console.log('   - Keep HTTP routes active for now');
console.log('   ⏰ Wait 30 minutes and monitor');
console.log('');

console.log('5️⃣  ROUTE HTTP TRAFFIC TO GOODFELLOW');
console.log('   Update your routes/DNS to point to:');
console.log('   - goodfellow-prod.qconcursos.workers.dev');
console.log('   OR');
console.log('   - Update routes in Cloudflare dashboard');
console.log('');

console.log('✅ MONITORING CHECKLIST:');
console.log('   □ Check queue depths remain normal');
console.log('   □ Verify Goodfellow is processing messages');
console.log('   □ Check error rates in Cloudflare analytics');
console.log('   □ Monitor database for new records');
console.log('   □ Verify webhooks are being delivered');
console.log('');

console.log('📚 See GOODFELLOW_MIGRATION_GUIDE.md for detailed instructions');
