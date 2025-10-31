/// <reference path="../../worker-configuration.d.ts" />

import { handleCrawlRequest, CrawlQueueMessage, CrawlQueueHandler } from './crawl';
import { GazetteEnqueuer, OcrQueueHandler, OcrQueueMessage } from './ocr';
import { AnalysisQueueHandler, AnalysisQueueMessage, AnalysisCallbackMessage } from './analysis';

/**
 * Goodfellow Worker - Unified worker handling all pipeline stages
 * Combines: Crawl → OCR → Analysis → Webhook
 * Each queue consumer does ONE job and dies, but all run from the same codebase
 */

import { Hono } from 'hono';
import { spiderRegistry } from './crawl/spiders';

// Cloudflare Worker environment is defined globally in worker-configuration.d.ts
// The Env interface extends Cloudflare.Env and includes all necessary bindings:
// - KV namespaces (OCR_RESULTS, ANALYSIS_RESULTS, etc.)
// - R2 buckets (GAZETTE_PDFS)
// - D1 database (DB)
// - Queues (CRAWL_QUEUE, OCR_QUEUE, ANALYSIS_QUEUE, WEBHOOK_QUEUE)
// - Browser rendering (BROWSER)
// - API keys and configuration

const app = new Hono<{ Bindings: Env }>();

/**
 * Health check endpoint
 */
app.get('/', (c) => {
  return c.json({
    service: 'goodfellow',
    version: '2.0.0',
    description: 'Unified gazette processing pipeline',
    spidersRegistered: spiderRegistry.getCount(),
    handlers: ['http', 'crawl-queue', 'ocr-queue', 'analysis-queue', 'webhook-queue'],
    queuesImplemented: {
      crawl: true,
      ocr: true,
      analysis: true,
      webhook: true // Stub handler (acknowledges messages)
    },
    authEnabled: !!c.env.API_KEY,
  });
});

app.post('/crawl', async (c) => handleCrawlRequest(c));

async function handleQueue(
  batch: MessageBatch,
  env: Env
): Promise<void> {
  const queueName = batch.queue;

  switch (queueName) {
    case 'goodfellow-crawl-queue':

      const gazetteEnqueuer = new GazetteEnqueuer(env);
      const crawlQueueHandler = new CrawlQueueHandler(env);

      await crawlQueueHandler.batchHandler(batch as MessageBatch<CrawlQueueMessage>, (gazette, crawlJobId) => {
        return gazetteEnqueuer.enqueueGazette(gazette, crawlJobId);
      });

      break;

    case 'goodfellow-ocr-queue':
      const ocrQueueHandler = new OcrQueueHandler(env);

      await ocrQueueHandler.batchHandler(batch as MessageBatch<OcrQueueMessage>, async (analysisMessage) => {
        // analysisMessage is already in AnalysisQueueMessage format from OCR handler
        await env.ANALYSIS_QUEUE.send(analysisMessage);
      });
      break;

    case 'goodfellow-analysis-queue':
      const analysisQueueHandler = new AnalysisQueueHandler(env);

      await analysisQueueHandler.batchHandler(
        batch as MessageBatch<AnalysisQueueMessage>,
        async (webhookMessage: AnalysisCallbackMessage) => {
          // webhookMessage is in AnalysisCallbackMessage format, ready for webhook queue
          await env.WEBHOOK_QUEUE.send({
            type: 'analysis_complete',
            payload: webhookMessage,
            timestamp: new Date().toISOString()
          });
        }
      );
      break;

    case 'goodfellow-webhook-queue':
      // Webhook queue handler not yet implemented
      // For now, just acknowledge the messages to prevent errors
      for (const message of batch.messages) {
        message.ack();
      }
      break;

    default:
      throw new Error(`Unknown queue: ${queueName}`);
  }
}

/**
 * Export unified worker with both HTTP and Queue handlers
 */
export default {
  // HTTP handler
  fetch: app.fetch,
  // Queue handler - routes to appropriate processor based on queue name
  queue: handleQueue,
};