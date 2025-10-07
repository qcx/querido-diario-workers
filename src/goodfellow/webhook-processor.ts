/**
 * Webhook Processor - Extracted from webhook-worker.ts
 * Processes webhook queue messages and delivers to endpoints
 */

import {
  WebhookQueueMessage,
  WebhookDeliveryResult,
  WebhookSubscription,
} from '../types';
import type { DatabaseEnv } from '../services/database';
import { logger } from '../utils';
import {
  getDatabase,
  TelemetryService,
  ErrorTracker,
  WebhookRepository,
} from '../services/database';

export interface WebhookProcessorEnv extends DatabaseEnv {
  WEBHOOK_SUBSCRIPTIONS: KVNamespace;
  WEBHOOK_DELIVERY_LOGS: KVNamespace;
}

/**
 * Process a batch of webhook queue messages
 */
export async function processWebhookBatch(
  batch: MessageBatch<WebhookQueueMessage>,
  env: WebhookProcessorEnv
): Promise<void> {
  logger.info(`Webhook Processor: Processing batch of ${batch.messages.length} messages`);

  // Initialize database services
  const db = getDatabase(env);
  const telemetry = new TelemetryService(db);
  const errorTracker = new ErrorTracker(db);
  const webhookRepo = new WebhookRepository(db);

  for (const message of batch.messages) {
    const startTime = Date.now();
    const crawlJobId = message.body.metadata?.crawlJobId || 'unknown';
    const territoryId = message.body.metadata?.territoryId || 'unknown';

    try {
      await processWebhookMessage(message, env, telemetry, crawlJobId, webhookRepo);

      const executionTimeMs = Date.now() - startTime;

      // Track webhook completion only if we have a valid crawlJobId
      if (crawlJobId !== 'unknown') {
        await telemetry.trackCityStep(
          crawlJobId,
          territoryId,
          'webhook',
          'webhook',
          'webhook_sent',
          'completed',
          {
            executionTimeMs,
          }
        );
      }

      message.ack();
    } catch (error: any) {
      const executionTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error('Failed to process webhook message', new Error(errorMessage), {
        messageId: message.body.messageId,
        crawlJobId,
      });

      // Track webhook failure only if we have a valid crawlJobId
      if (crawlJobId !== 'unknown') {
        await telemetry.trackCityStep(
          crawlJobId,
          territoryId,
          'webhook',
          'webhook',
          'webhook_sent',
          'failed',
          {
            executionTimeMs,
            errorMessage,
          }
        );
      }

      // Track webhook error in error_logs table
      await errorTracker.trackCriticalError(
        'goodfellow-webhook',
        'webhook_processing',
        error as Error,
        {
          messageId: message.body.messageId,
          subscriptionId: message.body.subscriptionId,
          crawlJobId,
          executionTimeMs,
        }
      );

      // Retry logic
      const attempts = message.body.attempts || 0;
      if (attempts < 3) {
        message.retry();
        } else {
          logger.error('Max retries reached for webhook', new Error('Max retries reached'), {
            messageId: message.body.messageId,
            subscriptionId: message.body.subscriptionId,
            crawlJobId,
          });
          message.ack(); // Move to DLQ
        }
    }
  }
}

/**
 * Process a single webhook message
 */
async function processWebhookMessage(
  message: Message<WebhookQueueMessage>,
  env: WebhookProcessorEnv,
  _telemetry: TelemetryService,
  _crawlJobId: string,
  webhookRepo: WebhookRepository
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
    logger.error('Subscription not found', new Error('Subscription not found'), {
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
  // Map status to match database enum: 'sent' instead of 'success', 'failed' instead of 'failure'
  const deliveryResult: WebhookDeliveryResult = {
    messageId,
    subscriptionId,
    status: result.success ? 'sent' : result.shouldRetry ? 'retry' : 'failed',
    statusCode: result.statusCode,
    responseBody: result.responseBody,
    error: result.error,
    deliveredAt: new Date().toISOString(),
    deliveryTimeMs,
    attempt,
  };

  await webhookRepo.logWebhookDelivery(notification, deliveryResult);

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
      'User-Agent': 'Goodfellow-Webhook/1.0',
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

    const success = statusCode >= 200 && statusCode < 300;
    const shouldRetry = !success && (statusCode >= 500 || statusCode === 429);

    return {
      success,
      shouldRetry,
      statusCode,
      responseBody: responseBody.substring(0, 1000),
      error: success ? undefined : `HTTP ${statusCode}: ${responseBody.substring(0, 200)}`,
    };
  } catch (error: any) {
    logger.error('Webhook request failed', error, {
      subscriptionId: subscription.id,
      webhookUrl: subscription.webhookUrl,
    });

    return {
      success: false,
      shouldRetry: true,
      error: error.message,
    };
  }
}

/**
 * Store delivery result in KV (deprecated - now using database)
 * Kept for backward compatibility and potential future use
 */
// async function storeDeliveryResult(
//   result: WebhookDeliveryResult,
//   env: WebhookProcessorEnv
// ): Promise<void> {
//   const key = `delivery:${result.messageId}`;

//   await env.WEBHOOK_DELIVERY_LOGS.put(key, JSON.stringify(result), {
//     expirationTtl: 86400 * 30, // 30 days
//     metadata: {
//       subscriptionId: result.subscriptionId,
//       status: result.status,
//       statusCode: result.statusCode,
//     },
//   });

//   // Store by subscription for querying
//   const subKey = `subscription:${result.subscriptionId}:deliveries`;
//   const existing = await env.WEBHOOK_DELIVERY_LOGS.get(subKey);
//   const deliveries = existing ? JSON.parse(existing) : [];

//   deliveries.unshift(result.messageId);

//   // Keep only last 100 deliveries
//   if (deliveries.length > 100) {
//     deliveries.length = 100;
//   }

//   await env.WEBHOOK_DELIVERY_LOGS.put(subKey, JSON.stringify(deliveries), {
//     expirationTtl: 86400 * 30,
//   });
// }
