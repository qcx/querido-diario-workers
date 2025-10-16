/**
 * OCR Processor - Extracted from ocr-worker.ts
 * Processes OCR queue messages and sends results to analysis queue
 */

import { OcrQueueMessage, OcrResult, AnalysisQueueMessage } from '../types';
import type { D1DatabaseEnv } from '../services/database';
import { MistralOcrService } from '../services/mistral-ocr';
import { logger } from '../utils';
import {
  getDatabase,
  TelemetryService,
  OcrRepository,
  GazetteRepository,
  ErrorTracker,
  schema,
} from '../services/database';
import { sql, eq, and, like, desc } from 'drizzle-orm';

export interface OcrProcessorEnv extends D1DatabaseEnv {
  ANALYSIS_QUEUE?: Queue<AnalysisQueueMessage>;
  MISTRAL_API_KEY: string;
  OCR_RESULTS?: KVNamespace;
  GAZETTE_PDFS?: R2Bucket;
  R2_PUBLIC_URL?: string;
}

/**
 * Process a batch of OCR queue messages
 */
export async function processOcrBatch(
  batch: MessageBatch<OcrQueueMessage>,
  env: OcrProcessorEnv
): Promise<void> {
  logger.info(`OCR Processor: Processing batch of ${batch.messages.length} messages`);

  // Initialize OCR service (shared across batch)
  const ocrService = new MistralOcrService({
    apiKey: env.MISTRAL_API_KEY,
    r2Bucket: env.GAZETTE_PDFS,
    r2PublicUrl: env.R2_PUBLIC_URL,
  });

  const results: OcrResult[] = [];
  const successfulResults: { ocrMessage: OcrQueueMessage; result: OcrResult }[] = [];

  for (const message of batch.messages) {
    const startTime = Date.now();
    const ocrMessage = message.body;
    const crawlJobId = ocrMessage.metadata?.crawlJobId || 'unknown';

    // Initialize database services per message
    const databaseClient = getDatabase(env);
    const db = databaseClient.getDb();
    const telemetry = new TelemetryService(databaseClient);
    const ocrRepo = new OcrRepository(databaseClient);
    const gazetteRepo = new GazetteRepository(databaseClient);
    const errorTracker = new ErrorTracker(databaseClient);

    try {
      logger.info(`Processing OCR job ${ocrMessage.jobId}`, {
        jobId: ocrMessage.jobId,
        pdfUrl: ocrMessage.pdfUrl,
        territoryId: ocrMessage.territoryId,
        crawlJobId,
      });

      // Track OCR start
      await telemetry.trackCityStep(
        crawlJobId,
        ocrMessage.territoryId,
        ocrMessage.spiderId,
        'ocr_start',
        'started'
      );

      let result: OcrResult;

      // Check if already processed in database first
      const existingOcr = await ocrRepo.ocrResultExists(ocrMessage.jobId);
      if (existingOcr) {
        const ocrRecord = await ocrRepo.getOcrResultByJobId(ocrMessage.jobId);
        if (ocrRecord) {
          logger.info(`OCR job ${ocrMessage.jobId} already processed (database hit)`, {
            jobId: ocrMessage.jobId,
          });

          result = {
            jobId: ocrMessage.jobId,
            status: 'success',
            extractedText: ocrRecord.extractedText,
            pdfUrl: ocrMessage.pdfUrl,
            territoryId: ocrMessage.territoryId,
            publicationDate: ocrMessage.publicationDate,
            editionNumber: ocrMessage.editionNumber,
            spiderId: ocrMessage.spiderId,
            processingTimeMs: ocrRecord.metadata.processingTimeMs,
            completedAt: ocrRecord.createdAt,
            metadata: ocrRecord.metadata,
          };
        } else {
          result = await ocrService.processPdf(ocrMessage);
        }
      } else {
        // Check KV cache as fallback
        let cached = null;
        if (env.OCR_RESULTS) {
          const cachedData = await env.OCR_RESULTS.get(`ocr:${ocrMessage.jobId}`);
          if (cachedData) {
            cached = JSON.parse(cachedData);
            logger.info(`OCR job ${ocrMessage.jobId} found in KV cache`, {
              jobId: ocrMessage.jobId,
            });
          }
        }

        if (cached) {
          result = cached;
        } else {
          // Process the PDF
          result = await ocrService.processPdf(ocrMessage);
        }

        // Store in database
        if (result.status === 'success' && result.extractedText) {
          try {
            await ocrRepo.storeOcrResult(result);
            logger.info(`OCR result stored in database`, {
              jobId: ocrMessage.jobId,
              textLength: result.extractedText.length,
            });
            
            // Update gazette with R2 key if available
            if (result.pdfR2Key) {
              try {
                // Construct the gazette job ID format: crawlJobId-territoryId-date-editionNumber
                const gazetteJobId = `${crawlJobId}-${ocrMessage.territoryId}-${ocrMessage.publicationDate}${ocrMessage.editionNumber ? `-${ocrMessage.editionNumber}` : ''}`;
                const gazette = await gazetteRepo.getGazetteByJobId(gazetteJobId);
                if (gazette) {
                  await gazetteRepo.updateR2Key(gazette.id, result.pdfR2Key);
                  logger.info(`Updated gazette with R2 key`, {
                    ocrJobId: ocrMessage.jobId,
                    gazetteJobId,
                    gazetteId: gazette.id,
                    pdfR2Key: result.pdfR2Key,
                  });
                } else {
                  logger.warn(`Gazette not found for job ID`, {
                    gazetteJobId,
                    ocrJobId: ocrMessage.jobId,
                  });
                }
              } catch (r2Error) {
                logger.error(
                  `Failed to update gazette R2 key`,
                  r2Error as Error,
                  {
                    ocrJobId: ocrMessage.jobId,
                    crawlJobId,
                    pdfR2Key: result.pdfR2Key,
                  }
                );
              }
            }
          } catch (dbError) {
            logger.error(
              `Failed to store OCR result in database`,
              dbError as Error,
              {
                jobId: ocrMessage.jobId,
                crawlJobId,
              }
            );
          }
        }

        // Store in KV cache
        if (env.OCR_RESULTS) {
          await env.OCR_RESULTS.put(
            `ocr:${ocrMessage.jobId}`,
            JSON.stringify(result),
            {
              expirationTtl: 86400 * 7, // 7 days
            }
          );
        }
      }

      results.push(result);

      const executionTimeMs = Date.now() - startTime;

      // Store OCR metadata (separate from OCR results)
      try {
        const gazetteResult = await db.select({ id: schema.gazetteRegistry.id })
          .from(schema.gazetteRegistry)
          .where(and(
            eq(schema.gazetteRegistry.territoryId, ocrMessage.territoryId),
            eq(schema.gazetteRegistry.publicationDate, ocrMessage.publicationDate)
          ))
          .orderBy(desc(schema.gazetteRegistry.createdAt))
          .limit(1);
        
        if (gazetteResult.length > 0) {
          const gazetteId = gazetteResult[0].id;
          const ocrStatus = result.status === 'success' ? 'success' : 'failure';
          
          // Check if metadata already exists
          const existing = await db.select({ id: schema.ocrMetadata.id })
            .from(schema.ocrMetadata)
            .where(eq(schema.ocrMetadata.jobId, ocrMessage.jobId));
          
          if (existing.length === 0) {
            await db.insert(schema.ocrMetadata).values({
              id: databaseClient.generateId(),
              jobId: ocrMessage.jobId,
              gazetteId,
              status: ocrStatus,
              pagesProcessed: result.pagesProcessed || 0,
              processingTimeMs: executionTimeMs,
              textLength: result.extractedText?.length || 0,
              completedAt: databaseClient.getCurrentTimestamp(),
              errorCode: result.error?.code || null,
              errorMessage: result.error?.message || null,
              metadata: JSON.stringify({
                processingMethod: result.processingMethod || 'mistral',
                confidenceScore: result.confidenceScore,
                languageDetected: result.languageDetected || 'pt',
                docSizeBytes: result.docSizeBytes,
                crawlJobId: crawlJobId
              })
            });
            
            logger.info('OCR metadata stored successfully', {
              jobId: ocrMessage.jobId,
              status: ocrStatus,
              executionTimeMs
            });
          }
        }
      } catch (metadataError) {
        logger.error('Failed to store OCR metadata', metadataError as Error, {
          jobId: ocrMessage.jobId,
          crawlJobId
        });
      }

      // Track OCR completion
      await telemetry.trackCityStep(
        crawlJobId,
        ocrMessage.territoryId,
        ocrMessage.spiderId,
        'ocr_end',
        result.status === 'success' ? 'completed' : 'failed',
        undefined,
        executionTimeMs,
        result.error?.message
      );

      // Handle failure results (OCR service returns failure, doesn't throw)
      if (result.status === 'failure') {
        logger.error('🔥 OCR FAILED - Logging to error_logs', null, {
          jobId: ocrMessage.jobId,
          status: result.status,
          errorMessage: result.error?.message,
          crawlJobId,
        });

        // Log OCR failure to error_logs table
        await db.insert(schema.errorLogs).values({
          id: databaseClient.generateId(),
          workerName: 'goodfellow-ocr',
          operationType: 'ocr_processing',
          severity: 'error',
          errorMessage: result.error?.message || 'OCR processing failed',
          stackTrace: result.error?.details || null,
          context: JSON.stringify({
            jobId: ocrMessage.jobId,
            pdfUrl: ocrMessage.pdfUrl,
            executionTimeMs,
            status: result.status,
          }),
          jobId: crawlJobId,
          territoryId: ocrMessage.territoryId
        });

        logger.info('🔥 OCR FAILURE LOGGED TO DATABASE!', {
          jobId: ocrMessage.jobId,
          crawlJobId,
        });
      }

      // Collect successful OCR results for batch sending
      if (result.status === 'success') {
        successfulResults.push({ ocrMessage, result });
      }

      // Acknowledge message
      message.ack();

      logger.info(`OCR job ${ocrMessage.jobId} completed`, {
        jobId: ocrMessage.jobId,
        status: result.status,
        textLength: result.extractedText?.length || 0,
        executionTimeMs,
        crawlJobId,
      });
    } catch (error: any) {
      const executionTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error(`🔥 CATCH BLOCK REACHED - Error processing OCR message`, error, {
        jobId: ocrMessage.jobId,
        crawlJobId,
        catchBlockReached: true,
      });

      // Track OCR failure
      await telemetry.trackCityStep(
        crawlJobId,
        ocrMessage.territoryId,
        ocrMessage.spiderId,
        'ocr_end',
        'failed',
        undefined,
        executionTimeMs,
        errorMessage
      );

      // Track the OCR error directly in database
      logger.info('🔥 ABOUT TO INSERT ERROR INTO DATABASE', {
        jobId: ocrMessage.jobId,
        errorMessage: errorMessage.substring(0, 100),
        crawlJobId,
      });
      
      await db.insert(schema.errorLogs).values({
        id: databaseClient.generateId(),
        workerName: 'goodfellow-ocr',
        operationType: 'ocr_processing',
        severity: 'critical',
        errorMessage,
        stackTrace: (error as Error).stack || null,
        context: JSON.stringify({
          jobId: ocrMessage.jobId,
          pdfUrl: ocrMessage.pdfUrl,
          executionTimeMs,
        }),
        jobId: crawlJobId,
        territoryId: ocrMessage.territoryId
      });
      
      logger.info('🔥 OCR ERROR INSERTED INTO DATABASE!', {
        jobId: ocrMessage.jobId,
        crawlJobId,
      });

      // Retry message
      message.retry();
    }
  }

  // Send successful results to analysis queue in batch
  if (successfulResults.length > 0 && env.ANALYSIS_QUEUE) {
    try {
      const analysisMessages: AnalysisQueueMessage[] = successfulResults.map(
        ({ ocrMessage }) => ({
          jobId: `analysis-${ocrMessage.jobId}`,
          ocrJobId: ocrMessage.jobId,
          territoryId: ocrMessage.territoryId,
          gazetteDate: ocrMessage.publicationDate,
          pdfUrl: ocrMessage.pdfUrl,
          queuedAt: new Date().toISOString(),
          metadata: {
            crawlJobId: ocrMessage.metadata?.crawlJobId,
          },
        })
      );

      const wrappedMessages = analysisMessages.map((msg) => ({ body: msg }));
      await env.ANALYSIS_QUEUE.sendBatch(wrappedMessages);

      logger.info(
        `Sent ${analysisMessages.length} OCR results to analysis queue in batch`,
        {
          count: analysisMessages.length,
        }
      );
    } catch (error: any) {
      logger.error(`Failed to send batch to analysis queue`, error);
      
      // Fallback to individual sends
      for (const { ocrMessage } of successfulResults) {
        try {
          const analysisMessage: AnalysisQueueMessage = {
            jobId: `analysis-${ocrMessage.jobId}`,
            ocrJobId: ocrMessage.jobId,
            territoryId: ocrMessage.territoryId,
            gazetteDate: ocrMessage.publicationDate,
            pdfUrl: ocrMessage.pdfUrl,
            queuedAt: new Date().toISOString(),
            metadata: {
              crawlJobId: ocrMessage.metadata?.crawlJobId,
            },
          };
          await env.ANALYSIS_QUEUE.send(analysisMessage);
        } catch (individualError: any) {
          logger.error(`Failed to send individual analysis message`, individualError, {
            jobId: ocrMessage.jobId,
          });
        }
      }
    }
  }

  logger.info(`OCR Processor: Batch processing completed`, {
    total: batch.messages.length,
    successful: results.filter((r) => r.status === 'success').length,
    failed: results.filter((r) => r.status === 'failure').length,
    sentToAnalysis: successfulResults.length,
  });
}
