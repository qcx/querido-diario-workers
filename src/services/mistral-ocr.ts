/**
 * Mistral OCR Service
 * Handles PDF processing using Mistral's OCR API
 */

import { OcrQueueMessage, OcrResult, MistralOcrConfig } from '../types';
import { logger } from '../utils';
import type { 
  MistralOcrResponse, 
  MistralPage, 
  MistralPageResult,
  MistralErrorResponse
} from '../types/external-apis';
import { isMistralOcrResponse } from '../types/external-apis';
import { MistralOcrError, toAppError } from '../types/errors';
import { DrizzleDatabaseClient, schema } from './database';
import { CostTracker, AIUsage } from './cost-tracker';

export class MistralOcrService {
  private config: MistralOcrConfig;
  private r2Bucket?: R2Bucket;
  private r2PublicUrl?: string;
  private dbClient?: DrizzleDatabaseClient;

  constructor(config: MistralOcrConfig & { 
    r2Bucket?: R2Bucket; 
    r2PublicUrl?: string;
    databaseClient?: DrizzleDatabaseClient;
  }) {
    this.config = {
      endpoint: 'https://api.mistral.ai/v1/ocr',
      model: 'mistral-ocr-latest',
      maxPages: 1000,
      timeout: 120000,
      ...config,
    };
    this.r2Bucket = config.r2Bucket;
    this.r2PublicUrl = config.r2PublicUrl;
    this.dbClient = config.databaseClient;
  }

  /**
   * Generate a deterministic R2 key from PDF URL
   * Same PDF URL always generates the same R2 key
   * Uses full base64 encoding for guaranteed uniqueness
   */
  private generateR2Key(pdfUrl: string): string {
    // Base64 encode the full URL and make it URL-safe
    const base64 = btoa(pdfUrl)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    
    return `pdfs/${base64}.pdf`;
  }

  /**
   * Upload PDF to R2 bucket
   * Returns the R2 key if successful, undefined if failed
   * Errors are caught and returned for proper logging
   */
  async uploadToR2(pdfUrl: string, jobId: string): Promise<{
    r2Key: string | undefined;
    uploaded: boolean;
    error?: Error;
  }> {
    if (!this.r2Bucket) {
      logger.error(`R2 bucket not found`, {
        jobId,
        pdfUrl,
      });
      return { r2Key: undefined, uploaded: false };
    }

    try {
      // Generate deterministic key
      const r2Key = this.generateR2Key(pdfUrl);
      
      // Check if PDF already exists in R2
      const existingFile = await this.r2Bucket.head(r2Key);
      
      if (existingFile) {
        logger.info(`PDF already exists in R2, skipping upload`, {
          jobId,
          r2Key,
          pdfUrl
        });
        return { r2Key, uploaded: false };
      }

      logger.info(`Downloading PDF from ${pdfUrl} for R2 upload`);
      
      // Download PDF
      const pdfResponse = await fetch(pdfUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:108.0) Gecko/20100101 Firefox/108.0',
          'Accept': 'application/pdf,*/*',
        },
      });
      if (!pdfResponse.ok) {
        throw new Error(`Failed to download PDF: ${pdfResponse.status}`);
      }
      
      const pdfData = await pdfResponse.arrayBuffer();
      
      // Upload to R2
      logger.info(`Uploading PDF to R2: ${r2Key}`);
      await this.r2Bucket.put(r2Key, pdfData, {
        httpMetadata: {
          contentType: 'application/pdf',
        },
      });
      
      logger.info(`Successfully uploaded PDF to R2`, {
        jobId,
        r2Key,
        sizeBytes: pdfData.byteLength,
        pdfUrl
      });

      return { r2Key, uploaded: true };
    } catch (error: unknown) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      const errorMessage = errorObj.message;
      
      logger.error(`Failed to upload to R2`, error, {
        jobId,
        pdfUrl,
        errorMessage,
        originalError: JSON.stringify(error),
      });

      return { r2Key: undefined, uploaded: false, error: errorObj };
    }
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
      // Call Mistral API with PDF URL directly
      const { extractedText, pagesProcessed, pdfR2Key, usage } = await this.callMistralApi(message.pdfUrl, message.jobId);
      
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
        pdfUrl: message.pdfUrl,
        pdfR2Key,
        territoryId: message.territoryId,
        publicationDate: message.publicationDate,
        editionNumber: message.editionNumber,
        spiderId: message.spiderId,
        pagesProcessed,
        processingTimeMs,
        completedAt: new Date().toISOString(),
        metadata: {
          ...message.metadata,
          aiUsage: {
            provider: 'mistral',
            model: this.config.model || 'mistral-ocr-latest',
            totalTokens: usage.tokens.total,
            estimatedCost: usage.estimatedCost,
            timestamp: usage.timestamp,
          },
        },
      };
    } catch (error: unknown) {
      const processingTimeMs = Date.now() - startTime;
      const appError = error instanceof MistralOcrError ? error : toAppError(error);
      
      logger.error(`OCR processing failed for job ${message.jobId}`, {
        jobId: message.jobId,
        processingTimeMs,
        ...appError.toJSON()
      });

      return {
        jobId: message.jobId,
        status: 'failure',
        pdfUrl: message.pdfUrl,
        territoryId: message.territoryId,
        publicationDate: message.publicationDate,
        editionNumber: message.editionNumber,
        spiderId: message.spiderId,
        error: {
          message: appError.message,
          code: appError.code,
          details: appError.stack,
        },
        processingTimeMs,
        completedAt: new Date().toISOString(),
        metadata: message.metadata,
      };
    }
  }

  /**
   * Download PDF from URL
   */
  private async downloadPdf(url: string): Promise<ArrayBuffer> {
    logger.debug(`Downloading PDF from ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:108.0) Gecko/20100101 Firefox/108.0',
        'Accept': 'application/pdf,*/*',
      },
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
  private async callMistralApi(pdfUrl: string, jobId: string): Promise<{extractedText: string, pagesProcessed: number, pdfR2Key?: string}> {
    logger.debug(`Calling Mistral OCR API for job ${jobId}`);

    let finalPdfUrl = pdfUrl;
    let pdfR2Key: string | undefined;

    // Check if R2 public URL is localhost (development mode)
    const isLocalR2 = this.r2PublicUrl?.includes('localhost') || this.r2PublicUrl?.includes('127.0.0.1');

    // Use the new uploadToR2 method
    const uploadResult = await this.uploadToR2(pdfUrl, jobId);
    
    if (uploadResult.r2Key) {
      pdfR2Key = uploadResult.r2Key;
      
      // In development with localhost R2, fallback to original URL for Mistral
      // since Mistral API cannot access localhost
      if (isLocalR2) {
        logger.info(`Development mode detected, using original PDF URL for Mistral: ${pdfUrl}`);
        finalPdfUrl = pdfUrl;
      } else {
        // Production: use R2 public URL
        const baseUrl = this.r2PublicUrl || 'https://gazette-pdfs.qconcursos.workers.dev';
        finalPdfUrl = `${baseUrl}/${uploadResult.r2Key}`;
        logger.info(`Using R2 URL for OCR: ${finalPdfUrl}`);
      }
    } else if (uploadResult.error) {
      // Track R2 upload failure in database
      if (this.dbClient) {
        try {
          const db = this.dbClient.getDb();
          await db.insert(schema.errorLogs).values({
            id: this.dbClient.generateId(),
            workerName: 'goodfellow-ocr',
            operationType: 'r2_upload',
            severity: 'warning',
            errorMessage: uploadResult.error.message,
            stackTrace: uploadResult.error.stack || null,
            context: JSON.stringify({
              jobId,
              pdfUrl,
              r2Key: pdfR2Key,
              stage: 'r2_upload_failed',
              fallbackUsed: true
            }),
            jobId: null,
            territoryId: null
          });
          
          logger.info('R2 upload failure logged to database', {
            jobId,
            r2Key: pdfR2Key
          });
        } catch (dbError) {
          // Don't fail OCR if error logging fails
          logger.error('Failed to log R2 upload error to database', dbError);
        }
      }
      
      // Fallback to original URL
      logger.warn(`Failed to upload to R2, using original URL`, {
        jobId,
        pdfUrl,
        error: uploadResult.error.message
      });
      pdfR2Key = undefined;
    }

    const payload = {
      model: this.config.model,
      document: {
        type: 'document_url',
        document_url: finalPdfUrl
      },
      include_image_base64: false
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
      throw new MistralOcrError(
        `Mistral OCR API error: ${response.status} - ${errorText}`,
        'https://api.mistral.ai/v1/ocr',
        response.status,
        errorText,
        { jobId, pdfUrl }
      );
    }

    const result: unknown = await response.json();
    
    if (!isMistralOcrResponse(result)) {
      throw new MistralOcrError(
        'Invalid response format from Mistral API',
        'https://api.mistral.ai/v1/ocr',
        undefined,
        JSON.stringify(result).substring(0, 500),
        { jobId, pdfUrl }
      );
    }
    
    if (!result.pages || result.pages.length === 0) {
      throw new MistralOcrError(
        'No pages in Mistral OCR response',
        'https://api.mistral.ai/v1/ocr',
        undefined,
        undefined,
        { jobId, pdfUrl, responsePages: result.pages?.length || 0 }
      );
    }

    // Extract markdown from all pages and concatenate
    const extractedText = result.pages
      .map((page: MistralPage) => page.markdown || '')
      .filter((text: string) => text.length > 0)
      .join('\n\n---\n\n');

    if (!extractedText) {
      throw new MistralOcrError(
        'No text extracted from PDF',
        'https://api.mistral.ai/v1/ocr',
        undefined,
        undefined,
        { jobId, pdfUrl, pagesProcessed: result.pages.length }
      );
    }

    // Track Mistral OCR usage and cost
    // For Mistral OCR, estimate tokens based on extracted text length
    // Rough estimate: 1 token per 4 characters
    const estimatedPromptTokens = Math.ceil((pdfUrl.length + 100) / 4); // URL + request overhead
    const estimatedCompletionTokens = Math.ceil(extractedText.length / 4);
    
    const usage = CostTracker.trackUsage(
      'mistral',
      this.config.model || 'mistral-ocr-latest',
      'ocr',
      {
        prompt_tokens: estimatedPromptTokens,
        completion_tokens: estimatedCompletionTokens,
        total_tokens: estimatedPromptTokens + estimatedCompletionTokens,
      },
      {
        jobId,
        pdfUrl,
        pagesProcessed: result.pages.length,
        docSizeBytes: result.usage_info?.doc_size_bytes,
      }
    );

    logger.info(`Extracted text from ${result.pages.length} pages`, {
      jobId,
      pagesProcessed: result.usage_info?.pages_processed,
      docSizeBytes: result.usage_info?.doc_size_bytes,
      estimatedCost: usage.estimatedCost,
      estimatedTokens: usage.tokens.total,
    });

    return { extractedText, pagesProcessed: result.pages.length, pdfR2Key, usage };
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
  
  /**
   * Generate mock OCR response for testing
   */
  private generateMockOcrResponse(pdfUrl: string, jobId: string): string {
    logger.info(`Generating mock OCR response for job ${jobId}`);
    
    // Generate realistic mock content based on the URL
    const mockContent = `
# DIÁRIO OFICIAL - EDIÇÃO Nº 112

**Data: 03 de Outubro de 2025**
**Município: ${pdfUrl.includes('aam') ? 'Manaus - AM' : 'Município'}**

## ATOS DO PODER EXECUTIVO

### DECRETO Nº 2025/2025

O PREFEITO MUNICIPAL, no uso de suas atribuições legais, DECRETA:

Art. 1º - Fica autorizada a abertura de CONCURSO PÚBLICO para provimento de vagas no quadro permanente de servidores municipais.

Art. 2º - As vagas disponíveis são:
- 50 vagas para Professor de Educação Básica
- 30 vagas para Enfermeiro
- 20 vagas para Analista de Sistemas
- 15 vagas para Engenheiro Civil

### EDITAL DE CONCURSO PÚBLICO Nº 001/2025

A Prefeitura Municipal torna público a abertura de inscrições para o CONCURSO PÚBLICO destinado ao preenchimento de vagas e formação de cadastro reserva.

**PERÍODO DE INSCRIÇÕES**: 10/10/2025 a 10/11/2025
**TAXA DE INSCRIÇÃO**: R$ 80,00 a R$ 120,00 conforme o cargo
**PROVAS**: 15/12/2025

Os candidatos aprovados serão nomeados sob o regime estatutário.

### PROCESSO SELETIVO SIMPLIFICADO Nº 002/2025

Fica aberto PROCESSO SELETIVO para contratação temporária de:
- 10 Médicos Clínico Geral
- 5 Psicólogos

**Mock OCR generated for testing purposes**
**Job ID**: ${jobId}
**PDF URL**: ${pdfUrl}
`;
    
    return mockContent;
  }
}
