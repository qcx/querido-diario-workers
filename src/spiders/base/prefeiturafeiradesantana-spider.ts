import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraFeiraDesantanaConfig } from '../../types';
import { logger } from '../../utils/logger';
import { getCurrentTimestamp } from '../../utils/date-utils';

/**
 * PrefeituraFeiraDesantanaSpider implementation
 * 
 * Crawls the official gazette from Feira de Santana, BA
 * Site: https://diariooficial.feiradesantana.ba.gov.br/
 * 
 * The site is a custom ASP platform with:
 * - Two separate tables for Poder Executivo and Poder Legislativo
 * - Links to PDFs via abrir.asp?edi=<edition>&p=<power>
 * - Power 1 = Executivo, Power 2 = Legislativo
 */
export class PrefeituraFeiraDesantanaSpider extends BaseSpider {
  protected feiraConfig: PrefeituraFeiraDesantanaConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.feiraConfig = spiderConfig.config as PrefeituraFeiraDesantanaConfig;
    
    if (!this.feiraConfig.baseUrl) {
      throw new Error(`PrefeituraFeiraDesantanaSpider requires baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing PrefeituraFeiraDesantanaSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.feiraConfig.baseUrl} for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Fetch main page
      const html = await this.fetch(this.feiraConfig.baseUrl);
      const $ = this.loadHTML(html);

      // Find all edition rows in tables
      // The structure has rows with: Year (Roman numeral), Edition number, Date
      // and PDF download links via abrir.asp
      
      // Parse Poder Executivo (p=1)
      const executivoGazettes = await this.parseGazettes($, 1, 'executive');
      gazettes.push(...executivoGazettes);
      
      // Parse Poder Legislativo (p=2)
      const legislativoGazettes = await this.parseGazettes($, 2, 'legislative');
      gazettes.push(...legislativoGazettes);

      logger.info(`Successfully found ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  private async parseGazettes(
    $: any, 
    power: number, 
    powerType: 'executive' | 'legislative'
  ): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    // Find all links to abrir.asp with the specified power
    const pdfLinks = $(`a[href*="abrir.asp"][href*="p=${power}"]`).toArray();
    
    logger.info(`Found ${pdfLinks.length} ${powerType} PDF links`);

    for (const link of pdfLinks) {
      try {
        const href = $(link).attr('href');
        if (!href) continue;

        // Extract edition number from href: abrir.asp?edi=3442&p=1
        const ediMatch = href.match(/edi=(\d+)/);
        if (!ediMatch) continue;
        const editionNumber = ediMatch[1];

        // Find the date in the same row or nearby cell
        // Look for the row containing this link and find the date
        const row = $(link).closest('tr');
        const rowText = row.text();
        
        // Try to extract date in format DD/MM/YYYY
        const dateMatch = rowText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        if (!dateMatch) {
          // Try finding in parent or sibling cells
          const dateCell = row.find('a[href*="detalhes.asp"]').first();
          const dateCellText = dateCell.text().trim();
          const dateCellMatch = dateCellText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          
          if (!dateCellMatch) {
            logger.debug(`Could not extract date for edition ${editionNumber}`);
            continue;
          }
          
          const [, day, month, year] = dateCellMatch;
          const date = `${year}-${month}-${day}`;
          const dateObj = new Date(date);
          
          if (this.isInDateRange(dateObj)) {
            const gazette = await this.createGazetteForEdition(editionNumber, date, power, powerType);
            if (gazette) {
              gazettes.push(gazette);
            }
          }
        } else {
          const [, day, month, year] = dateMatch;
          const date = `${year}-${month}-${day}`;
          const dateObj = new Date(date);
          
          if (this.isInDateRange(dateObj)) {
            const gazette = await this.createGazetteForEdition(editionNumber, date, power, powerType);
            if (gazette) {
              gazettes.push(gazette);
            }
          }
        }
      } catch (error) {
        logger.warn(`Error parsing gazette link:`, { error: (error as Error).message });
      }
    }

    return gazettes;
  }

  private async createGazetteForEdition(
    editionNumber: string,
    date: string,
    power: number,
    powerType: 'executive' | 'legislative'
  ): Promise<Gazette | null> {
    try {
      // The abrir.asp URL redirects to the actual PDF
      // We need to follow the redirect to get the final PDF URL
      const abrirUrl = `${this.getBaseUrl()}/abrir.asp?edi=${editionNumber}&p=${power}`;
      
      // Make a HEAD request to get the redirect location
      const response = await fetch(abrirUrl, {
        method: 'HEAD',
        redirect: 'manual'
      });
      
      let pdfUrl: string;
      
      if (response.status === 302 || response.status === 301) {
        // Get the redirect location
        const location = response.headers.get('location');
        if (location) {
          pdfUrl = location.startsWith('http') 
            ? location 
            : `${this.getBaseUrl()}${location.startsWith('/') ? '' : '/'}${location}`;
        } else {
          // If no redirect, use the abrir.asp URL directly
          pdfUrl = abrirUrl;
        }
      } else {
        // Use abrir.asp URL directly (it may serve the PDF)
        pdfUrl = abrirUrl;
      }

      logger.info(`Found ${powerType} gazette: Edition ${editionNumber}, Date ${date}`);

      return {
        date,
        fileUrl: pdfUrl,
        territoryId: this.spiderConfig.territoryId,
        scrapedAt: getCurrentTimestamp(),
        isExtraEdition: false,
        power: powerType,
        editionNumber,
        sourceText: `Diário Oficial ${powerType === 'executive' ? 'Executivo' : 'Legislativo'} - Edição ${editionNumber}`,
      };
    } catch (error) {
      logger.warn(`Error creating gazette for edition ${editionNumber}:`, { error: (error as Error).message });
      return null;
    }
  }

  private getBaseUrl(): string {
    // Normalize base URL
    let baseUrl = this.feiraConfig.baseUrl;
    if (baseUrl.endsWith('/')) {
      baseUrl = baseUrl.slice(0, -1);
    }
    return baseUrl;
  }
}
