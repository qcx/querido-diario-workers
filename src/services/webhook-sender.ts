/**
 * Webhook Sender Service
 * Sends analysis results to webhook queue
 */

import {
  GazetteAnalysis,
  WebhookSubscription,
  WebhookNotification,
  WebhookQueueMessage,
  WebhookFinding,
} from '../types';
import { WebhookFilterService } from './webhook-filter';
import { logger } from '../utils';

export class WebhookSenderService {
  private webhookQueue: Queue<WebhookQueueMessage>;
  private subscriptionsKV: KVNamespace;

  constructor(webhookQueue: Queue<WebhookQueueMessage>, subscriptionsKV: KVNamespace) {
    this.webhookQueue = webhookQueue;
    this.subscriptionsKV = subscriptionsKV;
  }

  /**
   * Process analysis and send to matching webhooks
   */
  async processAnalysis(analysis: GazetteAnalysis): Promise<number> {
    logger.info('Processing analysis for webhooks', {
      jobId: analysis.jobId,
      territoryId: analysis.territoryId,
    });

    // Get all active subscriptions
    const subscriptions = await this.getActiveSubscriptions();

    if (subscriptions.length === 0) {
      logger.info('No active webhook subscriptions');
      return 0;
    }

    let sentCount = 0;

    // Check each subscription
    for (const subscription of subscriptions) {
      try {
        // Check if analysis matches filters
        const matches = WebhookFilterService.matches(analysis, subscription.filters);

        if (!matches) {
          logger.debug('Analysis does not match subscription filters', {
            subscriptionId: subscription.id,
            clientId: subscription.clientId,
          });
          continue;
        }

        // Extract relevant findings
        const findings = WebhookFilterService.extractFindings(
          analysis,
          subscription.filters
        );

        if (findings.length === 0) {
          logger.debug('No matching findings for subscription', {
            subscriptionId: subscription.id,
          });
          continue;
        }

        // Create notification
        const notification = this.createNotification(
          subscription,
          analysis,
          findings
        );

        // Send to queue
        await this.sendToQueue(subscription, notification);

        sentCount++;

        logger.info('Sent analysis to webhook queue', {
          subscriptionId: subscription.id,
          clientId: subscription.clientId,
          findingsCount: findings.length,
        });
      } catch (error: any) {
        logger.error('Failed to process subscription', error, {
          subscriptionId: subscription.id,
        });
      }
    }

    return sentCount;
  }

  /**
   * Get all active subscriptions
   */
  private async getActiveSubscriptions(): Promise<WebhookSubscription[]> {
    // List all subscription keys
    const list = await this.subscriptionsKV.list({ prefix: 'subscription:' });
    
    const subscriptions: WebhookSubscription[] = [];

    for (const key of list.keys) {
      try {
        const data = await this.subscriptionsKV.get(key.name);
        if (data) {
          const subscription: WebhookSubscription = JSON.parse(data);
          if (subscription.active) {
            subscriptions.push(subscription);
          }
        }
      } catch (error: any) {
        logger.error('Failed to load subscription', error, {
          key: key.name,
        });
      }
    }

    return subscriptions;
  }

  /**
   * Create webhook notification
   */
  private createNotification(
    subscription: WebhookSubscription,
    analysis: GazetteAnalysis,
    findings: WebhookFinding[]
  ): WebhookNotification {
    // Determine event type
    let event: 'gazette.analyzed' | 'concurso.detected' | 'licitacao.detected' = 'gazette.analyzed';
    
    if (analysis.summary.categories.includes('concurso_publico')) {
      event = 'concurso.detected';
    } else if (analysis.summary.categories.includes('licitacao')) {
      event = 'licitacao.detected';
    }

    return {
      notificationId: `notif-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      subscriptionId: subscription.id,
      clientId: subscription.clientId,
      event,
      timestamp: new Date().toISOString(),
      gazette: {
        territoryId: analysis.territoryId,
        territoryName: this.getTerritoryName(analysis.territoryId),
        publicationDate: analysis.publicationDate,
        editionNumber: analysis.metadata?.editionNumber,
        pdfUrl: this.getPdfUrl(analysis),
        spiderId: analysis.metadata?.spiderId || 'unknown',
      },
      analysis: {
        jobId: analysis.jobId,
        totalFindings: analysis.summary.totalFindings,
        highConfidenceFindings: analysis.summary.highConfidenceFindings,
        categories: analysis.summary.categories,
      },
      findings,
      metadata: {
        power: analysis.metadata?.power,
        isExtraEdition: analysis.metadata?.isExtraEdition,
      },
    };
  }

  /**
   * Send notification to webhook queue
   */
  private async sendToQueue(
    subscription: WebhookSubscription,
    notification: WebhookNotification
  ): Promise<void> {
    const message: WebhookQueueMessage = {
      messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      subscriptionId: subscription.id,
      notification,
      queuedAt: new Date().toISOString(),
      attempts: 0,
    };

    await this.webhookQueue.send(message);
  }

  /**
   * Get territory name (placeholder - should use a territory database)
   */
  private getTerritoryName(_territoryId: string): string {
    // TODO: Implement territory name lookup
    return _territoryId;
  }

  /**
   * Get PDF URL from analysis
   */
  private getPdfUrl(_analysis: GazetteAnalysis): string {
    // TODO: Get from OCR result or metadata
    return 'https://example.com/gazette.pdf';
  }

  /**
   * Create Qconcursos subscription
   */
  static async createQconcursosSubscription(
    subscriptionsKV: KVNamespace,
    webhookUrl: string,
    authToken?: string,
    territories?: string[]
  ): Promise<WebhookSubscription> {
    const subscription: WebhookSubscription = {
      id: `qconcursos-${Date.now()}`,
      clientId: 'qconcursos',
      webhookUrl,
      filters: WebhookFilterService.createQconcursosFilter(0.7, territories),
      auth: authToken
        ? {
            type: 'bearer',
            token: authToken,
          }
        : undefined,
      retry: {
        maxAttempts: 3,
        backoffMs: 5000,
      },
      active: true,
      createdAt: new Date().toISOString(),
    };

    // Store in KV
    await subscriptionsKV.put(
      `subscription:${subscription.id}`,
      JSON.stringify(subscription)
    );

    logger.info('Created Qconcursos subscription', {
      subscriptionId: subscription.id,
      webhookUrl,
    });

    return subscription;
  }
}
