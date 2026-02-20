import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

interface PrefeiturafozConfig {
  type: "prefeiturafoz";
  baseUrl: string;
  gedApiUrl?: string;
}

export class PrefeiturafozSpider extends BaseSpider {
  private baseUrl: string;
  private gedApiUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeiturafozConfig;
    this.baseUrl = platformConfig.baseUrl;
    this.gedApiUrl = platformConfig.gedApiUrl || 'https://foz.oxy.elotech.com.br/ged-api/api/file/get-file-content';
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Foz do Iguaçu gazette for ${this.config.name}...`);

    try {
      const apiBaseUrl = this.baseUrl.replace('/portaltransparencia/1/diario-oficial', '');
      const apiUrl = `${apiBaseUrl}/portaltransparencia/api/legislacao/diarios-oficiais/publicados?page=0&size=50`;

      logger.info(`Trying Elotech API: ${apiUrl}`);

      const response = await fetch(apiUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        },
      });

      if (response.ok) {
        const contentType = response.headers.get('content-type') || '';

        if (contentType.includes('application/json')) {
          const data = await response.json() as any;
          const items = data.content || data.data || data || [];

          if (Array.isArray(items)) {
            for (const item of items) {
              const dateStr = item.dataPublicacao || item.date_at || item.data;
              if (!dateStr) continue;

              let isoDate: string;
              if (dateStr.includes('/')) {
                const [day, month, year] = dateStr.split('/');
                isoDate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
              } else {
                isoDate = dateStr.substring(0, 10);
              }

              if (isoDate < this.dateRange.start || isoDate > this.dateRange.end) continue;

              const editionNumber = item.numero || item.number || item.edicao;
              const fileKey = item.chaveArquivo || item.file || item.key;

              let fileUrl: string;
              if (fileKey) {
                fileUrl = `${this.gedApiUrl}?key=${encodeURIComponent(fileKey)}`;
              } else {
                fileUrl = item.urlDownload || item.url || `${this.baseUrl}#${isoDate}`;
              }

              gazettes.push({
                date: isoDate,
                editionNumber: editionNumber?.toString(),
                fileUrl,
                territoryId: this.config.territoryId,
                isExtraEdition: item.tipo === 'EXTRAORDINARIA' || false,
                power: 'executive',
                scrapedAt: new Date().toISOString(),
              });
            }
          }
        }
      }

      if (gazettes.length === 0) {
        logger.info('API approach failed, trying HTML scraping...');

        const htmlResponse = await fetch(this.baseUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html',
          },
        });

        if (htmlResponse.ok) {
          const html = await htmlResponse.text();

          const gedRegex = /get-file-content\?key=([^"'\s&]+)/g;
          let match;

          while ((match = gedRegex.exec(html)) !== null) {
            const key = decodeURIComponent(match[1]);
            const dateMatch = key.match(/(\d{2})-(\d{2})-(\d{4})/);
            if (!dateMatch) continue;

            const [, dd, mm, yyyy] = dateMatch;
            const isoDate = `${yyyy}-${mm}-${dd}`;

            if (isoDate >= this.dateRange.start && isoDate <= this.dateRange.end) {
              const editionMatch = key.match(/ordinaria-(\d+)/);

              gazettes.push({
                date: isoDate,
                editionNumber: editionMatch ? editionMatch[1] : undefined,
                fileUrl: `${this.gedApiUrl}?key=${encodeURIComponent(key)}`,
                territoryId: this.config.territoryId,
                isExtraEdition: key.includes('extraordinaria'),
                power: 'executive',
                scrapedAt: new Date().toISOString(),
              });
            }
          }
        }
      }

      logger.info(`Found ${gazettes.length} gazettes for Foz do Iguaçu`);
    } catch (error) {
      logger.error(`Error crawling Foz do Iguaçu: ${error}`);
    }

    return gazettes;
  }
}
