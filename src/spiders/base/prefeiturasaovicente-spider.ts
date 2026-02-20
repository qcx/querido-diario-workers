import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PlonePortalConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

interface Publication {
  pdfUrl: string;
  date: string; // YYYY-MM-DD format
  editionNumber?: string;
  isExtra?: boolean;
}

/**
 * Spider for Prefeitura de São Vicente - Boletim Oficial do Município
 * 
 * Site Structure:
 * - Main URL: https://www.saovicente.sp.gov.br/transparencia/bom
 * - Uses Plone CMS (gov.cidades theme)
 * - PDF listings directly in HTML page
 * 
 * PDF URL pattern:
 * - https://www.saovicente.sp.gov.br/transparencia/bom/bom-edicao-{EDITION}-{DDMMYYYY}-versaoimpressao.pdf/view
 * - Extra editions: bom-edicao-{EDITION}-extra-versaoimpressao.pdf/view
 * - Suplementar editions: bom-edicao-{EDITION}-suplementar-versaoimpressao.pdf/view
 * 
 * Download endpoint: Add @@download/file to PDF URL for direct download
 */
export class PrefeiturasaovicenteSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const ploneConfig = config.config as PlonePortalConfig;
    this.baseUrl = ploneConfig.baseUrl || 'https://www.saovicente.sp.gov.br/transparencia/bom';
  }

  /**
   * Set browser instance (for queue consumer context)
   * Note: This spider doesn't require browser automation
   */
  setBrowser(_browser: Fetcher): void {
    // Not needed - this spider uses HTTP requests
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    logger.info(`Crawling São Vicente gazettes from ${this.baseUrl}...`);

    try {
      const response = await fetch(this.baseUrl, {
        headers: {
          'Accept': 'text/html',
          'User-Agent': 'Mozilla/5.0 (compatible; QDSpider/1.0)',
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const html = await response.text();
      const publications = this.parsePublications(html);

      logger.info(`Found ${publications.length} publications on the page`);

      for (const pub of publications) {
        // Skip if already processed
        if (seenUrls.has(pub.pdfUrl)) continue;
        seenUrls.add(pub.pdfUrl);

        // Parse and check date range
        const date = new Date(pub.date);
        if (date < this.startDate || date > this.endDate) {
          continue;
        }

        const gazette = await this.createGazette(date, pub.pdfUrl, {
          editionNumber: pub.editionNumber,
          isExtraEdition: pub.isExtra,
          power: 'executive_legislative',
        });

        if (gazette) {
          gazettes.push(gazette);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
    } catch (error) {
      logger.error(`Error crawling São Vicente: ${error}`);
    }

    return gazettes;
  }

  private parsePublications(html: string): Publication[] {
    const publications: Publication[] = [];

    // Pattern to match PDF URLs with dates in the filename
    // Format: bom-edicao-{EDITION}-{DDMMYYYY}-versaoimpressao.pdf
    // or: bom-edicao-{EDITION}-extra-versaoimpressao.pdf
    // or: bom-edicao-{EDITION}-suplementar-versaoimpressao.pdf
    const pdfPattern = /href="(https:\/\/www\.saovicente\.sp\.gov\.br\/transparencia\/bom\/bom-edicao-(\d+)-([a-z0-9-]+)\.pdf\/view)"/gi;
    
    let match;
    const seenUrls = new Set<string>();

    while ((match = pdfPattern.exec(html)) !== null) {
      const pdfUrl = match[1];
      const editionNumber = match[2];
      const suffix = match[3];

      // Skip duplicates
      if (seenUrls.has(pdfUrl)) continue;
      seenUrls.add(pdfUrl);

      // Try to extract date from the suffix
      // Pattern: DDMMYYYY-versaoimpressao or extra-versaoimpressao
      const dateMatch = suffix.match(/^(\d{8})-/);
      const isExtra = suffix.includes('extra');
      const isSupplementar = suffix.includes('suplementar');

      let date: string | null = null;

      if (dateMatch) {
        // Parse DDMMYYYY to YYYY-MM-DD
        const ddmmyyyy = dateMatch[1];
        const day = ddmmyyyy.substring(0, 2);
        const month = ddmmyyyy.substring(2, 4);
        const year = ddmmyyyy.substring(4, 8);
        date = `${year}-${month}-${day}`;
      } else {
        // For extra/suplementar editions, try to find date from title text nearby
        // Look for pattern: Edição XXX - DD/MM/YYYY
        const titlePattern = new RegExp(`Edição\\s+${editionNumber}[^<]*?(\\d{2})\\/(\\d{2})\\/(\\d{4})`, 'i');
        const titleMatch = html.match(titlePattern);
        if (titleMatch) {
          date = `${titleMatch[3]}-${titleMatch[2]}-${titleMatch[1]}`;
        }
      }

      if (date) {
        // Convert view URL to download URL
        const downloadUrl = pdfUrl.replace('/view', '/@@download/file');
        
        publications.push({
          pdfUrl: downloadUrl,
          date,
          editionNumber,
          isExtra: isExtra || isSupplementar,
        });
      }
    }

    return publications;
  }
}

