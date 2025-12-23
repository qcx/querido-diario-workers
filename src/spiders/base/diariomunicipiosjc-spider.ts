import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, DiarioMunicipioSJCConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { getDailySequence } from '../../utils/date-utils';
import { logger } from '../../utils/logger';

/**
 * Response format from the Diário do Município SJC API
 */
interface EdicaoResponse {
  erro: boolean;
  msg: string;
  data: string | null;
  numero: number | null;
  ano: string;
  itens: EdicaoItem[];
}

interface EdicaoItem {
  id: number;
  data: string; // Format: "DD/MM/YYYY"
  suplemento: number; // 0 = normal, 1 = supplement
  numero: number;
  tipo_edicao_id: number;
  tipo_edicao_nome: string;
  capa: number;
  paginas: number;
}

/**
 * Spider for Diário do Município de São José dos Campos
 * 
 * This spider fetches gazettes from the São José dos Campos official gazette portal.
 * The platform provides a JSON API for fetching editions by date.
 * 
 * API Structure:
 * - Editions by date: {baseUrl}/apifront/portal/edicoes/edicoes_from_data/{YYYY-MM-DD}.json
 * - Download PDF: {baseUrl}/portal/edicoes/download/{id}
 * 
 * Similar to BarcoDigital but with different API structure.
 */
export class DiarioMunicipioSJCSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const sjcConfig = config.config as DiarioMunicipioSJCConfig;
    this.baseUrl = sjcConfig.baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const days = getDailySequence(this.startDate, this.endDate);

    logger.info(`Crawling ${this.baseUrl} for ${this.config.name}...`);

    for (const day of days) {
      // Format date as YYYY-MM-DD for API
      const year = day.getFullYear();
      const month = String(day.getMonth() + 1).padStart(2, '0');
      const dayOfMonth = String(day.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${dayOfMonth}`;
      
      const url = `${this.baseUrl}/apifront/portal/edicoes/edicoes_from_data/${dateStr}.json`;
      
      logger.debug(`Fetching editions for ${dateStr}`);

      try {
        const response = await fetch(url);
        
        if (!response.ok) {
          logger.warn(`Failed to fetch ${url}: ${response.status}`);
          continue;
        }

        const data = await response.json() as EdicaoResponse;

        if (data.erro) {
          logger.warn(`API error for ${dateStr}: ${data.msg}`);
          continue;
        }

        if (!data.itens || data.itens.length === 0) {
          // No editions for this date (normal for weekends/holidays)
          continue;
        }

        for (const item of data.itens) {
          // Parse the date from DD/MM/YYYY format
          const [dd, mm, yyyy] = item.data.split('/');
          const isoDate = `${yyyy}-${mm}-${dd}`;
          
          const gazette: Gazette = {
            date: isoDate,
            fileUrl: `${this.baseUrl}/portal/edicoes/download/${item.id}`,
            territoryId: this.config.territoryId,
            scrapedAt: new Date().toISOString(),
            editionNumber: item.numero?.toString() || undefined,
            isExtraEdition: item.suplemento === 1,
            power: 'executive',
          };

          gazettes.push(gazette);
        }
      } catch (error) {
        logger.error(`Error fetching editions for ${dateStr}: ${error}`);
      }
    }

    logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
    return gazettes;
  }
}


