import { InstarSpider } from "./instar-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Prefeitura de Porto Alegre - RS (DOPA)
 *
 * Site: www2.portoalegre.rs.gov.br/dopa/
 * Diário Oficial de Porto Alegre - busca por data, protocolo ou palavra-chave.
 * Usa estrutura compatível com Instar para extração.
 */
export class PrefeituraportoalegreSpider extends InstarSpider {
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
    logger.info(`Initializing PrefeituraportoalegreSpider (via Instar) for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    return super.crawl();
  }
}
