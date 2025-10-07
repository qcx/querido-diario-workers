import { Hono } from 'hono';
import { Gazette } from './types';
import { spiderRegistry } from './spiders/registry';
import { logger } from './utils/logger';
import { toISODate } from './utils/date-utils';
import { MistralOcrService } from './services/mistral-ocr';
import { AnalysisOrchestrator } from './services/analysis-orchestrator';
import { AnalysisConfig } from './types';
// import { WebhookSenderService } from './services/webhook-sender';
import { WebhookFilterService } from './services/webhook-filter';
import type { 
  // SpiderConfig, 
  DateRange, 
  OcrQueueMessage, 
  OcrResult, 
  // AnalysisQueueMessage, 
  GazetteAnalysis,
  WebhookSubscription,
  // WebhookQueueMessage 
} from './types';

/**
 * Local Test Worker - Executes the complete pipeline in a single worker
 * This is designed for local testing and debugging without queue dependencies
 */

interface LocalTestEnv {
  MISTRAL_API_KEY?: string;
  OPENAI_API_KEY?: string;
  BROWSER: Fetcher;
}

interface LocalTestRequest {
  cities: string[];
  startDate?: string;
  endDate?: string;
  enableOcr?: boolean;
  enableAnalysis?: boolean;
  enableWebhook?: boolean;
  mockWebhook?: boolean;
}

interface LocalTestResult {
  cityId: string;
  success: boolean;
  pipeline: {
    crawl: {
      success: boolean;
      gazetteCount: number;
      error?: string;
    };
    ocr: {
      success: boolean;
      processedCount: number;
      error?: string;
    };
    analysis: {
      success: boolean;
      analysisCount: number;
      concursosDetected: number;
      error?: string;
    };
    webhook: {
      success: boolean;
      sentCount: number;
      error?: string;
    };
  };
  executionTime: number;
}

const app = new Hono<{ Bindings: LocalTestEnv }>();

// Mock webhook subscriptions for local testing
const MOCK_WEBHOOK_SUBSCRIPTIONS: Record<string, WebhookSubscription> = {
  'grupoq-concursos-local': {
    id: 'grupoq-concursos-local',
    clientId: 'grupoq-concursos',
    webhookUrl: 'https://n8n.grupoq.io/webhook/webhook-concursos',
    filters: {
      categories: ['concurso_publico'],
      keywords: [
        'concurso público',
        'concurso',
        'edital de concurso',
        'seleção pública',
        'processo seletivo',
        'inscrições abertas',
        'vagas'
      ],
      minConfidence: 0.7,
      minFindings: 1
    },
    retry: {
      maxAttempts: 3,
      backoffMs: 5000
    },
    active: true,
    createdAt: new Date().toISOString()
  }
};

app.get('/', (c) => {
  return c.json({
    service: 'querido-diario-local-test',
    version: '1.0.0',
    description: 'Complete pipeline testing worker',
    spidersRegistered: spiderRegistry.getCount(),
  });
});

app.post('/test-pipeline', async (c) => {
  const request = await c.req.json<LocalTestRequest>();
  const startTime = Date.now();
  
  logger.info('🧪 Starting local pipeline test', {
    cities: request.cities,
    dateRange: { start: request.startDate, end: request.endDate }
  });

  const results: LocalTestResult[] = [];

  for (const cityId of request.cities) {
    const cityStartTime = Date.now();
    const result: LocalTestResult = {
      cityId,
      success: false,
      pipeline: {
        crawl: { success: false, gazetteCount: 0 },
        ocr: { success: false, processedCount: 0 },
        analysis: { success: false, analysisCount: 0, concursosDetected: 0 },
        webhook: { success: false, sentCount: 0 }
      },
      executionTime: 0
    };

    try {
      // Step 1: Crawl
      const crawlResult = await performCrawl(cityId, request, c.env);
      result.pipeline.crawl = crawlResult;

      if (!crawlResult.success || crawlResult.gazettes.length === 0) {
        result.executionTime = Date.now() - cityStartTime;
        results.push(result);
        continue;
      }

      // Step 2: OCR (if enabled)
      let ocrResults: OcrResult[] = [];
      if (request.enableOcr && c.env.MISTRAL_API_KEY) {
        const ocrResult = await performOCR(crawlResult.gazettes, c.env);
        result.pipeline.ocr = ocrResult;
        ocrResults = ocrResult.results;
      } else {
        // Mock OCR results
        ocrResults = crawlResult.gazettes.map(gazette => ({
          jobId: `ocr-${gazette.date}-${gazette.territoryId}`,
          territoryId: gazette.territoryId,
          gazetteDate: gazette.date,
          pdfUrl: gazette.url,
          extractedText: `PREFEITURA MUNICIPAL - ${cityId}\n\nEDITAL DE CONCURSO PÚBLICO N° 001/2025\n\nTorna público que realizará CONCURSO PÚBLICO para provimento de vagas...`,
          confidence: 0.95,
          pageCount: 1,
          processedAt: new Date().toISOString(),
          status: 'success' as const
        }));
        result.pipeline.ocr = { success: true, processedCount: ocrResults.length };
      }

      // Step 3: Analysis (if enabled)
      let analyses: GazetteAnalysis[] = [];
      if (request.enableAnalysis && ocrResults.length > 0) {
        const analysisResult = await performAnalysis(ocrResults, c.env);
        result.pipeline.analysis = analysisResult;
        analyses = analysisResult.analyses;
      }

      // Step 4: Webhook (if enabled)
      if (request.enableWebhook && analyses.length > 0) {
        const webhookResult = await performWebhook(analyses, request.mockWebhook || false);
        result.pipeline.webhook = webhookResult;
      }

      result.success = true;
    } catch (error: any) {
      logger.error(`Pipeline failed for ${cityId}`, error);
      result.success = false;
    }

    result.executionTime = Date.now() - cityStartTime;
    results.push(result);
  }

  const totalTime = Date.now() - startTime;
  
  return c.json({
    success: true,
    totalExecutionTime: totalTime,
    results,
    summary: {
      totalCities: request.cities.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      totalGazettes: results.reduce((sum, r) => sum + r.pipeline.crawl.gazetteCount, 0),
      totalOcrProcessed: results.reduce((sum, r) => sum + r.pipeline.ocr.processedCount, 0),
      totalAnalyses: results.reduce((sum, r) => sum + r.pipeline.analysis.analysisCount, 0),
      totalConcursosDetected: results.reduce((sum, r) => sum + r.pipeline.analysis.concursosDetected, 0),
      totalWebhooksSent: results.reduce((sum, r) => sum + r.pipeline.webhook.sentCount, 0)
    }
  });
});

async function performCrawl(cityId: string, request: LocalTestRequest, env: LocalTestEnv) {
  try {
    logger.info(`📄 Step 1: Crawling gazettes for ${cityId}`);
    
    // Get spider configuration from registry
    const allConfigs = spiderRegistry.getAllConfigs();
    const config = allConfigs.find(c => c.id === cityId);
    
    if (!config) {
      return { success: false, gazetteCount: 0, gazettes: [], error: `City ${cityId} not found` };
    }

    const dateRange = getDateRange(request.startDate, request.endDate);
    const spider = spiderRegistry.createSpider(config, dateRange, env.BROWSER);
    const gazettes = await spider.crawl();

    logger.info(`✅ Crawl completed for ${cityId}`, { gazetteCount: gazettes.length });
    return { success: true, gazetteCount: gazettes.length, gazettes };
  } catch (error: any) {
    logger.error(`❌ Crawl failed for ${cityId}`, error);
    return { success: false, gazetteCount: 0, gazettes: [], error: error.message };
  }
}

async function performOCR(gazettes: Gazette[], env: LocalTestEnv) {
  try {
    logger.info(`🔍 Step 2: OCR processing ${gazettes.length} gazettes`);
    
    if (!env.MISTRAL_API_KEY) {
      throw new Error('MISTRAL_API_KEY not configured');
    }

    const ocrService = new MistralOcrService({
      apiKey: env.MISTRAL_API_KEY,
      r2Bucket: undefined // Not needed for local testing
    });

    const results: OcrResult[] = [];
    
    for (const gazette of gazettes.slice(0, 3)) { // Limit for testing
      const ocrMessage: OcrQueueMessage = {
        jobId: `ocr-${gazette.date}-${gazette.territoryId}`,
        territoryId: gazette.territoryId,
        gazetteDate: gazette.date,
        pdfUrl: gazette.url,
        queuedAt: new Date().toISOString()
      };

      try {
        const result = await ocrService.processPdf(ocrMessage);
        if (result.status === 'success') {
          results.push(result);
        }
      } catch (error) {
        logger.error('OCR processing failed for gazette', error, { gazetteUrl: gazette.url });
      }
    }

    logger.info(`✅ OCR completed`, { processedCount: results.length });
    return { success: true, processedCount: results.length, results };
  } catch (error: any) {
    logger.error(`❌ OCR failed`, error);
    return { success: false, processedCount: 0, results: [], error: error.message };
  }
}

async function performAnalysis(ocrResults: OcrResult[], env: LocalTestEnv) {
  try {
    logger.info(`🤖 Step 3: Analyzing ${ocrResults.length} OCR results`);
    
    const config: AnalysisConfig = {
      analyzers: {
        keyword: {
          enabled: true,
          priority: 1,
          timeout: 10000,
        },
        entity: {
          enabled: true,
          priority: 2,
          timeout: 15000,
        },
        concurso: {
          enabled: true,
          priority: 1.5, // High priority for concurso detection
          timeout: 20000,
          useAIExtraction: !!env.OPENAI_API_KEY,
          apiKey: env.OPENAI_API_KEY,
          model: 'gpt-4o-mini',
        },
        ai: {
          enabled: !!env.OPENAI_API_KEY,
          priority: 3,
          timeout: 30000,
          apiKey: env.OPENAI_API_KEY,
        },
      },
    };

    const orchestrator = new AnalysisOrchestrator(config);
    const analyses: GazetteAnalysis[] = [];
    let concursosDetected = 0;

    for (const ocrResult of ocrResults) {
      try {
        const analysis = await orchestrator.analyze(ocrResult, ocrResult.territoryId);
        analyses.push(analysis);
        
        // Check if concurso was detected - look in summary and specific analyzers
        const hasConcurso = analysis.summary.categories.includes('concurso_publico') ||
          analysis.analyses.some(a => a.analyzerId === 'concurso-analyzer' && a.findings.length > 0);
        
        if (hasConcurso) {
          concursosDetected++;
        }

      } catch (error) {
        logger.error('Analysis failed for OCR result', error, { jobId: ocrResult.jobId });
      }
    }

    logger.info(`✅ Analysis completed`, { analysisCount: analyses.length, concursosDetected });
    return { success: true, analysisCount: analyses.length, concursosDetected, analyses };
  } catch (error: any) {
    logger.error(`❌ Analysis failed`, error);
    return { success: false, analysisCount: 0, concursosDetected: 0, analyses: [], error: error.message };
  }
}

async function performWebhook(analyses: GazetteAnalysis[], mockMode: boolean) {
  try {
    logger.info(`📨 Step 4: Processing webhooks for ${analyses.length} analyses`);
    
    let sentCount = 0;

    for (const analysis of analyses) {
      // Check against mock subscriptions
      for (const subscription of Object.values(MOCK_WEBHOOK_SUBSCRIPTIONS)) {
        if (!subscription.active) continue;

        // Check if analysis matches filters
        const matches = WebhookFilterService.matches(analysis, subscription.filters);
        
        if (!matches) continue;

        // Extract relevant findings
        const findings = WebhookFilterService.extractFindings(analysis, subscription.filters);
        
        if (findings.length === 0) continue;

        // Create notification
        const notification = {
          eventType: 'concurso.detected',
          timestamp: new Date().toISOString(),
          gazette: {
            territoryId: analysis.territoryId,
            date: analysis.gazetteDate,
            url: analysis.pdfUrl || 'N/A'
          },
          findings: findings.map(f => ({
            category: f.categories?.[0] || 'unknown',
            confidence: f.confidence,
            text: f.text,
            keywords: f.keywords
          }))
        };

        if (mockMode) {
          // Just log the webhook that would be sent
          logger.info(`📤 [MOCK] Webhook would be sent`, {
            subscriptionId: subscription.id,
            webhookUrl: subscription.webhookUrl,
            findings: findings.length
          });
          sentCount++;
        } else {
          // Actually send the webhook
          try {
            const response = await fetch(subscription.webhookUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Querido-Diario-Local-Test/1.0'
              },
              body: JSON.stringify(notification)
            });

            if (response.ok) {
              logger.info(`📤 Webhook sent successfully`, {
                subscriptionId: subscription.id,
                statusCode: response.status
              });
              sentCount++;
            } else {
              logger.error(`Webhook delivery failed`, {
                subscriptionId: subscription.id,
                statusCode: response.status,
                statusText: response.statusText
              });
            }
          } catch (error: any) {
            logger.error(`Webhook request failed`, error, {
              subscriptionId: subscription.id,
              webhookUrl: subscription.webhookUrl
            });
          }
        }
      }
    }

    logger.info(`✅ Webhook processing completed`, { sentCount });
    return { success: true, sentCount };
  } catch (error: any) {
    logger.error(`❌ Webhook processing failed`, error);
    return { success: false, sentCount: 0, error: error.message };
  }
}

function getDateRange(startDate?: string, endDate?: string): DateRange {
  const now = new Date();
  
  // Default: last 7 days for testing
  const defaultStart = new Date(now);
  defaultStart.setDate(defaultStart.getDate() - 7);
  
  return {
    start: startDate || toISODate(defaultStart),
    end: endDate || toISODate(now),
  };
}

export default app;
