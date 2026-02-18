import { InstarSpider } from "./instar-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Prefeitura de Canoas - RS (DOM)
 *
 * Site: sistemas.canoas.rs.gov.br/domc
 * Diário Oficial Municipal - calendário e busca por data.
 * Usa estrutura compatível com Instar para extração.
 */
export class PrefeituracanoasSpider extends InstarSpider {
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
    logger.info(`Initializing PrefeituracanoasSpider (via Instar) for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    return super.crawl();
  }
}
