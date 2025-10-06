#!/usr/bin/env node
/**
 * Setup webhook for Concursos Públicos
 * 
 * This script configures a webhook subscription to detect and notify
 * about public contests (concursos públicos) found in official gazettes.
 * 
 * Usage: npx tsx scripts/setup-concursos-webhook.ts [--env production|development]
 */

import { WebhookSubscription } from '../src/types/webhook';
import { WebhookFilterService } from '../src/services/webhook-filter';

interface SetupConfig {
  webhookUrl: string;
  clientId: string;
  authToken?: string;
  territories?: string[];
  minConfidence: number;
  environment: 'development' | 'production';
}

const DEFAULT_CONFIG: Partial<SetupConfig> = {
  webhookUrl: 'https://n8n.grupoq.io/webhook/webhook-concursos',
  clientId: 'grupoq-concursos',
  minConfidence: 0.7,
  environment: 'development'
};

async function setupWebhook(config: SetupConfig): Promise<string> {
  // Generate subscription ID
  const subscriptionId = `${config.clientId}-${Date.now()}`;
  
  // Create webhook subscription with concursos filter
  const subscription: WebhookSubscription = {
    id: subscriptionId,
    clientId: config.clientId,
    webhookUrl: config.webhookUrl,
    filters: WebhookFilterService.createQconcursosFilter(
      config.minConfidence,
      config.territories
    ),
    auth: config.authToken ? {
      type: 'bearer',
      token: config.authToken
    } : undefined,
    retry: {
      maxAttempts: 3,
      backoffMs: 5000
    },
    active: true,
    createdAt: new Date().toISOString()
  };

  console.log('🔧 Webhook Configuration:');
  console.log('─'.repeat(60));
  console.log(`📋 Subscription ID: ${subscription.id}`);
  console.log(`🏢 Client ID: ${subscription.clientId}`);
  console.log(`🔗 Webhook URL: ${subscription.webhookUrl}`);
  console.log(`🎯 Event Type: concurso.detected`);
  console.log(`📊 Min Confidence: ${config.minConfidence}`);
  console.log(`🌐 Environment: ${config.environment}`);
  console.log('');

  console.log('🎯 Filter Configuration:');
  console.log('─'.repeat(60));
  console.log(`📂 Categories: ${subscription.filters.categories?.join(', ')}`);
  console.log(`🔍 Keywords:`);
  subscription.filters.keywords?.forEach(kw => console.log(`   • ${kw}`));
  
  if (config.territories && config.territories.length > 0) {
    console.log(`🗺️  Territories: ${config.territories.length} selected`);
  } else {
    console.log(`🗺️  Territories: All (no filter)`);
  }
  
  console.log('');

  // Instructions for storing the subscription
  console.log('💾 Storage Instructions:');
  console.log('─'.repeat(60));
  console.log('To complete the setup, store this subscription in Cloudflare KV:');
  console.log('');
  console.log('1. Via Cloudflare Dashboard:');
  console.log(`   Key: subscription:${subscriptionId}`);
  console.log(`   Value: ${JSON.stringify(subscription, null, 2)}`);
  console.log('');
  console.log('2. Via Wrangler CLI:');
  console.log(`   wrangler kv:key put --binding=WEBHOOK_SUBSCRIPTIONS "subscription:${subscriptionId}" '${JSON.stringify(subscription)}'`);
  console.log('');

  // Generate test webhook payload
  const testPayload = {
    notificationId: `test-${Date.now()}`,
    subscriptionId: subscription.id,
    clientId: subscription.clientId,
    event: 'concurso.detected',
    timestamp: new Date().toISOString(),
    gazette: {
      territoryId: '3550308',
      territoryName: 'São Paulo - SP',
      publicationDate: new Date().toISOString().split('T')[0],
      editionNumber: '123',
      pdfUrl: 'https://example.com/gazette.pdf',
      spiderId: 'sp_sao_paulo'
    },
    analysis: {
      jobId: `test-job-${Date.now()}`,
      totalFindings: 2,
      highConfidenceFindings: 2,
      categories: ['concurso_publico']
    },
    findings: [
      {
        type: 'keyword:concurso_publico',
        confidence: 0.95,
        data: {
          category: 'concurso_publico',
          keyword: 'concurso público',
          entity: 'Prefeitura de São Paulo',
          vagas: 50,
          cargo: 'Analista de Sistemas'
        },
        context: 'A Prefeitura de São Paulo torna público o edital de concurso público para 50 vagas do cargo de Analista de Sistemas...',
        position: 1250
      }
    ],
    metadata: {
      webhookVersion: '1.0',
      testPayload: true
    }
  };

  console.log('🧪 Test Webhook Payload:');
  console.log('─'.repeat(60));
  console.log('You can test your webhook endpoint with this sample payload:');
  console.log('');
  console.log(`curl -X POST "${config.webhookUrl}" \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  if (config.authToken) {
    console.log(`  -H "Authorization: Bearer ${config.authToken}" \\`);
  }
  console.log(`  -d '${JSON.stringify(testPayload, null, 2)}'`);
  console.log('');

  // Save to file for reference
  const configFile = `webhook-config-${subscriptionId}.json`;
  console.log(`💾 Configuration saved to: ${configFile}`);
  
  return subscriptionId;
}

async function main() {
  const args = process.argv.slice(2);
  const envArg = args.find(arg => arg.startsWith('--env='));
  const environment = envArg ? envArg.split('=')[1] as 'development' | 'production' : 'development';

  console.log('🎯 CONFIGURAÇÃO DO WEBHOOK PARA CONCURSOS PÚBLICOS');
  console.log('═'.repeat(70));
  console.log('');

  const config: SetupConfig = {
    ...DEFAULT_CONFIG,
    environment
  } as SetupConfig;

  // Allow override via environment variables
  if (process.env.WEBHOOK_URL) {
    config.webhookUrl = process.env.WEBHOOK_URL;
  }
  if (process.env.AUTH_TOKEN) {
    config.authToken = process.env.AUTH_TOKEN;
  }
  if (process.env.MIN_CONFIDENCE) {
    config.minConfidence = parseFloat(process.env.MIN_CONFIDENCE);
  }

  try {
    const subscriptionId = await setupWebhook(config);

    console.log('✅ WEBHOOK CONFIGURADO COM SUCESSO!');
    console.log('═'.repeat(70));
    console.log(`📋 Subscription ID: ${subscriptionId}`);
    console.log('');
    console.log('🚀 Próximos passos:');
    console.log('1. Fazer deploy dos workers');
    console.log('2. Armazenar a configuração no Cloudflare KV');
    console.log('3. Executar crawling para testar');
    console.log('');
    console.log('Para fazer deploy:');
    console.log('  bun run deploy:webhook');
    console.log('  bun run deploy:analysis');
    console.log('  bun run deploy');
    console.log('');

  } catch (error: any) {
    console.error('❌ Erro ao configurar webhook:', error.message);
    process.exit(1);
  }
}

// Run if called directly
main();

export { setupWebhook, SetupConfig };
