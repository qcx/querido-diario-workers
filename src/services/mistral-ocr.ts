/**
 * Mistral OCR Service
 * Handles PDF processing using Mistral's OCR API
 */

import { OcrQueueMessage, OcrResult, MistralOcrConfig } from '../types';
import { logger } from '../utils';

export class MistralOcrService {
  private config: MistralOcrConfig;

  constructor(config: MistralOcrConfig) {
    this.config = {
      endpoint: 'https://api.mistral.ai/v1/chat/completions',
      model: 'pixtral-12b-2409',
      maxPages: 50,
      timeout: 60000,
      ...config,
    };
  }

  /**
   * Process a PDF using Mistral OCR
   */
  async processPdf(message: OcrQueueMessage): Promise<OcrResult> {
    const startTime = Date.now();
    
    logger.info(`Starting OCR processing for job ${message.jobId}`, {
      jobId: message.jobId,
      pdfUrl: message.pdfUrl,
      territoryId: message.territoryId,
    });

    try {
      // Download PDF
      const pdfBuffer = await this.downloadPdf(message.pdfUrl);
      
      // Convert PDF to base64
      const base64Pdf = this.bufferToBase64(pdfBuffer);
      
      // Call Mistral API
      const extractedText = await this.callMistralApi(base64Pdf, message.jobId);
      
      const processingTimeMs = Date.now() - startTime;
      
      logger.info(`OCR processing completed for job ${message.jobId}`, {
        jobId: message.jobId,
        processingTimeMs,
        textLength: extractedText.length,
      });

      return {
        jobId: message.jobId,
        status: 'success',
        extractedText,
        processingTimeMs,
        completedAt: new Date().toISOString(),
      };
    } catch (error: any) {
      const processingTimeMs = Date.now() - startTime;
      
      logger.error(`OCR processing failed for job ${message.jobId}`, error, {
        jobId: message.jobId,
        processingTimeMs,
      });

      return {
        jobId: message.jobId,
        status: 'failure',
        error: {
          message: error.message,
          code: error.code,
          details: error.stack,
        },
        processingTimeMs,
        completedAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Download PDF from URL
   */
  private async downloadPdf(url: string): Promise<ArrayBuffer> {
    logger.debug(`Downloading PDF from ${url}`);
    
    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.config.timeout!),
    });

    if (!response.ok) {
      throw new Error(`Failed to download PDF: ${response.status} ${response.statusText}`);
    }

    const contentType = response.headers.get('content-type');
    if (contentType && !contentType.includes('pdf')) {
      logger.warn(`Unexpected content type: ${contentType}`);
    }

    return await response.arrayBuffer();
  }

  /**
   * Convert ArrayBuffer to base64
   */
  private bufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Call Mistral API for OCR
   */
  private async callMistralApi(base64Pdf: string, jobId: string): Promise<string> {
    logger.debug(`Calling Mistral API for job ${jobId}`);

    const payload = {
      model: this.config.model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Extract all text from this PDF document. Return only the extracted text, without any additional commentary or formatting.',
            },
            {
              type: 'image_url',
              image_url: `data:application/pdf;base64,${base64Pdf}`,
            },
          ],
        },
      ],
      max_tokens: 16000,
    };

    const response = await fetch(this.config.endpoint!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.timeout!),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Mistral API error: ${response.status} - ${errorText}`);
    }

    const result: any = await response.json();
    
    if (!result.choices || result.choices.length === 0) {
      throw new Error('No response from Mistral API');
    }

    return result.choices[0].message.content;
  }

  /**
   * Process multiple PDFs in batch
   */
  async processBatch(messages: OcrQueueMessage[]): Promise<OcrResult[]> {
    logger.info(`Processing batch of ${messages.length} PDFs`);

    const results: OcrResult[] = [];

    for (const message of messages) {
      const result = await this.processPdf(message);
      results.push(result);
    }

    return results;
  }
}
