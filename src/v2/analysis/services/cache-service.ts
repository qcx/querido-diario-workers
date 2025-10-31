/**
 * Cache Service for Analysis Results
 * Manages KV cache for OCR and analysis results with deduplication
 */

import { logger } from '../../../utils';
import { OcrResult, GazetteAnalysis } from '../../../types';
import { AnalysisResultsRepository } from '../../db/repositories/analysis_results';
import { OcrResultsRepository } from '../../db/repositories/ocr_results';
import type { AnalysisCacheKey } from '../types';

export interface CacheConfig {
  ANALYSIS_RESULTS: KVNamespace;
  OCR_RESULTS?: KVNamespace;
  defaultTtl?: number;
}

export interface CachedAnalysisResult {
  analysis: GazetteAnalysis;
  id: string;
  cachedAt: string;
}

export interface CachedOcrResult extends OcrResult {
  cachedAt: string;
}

export class CacheService {
  private config: CacheConfig;
  private analysisRepo: AnalysisResultsRepository;
  private ocrRepo?: OcrResultsRepository;

  constructor(
    config: CacheConfig,
    analysisRepo: AnalysisResultsRepository,
    ocrRepo?: OcrResultsRepository
  ) {
    this.config = {
      defaultTtl: 86400, // 24 hours default
      ...config
    };
    this.analysisRepo = analysisRepo;
    this.ocrRepo = ocrRepo;
  }

  /**
   * Generate cache key for analysis deduplication
   */
  private generateAnalysisCacheKey(key: AnalysisCacheKey): string {
    const parts = [
      'analysis',
      'dedup',
      key.territoryId,
      key.gazetteId,
      key.configHash
    ];

    if (key.cityFilter) {
      parts.push(key.cityFilter);
    }

    return parts.join(':');
  }

  /**
   * Generate cache key for OCR results
   */
  private generateOcrCacheKey(ocrResultId: string): string {
    return `ocr:result:${ocrResultId}`;
  }

  /**
   * Get cached analysis result
   */
  async getCachedAnalysis(
    territoryId: string,
    gazetteId: string,
    configHash: string,
    cityFilter?: string
  ): Promise<CachedAnalysisResult | null> {
    const cacheKey = this.generateAnalysisCacheKey({
      territoryId,
      gazetteId,
      configHash,
      cityFilter
    });

    try {
      const cached = await this.config.ANALYSIS_RESULTS.get(cacheKey);
      
      if (!cached) {
        // Try database fallback
        const dbAnalysisId = await this.analysisRepo.findExistingAnalysis(
          territoryId,
          gazetteId,
          configHash
        );

        if (dbAnalysisId) {
          const dbAnalysis = await this.analysisRepo.getAnalysisById(dbAnalysisId);
          
          if (dbAnalysis) {
            // Reconstruct GazetteAnalysis from database record
            const analysis = this.reconstructAnalysisFromDb(dbAnalysis);
            
            // Cache it for future use
            await this.cacheAnalysis(
              territoryId,
              gazetteId,
              configHash,
              analysis,
              dbAnalysisId,
              cityFilter
            );

            return {
              analysis,
              id: dbAnalysisId,
              cachedAt: new Date().toISOString()
            };
          }
        }

        return null;
      }

      const result = JSON.parse(cached) as CachedAnalysisResult;
      
      logger.debug('Cache hit for analysis', {
        cacheKey,
        territoryId,
        gazetteId,
        totalFindings: result.analysis.summary.totalFindings
      });

      return result;
    } catch (error) {
      logger.error('Failed to get cached analysis', error as Error, {
        cacheKey,
        territoryId,
        gazetteId
      });
      return null;
    }
  }

  /**
   * Cache analysis result
   */
  async cacheAnalysis(
    territoryId: string,
    gazetteId: string,
    configHash: string,
    analysis: GazetteAnalysis,
    analysisId: string,
    cityFilter?: string
  ): Promise<void> {
    const cacheKey = this.generateAnalysisCacheKey({
      territoryId,
      gazetteId,
      configHash,
      cityFilter
    });

    const cacheData: CachedAnalysisResult = {
      analysis,
      id: analysisId,
      cachedAt: new Date().toISOString()
    };

    try {
      await this.config.ANALYSIS_RESULTS.put(
        cacheKey,
        JSON.stringify(cacheData),
        {
          expirationTtl: this.config.defaultTtl,
          metadata: {
            territoryId,
            gazetteId,
            totalFindings: analysis.summary.totalFindings,
            publicationDate: analysis.publicationDate,
            analyzedAt: analysis.analyzedAt
          }
        }
      );

      logger.debug('Analysis cached successfully', {
        cacheKey,
        analysisId,
        territoryId,
        gazetteId,
        expiresIn: `${this.config.defaultTtl}s`
      });
    } catch (error) {
      logger.error('Failed to cache analysis', error as Error, {
        cacheKey,
        analysisId
      });
    }
  }

  /**
   * Get cached OCR result
   */
  async getOcrResult(ocrResultId: string): Promise<OcrResult | null> {
    if (!this.config.OCR_RESULTS) {
      // Fallback to database if no OCR cache configured
      return this.getOcrFromDatabase(ocrResultId);
    }

    const cacheKey = this.generateOcrCacheKey(ocrResultId);

    try {
      const cached = await this.config.OCR_RESULTS.get(cacheKey);
      
      if (!cached) {
        // Try database fallback
        return this.getOcrFromDatabase(ocrResultId);
      }

      const result = JSON.parse(cached) as CachedOcrResult;
      
      logger.debug('Cache hit for OCR result', {
        cacheKey,
        ocrResultId,
        textLength: result.extractedText?.length || 0
      });

      return result;
    } catch (error) {
      logger.error('Failed to get cached OCR result', error as Error, {
        cacheKey,
        ocrResultId
      });
      return null;
    }
  }

  /**
   * Cache OCR result
   */
  async cacheOcrResult(ocrResultId: string, ocrResult: OcrResult): Promise<void> {
    if (!this.config.OCR_RESULTS) {
      return;
    }

    const cacheKey = this.generateOcrCacheKey(ocrResultId);

    const cacheData: CachedOcrResult = {
      ...ocrResult,
      cachedAt: new Date().toISOString()
    };

    try {
      await this.config.OCR_RESULTS.put(
        cacheKey,
        JSON.stringify(cacheData),
        {
          expirationTtl: this.config.defaultTtl,
          metadata: {
            territoryId: ocrResult.territoryId,
            publicationDate: ocrResult.publicationDate,
            textLength: ocrResult.extractedText?.length || 0
          }
        }
      );

      logger.debug('OCR result cached successfully', {
        cacheKey,
        ocrResultId,
        expiresIn: `${this.config.defaultTtl}s`
      });
    } catch (error) {
      logger.error('Failed to cache OCR result', error as Error, {
        cacheKey,
        ocrResultId
      });
    }
  }

  /**
   * Get OCR result from database
   */
  private async getOcrFromDatabase(ocrResultId: string): Promise<OcrResult | null> {
    if (!this.ocrRepo) {
      return null;
    }

    try {
      const dbOcr = await this.ocrRepo.findById(ocrResultId);
      
      if (!dbOcr || !dbOcr.extractedText) {
        return null;
      }

      // Convert to OcrResult format
      const result: OcrResult = {
        jobId: dbOcr.jobId,
        status: 'success',
        extractedText: dbOcr.extractedText,
        territoryId: dbOcr.territoryId,
        publicationDate: dbOcr.gazetteDate,
        metadata: JSON.parse(dbOcr.metadata || '{}')
      };

      // Cache for future use if OCR cache is available
      if (this.config.OCR_RESULTS) {
        await this.cacheOcrResult(ocrResultId, result);
      }

      return result;
    } catch (error) {
      logger.error('Failed to get OCR from database', error as Error, {
        ocrResultId
      });
      return null;
    }
  }

  /**
   * Reconstruct GazetteAnalysis from database record
   */
  private reconstructAnalysisFromDb(dbRecord: any): GazetteAnalysis {
    return {
      jobId: dbRecord.jobId,
      ocrJobId: dbRecord.jobId, // Assuming same job ID
      territoryId: dbRecord.territoryId,
      publicationDate: dbRecord.publicationDate,
      analyzedAt: dbRecord.analyzedAt,
      
      // OCR data - will need to be loaded separately if needed
      extractedText: '',
      textLength: 0,
      
      // Analysis results - simplified reconstruction
      analyses: [],
      
      // Aggregated findings
      summary: JSON.parse(dbRecord.summary),
      
      // Metadata
      metadata: JSON.parse(dbRecord.metadata)
    };
  }

  /**
   * Clear cache for specific analysis
   */
  async clearAnalysisCache(
    territoryId: string,
    gazetteId: string,
    configHash: string,
    cityFilter?: string
  ): Promise<void> {
    const cacheKey = this.generateAnalysisCacheKey({
      territoryId,
      gazetteId,
      configHash,
      cityFilter
    });

    try {
      await this.config.ANALYSIS_RESULTS.delete(cacheKey);
      
      logger.debug('Analysis cache cleared', {
        cacheKey,
        territoryId,
        gazetteId
      });
    } catch (error) {
      logger.error('Failed to clear analysis cache', error as Error, {
        cacheKey
      });
    }
  }

  /**
   * Clear OCR cache
   */
  async clearOcrCache(ocrResultId: string): Promise<void> {
    if (!this.config.OCR_RESULTS) {
      return;
    }

    const cacheKey = this.generateOcrCacheKey(ocrResultId);

    try {
      await this.config.OCR_RESULTS.delete(cacheKey);
      
      logger.debug('OCR cache cleared', {
        cacheKey,
        ocrResultId
      });
    } catch (error) {
      logger.error('Failed to clear OCR cache', error as Error, {
        cacheKey
      });
    }
  }
}
