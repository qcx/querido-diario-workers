import { BaseSpider } from "./base-spider";
import {
  SpiderConfig,
  Gazette,
  DateRange,
  PrefeituraJataiConfig,
} from "../../types";
import { logger } from "../../utils/logger";

/**
 * PrefeituraJataiSpider - Diário Oficial da Prefeitura de Jataí - GO.
 *
 * Fonte: intranet da prefeitura (intranet.jatai.go.gov.br).
 * Página: .../diario-oficial/diario-site.php — tabela com colunas Edição, Data, Download (link PDF).
 * Data no formato DD/MM/YYYY; link relativo tipo pdf/Diario_EdNNNN_DD-MM.pdf.
 */
export class PrefeituraJataiSpider extends BaseSpider {
  protected jataiConfig: PrefeituraJataiConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.jataiConfig = spiderConfig.config as PrefeituraJataiConfig;
    const baseUrl = this.jataiConfig.baseUrl.replace(/\/$/, "");
    logger.info(`Initializing PrefeituraJataiSpider with baseUrl: ${baseUrl}`);
  }

  async crawl(): Promise<Gazette[]> {
    const baseUrl = this.jataiConfig.baseUrl.replace(/\/$/, "");
    const listUrl = `${baseUrl}/diario-site.php`;

    logger.info(`Crawling Jataí Diário Oficial: ${listUrl}`);

    const gazettes: Gazette[] = [];

    try {
      const html = await this.fetch(listUrl);

      // Table rows: Edição | Data (DD/MM/YYYY) | Download [**](pdf/Diario_EdNNNN_DD-MM.pdf) | Visualizar
      const lines = html.split("\n");
      for (const line of lines) {
        const dateMatch = line.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        const pdfMatch = line.match(/\]\((pdf\/[^)]+\.pdf)\)/);
        if (!dateMatch || !pdfMatch) continue;

        const [, day, month, year] = dateMatch;
        const dateStr = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
        const gazetteDate = new Date(dateStr + "T00:00:00.000Z");

        if (!this.isInDateRange(gazetteDate)) continue;

        const pdfPath = pdfMatch[1];
        const pdfUrl = pdfPath.startsWith("http")
          ? pdfPath
          : `${baseUrl}/${pdfPath}`;

        const editionMatch =
          line.match(/n[º°]?\s*(\d+)/i) || line.match(/Ed[_\s]?(\d+)/i);
        const editionNumber = editionMatch ? editionMatch[1] : undefined;

        const gazette = await this.createGazette(gazetteDate, pdfUrl, {
          editionNumber,
          isExtraEdition: false,
          power: "executive",
        });
        if (gazette) {
          gazette.notes = `Diário Oficial - Prefeitura de Jataí (intranet).`;
          gazettes.push(gazette);
        }
      }

      logger.info(`Found ${gazettes.length} gazettes for Jataí from intranet`);
    } catch (error) {
      logger.error(`Error crawling Jataí Diário Oficial:`, error as Error);
    }

    return gazettes;
  }
}
