/**
 * Webhook Worker - Sends notifications to webhook endpoints
 */

import {
  WebhookQueueMessage,
  WebhookDeliveryResult,
  WebhookSubscription,
} from './types';
import { logger } from './utils';

export interface Env {
  // Queue bindings
  WEBHOOK_QUEUE: Queue<WebhookQueueMessage>;
  
  // KV for storing subscriptions and delivery logs
  WEBHOOK_SUBSCRIPTIONS: KVNamespace;
  WEBHOOK_DELIVERY_LOGS: KVNamespace;
}

/**
 * Queue consumer for webhook delivery
 */
export default {
  async queue(
    batch: MessageBatch<WebhookQueueMessage>,
    env: Env
  ): Promise<void> {
    logger.info(`Webhook Worker: Processing batch of ${batch.messages.length} messages`);

    for (const message of batch.messages) {
      try {
        await processWebhookMessage(message, env);
        message.ack();
      } catch (error: any) {
        logger.error('Failed to process webhook message', {
          error: error.message,
          messageId: message.body.messageId,
        });

        // Retry logic
        const attempts = message.body.attempts || 0;
        if (attempts < 3) {
          message.retry();
        } else {
          logger.error('Max retries reached for webhook', {
            messageId: message.body.messageId,
            subscriptionId: message.body.subscriptionId,
          });
          message.ack(); // Move to DLQ
        }
      }
    }
  },
};

/**
 * Process a single webhook message
 */
async function processWebhookMessage(
  message: Message<WebhookQueueMessage>,
  env: Env
): Promise<void> {
  const { messageId, subscriptionId, notification } = message.body;
  const attempt = (message.body.attempts || 0) + 1;

  logger.info(`Processing webhook message ${messageId}`, {
    messageId,
    subscriptionId,
    attempt,
  });

  // Get subscription configuration
  const subscriptionData = await env.WEBHOOK_SUBSCRIPTIONS.get(
    `subscription:${subscriptionId}`
  );

  if (!subscriptionData) {
    logger.error('Subscription not found', {
      error: 'Subscription not found',
      subscriptionId,
    });
    return;
  }

  const subscription: WebhookSubscription = JSON.parse(subscriptionData);

  if (!subscription.active) {
    logger.info('Subscription is inactive, skipping', {
      subscriptionId,
    });
    return;
  }

  // Send webhook
  const startTime = Date.now();
  const result = await sendWebhook(subscription, notification, attempt);
  const deliveryTimeMs = Date.now() - startTime;

  // Store delivery result
  const deliveryResult: WebhookDeliveryResult = {
    messageId,
    subscriptionId,
    status: result.success ? 'success' : result.shouldRetry ? 'retry' : 'failure',
    statusCode: result.statusCode,
    responseBody: result.responseBody,
    error: result.error,
    deliveredAt: new Date().toISOString(),
    deliveryTimeMs,
    attempt,
  };

  await storeDeliveryResult(deliveryResult, env);

  // Handle retry
  if (!result.success && result.shouldRetry) {
    throw new Error(`Webhook delivery failed, will retry: ${result.error}`);
  }

  logger.info(`Webhook delivered successfully`, {
    messageId,
    subscriptionId,
    statusCode: result.statusCode,
    deliveryTimeMs,
  });
}

/**
 * Send webhook HTTP request
 */
async function sendWebhook(
  subscription: WebhookSubscription,
  notification: any,
  attempt: number
): Promise<{
  success: boolean;
  shouldRetry: boolean;
  statusCode?: number;
  responseBody?: string;
  error?: string;
}> {
  try {
    // Prepare headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Querido-Diario-Webhook/1.0',
      'X-Webhook-Attempt': attempt.toString(),
      'X-Webhook-Subscription-Id': subscription.id,
    };

    // Add authentication
    if (subscription.auth) {
      if (subscription.auth.type === 'bearer' && subscription.auth.token) {
        headers['Authorization'] = `Bearer ${subscription.auth.token}`;
      } else if (subscription.auth.type === 'basic' && subscription.auth.username) {
        const credentials = btoa(
          `${subscription.auth.username}:${subscription.auth.password || ''}`
        );
        headers['Authorization'] = `Basic ${credentials}`;
      } else if (subscription.auth.type === 'custom' && subscription.auth.headers) {
        Object.assign(headers, subscription.auth.headers);
      }
    }

    // Send request
    const response = await fetch(subscription.webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(notification),
    });

    const responseBody = await response.text();
    const statusCode = response.status;

    // Check if successful
    const success = statusCode >= 200 && statusCode < 300;
    
    // Determine if should retry (5xx errors or network issues)
    const shouldRetry = !success && (statusCode >= 500 || statusCode === 429);

    return {
      success,
      shouldRetry,
      statusCode,
      responseBody: responseBody.substring(0, 1000), // Limit size
      error: success ? undefined : `HTTP ${statusCode}: ${responseBody.substring(0, 200)}`,
    };
  } catch (error: any) {
    logger.error('Webhook request failed', error, {
      subscriptionId: subscription.id,
      webhookUrl: subscription.webhookUrl,
    });

    return {
      success: false,
      shouldRetry: true, // Network errors should retry
      error: error.message,
    };
  }
}

/**
 * Store delivery result in KV
 */
async function storeDeliveryResult(
  result: WebhookDeliveryResult,
  env: Env
): Promise<void> {
  const key = `delivery:${result.messageId}`;
  
  await env.WEBHOOK_DELIVERY_LOGS.put(key, JSON.stringify(result), {
    expirationTtl: 86400 * 30, // 30 days
    metadata: {
      subscriptionId: result.subscriptionId,
      status: result.status,
      statusCode: result.statusCode,
    },
  });

  // Also store by subscription for querying
  const subKey = `subscription:${result.subscriptionId}:deliveries`;
  const existing = await env.WEBHOOK_DELIVERY_LOGS.get(subKey);
  const deliveries = existing ? JSON.parse(existing) : [];
  
  deliveries.unshift(result.messageId);
  
  // Keep only last 100 deliveries
  if (deliveries.length > 100) {
    deliveries.length = 100;
  }

  await env.WEBHOOK_DELIVERY_LOGS.put(subKey, JSON.stringify(deliveries), {
    expirationTtl: 86400 * 30,
  });
}
