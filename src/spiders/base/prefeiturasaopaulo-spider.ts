import { BaseSpider } from './base-spider';
import { SpiderConfig, PrefeiturasaopauloConfig } from '../../types/spider-config';
import { Gazette } from '../../types/gazette';
import { DateRange } from '../../types';
import { getDailySequence } from '../../utils/date-utils';
import { logger } from '../../utils/logger';

/**
 * PrefeiturasaopauloSpider implementation for São Paulo capital's official gazette
 * 
 * URL: https://diariooficial.prefeitura.sp.gov.br/
 * 
 * The São Paulo capital gazette portal (ARQUIP/DOSP) provides:
 * - "Diário Aberto" section with downloadable PDFs per day
 * - POST endpoint to get gazette for specific date
 * - PDF URLs are dynamically generated with encrypted tokens
 * 
 * API Structure:
 * - Endpoint: POST /md_epubli_controlador.php?acao=diario_aberto&formato=A
 * - Body: hdnDtaEdicao=DD/MM/YYYY (date in Brazilian format)
 * - Returns HTML with PDF link in data-format="pdf" href attribute
 * - PDF URL: /md_epubli_memoria_arquivo.php?{encrypted_token}
 */
export class PrefeiturasaopauloSpider extends BaseSpider {
  private spConfig: PrefeiturasaopauloConfig;
  private baseUrl: string;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.spConfig = spiderConfig.config as PrefeiturasaopauloConfig;
    this.baseUrl = this.spConfig.baseUrl || 'https://diariooficial.prefeitura.sp.gov.br';

    logger.info(`Initializing PrefeiturasaopauloSpider for ${spiderConfig.name} with URL: ${this.baseUrl}`);
  }

  /**
   * Set browser instance (for queue consumer context)
   * Note: This spider doesn't require browser automation, but the method is kept for interface compatibility
   */
  setBrowser(_browser: Fetcher): void {
    // Not needed - this spider uses HTTP requests, not browser automation
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const dates = getDailySequence(this.startDate, this.endDate);

    logger.info(`Crawling São Paulo gazettes for dates from ${this.startDate.toISOString()} to ${this.endDate.toISOString()}...`);

    for (const date of dates) {
      try {
        const gazette = await this.fetchGazetteForDate(date);
        if (gazette) {
          gazettes.push(gazette);
        }
      } catch (error) {
        logger.error(`Error fetching gazette for ${date.toISOString()}: ${error}`);
      }

      // Small delay between requests to be respectful
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
    return gazettes;
  }

  private async fetchGazetteForDate(date: Date): Promise<Gazette | null> {
    // Format date as DD/MM/YYYY for the Brazilian API
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const brazilianDate = `${day}/${month}/${year}`;
    const isoDate = `${year}-${month}-${day}`;

    logger.debug(`Fetching São Paulo gazette for ${brazilianDate}`);

    const endpoint = `${this.baseUrl}/md_epubli_controlador.php?acao=diario_aberto&formato=A`;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html',
        'User-Agent': 'Mozilla/5.0 (compatible; QDSpider/1.0)',
      },
      body: `hdnDtaEdicao=${encodeURIComponent(brazilianDate)}&hdnFormato=A&hdnTipoEdicao=C`,
    });

    if (!response.ok) {
      logger.warn(`Failed to fetch gazette for ${brazilianDate}: ${response.status}`);
      return null;
    }

    const html = await response.text();
    
    // Extract PDF URL from the response
    // Pattern: data-format="pdf" href="URL"
    const pdfPattern = /data-format="pdf"\s+href="([^"]+)"/i;
    const altPattern = /href="([^"]*md_epubli_memoria_arquivo\.php\?[^"]+)"/i;
    
    let match = html.match(pdfPattern);
    if (!match) {
      match = html.match(altPattern);
    }

    if (!match) {
      logger.debug(`No PDF found for ${brazilianDate}`);
      return null;
    }

    let pdfUrl = match[1];
    
    // Ensure URL is absolute
    if (pdfUrl.startsWith('http://')) {
      pdfUrl = pdfUrl.replace('http://', 'https://');
    } else if (!pdfUrl.startsWith('https://')) {
      pdfUrl = `${this.baseUrl}/${pdfUrl.replace(/^\//, '')}`;
    }

    // Extract edition info if available
    const editionMatch = html.match(/Ano\s+(\d+)\s*\/\s*(\d+)\s*[–-]\s*Edi[çc][ãa]o/i);
    const editionNumber = editionMatch ? editionMatch[2] : undefined;

    return {
      date: isoDate,
      fileUrl: pdfUrl,
      territoryId: this.config.territoryId,
      scrapedAt: new Date().toISOString(),
      editionNumber,
      power: 'executive',
    };
  }
}

