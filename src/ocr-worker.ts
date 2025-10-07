/**
 * OCR Worker - Processes PDF documents using Mistral OCR
 */

import { OcrQueueMessage, OcrResult, AnalysisQueueMessage } from './types';
import { MistralOcrService } from './services/mistral-ocr';
import { logger } from './utils';
import { 
  getDatabase, 
  TelemetryService, 
  OcrRepository,
  DatabaseEnv 
} from './services/database';

export interface Env extends DatabaseEnv {
  // Queue bindings
  OCR_QUEUE: Queue<OcrQueueMessage>;
  ANALYSIS_QUEUE?: Queue<AnalysisQueueMessage>;
  
  // Secrets
  MISTRAL_API_KEY: string;
  
  // Optional: KV for storing results (cache only)
  OCR_RESULTS?: KVNamespace;
  
  // R2 bucket for storing PDFs
  GAZETTE_PDFS?: R2Bucket;
}

/**
 * Queue consumer for OCR processing with database integration
 */
export default {
  async queue(batch: MessageBatch<OcrQueueMessage>, env: Env): Promise<void> {
    logger.info(`OCR Worker: Processing batch of ${batch.messages.length} messages`);

    // Initialize OCR service (shared across batch)
    const ocrService = new MistralOcrService({
      apiKey: env.MISTRAL_API_KEY,
      r2Bucket: env.GAZETTE_PDFS,
    });

    const results: OcrResult[] = [];
    const successfulResults: { ocrMessage: OcrQueueMessage; result: OcrResult }[] = [];

    for (const message of batch.messages) {
      const startTime = Date.now();
      const ocrMessage = message.body;
      const crawlJobId = ocrMessage.metadata?.crawlJobId || 'unknown';

      // Initialize database services per message to avoid I/O reuse issues
      const db = getDatabase(env);
      const telemetry = new TelemetryService(db);
      const ocrRepo = new OcrRepository(db);

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
          'ocr',
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
            
            // Reconstruct OCR result for compatibility
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
            // Fallback to processing if record retrieval fails
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

          // Validate result before storing
          if (result.status === 'success' && result.extractedText) {
            try {
              await ocrRepo.storeOcrResult(result);
              logger.info(`OCR result stored in database`, {
                jobId: ocrMessage.jobId,
                textLength: result.extractedText.length,
              });
            } catch (dbError) {
              logger.error(`Failed to store OCR result in database`, dbError as Error, {
                jobId: ocrMessage.jobId,
                errorMessage: (dbError as Error).message,
                errorStack: (dbError as Error).stack,
                crawlJobId
              });
              // Continue processing even if database storage fails - 
              // the result will still be cached in KV and sent to analysis
            }
          }

          // Store in KV cache for fast access during analysis
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

        // Track OCR completion
        await telemetry.trackCityStep(
          crawlJobId,
          ocrMessage.territoryId,
          ocrMessage.spiderId,
          'ocr',
          'ocr_end',
          result.status === 'success' ? 'completed' : 'failed',
          {
            executionTimeMs,
            errorMessage: result.error?.message,
            metadata: {
              textLength: result.extractedText?.length || 0,
              pagesProcessed: result.pagesProcessed,
            }
          }
        );

        // Collect successful OCR results for batch sending
        if (result.status === 'success') {
          successfulResults.push({ ocrMessage, result });
        }

        // Acknowledge message
        message.ack();

        logger.info(`OCR job ${ocrMessage.jobId} completed successfully`, {
          jobId: ocrMessage.jobId,
          status: result.status,
          textLength: result.extractedText?.length || 0,
          executionTimeMs,
          crawlJobId,
        });
      } catch (error: any) {
        const executionTimeMs = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        logger.error(`Error processing OCR message`, error, {
          jobId: ocrMessage.jobId,
          crawlJobId,
        });

        // Track OCR failure with error isolation
        try {
          await telemetry.trackCityStep(
            crawlJobId,
            ocrMessage.territoryId,
            ocrMessage.spiderId,
            'ocr',
            'ocr_end',
            'failed',
            {
              executionTimeMs,
              errorMessage,
            }
          );
        } catch (telemetryError) {
          logger.error('Failed to track OCR failure', telemetryError as Error, { 
            crawlJobId,
            originalError: errorMessage,
            telemetryError: (telemetryError as Error).message
          });
          // Don't let telemetry failures affect the main OCR processing flow
        }

        logger.error('OCR processing failed', error, {
          jobId: ocrMessage.jobId,
          crawlJobId,
          processingTimeMs: executionTimeMs
        });

        // Retry message (will go to DLQ after max retries)
        message.retry();
      }
    }

    // Send successful results to analysis queue in batch
    if (successfulResults.length > 0 && env.ANALYSIS_QUEUE) {
      try {
        const analysisMessages: AnalysisQueueMessage[] = successfulResults.map(({ ocrMessage, result }) => ({
          jobId: `analysis-${ocrMessage.jobId}`,
          ocrJobId: ocrMessage.jobId,
          territoryId: ocrMessage.territoryId,
          gazetteDate: ocrMessage.publicationDate,
          pdfUrl: ocrMessage.pdfUrl,
          queuedAt: new Date().toISOString(),
          metadata: {
            crawlJobId: ocrMessage.metadata?.crawlJobId,
          }
        }));

        // Wrap messages for Cloudflare Queue format and send in batch
        const wrappedMessages = analysisMessages.map(msg => ({ body: msg }));
        await env.ANALYSIS_QUEUE.sendBatch(wrappedMessages);

        logger.info(`Sent ${analysisMessages.length} OCR results to analysis queue in batch`, {
          count: analysisMessages.length,
        });
      } catch (error: any) {
        logger.error(`Failed to send batch to analysis queue`, error);
        // Fallback to individual sends
        for (const { ocrMessage, result } of successfulResults) {
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
              }
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

    logger.info(`OCR Worker: Batch processing completed`, {
      total: batch.messages.length,
      successful: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'failure').length,
      sentToAnalysis: successfulResults.length,
    });
  },
};
