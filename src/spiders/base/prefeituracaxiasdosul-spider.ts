import { InstarSpider } from "./instar-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Prefeitura de Caxias do Sul - RS (DOE)
 *
 * Site: doe.caxias.rs.gov.br
 * Diário Oficial Eletrônico - edições em /site/janela/{id}.
 * Usa estrutura compatível com Instar para extração.
 */
export class PrefeituracaxiasdosulSpider extends InstarSpider {
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
    logger.info(`Initializing PrefeituracaxiasdosulSpider (via Instar) for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    return super.crawl();
  }
}
