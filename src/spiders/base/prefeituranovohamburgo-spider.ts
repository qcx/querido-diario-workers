import { InstarSpider } from "./instar-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Prefeitura de Novo Hamburgo - RS (DOM)
 *
 * Site: dom.novohamburgo.rs.gov.br
 * Diário Oficial Municipal - edições em sites/default/files/arquivo_pdf/.
 * Usa estrutura compatível com Instar para extração.
 */
export class PrefeituranovohamburgoSpider extends InstarSpider {
  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: any) {
    const config = spiderConfig.config as { baseUrl: string; requiresClientRendering?: boolean };
    const instarConfig = {
      ...spiderConfig,
      config: {
        type: "instar" as const,
        url: config.baseUrl.replace(/\/$/, "") + "/",
        requiresClientRendering: config.requiresClientRendering ?? true,
      },
    };
    super(instarConfig, dateRange, browser);
    logger.info(`Initializing PrefeituranovohamburgoSpider (via Instar) for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    return super.crawl();
  }
}
