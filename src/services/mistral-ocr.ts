/**
 * Mistral OCR Service
 * Handles PDF processing using Mistral's OCR API
 */

import { OcrQueueMessage, OcrResult, MistralOcrConfig } from '../types';
import { logger } from '../utils';

export class MistralOcrService {
  private config: MistralOcrConfig;
  private r2Bucket?: R2Bucket;

  constructor(config: MistralOcrConfig & { r2Bucket?: R2Bucket }) {
    this.config = {
      endpoint: 'https://api.mistral.ai/v1/ocr',
      model: 'mistral-ocr-latest',
      maxPages: 1000,
      timeout: 120000,
      ...config,
    };
    this.r2Bucket = config.r2Bucket;
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
      const extractedText = await this.callMistralApi(message.pdfUrl, message.jobId);
      
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
  private async callMistralApi(pdfUrl: string, jobId: string): Promise<string> {
    logger.debug(`Calling Mistral OCR API for job ${jobId}`);

    let finalPdfUrl = pdfUrl;

    // If R2 is configured, download and upload to R2
    if (this.r2Bucket) {
      try {
        logger.info(`Downloading PDF from ${pdfUrl} for R2 upload`);
        
        // Download PDF
        const pdfResponse = await fetch(pdfUrl);
        if (!pdfResponse.ok) {
          throw new Error(`Failed to download PDF: ${pdfResponse.status}`);
        }
        
        const pdfData = await pdfResponse.arrayBuffer();
        const key = `pdfs/${jobId}_${Date.now()}.pdf`;
        
        // Upload to R2
        logger.info(`Uploading PDF to R2: ${key}`);
        await this.r2Bucket.put(key, pdfData, {
          httpMetadata: {
            contentType: 'application/pdf',
          },
        });
        
        // Get R2 public URL
        finalPdfUrl = `https://gazette-pdfs.qconcursos.workers.dev/${key}`;
        logger.info(`Using R2 URL for OCR: ${finalPdfUrl}`);
      } catch (error: any) {
        logger.error(`Failed to upload to R2, using original URL`, error);
        // Fallback to original URL
      }
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
      throw new Error(`Mistral OCR API error: ${response.status} - ${errorText}`);
    }

    const result: any = await response.json();
    
    if (!result.pages || !Array.isArray(result.pages) || result.pages.length === 0) {
      throw new Error('No pages in Mistral OCR response');
    }

    // Extract markdown from all pages and concatenate
    const extractedText = result.pages
      .map((page: any) => page.markdown || '')
      .filter((text: string) => text.length > 0)
      .join('\n\n---\n\n');

    if (!extractedText) {
      throw new Error('No text extracted from PDF');
    }

    logger.info(`Extracted text from ${result.pages.length} pages`, {
      jobId,
      pagesProcessed: result.usage_info?.pages_processed,
      docSizeBytes: result.usage_info?.doc_size_bytes,
    });

    return extractedText;
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
