import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, PrefeituradiademaConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

interface Publication {
  pdfUrl: string;
  date: string; // YYYY-MM-DD format
  editionNumber?: string;
}

/**
 * Spider for Prefeitura de Diadema - Diário Oficial
 * 
 * Site Structure:
 * - Main site: https://diariooficial.diadema.sp.gov.br/
 * - Uses ScriptCase application for document management
 * - API endpoint: /appconsulta_sc/appconsulta_sc_mobile/
 * - PDFs hosted at: https://arquivosanexos.diadema.sp.gov.br/arquivos_diario_oficial/publicacoes/
 * 
 * PDF URL pattern:
 * - https://arquivosanexos.diadema.sp.gov.br/arquivos_diario_oficial/publicacoes/{YEAR}/{ID}/{DDMMYYYY}_DOE_Diadema_{EDITION}.pdf
 * - Date format in filename: DDMMYYYY
 */
export class PrefeituradiademaSpider extends BaseSpider {
  private baseUrl: string;
  private mobileApiUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const diademaConfig = config.config as PrefeituradiademaConfig;
    this.baseUrl = diademaConfig.baseUrl || 'https://diariooficial.diadema.sp.gov.br';
    this.mobileApiUrl = `${this.baseUrl}/appconsulta_sc/appconsulta_sc_mobile/`;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const seenUrls = new Set<string>();

    logger.info(`Crawling Diadema gazettes from ${this.mobileApiUrl}...`);

    try {
      const response = await fetch(this.mobileApiUrl, {
        headers: {
          'Accept': 'text/html',
          'User-Agent': 'Mozilla/5.0 (compatible; QDSpider/1.0)',
        }
      });
      
      if (!response.ok) {
        logger.error(`Failed to fetch ${this.mobileApiUrl}: ${response.status}`);
        return gazettes;
      }

      const html = await response.text();
      const publications = this.extractPublications(html);

      for (const pub of publications) {
        const pubDate = new Date(pub.date);

        if (pubDate > this.endDate) continue;
        if (pubDate < this.startDate) continue;

        if (!seenUrls.has(pub.pdfUrl)) {
          seenUrls.add(pub.pdfUrl);

          const gazette: Gazette = {
            date: pub.date,
            fileUrl: pub.pdfUrl,
            territoryId: this.config.territoryId,
            scrapedAt: new Date().toISOString(),
            editionNumber: pub.editionNumber,
            power: 'executive',
          };

          gazettes.push(gazette);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
      return gazettes;
    } catch (error) {
      logger.error(`Error crawling Diadema gazettes: ${error}`);
      return gazettes;
    }
  }

  private extractPublications(html: string): Publication[] {
    const publications: Publication[] = [];
    
    // Pattern for PDF URLs:
    // https://arquivosanexos.diadema.sp.gov.br/arquivos_diario_oficial/publicacoes/2025/1174/29122025_DOE_Diadema_1027.pdf
    const pdfPattern = /href="(https:\/\/arquivosanexos\.diadema\.sp\.gov\.br\/arquivos_diario_oficial\/publicacoes\/\d{4}\/\d+\/(\d{8})_DOE_Diadema_(\d+)\.pdf)"/gi;
    
    let match;
    while ((match = pdfPattern.exec(html)) !== null) {
      const pdfUrl = match[1];
      const dateStr = match[2]; // DDMMYYYY
      const editionNumber = match[3];

      // Parse date from DDMMYYYY format
      const day = dateStr.substring(0, 2);
      const month = dateStr.substring(2, 4);
      const year = dateStr.substring(4, 8);
      const isoDate = `${year}-${month}-${day}`;

      publications.push({
        pdfUrl,
        date: isoDate,
        editionNumber,
      });
    }

    return publications;
  }
}

