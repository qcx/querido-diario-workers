/**
 * OCR Worker - Processes PDF documents using Mistral OCR
 */

import { OcrQueueMessage, OcrResult, AnalysisQueueMessage } from './types';
import { MistralOcrService } from './services/mistral-ocr';
import { logger } from './utils';

export interface Env {
  // Queue bindings
  OCR_QUEUE: Queue<OcrQueueMessage>;
  ANALYSIS_QUEUE?: Queue<AnalysisQueueMessage>;
  
  // Secrets
  MISTRAL_API_KEY: string;
  
  // Optional: KV for storing results
  OCR_RESULTS?: KVNamespace;
}

/**
 * Queue consumer for OCR processing
 */
export default {
  async queue(batch: MessageBatch<OcrQueueMessage>, env: Env): Promise<void> {
    logger.info(`OCR Worker: Processing batch of ${batch.messages.length} messages`);

    const ocrService = new MistralOcrService({
      apiKey: env.MISTRAL_API_KEY,
    });

    const results: OcrResult[] = [];

    for (const message of batch.messages) {
      try {
        const ocrMessage = message.body;
        
        logger.info(`Processing OCR job ${ocrMessage.jobId}`, {
          jobId: ocrMessage.jobId,
          pdfUrl: ocrMessage.pdfUrl,
          territoryId: ocrMessage.territoryId,
        });

        // Check if already processed (KV cache)
        if (env.OCR_RESULTS) {
          const cached = await env.OCR_RESULTS.get(`ocr:${ocrMessage.jobId}`);
          if (cached) {
            logger.info(`OCR job ${ocrMessage.jobId} already processed (cache hit)`, {
              jobId: ocrMessage.jobId,
            });
            message.ack();
            continue;
          }
        }

        // Process the PDF
        const result = await ocrService.processPdf(ocrMessage);
        results.push(result);

        // Store result in KV if available
        if (env.OCR_RESULTS) {
          await env.OCR_RESULTS.put(
            `ocr:${ocrMessage.jobId}`,
            JSON.stringify(result),
            {
              expirationTtl: 86400 * 7, // 7 days
            }
          );
        }

        // Send to analysis queue if OCR was successful
        if (result.status === 'success' && env.ANALYSIS_QUEUE) {
          try {
            const analysisMessage: AnalysisQueueMessage = {
              jobId: `analysis-${ocrMessage.jobId}`,
              ocrResult: result,
              queuedAt: new Date().toISOString(),
            };

            await env.ANALYSIS_QUEUE.send(analysisMessage);

            logger.info(`Sent OCR result to analysis queue`, {
              jobId: ocrMessage.jobId,
              analysisJobId: analysisMessage.jobId,
            });
          } catch (error: any) {
            logger.error(`Failed to send to analysis queue`, error, {
              jobId: ocrMessage.jobId,
            });
            // Don't fail the OCR job if analysis queueing fails
          }
        }

        // Acknowledge message
        message.ack();

        logger.info(`OCR job ${ocrMessage.jobId} completed successfully`, {
          jobId: ocrMessage.jobId,
          status: result.status,
          textLength: result.extractedText?.length || 0,
          sentToAnalysis: result.status === 'success' && !!env.ANALYSIS_QUEUE,
        });
      } catch (error: any) {
        logger.error(`Error processing OCR message`, error, {
          messageId: message.id,
        });

        // Retry message (will go to DLQ after max retries)
        message.retry();
      }
    }

    logger.info(`OCR Worker: Batch processing completed`, {
      total: batch.messages.length,
      successful: results.filter(r => r.status === 'success').length,
      failed: results.filter(r => r.status === 'failure').length,
    });
  },
};
