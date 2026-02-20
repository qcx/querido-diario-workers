import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

interface PrefeituracascavelConfig {
  type: "prefeituracascavel";
  baseUrl: string;
}

export class PrefeituracascavelSpider extends BaseSpider {
  private baseUrl: string;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as PrefeituracascavelConfig;
    this.baseUrl = platformConfig.baseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling Cascavel CIASOP gazette for ${this.config.name}...`);

    try {
      let page = 1;
      let hasMore = true;

      while (hasMore) {
        const url = `${this.baseUrl}/diariooficial/pesquisa/all/all/all/all/${page}`;
        logger.info(`Fetching Cascavel page ${page}: ${url}`);

        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/html',
          },
        });

        if (!response.ok) {
          logger.warn(`Failed to fetch page ${page}: ${response.status}`);
          break;
        }

        const html = await response.text();
        let foundInPage = 0;
        let foundOlder = false;

        const monthMap: Record<string, string> = {
          'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
          'abril': '04', 'maio': '05', 'junho': '06', 'julho': '07',
          'agosto': '08', 'setembro': '09', 'outubro': '10', 'novembro': '11', 'dezembro': '12',
        };

        // Extract edition entries
        // Look for edition links with dates
        // Pattern: /diariooficial/view/{id} or /diariooficial/materias/{id}
        const editionRegex = /Edição\s+(?:Nº\s+)?(\d+)[\s\S]*?(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})[\s\S]*?(?:href="([^"]*(?:view|materias)\/[^"]*)")/gi;

        let match;
        while ((match = editionRegex.exec(html)) !== null) {
          const editionNumber = match[1];
          const day = match[2].padStart(2, '0');
          const monthName = match[3].toLowerCase();
          const year = match[4];
          const link = match[5];

          const month = monthMap[monthName];
          if (!month) continue;

          const isoDate = `${year}-${month}-${day}`;

          if (isoDate < this.dateRange.start) {
            foundOlder = true;
            continue;
          }
          if (isoDate > this.dateRange.end) continue;

          // Get materials page for download links
          let materiasUrl = link;
          if (!materiasUrl.startsWith('http')) {
            materiasUrl = `${this.baseUrl}${materiasUrl}`;
          }

          // Use the view URL as the file URL (it has an embedded PDF)
          const viewUrl = materiasUrl.replace('/materias/', '/view/');

          gazettes.push({
            date: isoDate,
            editionNumber,
            fileUrl: viewUrl,
            territoryId: this.config.territoryId,
            isExtraEdition: false,
            power: 'executive',
            scrapedAt: new Date().toISOString(),
          });

          foundInPage++;
        }

        // Also try a simpler regex for finding dates and links
        if (foundInPage === 0) {
          const simpleLinkRegex = /href="([^"]*diariooficial\/(?:view|materias)\/[^"]*)"/g;
          const dateRegex = /(\d{1,2})\s+de\s+(\w+)\s+de\s+(\d{4})/g;

          // Extract all links and dates from the page
          const links: string[] = [];
          let linkMatch;
          while ((linkMatch = simpleLinkRegex.exec(html)) !== null) {
            links.push(linkMatch[1]);
          }

          const dates: string[] = [];
          let dateMatch;
          while ((dateMatch = dateRegex.exec(html)) !== null) {
            const day = dateMatch[1].padStart(2, '0');
            const monthName = dateMatch[2].toLowerCase();
            const year = dateMatch[3];
            const month = monthMap[monthName];
            if (month) {
              dates.push(`${year}-${month}-${day}`);
            }
          }
        }

        if (foundOlder || foundInPage === 0) {
          hasMore = false;
        } else {
          page++;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      logger.info(`Found ${gazettes.length} gazettes for Cascavel`);
    } catch (error) {
      logger.error(`Error crawling Cascavel: ${error}`);
    }

    return gazettes;
  }
}
