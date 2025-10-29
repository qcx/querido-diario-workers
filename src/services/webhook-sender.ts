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
  ConcursoData,
  ConcursoFinding,
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

        // Check minimum findings threshold on filtered findings
        if (subscription.filters.minFindings !== undefined) {
          if (findings.length < subscription.filters.minFindings) {
            logger.debug('Filtered findings do not meet minimum threshold', {
              subscriptionId: subscription.id,
              clientId: subscription.clientId,
              filteredFindings: findings.length,
              minFindings: subscription.filters.minFindings,
            });
            continue;
          }
        }

        if (findings.length === 0) {
          logger.debug('No matching findings for subscription', {
            subscriptionId: subscription.id,
          });
          continue;
        }

        // Create notification
        const notification = await this.createNotification(
          subscription,
          analysis,
          findings,
          gazetteId
        );

        // Create webhook message
        const message: WebhookQueueMessage = {
          messageId: `msg-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          subscriptionId: subscription.id,
          notification,
          queuedAt: new Date().toISOString(),
          attempts: 0,
          metadata: {
            crawlJobId: crawlJobId || analysis.jobId,
            territoryId: territoryId || analysis.territoryId,
          },
        };
        
        webhookMessages.push(message);
        sentCount++;

        logger.info('Prepared webhook message', {
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

    // Track if we have findings but no webhook matches
    if (telemetry && crawlJobId && crawlJobId !== 'unknown' && 
        analysis.summary.totalFindings > 0 && webhookMessages.length === 0) {
      await telemetry.trackCityStep(
        crawlJobId,
        territoryId || analysis.territoryId,
        'webhook',
        'webhook_sent',
        'skipped',
        undefined,
        undefined,
        `No subscription matches (checked ${subscriptions.length} subscriptions)`,
        'unknown'
      );
    }

    logger.info(`Collected ${webhookMessages.length} webhook messages`, {
      analysisJobId: analysis.jobId,
      messageCount: webhookMessages.length,
    });
    
    return webhookMessages;
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
   * Create enriched webhook notification
   */
  private async createNotification(
    subscription: WebhookSubscription,
    analysis: GazetteAnalysis,
    findings: WebhookFinding[],
    gazetteId?: string
  ): Promise<WebhookNotification> {
    // Determine event type
    let event: 'gazette.analyzed' | 'concurso.detected' | 'licitacao.detected' = 'gazette.analyzed';
    
    if (analysis.summary.categories.includes('concurso_publico')) {
      event = 'concurso.detected';
    } else if (analysis.summary.categories.includes('licitacao')) {
      event = 'licitacao.detected';
    }

    // Get enriched territory information
    const territoryInfo = TerritoryService.createEnrichedTerritoryInfo(analysis.territoryId);

    // Extract concurso-specific data from findings
    const concursoData = this.extractConcursoData(findings, analysis);

    return {
      notificationId: `notif-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      subscriptionId: subscription.id,
      clientId: subscription.clientId,
      event,
      timestamp: new Date().toISOString(),
      gazette: {
        territoryId: analysis.territoryId,
        territoryName: territoryInfo.territoryName,
        cityName: territoryInfo.cityName,
        stateCode: territoryInfo.stateCode,
        stateName: territoryInfo.stateName,
        region: territoryInfo.region,
        formattedName: territoryInfo.formattedName,
        publicationDate: analysis.publicationDate,
        editionNumber: analysis.metadata?.editionNumber,
        pdfUrl: await this.getPdfUrl(analysis, gazetteId),
        spiderId: analysis.metadata?.spiderId || analysis.territoryId || 'unknown',
        spiderType: territoryInfo.spiderType,
      },
      analysis: {
        jobId: analysis.jobId,
        totalFindings: analysis.summary.totalFindings,
        highConfidenceFindings: analysis.summary.highConfidenceFindings,
        categories: analysis.summary.categories,
        processingTimeMs: analysis.analyses.reduce((total, a) => total + (a.processingTimeMs || 0), 0),
        analyzedAt: analysis.analyzedAt,
        textLength: analysis.textLength,
      },
      findings,
      concurso: event === 'concurso.detected' ? concursoData : undefined,
      metadata: {
        power: analysis.metadata?.power,
        isExtraEdition: analysis.metadata?.isExtraEdition,
        webhookVersion: '2.0',
        source: 'querido-diario',
        crawledAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Send webhook messages in batch
   */
  async sendWebhookBatch(messages: WebhookQueueMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    try {
      // Wrap messages for Cloudflare Queue format
      const wrappedMessages = messages.map(msg => ({ body: msg }));
      await this.webhookQueue.sendBatch(wrappedMessages);
      
      logger.info(`Sent ${messages.length} webhook messages in batch`, {
        count: messages.length,
      });
    } catch (error: any) {
      logger.error(`Failed to send webhook batch`, error, {
        count: messages.length,
      });
      
      // Fallback to individual sends
      for (const message of messages) {
        try {
          await this.webhookQueue.send(message);
        } catch (individualError: any) {
          logger.error(`Failed to send individual webhook message`, individualError, {
            messageId: message.messageId,
          });
        }
      }
    }
  }

  /**
   * Extract concurso-specific data from findings
   */
  private extractConcursoData(findings: WebhookFinding[], analysis: GazetteAnalysis): any {
    // Look for structured concurso data from ConcursoAnalyzer first
    const concursoFindings = analysis.analyses?.find(a => a.analyzerId === 'concurso-analyzer')?.findings || [];
    
    if (concursoFindings.length > 0) {
      const structuredFinding = concursoFindings.find(f => f.data.concursoData) as ConcursoFinding;
      
      if (structuredFinding?.data.concursoData) {
        const structured = structuredFinding.data.concursoData as ConcursoData;
        
        return {
          // Document classification
          documentType: structured.documentType,
          documentTypeConfidence: structured.documentTypeConfidence,
          extractionMethod: structuredFinding.data.extractionMethod,
          
          // Basic information
          orgao: structured.orgao,
          editalNumero: structured.editalNumero,
          
          // Vacancies data
          totalVagas: structured.vagas?.total || 0,
          cargos: structured.vagas?.porCargo?.map(cargo => ({
            cargo: cargo.cargo,
            vagas: cargo.vagas,
            salario: cargo.salario,
            requisitos: cargo.requisitos,
            jornada: cargo.jornada,
          })) || [],
          reservaPCD: structured.vagas?.reservaPCD,
          reservaAmplaConcorrencia: structured.vagas?.reservaAmplaConcorrencia,
          
          // Important dates
          inscricoesInicio: structured.datas?.inscricoesInicio,
          inscricoesFim: structured.datas?.inscricoesFim,
          prova: structured.datas?.prova,
          provaObjetiva: structured.datas?.provaObjetiva,
          provaPratica: structured.datas?.provaPratica,
          resultado: structured.datas?.resultado,
          recursos: structured.datas?.recursos,
          
          // Fees
          taxas: structured.taxas || [],
          
          // Organization/Banca
          banca: structured.banca,
          
          // Multi-city support
          cidades: structured.cidades,
          
          // Status and notes
          status: structured.status,
          observacoes: structured.observacoes,
          
          // Legacy fields for backward compatibility
          keywords: this.extractKeywordsFromFindings(findings),
        };
      }
    }

    // Fallback to legacy extraction for backward compatibility
    return this.extractLegacyConcursoData(findings);
  }

  /**
   * Legacy extraction method for backward compatibility
   */
  private extractLegacyConcursoData(findings: WebhookFinding[]): any {
    const concursoData: any = {
      totalVagas: 0,
      cargos: [],
      inscricoes: null,
      provas: null,
      taxas: [],
      keywords: [],
      extractionMethod: 'legacy'
    };

    for (const finding of findings) {
      // Extract keywords
      if (finding.data.keyword) {
        concursoData.keywords.push(finding.data.keyword);
      }

      // Extract job positions and vacancies
      if (finding.data.cargo && finding.data.vagas) {
        concursoData.cargos.push({
          cargo: finding.data.cargo,
          vagas: finding.data.vagas
        });
        concursoData.totalVagas += finding.data.vagas;
      }

      // Extract registration dates
      if (finding.data.inscricoes) {
        concursoData.inscricoes = finding.data.inscricoes;
      }

      // Extract exam dates
      if (finding.data.provas) {
        concursoData.provas = finding.data.provas;
      }

      // Extract fees
      if (finding.data.taxas) {
        concursoData.taxas.push(finding.data.taxas);
      }
    }

    // Remove duplicates from keywords
    concursoData.keywords = [...new Set(concursoData.keywords)];

    // Only return if we found concurso-specific data
    if (concursoData.totalVagas > 0 || concursoData.keywords.length > 0) {
      return concursoData;
    }

    return null;
  }

  /**
   * Extract keywords from findings for compatibility
   */
  private extractKeywordsFromFindings(findings: WebhookFinding[]): string[] {
    const keywords: string[] = [];
    
    for (const finding of findings) {
      if (finding.data.keyword) {
        keywords.push(finding.data.keyword);
      }
    }
    
    return [...new Set(keywords)];
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
        }
      } catch (error: any) {
        logger.warn('Failed to fetch R2 key, falling back to original URL', {
          gazetteId,
          error: error.message,
        });
      }
    }
    
    // Fallback to the original PDF URL from analysis or construct from territory/date
    return analysis.pdfUrl || `/${analysis.territoryId}/${analysis.publicationDate}`;
  }

  /**
   * Create Qconcursos subscription
   */
  static async createQconcursosSubscription(
    subscriptionsKV: KVNamespace,
    webhookUrl: string,
    authToken?: string,
    territories?: string[],
    maxDeliveries?: number | "always"
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
      maxDeliveries: maxDeliveries,
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
