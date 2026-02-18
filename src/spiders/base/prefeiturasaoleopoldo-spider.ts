import { InstarSpider } from "./instar-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Prefeitura de São Leopoldo - RS
 *
 * Site: saoleopoldo.rs.gov.br
 * Diário Oficial - verificar seção Serviços/Cidadão.
 * Usa estrutura compatível com Instar para extração.
 */
export class PrefeiturasaoleopoldoSpider extends InstarSpider {
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
    logger.info(`Initializing PrefeiturasaoleopoldoSpider (via Instar) for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    return super.crawl();
  }
}
