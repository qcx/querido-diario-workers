/**
 * Cache Service for OCR Results
 * Provides a unified interface for caching OCR results with KV storage as primary cache
 * and database as fallback, following the patterns from the goodfellow OCR processor
 */

import { OcrResultsRepository } from '../../../v2/db/repositories/ocr_results';
import { logger } from '../../../utils/logger';

/**
 * OCR result structure for caching
 */
export interface CachedOcrResult {
  jobId: string;
  status: 'success' | 'failure' | 'partial';
  extractedText: string;
  pdfUrl: string;
  pdfR2Key?: string;
  territoryId: string;
  gazetteDate: string;
  editionNumber?: string;
  spiderId?: string;
  pagesProcessed?: number;
  processingTimeMs?: number;
  confidence?: number;
  language?: string;
  completedAt: string;
  error?: {
    message: string;
    code?: string;
    details?: any;
  };
  metadata?: Record<string, any>;
}

/**
 * Configuration for cache service
 */
export interface CacheServiceConfig {
  OCR_RESULTS?: KVNamespace;
  defaultTtl?: number; // Default TTL in seconds (24 hours)
}

/**
 * Cache service for OCR results with KV primary and database fallback
 */
export class CacheService {
  private readonly defaultTtl: number;

  constructor(
    private config: CacheServiceConfig,
    private ocrResultsRepository: OcrResultsRepository
  ) {
    this.defaultTtl = config.defaultTtl || 86400; // 24 hours default
  }

  /**
   * Generate a consistent KV key from PDF URL
   * Uses base64 encoding to create a URL-safe key (same as goodfellow implementation)
   */
  private generateCacheKey(pdfUrl: string): string {
    // Base64 encode the URL and make it URL-safe for KV
    const base64 = btoa(pdfUrl)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    return `ocr:${base64}`;
  }

  /**
   * Get OCR result from cache (KV first, database fallback)
   * This is the optimized "hot path" for reusing existing OCR results
   */
  async getOcrResult(
    pdfUrl: string,
    gazetteId?: string,
    jobId?: string
  ): Promise<CachedOcrResult | null> {
    // Step 1: Try KV cache first (hot path)
    if (this.config.OCR_RESULTS) {
      const cacheKey = this.generateCacheKey(pdfUrl);
      
      const cachedData = await this.config.OCR_RESULTS.get(cacheKey);

      if (cachedData) {
        const cached = JSON.parse(cachedData) as CachedOcrResult;
        return cached;
      }
    }

    // Step 2: Fallback to database
    if (gazetteId) {
      const existingOcr = await this.ocrResultsRepository.findByGazetteId(gazetteId);
      
      if (existingOcr) {
        // Reconstruct cached result format
        const metadata = existingOcr.metadata ? 
          (typeof existingOcr.metadata === 'string' ? 
            JSON.parse(existingOcr.metadata) : 
            existingOcr.metadata) : {};

        const result: CachedOcrResult = {
          jobId: jobId || 'unknown',
          status: 'success',
          extractedText: existingOcr.extractedText,
          pdfUrl,
          pdfR2Key: metadata.pdfR2Key,
          territoryId: metadata.territoryId || 'unknown',
          gazetteDate: metadata.gazetteDate || 'unknown',
          editionNumber: metadata.editionNumber,
          spiderId: metadata.spiderId,
          pagesProcessed: metadata.pagesProcessed || 0,
          processingTimeMs: metadata.processingTimeMs,
          confidence: existingOcr.confidenceScore || undefined,
          language: existingOcr.languageDetected || undefined,
          completedAt: existingOcr.createdAt,
          metadata
        };

        // Step 3: Repopulate KV cache (cache-aside pattern)
        await this.setOcrResult(pdfUrl, result);

        return result;
      }
    }

    return null;
  }

  /**
   * Store OCR result in cache (KV primary)
   */
  async setOcrResult(
    pdfUrl: string, 
    result: CachedOcrResult, 
    ttl?: number
  ): Promise<boolean> {
    if (!this.config.OCR_RESULTS) {
      return false;
    }

    const cacheKey = this.generateCacheKey(pdfUrl);
    const cacheTtl = ttl || this.defaultTtl;

    await this.config.OCR_RESULTS.put(
      cacheKey,
      JSON.stringify(result),
      {
        expirationTtl: cacheTtl
      }
    );

    return true;
  }
}