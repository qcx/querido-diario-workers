import { QueueMessage, CrawlResult, SpiderConfig } from './types';
import { spiderRegistry } from './spiders/registry';
import { logger } from './utils/logger';

export interface Env {
  // Add any environment bindings here if needed
}

/**
 * Queue consumer handler
 */
export default {
  async queue(batch: MessageBatch<QueueMessage>, _env: Env): Promise<void> {
    logger.info('Processing queue batch', { batchSize: batch.messages.length });

    for (const message of batch.messages) {
      const startTime = Date.now();
      
      try {
        const queueMessage = message.body;
        
        logger.setContext({
          spiderId: queueMessage.spiderId,
          territoryId: queueMessage.territoryId,
        });

        logger.info('Processing crawl task', {
          spiderType: queueMessage.spiderType,
          dateRange: queueMessage.dateRange,
        });

        // Get spider configuration
        const config: SpiderConfig = {
          id: queueMessage.spiderId,
          name: '', // Will be filled from registry if needed
          territoryId: queueMessage.territoryId,
          spiderType: queueMessage.spiderType,
          startDate: '', // Will be filled from config
          config: queueMessage.config,
        };

        // Create spider instance
        const spider = spiderRegistry.createSpider(config, queueMessage.dateRange);

        // Execute crawl
        const gazettes = await spider.crawl();

        const executionTimeMs = Date.now() - startTime;

        const result: CrawlResult = {
          spiderId: queueMessage.spiderId,
          territoryId: queueMessage.territoryId,
          gazettes,
          stats: {
            totalFound: gazettes.length,
            dateRange: queueMessage.dateRange,
            requestCount: spider.getRequestCount(),
            executionTimeMs,
          },
        };

        logger.info('Crawl task completed', {
          totalGazettes: gazettes.length,
          executionTimeMs,
          requestCount: spider.getRequestCount(),
        });

        // Log result (in production, you might want to store this in a database or KV)
        console.log(JSON.stringify(result));

        // Acknowledge message
        message.ack();

      } catch (error) {
        const executionTimeMs = Date.now() - startTime;
        
        logger.error('Crawl task failed', error as Error, {
          executionTimeMs,
          retryCount: message.attempts,
        });

        // Retry the message (will go to DLQ after max retries)
        message.retry();
      } finally {
        logger.clearContext();
      }
    }
  },
};
