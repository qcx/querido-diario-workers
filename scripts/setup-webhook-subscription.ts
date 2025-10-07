/**
 * Setup Webhook Subscription Script
 * Creates a default webhook subscription for testing
 */

import { WebhookSubscription } from '../src/types/webhook';

// Configuration from environment
const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://example.com/webhook';
const SUBSCRIPTION_ID = process.env.SUBSCRIPTION_ID || 'sub_default';
const CLIENT_ID = process.env.CLIENT_ID || 'test_client';

async function setupWebhookSubscription() {
  if (!CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_API_TOKEN) {
    console.error('❌ Missing CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN');
    console.log('Usage: CLOUDFLARE_ACCOUNT_ID=xxx CLOUDFLARE_API_TOKEN=xxx bun run scripts/setup-webhook-subscription.ts');
    process.exit(1);
  }

  const subscription: WebhookSubscription = {
    id: SUBSCRIPTION_ID,
    clientId: CLIENT_ID,
    active: true,
    webhookUrl: WEBHOOK_URL,
    filters: {
      categories: ['concurso_publico'], // Get notified about concurso findings
      territoryIds: [], // Empty means all territories
      minConfidence: 0.5,
    },
    metadata: {
      description: 'Default webhook subscription for concurso notifications',
      createdAt: new Date().toISOString(),
    },
  };

  console.log('📡 Setting up webhook subscription...');
  console.log('Subscription ID:', subscription.id);
  console.log('Client ID:', subscription.clientId);
  console.log('Webhook URL:', subscription.webhookUrl);
  console.log('Filters:', JSON.stringify(subscription.filters, null, 2));

  // Use Cloudflare API to write to KV namespace
  const kvNamespace = 'WEBHOOK_SUBSCRIPTIONS';
  const key = `subscription:${subscription.id}`;
  
  try {
    // First, let's list KV namespaces to find the ID
    const namespacesResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces`,
      {
        headers: {
          'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const namespacesData = await namespacesResponse.json();
    
    if (!namespacesData.success) {
      console.error('❌ Failed to list KV namespaces:', namespacesData.errors);
      process.exit(1);
    }

    const webhookNamespace = namespacesData.result.find(
      (ns: any) => ns.title === kvNamespace
    );

    if (!webhookNamespace) {
      console.error(`❌ KV namespace ${kvNamespace} not found`);
      console.log('Available namespaces:', namespacesData.result.map((ns: any) => ns.title));
      process.exit(1);
    }

    console.log(`✅ Found KV namespace: ${webhookNamespace.title} (ID: ${webhookNamespace.id})`);

    // Write subscription to KV
    const putResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${webhookNamespace.id}/values/${key}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(subscription),
      }
    );

    if (!putResponse.ok) {
      const errorText = await putResponse.text();
      console.error('❌ Failed to create subscription:', errorText);
      process.exit(1);
    }

    console.log('✅ Webhook subscription created successfully!');
    console.log('');
    console.log('📝 To test webhooks:');
    console.log('1. Make sure your webhook URL is accessible');
    console.log('2. Run a crawl that includes concurso findings');
    console.log('3. Check webhook_deliveries table for delivery attempts');
    console.log('');
    console.log('🔍 To verify subscription:');
    console.log(`curl "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/storage/kv/namespaces/${webhookNamespace.id}/values/${key}" \\`);
    console.log(`  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"`);

  } catch (error) {
    console.error('❌ Error setting up webhook subscription:', error);
    process.exit(1);
  }
}

// Run the script
setupWebhookSubscription().catch(console.error);
