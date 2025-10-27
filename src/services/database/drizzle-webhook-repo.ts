/**
 * Drizzle-based Webhook Repository
 * Replaces webhook-repo.ts with Drizzle ORM implementation
 */

import { eq, desc, and, gte, lte, inArray } from 'drizzle-orm';
import { DrizzleDatabaseClient, schema } from './drizzle-client';
import { logger } from '../../utils/logger';
import type { WebhookDeliveryResult } from '../../types';
import type { WebhookMetadata } from '../../types/database';

export interface WebhookDeliveryRecord {
  id: string;
  notificationId: string;
  subscriptionId: string;
  analysisJobId: string | null;
  eventType: string;
  status: string;
  statusCode: number | null;
  attempts: number;
  responseBody: string | null;
  errorMessage: string | null;
  createdAt: string;
  deliveredAt: string | null;
  nextRetryAt: string | null;
  metadata: WebhookMetadata;
}

export class DrizzleWebhookRepository {
  constructor(private dbClient: DrizzleDatabaseClient) {}

  /**
   * Log webhook delivery (compatibility method)
   */
  async logWebhookDelivery(
    notificationId: string,
    subscriptionId: string,
    success: boolean,
    statusCode?: number,
    errorMessage?: string,
    responseBody?: string,
    deliveryTimeMs?: number
  ): Promise<string> {
    const deliveryResult: WebhookDeliveryResult = {
      messageId: notificationId,
      subscriptionId,
      status: success ? 'sent' : 'failed',
      statusCode,
      error: errorMessage,
      responseBody,
      deliveredAt: this.dbClient.getCurrentTimestamp(),
      deliveryTimeMs: deliveryTimeMs || 0,
      attempt: 1,
    };

    return await this.logDelivery(deliveryResult);
  }

  /**
   * Log webhook delivery attempt
   */
  async logDelivery(delivery: WebhookDeliveryResult): Promise<string> {
    try {
      const db = this.dbClient.getDb();

      const metadata = {
        deliveryTimeMs: delivery.deliveryTimeMs || 0,
        timestamp: this.dbClient.getCurrentTimestamp()
      };

      const deliveryData = {
        id: this.dbClient.generateId(),
        notificationId: delivery.messageId,
        subscriptionId: delivery.subscriptionId,
        analysisJobId: null,
        eventType: 'webhook.delivery',
        status: delivery.status,
        statusCode: delivery.statusCode || null,
        attempts: delivery.attempt || 1,
        responseBody: delivery.responseBody || null,
        errorMessage: delivery.error || null,
        createdAt: this.dbClient.getCurrentTimestamp(),
        deliveredAt: delivery.deliveredAt,
        nextRetryAt: null,
        metadata: JSON.stringify(metadata)
      };

      const result = await db.insert(schema.webhookDeliveries)
      .values(deliveryData)
      .onConflictDoUpdate({
        target: schema.webhookDeliveries.notificationId,
        set: {
          status: deliveryData.status,
          statusCode: deliveryData.statusCode,
          attempts: deliveryData.attempts,
          responseBody: deliveryData.responseBody,
          errorMessage: deliveryData.errorMessage,
          deliveredAt: deliveryData.deliveredAt,
          nextRetryAt: deliveryData.nextRetryAt
        }
      })
      .returning({ id: schema.webhookDeliveries.id });

    logger.info('Webhook delivery logged', {
      deliveryId: result[0].id,
      messageId: delivery.messageId,
      status: delivery.status,
      statusCode: delivery.statusCode
    });

    return result[0].id;
  } catch (error) {
    logger.error('Failed to log webhook delivery', {
      messageId: delivery.messageId,
      error
    });
    throw error;
    }
  }

  /**
   * Schedule webhook retry
   */
  async scheduleRetry(
    notificationId: string,
    retryAt: Date,
    maxRetries: number = 3
  ): Promise<boolean> {
    try {
      const db = this.dbClient.getDb();

      // Get current delivery record
      const deliveries = await db.select()
        .from(schema.webhookDeliveries)
        .where(eq(schema.webhookDeliveries.notificationId, notificationId))
        .limit(1);

      if (deliveries.length === 0) {
        throw new Error(`Webhook delivery not found: ${notificationId}`);
      }

      const delivery = deliveries[0];

      if (delivery.attempts >= maxRetries) {
        // Mark as permanently failed
        await db.update(schema.webhookDeliveries)
          .set({
            status: 'failed',
            nextRetryAt: null
          })
          .where(eq(schema.webhookDeliveries.notificationId, notificationId));

        logger.warn('Webhook delivery failed permanently', {
          notificationId,
          attempts: delivery.attempts,
          maxRetries
        });

        return false;
      }

      // Schedule retry
      await db.update(schema.webhookDeliveries)
        .set({
          status: 'retry',
          nextRetryAt: retryAt.toISOString(),
          attempts: delivery.attempts + 1
        })
        .where(eq(schema.webhookDeliveries.notificationId, notificationId));

      logger.info('Webhook retry scheduled', {
        notificationId,
        retryAt: retryAt.toISOString(),
        attempt: delivery.attempts + 1
      });

      return true;
    } catch (error) {
      logger.error('Failed to schedule webhook retry', {
        notificationId,
        error
      });
      throw error;
    }
  }

  /**
   * Get pending retries
   */
  async getPendingRetries(limit: number = 100): Promise<WebhookDeliveryRecord[]> {
    try {
      const db = this.dbClient.getDb();
      const now = this.dbClient.getCurrentTimestamp();

      const retries = await db.select()
        .from(schema.webhookDeliveries)
        .where(and(
          eq(schema.webhookDeliveries.status, 'retry'),
          lte(schema.webhookDeliveries.nextRetryAt, now)
        ))
        .orderBy(schema.webhookDeliveries.nextRetryAt)
        .limit(limit);

      return retries.map(retry => ({
        ...retry,
        metadata: this.dbClient.parseJson<WebhookMetadata>(retry.metadata, {})
      }));
    } catch (error) {
      logger.error('Failed to get pending retries', { error });
      throw error;
    }
  }

  /**
   * Get webhook delivery by notification ID
   */
  async getDeliveryByNotificationId(notificationId: string): Promise<WebhookDeliveryRecord | null> {
    try {
      const db = this.dbClient.getDb();

      const results = await db.select()
        .from(schema.webhookDeliveries)
        .where(eq(schema.webhookDeliveries.notificationId, notificationId))
        .limit(1);

      if (results.length === 0) {
        return null;
      }

      const delivery = results[0];
      return {
        ...delivery,
        metadata: this.dbClient.parseJson<WebhookMetadata>(delivery.metadata, {})
      };
    } catch (error) {
      logger.error('Failed to get delivery by notification ID', {
        notificationId,
        error
      });
      throw error;
    }
  }

  /**
   * Get webhook deliveries for a subscription
   */
  async getDeliveriesForSubscription(
    subscriptionId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{
    deliveries: WebhookDeliveryRecord[];
    total: number;
  }> {
    try {
      const db = this.dbClient.getDb();

      // Get paginated deliveries
      const deliveries = await db.select()
        .from(schema.webhookDeliveries)
        .where(eq(schema.webhookDeliveries.subscriptionId, subscriptionId))
        .orderBy(desc(schema.webhookDeliveries.createdAt))
        .limit(limit)
        .offset(offset);

      // Get total count
      const totalResults = await db.select({ count: schema.webhookDeliveries.id })
        .from(schema.webhookDeliveries)
        .where(eq(schema.webhookDeliveries.subscriptionId, subscriptionId));

      const records = deliveries.map(delivery => ({
        ...delivery,
        metadata: this.dbClient.parseJson<WebhookMetadata>(delivery.metadata, {})
      }));

      return {
        deliveries: records,
        total: totalResults.length
      };
    } catch (error) {
      logger.error('Failed to get deliveries for subscription', {
        subscriptionId,
        error
      });
      throw error;
    }
  }

  /**
   * Get webhook delivery statistics
   */
  async getDeliveryStats(days: number = 7): Promise<{
    totalDeliveries: number;
    successfulDeliveries: number;
    failedDeliveries: number;
    pendingRetries: number;
    averageResponseTime: number;
    statusCodeBreakdown: { code: number; count: number }[];
  }> {
    try {
      const db = this.dbClient.getDb();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffDateStr = cutoffDate.toISOString();

      const deliveries = await db.select()
        .from(schema.webhookDeliveries)
        .where(gte(schema.webhookDeliveries.createdAt, cutoffDateStr));

      if (deliveries.length === 0) {
        return {
          totalDeliveries: 0,
          successfulDeliveries: 0,
          failedDeliveries: 0,
          pendingRetries: 0,
          averageResponseTime: 0,
          statusCodeBreakdown: []
        };
      }

      const totalDeliveries = deliveries.length;
      const successfulDeliveries = deliveries.filter(d => d.status === 'sent').length;
      const failedDeliveries = deliveries.filter(d => d.status === 'failed').length;
      const pendingRetries = deliveries.filter(d => d.status === 'retry').length;

      // Calculate average response time from stored delivery timing data
      // Parse metadata first to access deliveryTimeMs
      let totalTime = 0;
      let validTimingCount = 0;

      for (const delivery of deliveries) {
        try {
          const metadata = this.dbClient.parseJson<any>(delivery.metadata, {});
          if (metadata.deliveryTimeMs && typeof metadata.deliveryTimeMs === 'number') {
            totalTime += metadata.deliveryTimeMs;
            validTimingCount++;
          }
        } catch {
          // Skip deliveries with invalid metadata
        }
      }

      const averageResponseTime = validTimingCount > 0 
        ? Math.round(totalTime / validTimingCount) 
        : 0;
      // Status code breakdown
      const statusCodeCount: Record<number, number> = {};
      deliveries.forEach(delivery => {
        if (delivery.statusCode) {
          statusCodeCount[delivery.statusCode] = (statusCodeCount[delivery.statusCode] || 0) + 1;
        }
      });

      const statusCodeBreakdown = Object.entries(statusCodeCount)
        .map(([code, count]) => ({ code: parseInt(code), count }))
        .sort((a, b) => b.count - a.count);

      return {
        totalDeliveries,
        successfulDeliveries,
        failedDeliveries,
        pendingRetries,
        averageResponseTime,
        statusCodeBreakdown
      };
    } catch (error) {
      logger.error('Failed to get delivery stats', {
        days,
        error
      });
      throw error;
    }
  }

  /**
   * Get failed deliveries for investigation
   */
  async getFailedDeliveries(
    limit: number = 50,
    subscriptionId?: string
  ): Promise<WebhookDeliveryRecord[]> {
    try {
      const db = this.dbClient.getDb();

      const whereConditions = subscriptionId
      ? and(
          eq(schema.webhookDeliveries.status, 'failed'),
          eq(schema.webhookDeliveries.subscriptionId, subscriptionId)
        )
      : eq(schema.webhookDeliveries.status, 'failed');

    const deliveries = await db.select()
      .from(schema.webhookDeliveries)
      .where(whereConditions)
        .orderBy(desc(schema.webhookDeliveries.createdAt))
        .limit(limit);

      return deliveries.map(delivery => ({
        ...delivery,
        metadata: this.dbClient.parseJson<WebhookMetadata>(delivery.metadata, {})
      }));
    } catch (error) {
      logger.error('Failed to get failed deliveries', {
        subscriptionId,
        error
      });
      throw error;
    }
  }

  /**
   * Clean up old webhook delivery logs
   */
  async cleanupOldDeliveries(daysOld: number = 30): Promise<number> {
    try {
      const db = this.dbClient.getDb();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);
      const cutoffDateStr = cutoffDate.toISOString();

      // Keep failed deliveries longer for analysis
      await db.delete(schema.webhookDeliveries)
        .where(and(
          lte(schema.webhookDeliveries.createdAt, cutoffDateStr),
          inArray(schema.webhookDeliveries.status, ['sent', 'retry'])
        ));

      logger.info('Old webhook deliveries cleaned up', {
        deletedCount: 0, // D1 doesn't return changes count easily
        cutoffDate: cutoffDateStr
      });

      return 0;
    } catch (error) {
      logger.error('Failed to cleanup old webhook deliveries', {
        daysOld,
        error
      });
      throw error;
    }
  }
}
