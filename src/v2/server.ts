/// <reference path="../../worker-configuration.d.ts" />

import { handleCrawlRequest, CrawlQueueMessage, CrawlQueueHandler } from './crawl';
import { GazetteEnqueuer } from './ocr';

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
    version: '1.0.0',
    description: 'Unified gazette processing pipeline',
    spidersRegistered: spiderRegistry.getCount(),
    handlers: ['http', 'crawl-queue', 'ocr-queue', 'analysis-queue', 'webhook-queue'],
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
        await processOcrBatch(batch as MessageBatch<OcrQueueMessage>, env as OcrProcessorEnv);
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