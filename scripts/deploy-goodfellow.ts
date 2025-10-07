#!/usr/bin/env tsx

/**
 * Goodfellow Deployment Script
 * Handles staged deployment of the unified worker
 */

import { execSync } from 'child_process';

interface DeploymentConfig {
  environment: 'staging' | 'production';
  skipSecrets?: boolean;
  dryRun?: boolean;
}

const REQUIRED_SECRETS = [
  'MISTRAL_API_KEY',
  'OPENAI_API_KEY',
  'DATABASE_URL'
];

async function deployGoodfellow(config: DeploymentConfig) {
  console.log('🚀 GOODFELLOW DEPLOYMENT');
  console.log('═'.repeat(60));
  console.log(`Environment: ${config.environment}`);
  console.log(`Dry Run: ${config.dryRun ? 'YES' : 'NO'}`);
  console.log('');

  // Step 1: Verify secrets
  if (!config.skipSecrets) {
    console.log('📝 Step 1: Verifying secrets...');
    for (const secret of REQUIRED_SECRETS) {
      console.log(`  Checking ${secret}...`);
      // Note: We can't actually read secrets, but we can warn the user
      console.log(`  ⚠️  Make sure ${secret} is set via: wrangler secret put ${secret} --config wrangler-goodfellow.jsonc --env ${config.environment}`);
    }
    console.log('');
  }

  // Step 2: Build TypeScript
  console.log('🔨 Step 2: Building TypeScript...');
  if (!config.dryRun) {
    try {
      execSync('bun run build', { stdio: 'inherit' });
      console.log('✅ Build successful');
    } catch (error) {
      console.error('❌ Build failed');
      process.exit(1);
    }
  } else {
    console.log('⏭️  Skipped (dry run)');
  }
  console.log('');

  // Step 3: Deploy worker
  console.log('🚢 Step 3: Deploying Goodfellow worker...');
  if (!config.dryRun) {
    try {
      const deployCmd = config.environment === 'production'
        ? 'bun run goodfellow:deploy:production'
        : 'bun run goodfellow:deploy:staging';
      
      execSync(deployCmd, { stdio: 'inherit' });
      console.log('✅ Deployment successful');
    } catch (error) {
      console.error('❌ Deployment failed');
      process.exit(1);
    }
  } else {
    console.log('⏭️  Skipped (dry run)');
  }
  console.log('');

  // Step 4: Verify deployment
  console.log('✓ Step 4: Verifying deployment...');
  const workerUrl = config.environment === 'production'
    ? 'https://goodfellow-prod.qconcursos.workers.dev'
    : 'https://goodfellow-staging.qconcursos.workers.dev';
  
  console.log(`  Test health check: curl ${workerUrl}/`);
  console.log(`  Test stats: curl ${workerUrl}/stats`);
  console.log(`  Test queue health: curl ${workerUrl}/health/queue`);
  console.log('');

  // Step 5: Next steps
  console.log('📋 Next Steps:');
  console.log('  1. Test the health endpoint');
  console.log('  2. Monitor queue processing in Cloudflare dashboard');
  console.log('  3. Test a small crawl job');
  console.log('  4. Monitor for 24-48 hours alongside old workers');
  console.log('  5. Gradually disable old worker queue consumers');
  console.log('');
  console.log('📚 See GOODFELLOW_MIGRATION_GUIDE.md for detailed instructions');
}

// Parse command line arguments
const args = process.argv.slice(2);
const environment = args.includes('--production') ? 'production' : 'staging';
const skipSecrets = args.includes('--skip-secrets');
const dryRun = args.includes('--dry-run');

if (args.includes('--help')) {
  console.log(`
Goodfellow Deployment Script

USAGE:
  npx tsx scripts/deploy-goodfellow.ts [OPTIONS]

OPTIONS:
  --production      Deploy to production (default: staging)
  --skip-secrets    Skip secret verification warnings
  --dry-run        Show what would be done without doing it
  --help           Show this help message

EXAMPLES:
  # Deploy to staging
  npx tsx scripts/deploy-goodfellow.ts

  # Deploy to production
  npx tsx scripts/deploy-goodfellow.ts --production

  # Dry run for production
  npx tsx scripts/deploy-goodfellow.ts --production --dry-run
`);
  process.exit(0);
}

deployGoodfellow({ environment, skipSecrets, dryRun }).catch(console.error);
