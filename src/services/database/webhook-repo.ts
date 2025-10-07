/**
 * Webhook Repository
 * Handles webhook delivery logging and tracking
 */

import { DatabaseClient } from './client';
import { WebhookNotification, WebhookDeliveryResult } from '../../types/webhook';
import { logger } from '../../utils';

export interface WebhookDeliveryRecord {
  id: string;
  notificationId: string;
  subscriptionId: string;
  analysisJobId?: string;
  eventType: string;
  status: 'pending' | 'sent' | 'failed' | 'retry';
  statusCode?: number;
  attempts: number;
  responseBody?: string;
  errorMessage?: string;
  createdAt: string;
  deliveredAt?: string;
  nextRetryAt?: string;
  metadata: Record<string, any>;
}

export class WebhookRepository {
  constructor(private db: DatabaseClient) {}

  /**
   * Log a webhook delivery attempt
   */
  async logWebhookDelivery(
    notification: WebhookNotification,
    result: WebhookDeliveryResult
  ): Promise<string> {
    try {
      const record = await this.db.queryTemplate`
        INSERT INTO webhook_deliveries (
          notification_id, subscription_id, analysis_job_id, event_type,
          status, status_code, attempts, response_body, error_message,
          delivered_at, metadata
        )
        VALUES (
          ${notification.notificationId}, ${notification.subscriptionId},
          ${notification.analysis?.jobId || null}, ${notification.event},
          ${result.status}, ${result.statusCode || null}, ${result.attempt},
          ${result.responseBody || null}, ${result.error || null},
          ${result.deliveredAt}, ${JSON.stringify({
            deliveryTimeMs: result.deliveryTimeMs,
            webhookUrl: 'redacted', // Don't store sensitive URLs
            clientId: notification.clientId
          })}
        )
        ON CONFLICT (notification_id) DO UPDATE SET
          status = EXCLUDED.status,
          status_code = EXCLUDED.status_code,
          attempts = EXCLUDED.attempts,
          response_body = EXCLUDED.response_body,
          error_message = EXCLUDED.error_message,
          delivered_at = EXCLUDED.delivered_at,
          metadata = EXCLUDED.metadata
        RETURNING id
      `;

      const deliveryId = record[0].id;

      logger.info('Webhook delivery logged', {
        deliveryId,
        notificationId: notification.notificationId,
        status: result.status,
        attempt: result.attempt
      });

      return deliveryId;
    } catch (error) {
      logger.error('Failed to log webhook delivery', {
        notificationId: notification.notificationId,
        status: result.status,
        error
      });
      throw error;
    }
  }

  /**
   * Schedule webhook retry
   */
  async scheduleWebhookRetry(
    notificationId: string,
    nextRetryAt: Date,
    attempts: number,
    errorMessage?: string
  ): Promise<void> {
    try {
      await this.db.queryTemplate`
        UPDATE webhook_deliveries 
        SET 
          status = 'retry',
          attempts = ${attempts},
          next_retry_at = ${nextRetryAt.toISOString()},
          error_message = ${errorMessage || null}
        WHERE notification_id = ${notificationId}
      `;

      logger.info('Webhook retry scheduled', {
        notificationId,
        nextRetryAt: nextRetryAt.toISOString(),
        attempts
      });
    } catch (error) {
      logger.error('Failed to schedule webhook retry', {
        notificationId,
        error
      });
      throw error;
    }
  }

  /**
   * Get pending webhook retries
   */
  async getPendingRetries(limit: number = 100): Promise<WebhookDeliveryRecord[]> {
    try {
      const result = await this.db.queryTemplate`
        SELECT * FROM webhook_deliveries 
        WHERE status = 'retry' 
          AND next_retry_at <= NOW()
        ORDER BY next_retry_at ASC
        LIMIT ${limit}
      `;

      return result.map(row => this.mapToWebhookRecord(row));
    } catch (error) {
      logger.error('Failed to get pending webhook retries', { error });
      throw error;
    }
  }

  /**
   * Get webhook delivery by notification ID
   */
  async getWebhookDelivery(notificationId: string): Promise<WebhookDeliveryRecord | null> {
    try {
      const result = await this.db.queryTemplate`
        SELECT * FROM webhook_deliveries WHERE notification_id = ${notificationId}
      `;

      if (result.length === 0) {
        return null;
      }

      return this.mapToWebhookRecord(result[0]);
    } catch (error) {
      logger.error('Failed to get webhook delivery', { notificationId, error });
      throw error;
    }
  }

  /**
   * Get webhook delivery history for a subscription
   */
  async getWebhookHistory(
    subscriptionId: string,
    startDate?: string,
    endDate?: string,
    status?: string,
    limit: number = 100
  ): Promise<WebhookDeliveryRecord[]> {
    try {
      let whereClause = 'WHERE subscription_id = $1';
      const params = [subscriptionId];

      if (startDate) {
        whereClause += ` AND created_at >= $${params.length + 1}`;
        params.push(startDate);
      }

      if (endDate) {
        whereClause += ` AND created_at <= $${params.length + 1}`;
        params.push(endDate);
      }

      if (status) {
        whereClause += ` AND status = $${params.length + 1}`;
        params.push(status);
      }

      const query = `
        SELECT * FROM webhook_deliveries 
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $${params.length + 1}
      `;
      params.push(limit);

      const result = await this.db.query(query, params);
      return result.map(row => this.mapToWebhookRecord(row));
    } catch (error) {
      logger.error('Failed to get webhook history', {
        subscriptionId,
        error
      });
      throw error;
    }
  }

  /**
   * Get webhook delivery statistics
   */
  async getWebhookStats(
    subscriptionId?: string,
    days: number = 7
  ): Promise<{
    totalDeliveries: number;
    successfulDeliveries: number;
    failedDeliveries: number;
    retryDeliveries: number;
    averageDeliveryTimeMs: number;
    successRate: number;
    topErrors: Array<{ error: string; count: number }>;
    deliveriesByDay: Array<{ date: string; count: number; successCount: number }>;
  }> {
    try {
      let whereClause = `WHERE created_at > NOW() - INTERVAL ${days} DAY`;
      const params: any[] = [];

      if (subscriptionId) {
        whereClause += ` AND subscription_id = $${params.length + 1}`;
        params.push(subscriptionId);
      }

      const [generalStats, errorStats, dailyStats] = await Promise.all([
        // General statistics
        this.db.query(`
          SELECT 
            COUNT(*) as total_deliveries,
            COUNT(CASE WHEN status = 'sent' THEN 1 END) as successful_deliveries,
            COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_deliveries,
            COUNT(CASE WHEN status = 'retry' THEN 1 END) as retry_deliveries,
            AVG(CASE WHEN metadata->>'deliveryTimeMs' IS NOT NULL 
                THEN (metadata->>'deliveryTimeMs')::int END) as avg_delivery_time_ms,
            (COUNT(CASE WHEN status = 'sent' THEN 1 END)::float / 
             NULLIF(COUNT(*), 0)) * 100 as success_rate
          FROM webhook_deliveries 
          ${whereClause}
        `, params),

        // Top errors
        this.db.query(`
          SELECT error_message as error, COUNT(*) as count
          FROM webhook_deliveries 
          ${whereClause} AND error_message IS NOT NULL
          GROUP BY error_message
          ORDER BY count DESC
          LIMIT 10
        `, params),

        // Daily breakdown
        this.db.query(`
          SELECT 
            created_at::date as date,
            COUNT(*) as count,
            COUNT(CASE WHEN status = 'sent' THEN 1 END) as success_count
          FROM webhook_deliveries 
          ${whereClause}
          GROUP BY created_at::date
          ORDER BY date DESC
        `, params)
      ]);

      const stats = generalStats[0] || {};

      return {
        totalDeliveries: parseInt(stats.total_deliveries || '0'),
        successfulDeliveries: parseInt(stats.successful_deliveries || '0'),
        failedDeliveries: parseInt(stats.failed_deliveries || '0'),
        retryDeliveries: parseInt(stats.retry_deliveries || '0'),
        averageDeliveryTimeMs: Math.round(stats.avg_delivery_time_ms || 0),
        successRate: Math.round(stats.success_rate || 0),
        topErrors: errorStats.map(row => ({
          error: row.error,
          count: parseInt(row.count)
        })),
        deliveriesByDay: dailyStats.map(row => ({
          date: row.date,
          count: parseInt(row.count),
          successCount: parseInt(row.success_count)
        }))
      };
    } catch (error) {
      logger.error('Failed to get webhook statistics', {
        subscriptionId,
        days,
        error
      });
      throw error;
    }
  }

  /**
   * Get failed webhooks for analysis
   */
  async getFailedWebhooks(
    days: number = 1,
    limit: number = 100
  ): Promise<Array<{
    notificationId: string;
    subscriptionId: string;
    eventType: string;
    attempts: number;
    lastError: string;
    createdAt: string;
  }>> {
    try {
      const result = await this.db.queryTemplate`
        SELECT 
          notification_id, subscription_id, event_type, attempts,
          error_message as last_error, created_at
        FROM webhook_deliveries 
        WHERE status = 'failed' 
          AND created_at > NOW() - INTERVAL ${days} DAY
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;

      return result.map(row => ({
        notificationId: row.notification_id,
        subscriptionId: row.subscription_id,
        eventType: row.event_type,
        attempts: row.attempts,
        lastError: row.last_error || 'Unknown error',
        createdAt: row.created_at
      }));
    } catch (error) {
      logger.error('Failed to get failed webhooks', { days, error });
      throw error;
    }
  }

  /**
   * Clean up old webhook delivery logs
   */
  async cleanupOldDeliveries(olderThanDays: number = 30): Promise<{ deleted: number }> {
    try {
      const result = await this.db.queryTemplate`
        DELETE FROM webhook_deliveries 
        WHERE created_at < NOW() - INTERVAL ${olderThanDays} DAY
          AND status IN ('sent', 'failed')
      `;

      logger.info('Cleaned up old webhook deliveries', {
        deletedCount: result.length,
        olderThanDays
      });

      return { deleted: result.length };
    } catch (error) {
      logger.error('Failed to cleanup old webhook deliveries', {
        olderThanDays,
        error
      });
      throw error;
    }
  }

  /**
   * Update webhook delivery status
   */
  async updateWebhookStatus(
    notificationId: string,
    status: 'pending' | 'sent' | 'failed' | 'retry',
    statusCode?: number,
    responseBody?: string,
    errorMessage?: string
  ): Promise<void> {
    try {
      await this.db.queryTemplate`
        UPDATE webhook_deliveries 
        SET 
          status = ${status},
          status_code = ${statusCode || null},
          response_body = ${responseBody || null},
          error_message = ${errorMessage || null},
          delivered_at = ${status === 'sent' ? new Date().toISOString() : null}
        WHERE notification_id = ${notificationId}
      `;

      logger.debug('Webhook status updated', {
        notificationId,
        status,
        statusCode
      });
    } catch (error) {
      logger.error('Failed to update webhook status', {
        notificationId,
        status,
        error
      });
      throw error;
    }
  }

  /**
   * Get webhook delivery rate (for monitoring)
   */
  async getDeliveryRate(intervalMinutes: number = 60): Promise<{
    deliveriesPerMinute: number;
    successRate: number;
    activeSubscriptions: number;
  }> {
    try {
      const result = await this.db.queryTemplate`
        SELECT 
          COUNT(*)::float / ${intervalMinutes} as deliveries_per_minute,
          (COUNT(CASE WHEN status = 'sent' THEN 1 END)::float / 
           NULLIF(COUNT(*), 0)) * 100 as success_rate,
          COUNT(DISTINCT subscription_id) as active_subscriptions
        FROM webhook_deliveries 
        WHERE created_at > NOW() - INTERVAL ${intervalMinutes} MINUTE
      `;

      const row = result[0] || {};

      return {
        deliveriesPerMinute: Math.round(row.deliveries_per_minute || 0),
        successRate: Math.round(row.success_rate || 0),
        activeSubscriptions: parseInt(row.active_subscriptions || '0')
      };
    } catch (error) {
      logger.error('Failed to get delivery rate', { intervalMinutes, error });
      throw error;
    }
  }

  /**
   * Map database row to WebhookDeliveryRecord
   */
  private mapToWebhookRecord(row: any): WebhookDeliveryRecord {
    return {
      id: row.id,
      notificationId: row.notification_id,
      subscriptionId: row.subscription_id,
      analysisJobId: row.analysis_job_id,
      eventType: row.event_type,
      status: row.status,
      statusCode: row.status_code,
      attempts: row.attempts,
      responseBody: row.response_body,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      deliveredAt: row.delivered_at,
      nextRetryAt: row.next_retry_at,
      metadata: row.metadata || {}
    };
  }
}
