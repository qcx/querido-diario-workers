/**
 * Cache Service - R2 Storage Management
 * Handles PDF storage in R2 bucket with deduplication and error handling
 */

export interface StorageServiceEnv {
  GAZETTE_PDFS?: R2Bucket;
  R2_PUBLIC_URL?: string;
}

export interface UploadResult {
  r2Key?: string;
  error?: Error;
}

/**
 * Cache Service for R2 PDF storage
 * Pure service focused on R2 operations without external dependencies
 */
export class StorageService {
  constructor(private env: StorageServiceEnv) {}

  /**
   * Upload PDF to R2 bucket with deduplication
   */
  async uploadPdf(pdfUrl: string): Promise<{ r2Key: string, pdf: R2Object | null }> {
    if (!this.env.GAZETTE_PDFS) {
      return { r2Key: '', pdf: null };
    }

    const r2Key = this.generateKey(pdfUrl);

    // Check if file already exists (deduplication)
    const existing = await this.env.GAZETTE_PDFS.head(r2Key);
    
    if (existing) {
      return { r2Key, pdf: existing as R2Object };
    }

    // Download PDF from original URL
    const response = await fetch(pdfUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:108.0) Gecko/20100101 Firefox/108.0',
        'Accept': 'application/pdf,*/*',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download PDF: ${response.status}`);
    }

    const pdfData = await response.arrayBuffer();

    // Upload to R2
    const newPdf = await this.env.GAZETTE_PDFS.put(r2Key, pdfData, {
      httpMetadata: {
        contentType: 'application/pdf',
      },
    });

    return { r2Key, pdf: newPdf };
  
  }

  async getPdf(pdfUrl: string): Promise<{ r2Key: string, pdf: R2Object | null }> {
    const r2Key = this.generateKey(pdfUrl);

    if (!this.env.GAZETTE_PDFS) {
      return { r2Key, pdf: null };
    }

    const pdf = await this.env.GAZETTE_PDFS.get(r2Key);

    if (pdf) {
      return { r2Key, pdf: pdf as R2Object };
    }

    const newPdf = await this.uploadPdf(pdfUrl);

    if (newPdf.r2Key) {
      return { r2Key: newPdf.r2Key, pdf: newPdf.pdf as R2Object };
    }

    return { r2Key, pdf: null };
  }
  /**
   * Generate R2 key from PDF URL
   */
  generateKey(pdfUrl: string): string {
    const base64 = btoa(pdfUrl)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
    return `pdfs/${base64}.pdf`;
  }

  /**
   * Get public URL for R2 key if available
   */
  getPublicUrl(r2Key: string): string | null {
    if (!this.env.R2_PUBLIC_URL || !r2Key) {
      return null;
    }

    // Check if it's a local R2 instance
    const isLocalR2 = this.env.R2_PUBLIC_URL.includes('localhost') || 
                      this.env.R2_PUBLIC_URL.includes('127.0.0.1');
    
    if (isLocalR2) {
      return null;
    }

    return `${this.env.R2_PUBLIC_URL}/${r2Key}`;
  }
}
