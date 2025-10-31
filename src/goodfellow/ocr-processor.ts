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
  schema,
} from '../services/database';
import { eq, and, sql } from 'drizzle-orm';

/**
 * Generate a consistent KV key from PDF URL
 * Uses base64 encoding to create a URL-safe key
 */
function generateOcrCacheKey(pdfUrl: string): string {
  // Base64 encode the URL and make it URL-safe for KV
  const base64 = btoa(pdfUrl)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return `ocr:${base64}`;
}

// Retry configuration for OCR result storage
const OCR_STORAGE_MAX_RETRIES = 3;
const OCR_STORAGE_RETRY_DELAY_MS = 1000; // exponential backoff base

/**
 * Retry a function with exponential backoff
 */
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number,
  baseDelayMs: number,
  operationName: string
): Promise<{ success: boolean; result?: T; error?: Error }> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      return { success: true, result };
    } catch (error) {
      logger.warn(`${operationName} attempt ${attempt}/${maxRetries} failed`, {
        error: error instanceof Error ? error.message : String(error),
        attempt,
      });
      
      if (attempt === maxRetries) {
        return { success: false, error: error as Error };
      }
      
      // Exponential backoff: 1s, 2s, 4s...
      const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return { success: false, error: new Error('Max retries exceeded') };
}

/**
 * Get OCR result from KV cache first, then fall back to database
 * This is the optimized "hot path" for reusing existing OCR results
 */
async function getOcrResultFromCacheOrDb(
  pdfUrl: string,
  gazetteId: string,
  jobId: string,
  ocrRepo: OcrRepository,
  env: OcrProcessorEnv,
  ocrMessage: OcrQueueMessage
): Promise<OcrResult | null> {
  // Try KV cache first (hot path)
  if (env.OCR_RESULTS) {
    const cacheKey = generateOcrCacheKey(pdfUrl);
    const cachedData = await env.OCR_RESULTS.get(cacheKey);
    if (cachedData) {
      const cached = JSON.parse(cachedData);
      // Ensure publicationDate is set (fallback to message publicationDate if missing)
      if (!cached.publicationDate) {
        cached.publicationDate = ocrMessage.publicationDate;
      }
      logger.info('OCR result retrieved from KV cache (hot path)', {
        jobId,
        cacheKey,
        pdfUrl
      });
      return cached;
    }
  }

  // Fallback to database
  const existingOcr = await ocrRepo.getOcrResultByGazetteId(gazetteId);
  if (existingOcr) {
    logger.info('OCR result retrieved from database (cache miss)', {
      jobId,
      gazetteId
    });
    
    // Reconstruct result
    return {
      jobId,
      status: 'success',
      extractedText: existingOcr.extractedText,
      pdfUrl: ocrMessage.pdfUrl,
      territoryId: ocrMessage.territoryId,
      publicationDate: ocrMessage.publicationDate,
      editionNumber: ocrMessage.editionNumber,
      spiderId: ocrMessage.spiderId,
      processingTimeMs: (existingOcr.metadata?.processingTimeMs as number) || undefined,
      completedAt: existingOcr.createdAt,
      metadata: ocrMessage.metadata,
    };
  }

  return null;
}

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

    // Initialize OCR service with database client for telemetry (per message)
    const ocrService = new MistralOcrService({
      apiKey: env.MISTRAL_API_KEY,
      r2Bucket: env.GAZETTE_PDFS,
      r2PublicUrl: env.R2_PUBLIC_URL,
      databaseClient: databaseClient,
    });

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
        'started',
        undefined,
        undefined,
        undefined,
        ocrMessage.metadata?.spiderType
      );

      let result: OcrResult;
      let isReusedResult = false; // Track if result was reused vs freshly processed
      let ocrJobId: string | null = null; // Track OCR job ID for this processing

      // 1. Find the gazette by PDF URL (unique identifier)
      const gazetteResult = await db.select()
        .from(schema.gazetteRegistry)
        .where(eq(schema.gazetteRegistry.pdfUrl, ocrMessage.pdfUrl))
        .limit(1);

      if (gazetteResult.length === 0) {
        logger.warn('Gazette not found for OCR processing', {
          jobId: ocrMessage.jobId,
          pdfUrl: ocrMessage.pdfUrl,
          territoryId: ocrMessage.territoryId,
          publicationDate: ocrMessage.publicationDate
        });
        // Still try to process - gazette might have been created without registry
      }

      const gazette = gazetteResult.length > 0 ? gazetteResult[0] : null;

      // 2. Check gazette status and determine action
      if (gazette) {
        if (gazette.status === 'ocr_success') {
          // Already processed successfully - reuse existing result (KV cache first, DB fallback)
          const existingResult = await getOcrResultFromCacheOrDb(
            ocrMessage.pdfUrl,
            gazette.id,
            ocrMessage.jobId,
            ocrRepo,
            env,
            ocrMessage
          );
          
            if (existingResult) {
              logger.info(`OCR already successful for gazette, reusing result`, {
                gazetteId: gazette.id,
                jobId: ocrMessage.jobId,
              });

              isReusedResult = true; // Mark as reused
              result = existingResult;
              
              // Check if gazette is missing R2 key and retry upload
              if (!gazette.pdfR2Key && env.GAZETTE_PDFS) {
                logger.info('Cached OCR result found but missing R2 key, attempting upload', {
                  gazetteId: gazette.id,
                  jobId: ocrMessage.jobId,
                  pdfUrl: ocrMessage.pdfUrl
                });
                
                const uploadResult = await ocrService.uploadToR2(ocrMessage.pdfUrl, ocrMessage.jobId);
                
                if (uploadResult.uploaded && uploadResult.r2Key) {
                  result.pdfR2Key = uploadResult.r2Key;
                  logger.info('R2 upload succeeded during recrawl', {
                    gazetteId: gazette.id,
                    r2Key: uploadResult.r2Key
                  });
                } else if (uploadResult.error) {
                  // Log R2 upload failure to error_logs
                  await db.insert(schema.errorLogs).values({
                    id: databaseClient.generateId(),
                    workerName: 'goodfellow-ocr',
                    operationType: 'r2_upload_retry',
                    severity: 'warning',
                    errorMessage: uploadResult.error.message,
                    stackTrace: uploadResult.error.stack || null,
                    context: JSON.stringify({
                      gazetteId: gazette.id,
                      jobId: ocrMessage.jobId,
                      pdfUrl: ocrMessage.pdfUrl,
                      stage: 'recrawl_r2_upload_retry'
                    }),
                    jobId: crawlJobId,
                    territoryId: ocrMessage.territoryId
                  });
                  
                  logger.warn('R2 upload retry failed, logged to error_logs', {
                    gazetteId: gazette.id,
                    error: uploadResult.error.message
                  });
                }
              }
            } else {
            // Status says success but no OCR result - data inconsistency!
            logger.warn('Gazette status is ocr_success but no OCR result found, reprocessing', {
              gazetteId: gazette.id,
              jobId: ocrMessage.jobId
            });

            // Log as critical data inconsistency
            await db.insert(schema.errorLogs).values({
              id: databaseClient.generateId(),
              workerName: 'goodfellow-ocr',
              operationType: 'data_inconsistency',
              severity: 'warning',
              errorMessage: 'Gazette marked ocr_success but no OCR result in database or cache',
              stackTrace: null,
              context: JSON.stringify({
                gazetteId: gazette.id,
                jobId: ocrMessage.jobId,
                pdfUrl: ocrMessage.pdfUrl,
                gazetteStatus: gazette.status
              }),
              jobId: crawlJobId,
              territoryId: ocrMessage.territoryId
            });

            await gazetteRepo.updateGazetteStatus(gazette.id, 'ocr_processing');
            result = await ocrService.processPdf(ocrMessage);
          }
        } else if (gazette.status === 'ocr_processing' || gazette.status === 'ocr_retrying') {
          // Currently being processed - retry message to wait for completion
          logger.info('Gazette OCR still in progress, retrying message', {
            gazetteId: gazette.id,
            status: gazette.status,
            jobId: ocrMessage.jobId
          });
          message.retry();
          continue;
        } else if (gazette.status === 'ocr_failure') {
          // Previously failed - mark as retrying and try again
          logger.info('Retrying previously failed OCR', {
            gazetteId: gazette.id,
            jobId: ocrMessage.jobId
          });
          
          // Create new OCR job record for this retry attempt
          try {
            ocrJobId = databaseClient.generateId();
            await db.insert(schema.ocrJobs).values({
              id: ocrJobId,
              documentType: 'gazette_registry',
              documentId: gazette.id,
              status: 'processing',
              pagesProcessed: 0,
              processingTimeMs: null,
              textLength: 0,
              errorCode: null,
              errorMessage: null,
              createdAt: databaseClient.getCurrentTimestamp(),
              completedAt: null,
              metadata: databaseClient.stringifyJson({
                jobId: ocrMessage.jobId,
                processingMethod: 'mistral',
                crawlJobId: crawlJobId,
                isRetry: true
              })
            });
            
            logger.info('Created OCR job for retry attempt', {
              gazetteId: gazette.id,
              jobId: ocrMessage.jobId,
              ocrJobId
            });
          } catch (insertError) {
            // Race: recover by locating job created with this jobId using dialect-aware helper
            const existing = await ocrRepo.findOcrJobIdByDocumentAndJobId(
              'gazette_registry',
              gazette.id,
              ocrMessage.jobId
            );
            
            if (existing.length > 0) {
              ocrJobId = existing[0].id;
              logger.info('OCR job already exists for retry (race condition)', {
                gazetteId: gazette.id,
                jobId: ocrMessage.jobId,
                ocrJobId
              });
            } else {
              logger.warn('Failed to create OCR job for retry and could not find existing', {
                gazetteId: gazette.id,
                jobId: ocrMessage.jobId,
                error: insertError instanceof Error ? insertError.message : String(insertError)
              });
            }
          }
          
          await gazetteRepo.updateGazetteStatus(gazette.id, 'ocr_retrying');
          result = await ocrService.processPdf(ocrMessage);
        } else {
          // Status is pending or uploaded - atomically claim for processing
          logger.info('Attempting to claim gazette for OCR processing', {
            gazetteId: gazette.id,
            status: gazette.status,
            jobId: ocrMessage.jobId
          });
          
          // STEP 1: Create OCR job record FIRST (before claiming gazette)
          let ocrJobCreated = false;
          try {
            ocrJobId = databaseClient.generateId();
            await db.insert(schema.ocrJobs).values({
              id: ocrJobId,
              documentType: 'gazette_registry',
              documentId: gazette.id,
              status: 'processing',
              pagesProcessed: 0,
              processingTimeMs: null,
              textLength: 0,
              errorCode: null,
              errorMessage: null,
              createdAt: databaseClient.getCurrentTimestamp(),
              completedAt: null,
              metadata: databaseClient.stringifyJson({
                jobId: ocrMessage.jobId,
                processingMethod: 'mistral',
                crawlJobId: crawlJobId
              })
            });
            
            ocrJobCreated = true;
            logger.info('Created OCR job record before claiming gazette', {
              gazetteId: gazette.id,
              jobId: ocrMessage.jobId,
              ocrJobId
            });
          } catch (insertError) {
            // Race: recover by locating job created with this jobId using dialect-aware helper
            const existing = await ocrRepo.findOcrJobIdByDocumentAndJobId(
              'gazette_registry',
              gazette.id,
              ocrMessage.jobId
            );
            
            if (existing.length > 0) {
              // Job already exists, another worker may have started - continue to claim attempt
              ocrJobCreated = true;
              ocrJobId = existing[0].id;
              logger.info('OCR job already exists (race condition), proceeding with claim', {
                gazetteId: gazette.id,
                jobId: ocrMessage.jobId,
                ocrJobId
              });
            } else {
              // Real error, not a duplicate
              logger.error('Failed to create OCR job record', insertError as Error, {
                gazetteId: gazette.id,
                jobId: ocrMessage.jobId
              });
              throw insertError;
            }
          }
          
          // STEP 2: Atomic update - only set to ocr_processing if not already processing/success
          const claimResult = await db.update(schema.gazetteRegistry)
            .set({ status: 'ocr_processing' })
            .where(and(
              eq(schema.gazetteRegistry.id, gazette.id),
              sql`status NOT IN ('ocr_processing', 'ocr_retrying', 'ocr_success')`
            ))
            .returning({ id: schema.gazetteRegistry.id });

          if (claimResult.length > 0) {
            // Successfully claimed - proceed with processing
            logger.info('Successfully claimed gazette for processing', {
              gazetteId: gazette.id,
              jobId: ocrMessage.jobId,
              ocrJobCreated,
              ocrJobId
            });
            result = await ocrService.processPdf(ocrMessage);
          } else {
            // Failed to claim - someone else is processing or already processed
            logger.info('Failed to claim gazette, re-checking status', {
              gazetteId: gazette.id,
              jobId: ocrMessage.jobId
            });
            
            // Re-fetch current status
            const updatedGazette = await db.select()
              .from(schema.gazetteRegistry)
              .where(eq(schema.gazetteRegistry.id, gazette.id))
              .limit(1);

            if (updatedGazette.length > 0) {
              const currentStatus = updatedGazette[0].status;
              
              if (currentStatus === 'ocr_success') {
                // Already completed by another process - reuse result (KV cache first, DB fallback)
                const existingResult = await getOcrResultFromCacheOrDb(
                  ocrMessage.pdfUrl,
                  gazette.id,
                  ocrMessage.jobId,
                  ocrRepo,
                  env,
                  ocrMessage
                );
                
                if (existingResult) {
                  logger.info('Gazette completed by another process, reusing result', {
                    gazetteId: gazette.id,
                    jobId: ocrMessage.jobId
                  });
                  
                  isReusedResult = true; // Mark as reused
                  result = existingResult;
                  
                  // Check if gazette is missing R2 key and retry upload
                  if (!gazette.pdfR2Key && env.GAZETTE_PDFS) {
                    logger.info('Cached OCR result found but missing R2 key, attempting upload', {
                      gazetteId: gazette.id,
                      jobId: ocrMessage.jobId,
                      pdfUrl: ocrMessage.pdfUrl
                    });
                    
                    const uploadResult = await ocrService.uploadToR2(ocrMessage.pdfUrl, ocrMessage.jobId);
                    
                    if (uploadResult.uploaded && uploadResult.r2Key) {
                      result.pdfR2Key = uploadResult.r2Key;
                      logger.info('R2 upload succeeded during recrawl (after claim failure)', {
                        gazetteId: gazette.id,
                        r2Key: uploadResult.r2Key
                      });
                    } else if (uploadResult.error) {
                      // Log R2 upload failure to error_logs
                      await db.insert(schema.errorLogs).values({
                        id: databaseClient.generateId(),
                        workerName: 'goodfellow-ocr',
                        operationType: 'r2_upload_retry',
                        severity: 'warning',
                        errorMessage: uploadResult.error.message,
                        stackTrace: uploadResult.error.stack || null,
                        context: JSON.stringify({
                          gazetteId: gazette.id,
                          jobId: ocrMessage.jobId,
                          pdfUrl: ocrMessage.pdfUrl,
                          stage: 'recrawl_r2_upload_retry_after_claim_failure'
                        }),
                        jobId: crawlJobId,
                        territoryId: ocrMessage.territoryId
                      });
                      
                      logger.warn('R2 upload retry failed, logged to error_logs', {
                        gazetteId: gazette.id,
                        error: uploadResult.error.message
                      });
                    }
                  }
                } else {
                  logger.error('Gazette marked success but no OCR found after claim failure', {
                    gazetteId: gazette.id,
                    jobId: ocrMessage.jobId
                  });
                  message.retry();
                  continue;
                }
              } else if (currentStatus === 'ocr_processing' || currentStatus === 'ocr_retrying') {
                // Another process is still working on it
                logger.info('Gazette being processed by another worker, retrying message', {
                  gazetteId: gazette.id,
                  currentStatus,
                  jobId: ocrMessage.jobId
                });
                message.retry();
                continue;
              } else {
                // Unexpected status
                logger.warn('Unexpected status after failed claim, retrying', {
                  gazetteId: gazette.id,
                  currentStatus,
                  jobId: ocrMessage.jobId
                });
                message.retry();
                continue;
              }
            } else {
              logger.error('Gazette disappeared after claim failure', {
                gazetteId: gazette.id,
                jobId: ocrMessage.jobId
              });
              message.retry();
              continue;
            }
          }
        }
      } else {
        // No gazette found - process anyway (backwards compatibility)
        // Try KV cache first (fast path)
        let cached = null;
        if (env.OCR_RESULTS) {
          const cacheKey = generateOcrCacheKey(ocrMessage.pdfUrl);
          const cachedData = await env.OCR_RESULTS.get(cacheKey);
          if (cachedData) {
            cached = JSON.parse(cachedData);
            logger.info(`OCR result found in KV cache (no gazette path)`, {
              jobId: ocrMessage.jobId,
              cacheKey,
              pdfUrl: ocrMessage.pdfUrl,
            });
          }
        }

        if (cached) {
          isReusedResult = true; // Mark as reused from cache
          // Ensure publicationDate is set (fallback to message publicationDate if missing)
          if (!cached.publicationDate) {
            cached.publicationDate = ocrMessage.publicationDate;
          }
          result = cached;
        } else {
          // Fallback: try to find OCR result by jobId in DB (will scan metadata)
          const ocrRecord = await ocrRepo.getOcrResultByJobId(ocrMessage.jobId);
          if (ocrRecord) {
            logger.info(`OCR job ${ocrMessage.jobId} already processed (database hit, no gazette)`, {
              jobId: ocrMessage.jobId,
            });

            isReusedResult = true; // Mark as reused
            result = {
              jobId: ocrMessage.jobId,
              status: 'success',
              extractedText: ocrRecord.extractedText,
              pdfUrl: ocrMessage.pdfUrl,
              territoryId: ocrMessage.territoryId,
              publicationDate: ocrMessage.publicationDate,
              editionNumber: ocrMessage.editionNumber,
              spiderId: ocrMessage.spiderId,
              processingTimeMs: (ocrRecord.metadata?.processingTimeMs as number) || undefined,
              completedAt: ocrRecord.createdAt,
              metadata: ocrMessage.metadata,
            };
          } else {
            // Not in cache or DB - process the PDF
            result = await ocrService.processPdf(ocrMessage);
          }
        }
      }

      // Store in database with retry logic
      let storageSucceeded = false;

      if (result.status === 'success' && result.extractedText) {
        // Extract gazetteCrawlId from message metadata (if available)
        const gazetteCrawlId = ocrMessage.metadata?.gazetteCrawlId;
        
        if (!gazetteCrawlId) {
          logger.warn('OCR message missing gazetteCrawlId, will bulk-update all crawls for gazette', {
            jobId: ocrMessage.jobId,
            pdfUrl: ocrMessage.pdfUrl
          });
        }
        
        const storageResult = await retryWithBackoff(
          () => ocrRepo.storeOcrResult(result, gazetteCrawlId),
          OCR_STORAGE_MAX_RETRIES,
          OCR_STORAGE_RETRY_DELAY_MS,
          'OCR result storage'
        );
        
        if (storageResult.success) {
          storageSucceeded = true;
          logger.info(`OCR result stored in database`, {
            jobId: ocrMessage.jobId,
            textLength: result.extractedText.length,
          });
          
          // Update gazette with R2 key if available
          if (result.pdfR2Key && gazette) {
            try {
              await gazetteRepo.updateR2Key(gazette.id, result.pdfR2Key);
              logger.info(`Updated gazette with R2 key`, {
                ocrJobId: ocrMessage.jobId,
                gazetteId: gazette.id,
                pdfR2Key: result.pdfR2Key,
              });
            } catch (r2Error) {
              logger.error(
                `Failed to update gazette R2 key`,
                r2Error as Error,
                {
                  ocrJobId: ocrMessage.jobId,
                  pdfR2Key: result.pdfR2Key,
                }
              );
            }
          }
        } else {
          // Storage failed after all retries
          logger.error(
            `Failed to store OCR result after ${OCR_STORAGE_MAX_RETRIES} retries`,
            storageResult.error!,
            {
              jobId: ocrMessage.jobId,
              crawlJobId,
              extractedTextLength: result.extractedText.length,
            }
          );
          
          // Override result status to failure since we couldn't store it
          result.status = 'failure';
          result.error = {
            code: 'STORAGE_FAILED',
            message: `Failed to store OCR result: ${storageResult.error?.message}`,
            details: storageResult.error?.stack,
          };
          
          // Update gazette and crawls to failed status immediately to maintain consistency
          if (gazette) {
            try {
              await gazetteRepo.updateGazetteStatus(gazette.id, 'ocr_failure');
              await gazetteRepo.updateCrawlsStatusByGazetteId(gazette.id, 'failed');
              logger.info('Updated gazette and crawls to failed status after storage failure', {
                gazetteId: gazette.id,
                jobId: ocrMessage.jobId
              });
            } catch (updateError) {
              logger.error('Failed to update gazette status after storage failure', updateError as Error, {
                gazetteId: gazette.id,
                jobId: ocrMessage.jobId
              });
            }
          }
        }
      } else if (result.status === 'success' && !result.extractedText) {
        // Extraction succeeded but no text - mark as failure
        logger.error('OCR marked as success but no extracted text', null, {
          jobId: ocrMessage.jobId,
          crawlJobId,
        });
        result.status = 'failure';
        result.error = {
          code: 'NO_TEXT_EXTRACTED',
          message: 'OCR completed but extracted text is empty',
        };
        
        // Update gazette and crawls to failed status immediately to maintain consistency
        if (gazette) {
          try {
            await gazetteRepo.updateGazetteStatus(gazette.id, 'ocr_failure');
            await gazetteRepo.updateCrawlsStatusByGazetteId(gazette.id, 'failed');
            logger.info('Updated gazette and crawls to failed status (no text extracted)', {
              gazetteId: gazette.id,
              jobId: ocrMessage.jobId
            });
          } catch (updateError) {
            logger.error('Failed to update gazette status after no-text error', updateError as Error, {
              gazetteId: gazette.id,
              jobId: ocrMessage.jobId
            });
          }
        }
      }

      // Store in KV cache (always cache results, even if reused)
      if (env.OCR_RESULTS) {
        const cacheKey = generateOcrCacheKey(ocrMessage.pdfUrl);
        await env.OCR_RESULTS.put(
          cacheKey,
          JSON.stringify(result),
          {
            expirationTtl: 86400, // 24 hours
          }
        );
        logger.info('Stored OCR result in KV cache', {
          cacheKey,
          jobId: ocrMessage.jobId,
          pdfUrl: ocrMessage.pdfUrl,
          isReused: isReusedResult
        });
      }

      results.push(result);

      const executionTimeMs = Date.now() - startTime;

      // Update OCR job metadata with final results
      try {
        const ocrStatus = result.status === 'success' ? 'success' : 'failure';
        
        // If we don't have ocrJobId (backwards compatibility path), try to find it using dialect-aware helper
        if (!ocrJobId && gazette) {
          const jobLookup = await ocrRepo.findOcrJobIdByDocumentAndJobId(
            'gazette_registry',
            gazette.id,
            ocrMessage.jobId
          );
          
          if (jobLookup.length > 0) {
            ocrJobId = jobLookup[0].id;
            logger.info('Recovered ocrJobId for update', {
              jobId: ocrMessage.jobId,
              ocrJobId
            });
          }
        }
        
        if (ocrJobId) {
          // Update the specific OCR job by ID to avoid updating multiple jobs
          const updateResult = await db.update(schema.ocrJobs)
            .set({
              status: ocrStatus,
              pagesProcessed: result.pagesProcessed || 0,
              processingTimeMs: executionTimeMs,
              textLength: result.extractedText?.length || 0,
              completedAt: databaseClient.getCurrentTimestamp(),
              errorCode: result.error?.code || null,
              errorMessage: result.error?.message || null,
              metadata: databaseClient.stringifyJson({
                jobId: ocrMessage.jobId,
                processingMethod: 'mistral',
                crawlJobId: crawlJobId
              })
            })
            .where(eq(schema.ocrJobs.id, ocrJobId))
            .returning({ id: schema.ocrJobs.id });
          
          if (updateResult.length > 0) {
            logger.info('OCR job metadata updated successfully', {
              jobId: ocrMessage.jobId,
              ocrJobId,
              status: ocrStatus,
              executionTimeMs
            });
          } else {
            logger.warn('OCR job not found for update', {
              jobId: ocrMessage.jobId,
              ocrJobId
            });
          }
        } else {
          logger.warn('No ocrJobId available to update job metadata', {
            jobId: ocrMessage.jobId,
            hasGazette: !!gazette
          });
        }
      } catch (metadataError) {
        logger.error('Failed to update OCR job metadata', metadataError as Error, {
          jobId: ocrMessage.jobId,
          ocrJobId,
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
        result.error?.message,
        ocrMessage.metadata?.spiderType
      );

      // Handle failure results (OCR service returns failure, doesn't throw)
      if (result.status === 'failure') {
        logger.error('🔥 OCR FAILED - Logging to error_logs', null, {
          jobId: ocrMessage.jobId,
          status: result.status,
          errorMessage: result.error?.message,
          crawlJobId,
        });

        // Update gazette status to ocr_failure
        if (gazette) {
          await gazetteRepo.updateGazetteStatus(gazette.id, 'ocr_failure');
          await gazetteRepo.updateCrawlsStatusByGazetteId(gazette.id, 'failed');
          
          logger.info('Updated gazette and crawls to failed status', {
            gazetteId: gazette.id,
            jobId: ocrMessage.jobId
          });
        }

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
            gazetteId: gazette?.id,
          }),
          jobId: crawlJobId,
          territoryId: ocrMessage.territoryId
        });

        logger.info('🔥 OCR FAILURE LOGGED TO DATABASE!', {
          jobId: ocrMessage.jobId,
          crawlJobId,
        });
      }

      // Handle success results
      if (result.status === 'success') {
        // Status updates are now handled atomically in storeOcrResult
        // No need for duplicate updates here
        
        // Collect all successful OCR results for batch sending to analysis
        // This includes both newly processed and reused results
        successfulResults.push({ ocrMessage, result });
        logger.info('OCR result queued for analysis', {
          jobId: ocrMessage.jobId,
          gazetteId: gazette?.id,
          isReused: isReusedResult
        });
        
        // Always queue for analysis, even if result was reused
        // This ensures consistent flow: Crawl -> OCR -> Analysis
      }

      // Acknowledge message
      message.ack();

      logger.info(`OCR job ${ocrMessage.jobId} completed`, {
        jobId: ocrMessage.jobId,
        status: result.status,
        textLength: result.extractedText?.length || 0,
        storageSucceeded: result.status === 'success' ? storageSucceeded : undefined,
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

      // Find gazette to update status
      try {
        const gazetteResult = await db.select()
          .from(schema.gazetteRegistry)
          .where(eq(schema.gazetteRegistry.pdfUrl, ocrMessage.pdfUrl))
          .limit(1);

        if (gazetteResult.length > 0) {
          const gazette = gazetteResult[0];
          await gazetteRepo.updateGazetteStatus(gazette.id, 'ocr_failure');
          await gazetteRepo.updateCrawlsStatusByGazetteId(gazette.id, 'failed');
          
          logger.info('Updated gazette to failed status after exception', {
            gazetteId: gazette.id,
            jobId: ocrMessage.jobId
          });
        }
      } catch (updateError) {
        logger.error('Failed to update gazette status after OCR error', updateError as Error);
      }

      // Track OCR failure
      await telemetry.trackCityStep(
        crawlJobId,
        ocrMessage.territoryId,
        ocrMessage.spiderId,
        'ocr_end',
        'failed',
        undefined,
        executionTimeMs,
        errorMessage,
        ocrMessage.metadata?.spiderType
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
      // Initialize gazette repo for analysis message preparation
      const databaseClient = getDatabase(env);
      const db = databaseClient.getDb();
      const gazetteRepo = new GazetteRepository(databaseClient);
      
      const analysisMessages: AnalysisQueueMessage[] = [];
      
      for (const { ocrMessage } of successfulResults) {
        const crawlJobId = ocrMessage.metadata?.crawlJobId || 'unknown';
        const gazetteCrawlId = ocrMessage.metadata?.gazetteCrawlId;
        
        if (!gazetteCrawlId) {
          logger.warn('No gazetteCrawlId in OCR message, skipping analysis', {
            ocrJobId: ocrMessage.jobId,
          });
          continue;
        }
        
        // Direct lookup by ID
        const gazetteLookup = await db.select({
          crawl: schema.gazetteCrawls,
          gazette: schema.gazetteRegistry
        })
          .from(schema.gazetteCrawls)
          .innerJoin(
            schema.gazetteRegistry,
            eq(schema.gazetteCrawls.gazetteId, schema.gazetteRegistry.id)
          )
          .where(eq(schema.gazetteCrawls.id, gazetteCrawlId))
          .limit(1);

        if (gazetteLookup.length === 0) {
          logger.warn('Gazette crawl not found by ID, skipping analysis', {
            ocrJobId: ocrMessage.jobId,
            gazetteCrawlId,
          });
          continue;
        }

        const gazette = gazetteLookup[0].gazette;
        const gazetteCrawl = gazetteLookup[0].crawl;
        
        // Update status to analysis_pending (OCR completed, ready for analysis)
        await gazetteRepo.updateGazetteCrawlStatus(gazetteCrawl.id, 'analysis_pending');
        
        analysisMessages.push({
          jobId: `analysis-${ocrMessage.jobId}`,
          ocrJobId: ocrMessage.jobId,
          gazetteCrawlId: gazetteCrawl.id,
          gazetteId: gazette.id,
          territoryId: ocrMessage.territoryId,
          gazetteDate: ocrMessage.publicationDate,
          pdfUrl: ocrMessage.pdfUrl,
          queuedAt: new Date().toISOString(),
          metadata: {
            crawlJobId,
            spiderId: ocrMessage.spiderId,
            spiderType: ocrMessage.metadata?.spiderType,
          },
        });
      }

      if (analysisMessages.length > 0) {
        const wrappedMessages = analysisMessages.map((msg) => ({ body: msg }));
        await env.ANALYSIS_QUEUE.sendBatch(wrappedMessages);

        logger.info(`Sent ${analysisMessages.length} to analysis queue`, {
          count: analysisMessages.length,
        });
      } else {
        logger.warn('No analysis messages to send (all gazettes skipped)');
      }
    } catch (error: any) {
      logger.error('Failed to send to analysis queue', error);
    }
  }

  logger.info(`OCR Processor: Batch processing completed`, {
    total: batch.messages.length,
    successful: results.filter((r) => r.status === 'success').length,
    failed: results.filter((r) => r.status === 'failure').length,
    sentToAnalysis: successfulResults.length,
  });
}
