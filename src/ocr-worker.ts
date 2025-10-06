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
  
  // R2 bucket for storing PDFs
  GAZETTE_PDFS?: R2Bucket;
}

/**
 * Queue consumer for OCR processing
 */
export default {
  async queue(batch: MessageBatch<OcrQueueMessage>, env: Env): Promise<void> {
    logger.info(`OCR Worker: Processing batch of ${batch.messages.length} messages`);

    const ocrService = new MistralOcrService({
      apiKey: env.MISTRAL_API_KEY,
      r2Bucket: env.GAZETTE_PDFS,
    });

    const results: OcrResult[] = [];
    const successfulResults: { ocrMessage: OcrQueueMessage; result: OcrResult }[] = [];

    for (const message of batch.messages) {
      try {
        const ocrMessage = message.body;
        
        logger.info(`Processing OCR job ${ocrMessage.jobId}`, {
          jobId: ocrMessage.jobId,
          pdfUrl: ocrMessage.pdfUrl,
          territoryId: ocrMessage.territoryId,
        });

        let result: OcrResult;

        // Check if already processed (KV cache)
        if (env.OCR_RESULTS) {
          const cached = await env.OCR_RESULTS.get(`ocr:${ocrMessage.jobId}`);
          if (cached) {
            logger.info(`OCR job ${ocrMessage.jobId} already processed (cache hit)`, {
              jobId: ocrMessage.jobId,
            });
            result = JSON.parse(cached);
          } else {
            // Process the PDF
            result = await ocrService.processPdf(ocrMessage);
            
            // Store result in KV if available
            await env.OCR_RESULTS.put(
              `ocr:${ocrMessage.jobId}`,
              JSON.stringify(result),
              {
                expirationTtl: 86400 * 7, // 7 days
              }
            );
          }
        } else {
          // No KV storage available, always process
          result = await ocrService.processPdf(ocrMessage);
        }

        results.push(result);

        // Collect successful OCR results for batch sending (both cached and new)
        if (result.status === 'success') {
          successfulResults.push({ ocrMessage, result });
        }

        // Acknowledge message
        message.ack();

        logger.info(`OCR job ${ocrMessage.jobId} completed successfully`, {
          jobId: ocrMessage.jobId,
          status: result.status,
          textLength: result.extractedText?.length || 0,
        });
      } catch (error: any) {
        logger.error(`Error processing OCR message`, error, {
          messageId: message.id,
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
