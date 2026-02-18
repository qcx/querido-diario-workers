import { InstarSpider } from "./instar-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";

/**
 * Spider for Prefeitura de Porto Alegre - RS (DOPA)
 *
 * Site: dopa.portoalegre.rs.gov.br
 * Diário Oficial de Porto Alegre - Angular SPA application.
 * 
 * This spider requires browser rendering due to the Angular-based frontend.
 * When browser is available, it will render and extract gazette data.
 * Configuration: requiresClientRendering=true
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
    logger.info(`Initializing PrefeituraportoalegreSpider (via Instar) for ${spiderConfig.name} with browser rendering required`);
  }

  async crawl(): Promise<Gazette[]> {
    return super.crawl();
  }
}
