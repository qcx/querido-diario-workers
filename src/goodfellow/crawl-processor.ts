/**
 * Crawl Processor - Extracted from worker.ts
 * Processes crawl queue messages and sends results to OCR queue
 */

import { QueueMessage, CrawlResult, SpiderConfig } from '../types';
import type { DatabaseEnv } from '../services/database';
import { spiderRegistry } from '../spiders/registry';
import { logger } from '../utils/logger';
import { OcrQueueSender } from '../services/ocr-queue-sender';
import {
  getDatabase,
  TelemetryService,
  GazetteRepository,
  ErrorTracker,
} from '../services/database';

export interface CrawlProcessorEnv extends DatabaseEnv {
  OCR_QUEUE: Queue<any>;
  BROWSER: Fetcher;
}

/**
 * Process a batch of crawl queue messages
 */
export async function processCrawlBatch(
  batch: MessageBatch<QueueMessage>,
  env: CrawlProcessorEnv
): Promise<void> {
  logger.info('Processing crawl queue batch', { batchSize: batch.messages.length });

  // Initialize database services
  const db = getDatabase(env);
  const telemetry = new TelemetryService(db);
  const gazetteRepo = new GazetteRepository(db);
  const errorTracker = new ErrorTracker(db);

  for (const message of batch.messages) {
    const startTime = Date.now();
    const queueMessage = message.body;
    const crawlJobId = queueMessage.metadata?.crawlJobId || 'unknown';

    try {
      logger.setContext({
        spiderId: queueMessage.spiderId,
        territoryId: queueMessage.territoryId,
        crawlJobId,
      });

      logger.info('Processing crawl task', {
        spiderType: queueMessage.spiderType,
        dateRange: queueMessage.dateRange,
        crawlJobId,
      });

      // Track crawl start
      await telemetry.trackCityStep(
        crawlJobId,
        queueMessage.territoryId,
        queueMessage.spiderId,
        queueMessage.spiderType,
        'crawl_start',
        'started'
      );

      // Get spider configuration
      const config: SpiderConfig = {
        id: queueMessage.spiderId,
        name: '',
        territoryId: queueMessage.territoryId,
        spiderType: queueMessage.spiderType,
        startDate: '',
        config: queueMessage.config,
      };

      // Create spider instance
      const spider = spiderRegistry.createSpider(
        config,
        queueMessage.dateRange,
        env.BROWSER
      );

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
        spiderId: result.spiderId,
        totalFound: result.stats.totalFound,
        executionTimeMs: result.stats.executionTimeMs,
      });

      // Save gazettes to database registry if any were found
      if (gazettes.length > 0) {
        try {
          const gazetteJobIds = await gazetteRepo.registerGazettes(
            gazettes,
            crawlJobId
          );

          logger.info('Gazettes registered in database', {
            spiderId: queueMessage.spiderId,
            count: gazettes.length,
            gazetteJobIds: gazetteJobIds.length,
          });
        } catch (error) {
          logger.error(
            'Failed to register gazettes in database',
            error as Error,
            {
              spiderId: queueMessage.spiderId,
              count: gazettes.length,
            }
          );

          await errorTracker
            .trackDatabaseError(
              'goodfellow-crawl',
              'register_gazettes',
              error as Error,
              'INSERT INTO gazette_registry',
              crawlJobId
            )
            .catch(() => {});
        }
      }

      // Send gazettes to OCR queue if any were found
      if (gazettes.length > 0 && env.OCR_QUEUE) {
        try {
          const ocrSender = new OcrQueueSender(env.OCR_QUEUE);
          await ocrSender.sendGazettes(
            gazettes,
            queueMessage.spiderId,
            crawlJobId
          );

          logger.info('Gazettes sent to OCR queue', {
            spiderId: queueMessage.spiderId,
            count: gazettes.length,
          });
        } catch (error) {
          logger.error(
            'Failed to send gazettes to OCR queue',
            error as Error,
            {
              spiderId: queueMessage.spiderId,
              count: gazettes.length,
            }
          );

          await errorTracker
            .trackError({
              workerName: 'goodfellow-crawl',
              operationType: 'queue_send_ocr',
              severity: 'error',
              errorMessage: (error as Error).message,
              stackTrace: (error as Error).stack,
              jobId: crawlJobId,
              territoryId: queueMessage.territoryId,
              context: {
                spiderId: queueMessage.spiderId,
                gazetteCount: gazettes.length,
              },
            })
            .catch(() => {});
        }
      }

      // Track successful crawl completion
      await telemetry.trackCityStep(
        crawlJobId,
        queueMessage.territoryId,
        queueMessage.spiderId,
        queueMessage.spiderType,
        'crawl_end',
        'completed',
        {
          executionTimeMs,
          gazettesFound: gazettes.length,
        }
      );

      // Acknowledge message
      message.ack();
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';

      logger.error('Crawl task failed', error as Error, {
        spiderId: queueMessage.spiderId,
        territoryId: queueMessage.territoryId,
        crawlJobId,
      });

      // Track crawl failure
      await telemetry.trackCityStep(
        crawlJobId,
        queueMessage.territoryId,
        queueMessage.spiderId,
        queueMessage.spiderType,
        'crawl_end',
        'failed',
        {
          executionTimeMs,
          errorMessage,
        }
      );

      await errorTracker.trackCriticalError(
        'goodfellow-crawl', 
        'crawl_processing', 
        error as Error, 
        {
          spiderId: queueMessage.spiderId,
          territoryId: queueMessage.territoryId,
          crawlJobId,
          executionTimeMs,
        }
      );

      // Retry the message
      message.retry();
    } finally {
      logger.clearContext();
    }
  }

  // Check if crawl job should be marked as complete
  try {
    // Get unique crawl job IDs from this batch
    const crawlJobIds = new Set(
      batch.messages
        .map(msg => msg.body.metadata?.crawlJobId)
        .filter((id): id is string => id !== undefined && id !== 'unknown')
    );

    for (const crawlJobId of crawlJobIds) {
      // Check job completion status
      const jobStats = await db.queryTemplate`
        SELECT 
          COUNT(DISTINCT territory_id) as total,
          COUNT(DISTINCT CASE WHEN status = 'completed' THEN territory_id END) as completed,
          COUNT(DISTINCT CASE WHEN status = 'failed' THEN territory_id END) as failed
        FROM crawl_telemetry
        WHERE crawl_job_id = ${crawlJobId}
          AND step = 'crawl_end'
      `;

      if (jobStats.length > 0 && jobStats[0].total > 0) {
        const { total, completed, failed } = jobStats[0];
        
        // Also check expected cities from crawl_jobs table
        const jobInfo = await db.queryTemplate`
          SELECT total_cities, status 
          FROM crawl_jobs 
          WHERE id = ${crawlJobId}
        `;

        if (jobInfo.length > 0 && jobInfo[0].status === 'running') {
          const expectedCities = jobInfo[0].total_cities;
          
          // If all expected cities have been processed (either completed or failed)
          if (total >= expectedCities) {
            const finalStatus = failed === total ? 'failed' : 'completed';
            
            await db.queryTemplate`
              UPDATE crawl_jobs 
              SET 
                status = ${finalStatus}::job_status,
                completed_at = NOW(),
                completed_cities = ${completed},
                failed_cities = ${failed}
              WHERE id = ${crawlJobId}
            `;
            
            logger.info('Crawl job marked as complete', {
              crawlJobId,
              status: finalStatus,
              totalCities: total,
              completed,
              failed,
            });
          } else {
            // Update city counts even if not complete
            await db.queryTemplate`
              UPDATE crawl_jobs 
              SET 
                completed_cities = ${completed},
                failed_cities = ${failed}
              WHERE id = ${crawlJobId}
            `;
          }
        }
      }
    }
  } catch (error) {
    logger.error('Failed to update crawl job status', error as Error);
  }
}
