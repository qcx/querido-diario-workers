import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, SiganetConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider for Siganet platform
 * 
 * Siganet is a transparency portal platform used by municipalities in Maranhão.
 * It provides a simple JSON API that returns all gazettes.
 * 
 * API Structure:
 * - Endpoint: {baseUrl}/listarDiario
 * - Response: { data: [...] }
 * - Each item has: TDI_DT_PUBLICACAO, TDI_TPS_ID, TDI_ARQUIVO, TDI_EDICAO
 */
export class SiganetSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const siganetConfig = config.config as SiganetConfig;
    this.baseUrl = siganetConfig.baseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const url = `${this.baseUrl}/listarDiario`;

    logger.info(`Crawling ${this.baseUrl} for ${this.config.name}...`);

    try {
      const response = await fetch(url);
      
      if (!response.ok) {
        logger.error(`Failed to fetch ${url}: ${response.status}`);
        return gazettes;
      }

      const data = await response.json() as { data: any[] };

      if (!data.data || !Array.isArray(data.data)) {
        logger.error(`Invalid response format from ${url}`);
        return gazettes;
      }

      for (const item of data.data) {
        // Parse date: "2020-07-30 00:00:00"
        const dateStr = item.TDI_DT_PUBLICACAO.split(' ')[0]; // Get YYYY-MM-DD part
        const gazetteDate = new Date(dateStr);

        // Filter by date range
        if (gazetteDate > this.endDate) continue;
        if (gazetteDate < this.startDate) continue;

        // Build file URL
        const fileId = item.TDI_TPS_ID.toString().padStart(10, '0');
        const fileUrl = `https://painel.siganet.net.br/upload/${fileId}/cms/publicacoes/diario/${item.TDI_ARQUIVO}`;

        const gazette: Gazette = {
          date: dateStr,
          fileUrl: fileUrl,
          territoryId: this.config.territoryId,
          scrapedAt: new Date().toISOString(),
          editionNumber: item.TDI_EDICAO?.toString() || undefined,
          isExtraEdition: false,
          power: 'executive_legislative',
        };

        gazettes.push(gazette);
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes for ${this.config.name}`);
    } catch (error) {
      logger.error(`Error crawling ${url}: ${error}`);
    }

    return gazettes;
  }
}
