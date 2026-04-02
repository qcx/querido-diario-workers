import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types/index';
import { logger } from '../../../../utils/logger'

export class BaseGazetteSpider extends BaseSpider {
  protected spiderConfig: SpiderConfig;
  protected dateRange: DateRange;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.spiderConfig = spiderConfig;
    this.dateRange = dateRange;
    logger.info(`Initializing BaseGazetteSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.warn(`BaseGazetteSpider for ${this.spiderConfig.name} does not implement a specific crawl method. Returning empty array.`);
    return [];
  }
}

