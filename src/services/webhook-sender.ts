/**
 * Webhook Sender Service
 * Sends analysis results to webhook queue
 */

import {
  GazetteAnalysis,
  WebhookSubscription,
  WebhookNotification,
  WebhookQueueMessage,
} from '../types';
import { WebhookFilterService } from './webhook-filter';
import { TerritoryService } from './territory-service';
import { TelemetryService } from './database';
import { logger } from '../utils';

export class WebhookSenderService {
  private webhookQueue: Queue<WebhookQueueMessage>;
  private subscriptionsKV: KVNamespace;
  private webhookRepo?: any; // WebhookRepository for checking delivery counts
  private r2PublicUrl?: string;
  private gazetteRepo?: any; // GazetteRepository for fetching R2 keys
  private concursoRepo?: any; // ConcursoRepository for checking concurso findings

  constructor(
    webhookQueue: Queue<WebhookQueueMessage>, 
    subscriptionsKV: KVNamespace,
    webhookRepo?: any,
    r2PublicUrl?: string,
    gazetteRepo?: any,
    concursoRepo?: any
  ) {
    this.webhookQueue = webhookQueue;
    this.subscriptionsKV = subscriptionsKV;
    this.webhookRepo = webhookRepo;
    this.r2PublicUrl = r2PublicUrl;
    this.gazetteRepo = gazetteRepo;
    this.concursoRepo = concursoRepo;
  }

  /**
   * Process analysis and collect webhook messages for matching subscriptions
   */
  async processAnalysisForWebhooks(
    analysis: GazetteAnalysis, 
    crawlJobId?: string,
    territoryId?: string,
    telemetry?: TelemetryService,
    gazetteId?: string
  ): Promise<WebhookQueueMessage[]> {
    const webhookMessages: WebhookQueueMessage[] = [];
    logger.info('Processing analysis for webhooks', {
      jobId: analysis.jobId,
      territoryId: analysis.territoryId,
    });

    // Get all active subscriptions
    const subscriptions = await this.getActiveSubscriptions();

    if (subscriptions.length === 0) {
      logger.info('No active webhook subscriptions');
      
      // Track telemetry if there are findings but no subscriptions
      if (telemetry && crawlJobId && crawlJobId !== 'unknown' && analysis.summary.totalFindings > 0) {
        await telemetry.trackCityStep(
          crawlJobId,
          territoryId || analysis.territoryId,
          'webhook',
          'webhook_sent',
          'skipped',
          undefined,
          undefined,
          'No active subscriptions',
          'unknown'
        );
      }
      
      return [];
    }

    let sentCount = 0;

    // Check each subscription
    for (const subscription of subscriptions) {
      try {
        // Check maxDeliveries limit first (before filter matching)
        if (subscription.maxDeliveries !== undefined && 
            subscription.maxDeliveries !== "always" && 
            this.webhookRepo) {
          
          const deliveryCount = await this.webhookRepo.getSuccessfulDeliveryCount(
            subscription.id,
            analysis.jobId
          );
          
          if (deliveryCount >= subscription.maxDeliveries) {
            logger.info('Webhook skipped: maxDeliveries limit reached', {
              subscriptionId: subscription.id,
              clientId: subscription.clientId,
              analysisJobId: analysis.jobId,
              maxDeliveries: subscription.maxDeliveries,
              currentCount: deliveryCount,
            });
            
            // Track telemetry for skipped webhook
            if (telemetry && crawlJobId && crawlJobId !== 'unknown') {
              await telemetry.trackCityStep(
                crawlJobId,
                territoryId || analysis.territoryId,
                'webhook',
                'webhook_sent',
                'skipped',
                undefined,
                undefined,
                `Max deliveries reached (${deliveryCount}/${subscription.maxDeliveries})`,
                'unknown'
              );
            }
            
            continue;
          }
        }

        // Check if analysis matches filters
        const matches = await WebhookFilterService.matches(analysis, subscription.filters, this.concursoRepo);

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

        // Create webhook notification
        const territoryInfo = TerritoryService.getTerritoryInfo(analysis.territoryId);
        const notification: WebhookNotification = {
          notificationId: `${analysis.jobId}-${subscription.id}`,
          subscriptionId: subscription.id,
          clientId: subscription.clientId,
          event: 'gazette.analyzed',
          timestamp: new Date().toISOString(),
          gazette: {
            territoryId: analysis.territoryId,
            territoryName: territoryInfo?.name || 'Unknown',
            cityName: territoryInfo?.name || 'Unknown',
            stateCode: territoryInfo?.stateCode || 'XX',
            stateName: territoryInfo?.stateCode || 'Unknown',
            region: territoryInfo?.region || 'Unknown',
            formattedName: territoryInfo ? TerritoryService.getFormattedCityName(analysis.territoryId) : 'Unknown',
            publicationDate: analysis.publicationDate,
            editionNumber: analysis.metadata?.editionNumber,
            pdfUrl: await this.getPdfUrl(analysis, gazetteId),
            spiderId: analysis.metadata?.spiderId || 'unknown',
            spiderType: territoryInfo?.spiderType || 'unknown',
          },
          analysis: {
            jobId: analysis.jobId,
            totalFindings: analysis.summary.totalFindings,
            highConfidenceFindings: analysis.summary.highConfidenceFindings || 0,
            categories: analysis.summary.categories,
            processingTimeMs: 0, // Not available in current analysis structure
            analyzedAt: analysis.analyzedAt,
            textLength: analysis.textLength || 0,
          },
          findings,
          concurso: await this.extractConcursoData(analysis),
          metadata: {
            power: analysis.metadata?.power,
            isExtraEdition: analysis.metadata?.isExtraEdition,
            webhookVersion: '2.0',
            source: 'querido-diario-workers',
            crawledAt: new Date().toISOString(),
          },
        };

        // Create queue message
        const queueMessage: WebhookQueueMessage = {
          messageId: `${analysis.jobId}-${subscription.id}-${Date.now()}`,
          subscriptionId: subscription.id,
          notification,
          queuedAt: new Date().toISOString(),
        };

        webhookMessages.push(queueMessage);
        sentCount++;

        logger.info('Prepared webhook message', {
          subscriptionId: subscription.id,
          clientId: subscription.clientId,
          analysisJobId: analysis.jobId,
          findingsCount: findings.length,
        });
      } catch (error: any) {
        logger.error('Failed to process subscription for webhook', error, {
          subscriptionId: subscription.id,
          analysisJobId: analysis.jobId,
        });
      }
    }

    logger.info(`Prepared ${sentCount} webhook messages for analysis`, {
      analysisJobId: analysis.jobId,
      totalSubscriptions: subscriptions.length,
      sentCount,
    });

    return webhookMessages;
  }

  /**
   * Send webhook messages in batch
   */
  async sendWebhookBatch(messages: WebhookQueueMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    logger.info(`Sending batch of ${messages.length} webhook messages`);

    try {
      // Send all messages to the queue
      await this.webhookQueue.sendBatch(messages.map(msg => ({
        body: msg,
        contentType: 'json',
      })));

      logger.info(`Successfully sent ${messages.length} webhook messages to queue`);
    } catch (error: any) {
      logger.error('Failed to send webhook batch to queue', error, {
        messageCount: messages.length,
      });

      // Try to send messages individually as fallback
      for (const message of messages) {
        try {
          await this.webhookQueue.send(message);
        } catch (individualError: any) {
          logger.error('Failed to send individual webhook message', individualError, {
            subscriptionId: message.subscriptionId,
          });
        }
      }
    }
  }

  /**
   * Extract concurso-specific data from database records instead of analysis findings
   */
  private async extractConcursoData(analysis: GazetteAnalysis): Promise<any> {
    // Fetch concurso data from database records instead of analysis findings
    if (!this.concursoRepo) {
      logger.debug('No concurso repository available for data extraction', {
        analysisJobId: analysis.jobId,
      });
      return null;
    }

    try {
      const concursoRecords = await this.concursoRepo.getConcursoFindingsByAnalysisJobId(analysis.jobId);
      
      if (!concursoRecords || concursoRecords.length === 0) {
        logger.debug('No concurso records found in database', {
          analysisJobId: analysis.jobId,
        });
        return null;
      }

      // Use the first record (most recent or primary finding)
      const record = concursoRecords[0];
      
      logger.info('Extracted concurso data from database record', {
        analysisJobId: analysis.jobId,
        concursoId: record.id,
        orgao: record.orgao,
        totalVagas: record.totalVagas,
      });
      
      // Parse JSON fields safely
      const parsedCargos = this.parseJsonSafely(record.cargos, []);
      const parsedDatas = this.parseJsonSafely(record.datas, {});
      const parsedTaxas = this.parseJsonSafely(record.taxas, []);
      const parsedBanca = this.parseJsonSafely(record.banca, {});

      // Extract keywords from analysis summary for backward compatibility
      const keywords = analysis.summary?.keywords || [];

      return {
        // Document classification
        documentType: record.documentType,
        extractionMethod: record.extractionMethod,
        
        // Basic information
        orgao: record.orgao,
        editalNumero: record.editalNumero,
        
        // Vacancies data
        totalVagas: record.totalVagas || 0,
        cargos: parsedCargos,
        
        // Important dates
        datas: parsedDatas,
        
        // Fees
        taxas: parsedTaxas,
        
        // Organization/Banca
        banca: parsedBanca,
        
        // Keywords for backward compatibility
        keywords: keywords,
        
        // Database metadata
        confidence: record.confidence,
        territoryId: record.territoryId,
        createdAt: record.createdAt,
      };
    } catch (error) {
      logger.error('Failed to extract concurso data from database', error as Error, {
        analysisJobId: analysis.jobId,
      });
      return null;
    }
  }

  /**
   * Safely parse JSON string with fallback
   */
  private parseJsonSafely(jsonString: string, fallback: any): any {
    try {
      return JSON.parse(jsonString || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  }

  /**
   * Get PDF URL from analysis
   * Prioritizes R2 URL if available, falls back to original URL
   */
  private async getPdfUrl(analysis: GazetteAnalysis, gazetteId?: string): Promise<string> {
    // Try to get R2 URL from gazette registry
    if (this.gazetteRepo && gazetteId && this.r2PublicUrl) {
      try {
        const gazette = await this.gazetteRepo.getGazetteById(gazetteId);
        
        if (gazette?.pdfR2Key) {
          const r2Url = `${this.r2PublicUrl}/${gazette.pdfR2Key}`;
          logger.info('Using R2 URL for webhook', {
            gazetteId,
            r2Key: gazette.pdfR2Key,
            r2Url,
          });
          return r2Url;
        } else {
          logger.warn('Gazette found but no R2 key available', {
            gazetteId,
            hasGazette: !!gazette,
          });
        }
      } catch (error: any) {
        logger.warn('Failed to fetch R2 key, falling back to original URL', {
          gazetteId,
          error: error.message,
        });
      }
    } else {
      logger.warn('Missing required data for R2 URL lookup', {
        hasGazetteRepo: !!this.gazetteRepo,
        hasGazetteId: !!gazetteId,
        hasR2PublicUrl: !!this.r2PublicUrl,
        analysisJobId: analysis.jobId,
      });
    }
    
    // Fallback to the original PDF URL from analysis
    if (analysis.pdfUrl) {
      return analysis.pdfUrl;
    }
    
    // Last resort: construct a placeholder URL and warn
    logger.warn('No valid PDF URL available, using placeholder format', {
      analysisJobId: analysis.jobId,
      territoryId: analysis.territoryId,
      publicationDate: analysis.publicationDate,
      gazetteId,
    });
    return `/${analysis.territoryId}/${analysis.publicationDate}`;
  }

  /**
   * Get all active webhook subscriptions
   */
  private async getActiveSubscriptions(): Promise<WebhookSubscription[]> {
    try {
      const subscriptions: WebhookSubscription[] = [];
      
      // List all subscription keys
      const list = await this.subscriptionsKV.list({ prefix: 'subscription:' });
      
      for (const key of list.keys) {
        try {
          const subscriptionData = await this.subscriptionsKV.get(key.name);
          if (subscriptionData) {
            const subscription = JSON.parse(subscriptionData) as WebhookSubscription;
            if (subscription.active) {
              subscriptions.push(subscription);
            }
          }
        } catch (error: any) {
          logger.warn('Failed to parse subscription', {
            key: key.name,
            error: error.message,
          });
        }
      }
      
      return subscriptions;
    } catch (error: any) {
      logger.error('Failed to get active subscriptions', error);
      return [];
    }
  }

  /**
   * Create Qconcursos subscription
   */
  static async createQconcursosSubscription(
    subscriptionsKV: KVNamespace,
    webhookUrl: string
  ): Promise<WebhookSubscription> {
    const subscription: WebhookSubscription = {
      id: `qconcursos-${Date.now()}`,
      clientId: 'qconcursos',
      webhookUrl,
      active: true,
      createdAt: new Date().toISOString(),
      filters: {
        categories: ['concurso'],
        requireConcursoFinding: true,
        minConfidence: 0.7,
      },
      maxDeliveries: "always",
    };

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
