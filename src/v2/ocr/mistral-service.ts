/**
 * Configuration for Mistral OCR API
 */
export interface MistralOcrConfig {
  /** Mistral API key */
  apiKey: string;
  
  /** API endpoint */
  endpoint?: string;
  
  /** Model to use for OCR */
  model?: string;
  
  /** Maximum pages to process per request */
  maxPages?: number;
  
  /** Timeout in milliseconds */
  timeout?: number;
}

export class MistralService {
  private config: MistralOcrConfig;
  private r2Bucket?: R2Bucket;
  private r2PublicUrl?: string;

  constructor(config: MistralOcrConfig & { 
    r2Bucket?: R2Bucket; 
    r2PublicUrl?: string;
  }) {
    this.config = {
      endpoint: 'https://api.mistral.ai/v1/ocr',
      model: 'mistral-ocr-latest',
      maxPages: 1000,
      timeout: 120000,
      ...config
    };
    this.r2Bucket = config.r2Bucket;
    this.r2PublicUrl = config.r2PublicUrl;
  }
}