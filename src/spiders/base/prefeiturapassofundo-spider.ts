import { InstarSpider } from "./instar-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Prefeitura de Passo Fundo - RS
 *
 * Site: pmpf.rs.gov.br / grp.pmpf.rs.gov.br
 * Diário Oficial via sistema GRP com acesso externo.
 * Usa estrutura compatível com Instar para extração.
 */
export class PrefeiturapassofundoSpider extends InstarSpider {
  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: any) {
    const config = spiderConfig.config as { baseUrl: string; domUrl?: string; requiresClientRendering?: boolean };
    const url = (config.domUrl || config.baseUrl).replace(/\/$/, "");
    const instarConfig = {
      ...spiderConfig,
      config: {
        type: "instar" as const,
        url: url.includes("?") ? url : url + "/",
        requiresClientRendering: config.requiresClientRendering ?? true,
      },
    };
    super(instarConfig, dateRange, browser);
    logger.info(`Initializing PrefeiturapassofundoSpider (via Instar) for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    return super.crawl();
  }
}
