/**
 * Crawl Processor - Extracted from worker.ts
 * Processes crawl queue messages and sends results to OCR queue
 */

import { QueueMessage, CrawlResult, SpiderConfig } from '../types';
import type { D1DatabaseEnv } from '../services/database';
import { spiderRegistry } from '../spiders/registry';
import { logger } from '../utils/logger';
import { OcrQueueSender } from '../services/ocr-queue-sender';
import {
  getDatabase,
  TelemetryService,
  GazetteRepository,
  ErrorTracker,
  schema,
} from '../services/database';
import { sql, eq, and } from 'drizzle-orm';

export interface CrawlProcessorEnv extends D1DatabaseEnv {
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

  // Initialize D1 database services
  const databaseClient = getDatabase(env);
  const db = databaseClient.getDb();
  const telemetry = new TelemetryService(databaseClient);
  const gazetteRepo = new GazetteRepository(databaseClient);
  const errorTracker = new ErrorTracker(databaseClient);

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
        'crawl_start',
        'started'
      );

      // Get spider configuration
      const config: SpiderConfig = {
        id: queueMessage.spiderId,
        name: '',
        territoryId: queueMessage.territoryId,
        spiderType: queueMessage.spiderType,
        gazetteScope: queueMessage.gazetteScope || 'city', // Default to city scope if not specified
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

      // Process each gazette: check for existing entries and route accordingly
      if (gazettes.length > 0) {
        const ocrSender = new OcrQueueSender(env.OCR_QUEUE);
        let newGazettes = 0;
        let skippedFailed = 0;
        let reusedSuccess = 0;
        let retriedProcessing = 0;

        for (const gazette of gazettes) {
          try {
            // 1. Check if gazette exists by PDF URL
            const existingGazette = await gazetteRepo.getGazetteByPdfUrl(gazette.fileUrl);
            
            const gazetteJobId = `${crawlJobId}-${gazette.territoryId}-${gazette.date}${gazette.editionNumber ? `-${gazette.editionNumber}` : ''}-${Date.now()}`;

            if (existingGazette) {
              logger.info('Found existing gazette', {
                gazetteId: existingGazette.id,
                status: existingGazette.status,
                pdfUrl: gazette.fileUrl
              });

              // Handle based on status
              if (existingGazette.status === 'ocr_failure') {
                // OCR permanently failed - create failed crawl and skip
                await gazetteRepo.createGazetteCrawl({
                  gazetteId: existingGazette.id,
                  jobId: gazetteJobId,
                  territoryId: queueMessage.territoryId,
                  spiderId: queueMessage.spiderId,
                  status: 'failed',
                  scrapedAt: gazette.scrapedAt
                });
                
                skippedFailed++;
                logger.info('Skipped gazette with permanent OCR failure', {
                  gazetteId: existingGazette.id,
                  pdfUrl: gazette.fileUrl
                });
                continue;
              }

              if (existingGazette.status === 'ocr_success') {
                // OCR already successful - create success crawl and send to analysis
                const gazetteCrawlId = await gazetteRepo.createGazetteCrawl({
                  gazetteId: existingGazette.id,
                  jobId: gazetteJobId,
                  territoryId: queueMessage.territoryId,
                  spiderId: queueMessage.spiderId,
                  status: 'success',
                  scrapedAt: gazette.scrapedAt
                });

                // Send directly to analysis queue (skip OCR)
                if (env.OCR_QUEUE) {
                  await ocrSender.sendGazette(
                    gazette,
                    queueMessage.spiderId,
                    crawlJobId,
                    gazetteCrawlId
                  );
                }

                reusedSuccess++;
                logger.info('Reusing existing OCR result', {
                  gazetteId: existingGazette.id,
                  pdfUrl: gazette.fileUrl
                });
                continue;
              }

              // Status is pending/uploaded/ocr_processing/ocr_retrying
              // Create processing crawl and send to OCR queue (will retry)
              const gazetteCrawlId = await gazetteRepo.createGazetteCrawl({
                gazetteId: existingGazette.id,
                jobId: gazetteJobId,
                territoryId: queueMessage.territoryId,
                spiderId: queueMessage.spiderId,
                status: 'processing',
                scrapedAt: gazette.scrapedAt
              });

              if (env.OCR_QUEUE) {
                await ocrSender.sendGazette(
                  gazette,
                  queueMessage.spiderId,
                  crawlJobId,
                  gazetteCrawlId
                );
              }

              retriedProcessing++;
              logger.info('Re-queued gazette still in processing', {
                gazetteId: existingGazette.id,
                status: existingGazette.status,
                pdfUrl: gazette.fileUrl
              });
              continue;
            }

            // New gazette - create registry and crawl
            const gazetteId = await gazetteRepo.registerGazette(gazette, crawlJobId);
            
            const gazetteCrawlId = await gazetteRepo.createGazetteCrawl({
              gazetteId,
              jobId: gazetteJobId,
              territoryId: queueMessage.territoryId,
              spiderId: queueMessage.spiderId,
              status: 'created',
              scrapedAt: gazette.scrapedAt
            });

            if (env.OCR_QUEUE) {
              await ocrSender.sendGazette(
                gazette,
                queueMessage.spiderId,
                crawlJobId,
                gazetteCrawlId
              );
            }

            newGazettes++;
            logger.info('Registered new gazette', {
              gazetteId,
              pdfUrl: gazette.fileUrl
            });

          } catch (gazetteError) {
            logger.error('Failed to process individual gazette', gazetteError as Error, {
              pdfUrl: gazette.fileUrl,
              territoryId: gazette.territoryId
            });

            await errorTracker
              .trackError({
                workerName: 'goodfellow-crawl',
                operationType: 'process_gazette',
                severity: 'error',
                errorMessage: (gazetteError as Error).message,
                stackTrace: (gazetteError as Error).stack,
                jobId: crawlJobId,
                territoryId: queueMessage.territoryId,
                context: {
                  spiderId: queueMessage.spiderId,
                  pdfUrl: gazette.fileUrl,
                },
              })
              .catch(() => {});
          }
        }

        logger.info('Gazette processing summary', {
          spiderId: queueMessage.spiderId,
          total: gazettes.length,
          newGazettes,
          reusedSuccess,
          retriedProcessing,
          skippedFailed
        });
      }

      // Track successful crawl completion
      await telemetry.trackCityStep(
        crawlJobId,
        queueMessage.territoryId,
        queueMessage.spiderId,
        'crawl_end',
        'completed',
        gazettes.length,
        executionTimeMs
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
        'crawl_end',
        'failed',
        undefined,
        executionTimeMs,
        errorMessage
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
      const jobStatsResult = await db.select({
        total: sql<number>`COUNT(DISTINCT territory_id)`,
        completed: sql<number>`COUNT(DISTINCT CASE WHEN status = 'completed' THEN territory_id END)`,
        failed: sql<number>`COUNT(DISTINCT CASE WHEN status = 'failed' THEN territory_id END)`
      })
      .from(schema.crawlTelemetry)
      .where(and(
        eq(schema.crawlTelemetry.crawlJobId, crawlJobId),
        eq(schema.crawlTelemetry.step, 'crawl_end')
      ));
      const jobStats = jobStatsResult;

      if (jobStats.length > 0 && jobStats[0].total > 0) {
        const { total, completed, failed } = jobStats[0];
        
        // Also check expected cities from crawl_jobs table
        const jobInfo = await db.select({
          total_cities: schema.crawlJobs.totalCities,
          status: schema.crawlJobs.status
        })
        .from(schema.crawlJobs)
        .where(eq(schema.crawlJobs.id, crawlJobId));

        if (jobInfo.length > 0 && jobInfo[0].status === 'running') {
          const expectedCities = jobInfo[0].total_cities;
          
          // If all expected cities have been processed (either completed or failed)
          if (total >= expectedCities) {
            const finalStatus = failed === total ? 'failed' : 'completed';
            
            await db.update(schema.crawlJobs)
              .set({
                status: finalStatus,
                completedAt: databaseClient.getCurrentTimestamp(),
                completedCities: completed,
                failedCities: failed
              })
              .where(eq(schema.crawlJobs.id, crawlJobId));
            
            logger.info('Crawl job marked as complete', {
              crawlJobId,
              status: finalStatus,
              totalCities: total,
              completed,
              failed,
            });
          } else {
            // Update city counts even if not complete
            await db.update(schema.crawlJobs)
              .set({
                completedCities: completed,
                failedCities: failed
              })
              .where(eq(schema.crawlJobs.id, crawlJobId));
          }
        }
      }
    }
  } catch (error) {
    logger.error('Failed to update crawl job status', error as Error);
  }
}
