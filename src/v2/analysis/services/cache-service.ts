/**
 * Cache Service for Analysis Results
 * Manages KV cache for OCR and analysis results with deduplication
 */
import { AnalysisResultsRepository } from '../../db/repositories/analysis_results';
import { OcrResultsRepository } from '../../db/repositories/ocr_results';
import type { AnalysisCacheKey, AnalysisQueueHandlerEnv } from '../types';
import { schema } from '../../db';

export interface CachedAnalysisResult {
  analysis: typeof schema.analysisResults.$inferSelect;
  id: string;
  cachedAt: string;
}

export class CacheService {
  private env: AnalysisQueueHandlerEnv; 
  private analysisRepo: AnalysisResultsRepository;
  private ocrRepo: OcrResultsRepository;

  constructor(
    env: AnalysisQueueHandlerEnv,
    analysisRepo: AnalysisResultsRepository,
    ocrRepo: OcrResultsRepository
  ) {
    this.env = env;
    this.analysisRepo = analysisRepo;
    this.ocrRepo = ocrRepo;
  }

  /**
   * Generate cache key for OCR results
   * Uses base64 encoding to create a URL-safe key
   */
  private generateOcrCacheKey(pdfUrl: string): string {
    const base64 = btoa(pdfUrl)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    return `ocr:${base64}`;
  }

  /**
   * Generate cache key for analysis deduplication
   * Based solely on configHash (plus optional cityFilter)
   */
  private generateAnalysisCacheKey(key: AnalysisCacheKey): string {
    const parts = [
      'analysis',
      'dedup',
      key.configHash
    ];

    if (key.cityFilter) {
      parts.push(key.cityFilter);
    }

    return parts.join(':');
  }
  /**
   * Get OCR result from cache (KV first, database fallback)
   */
  async getOcrResult(
    pdfUrl: string,
    ocrResultId?: string
  ): Promise<typeof schema.ocrResults.$inferSelect | null> {
    const cacheKey = this.generateOcrCacheKey(pdfUrl);

    try {
      const cached = await this.env.OCR_RESULTS.get(cacheKey);
      
      if (cached) {
        const ocrData = JSON.parse(cached);
        
        if (ocrData.extractedText) {
          return {
            id: ocrResultId || 'cached',
            documentType: 'gazette_registry',
            documentId: ocrResultId || '',
            extractedText: ocrData.extractedText,
            textLength: ocrData.extractedText.length,
            confidenceScore: ocrData.confidence || null,
            languageDetected: ocrData.language || 'pt',
            processingMethod: 'mistral',
            createdAt: ocrData.completedAt,
            metadata: JSON.stringify({
              pdfUrl: ocrData.pdfUrl,
              pdfR2Key: ocrData.pdfR2Key,
              territoryId: ocrData.territoryId,
              gazetteDate: ocrData.gazetteDate,
              editionNumber: ocrData.editionNumber,
              spiderId: ocrData.spiderId,
              pagesProcessed: ocrData.pagesProcessed,
              processingTimeMs: ocrData.processingTimeMs
            })
          };
        }
      }
    } catch (error) {
      // Continue to database fallback
    }

    if (ocrResultId) {
      const dbOcr = await this.ocrRepo.findByDocumentId(ocrResultId, 'gazette_registry');
      
      if (dbOcr) {
        const metadata = dbOcr.metadata ? 
          (typeof dbOcr.metadata === 'string' ? JSON.parse(dbOcr.metadata) : dbOcr.metadata) : {};

        const cacheData = {
          jobId: 'db-fallback',
          status: 'success',
          extractedText: dbOcr.extractedText,
          pdfUrl,
          pdfR2Key: metadata.pdfR2Key,
          territoryId: metadata.territoryId || 'unknown',
          gazetteDate: metadata.gazetteDate || 'unknown',
          editionNumber: metadata.editionNumber,
          spiderId: metadata.spiderId,
          pagesProcessed: metadata.pagesProcessed || 0,
          processingTimeMs: metadata.processingTimeMs,
          confidence: dbOcr.confidenceScore || undefined,
          language: dbOcr.languageDetected || 'pt',
          completedAt: dbOcr.createdAt
        };

        try {
          await this.env.OCR_RESULTS.put(
            cacheKey,
            JSON.stringify(cacheData),
            { expirationTtl: 86400 }
          );
        } catch (error) {
          // Cache repopulation failed, continue
        }

        return dbOcr;
      }
    }

    return null;
  }

  /**
   * Get cached analysis result by configHash
   */
  async getCachedAnalysis(
    configHash: string,
    cityFilter?: string
  ): Promise<CachedAnalysisResult | null> {
    const cacheKey = this.generateAnalysisCacheKey({
      configHash,
      cityFilter
    });

    try {
      const cached = await this.env.ANALYSIS_RESULTS.get(cacheKey);
      
      if (!cached) {
        // Try database fallback
        const dbAnalysis = await this.analysisRepo.findExistingAnalysis(configHash);

        if (dbAnalysis) {
          // Cache it for future use
          await this.cacheAnalysis(dbAnalysis, cityFilter);
          
          return {
            analysis: dbAnalysis,
            id: dbAnalysis.id,
            cachedAt: new Date().toISOString()
          };
        }

        return null;
      }

      const result = JSON.parse(cached) as CachedAnalysisResult;

      return result;
    } catch (error) {
      return null;
    }
  }

  /**
   * Cache analysis result
   */
  async cacheAnalysis(
    analysis: typeof schema.analysisResults.$inferSelect,
    cityFilter?: string
  ): Promise<void> {
    const metadata = JSON.parse(analysis.metadata);
    const configHash = metadata.configSignature?.configHash || '';
    
    const cacheKey = this.generateAnalysisCacheKey({
      configHash,
      cityFilter
    });

    const cacheData: CachedAnalysisResult = {
      analysis,
      id: analysis.id,
      cachedAt: new Date().toISOString()
    };

    try {
      await this.env.ANALYSIS_RESULTS.put(
        cacheKey,
        JSON.stringify(cacheData),
        {
          expirationTtl: 86400, // 24 hours
          metadata: {
            territoryId: analysis.territoryId,
            gazetteId: analysis.gazetteId,
            totalFindings: analysis.totalFindings,
            publicationDate: analysis.publicationDate,
            analyzedAt: analysis.analyzedAt
          }
        }
      );
    } catch (error) {
    }
  }

  /**
   * Clear cache for specific analysis
   */
  async clearAnalysisCache(
    configHash: string,
    cityFilter?: string
  ): Promise<void> {
    const cacheKey = this.generateAnalysisCacheKey({
      configHash,
      cityFilter
    });

    try {
      await this.env.ANALYSIS_RESULTS.delete(cacheKey);
    } catch (error) {
    }
  }
}
