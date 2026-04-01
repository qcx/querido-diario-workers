import { SpiderConfig, DateRange, Gazette } from '../../types';
import { ExecutionStrategy } from './types';
import { SpiderRegistryV2 } from './registry';
import { spiderRegistry } from '../registry';
import { logger } from '../../utils/logger';

/**
 * Result of executing a single spider
 */
export interface SpiderExecutionResult {
  spiderId: string;
  spiderType: string;
  success: boolean;
  gazettes: Gazette[];
  executionTime: number;
  error: Error | null;
}

/**
 * Result of executing spiders for a territory
 */
export interface TerritoryExecutionResult {
  territoryId: string;
  strategy: ExecutionStrategy;
  totalSpiders: number;
  executedSpiders: number;
  successfulSpiders: number;
  totalGazettes: number;
  results: SpiderExecutionResult[];
  allGazettes: Gazette[];
}

/**
 * Environment interface for spider execution
 */
export interface SpiderExecutionEnv {
  BROWSER?: Fetcher;
}

/**
 * V2 Territory Spider Executor
 */
export class TerritoryExecutor {
  constructor(private v2Registry: SpiderRegistryV2) {}

  /**
   * Execute spiders for a territory using the specified strategy
   */
  async executeForTerritory(
    territoryId: string,
    dateRange: DateRange,
    strategy: ExecutionStrategy = 'all-parallel',
    env: SpiderExecutionEnv = {}
  ): Promise<TerritoryExecutionResult> {
    
    const spiders = this.v2Registry.getActiveSpidersForTerritory(territoryId);
    
    if (spiders.length === 0) {
      throw new Error(`No active spiders found for territory ${territoryId}`);
    }

    logger.info(`Executing ${spiders.length} spiders for territory ${territoryId} with strategy ${strategy}`);

    let results: SpiderExecutionResult[];
    
    switch (strategy) {
      case 'priority-fallback':
        results = await this.executePriorityFallback(spiders, dateRange, env);
        break;
      
      case 'all-parallel':
        results = await this.executeAllParallel(spiders, dateRange, env);
        break;
      
      default:
        throw new Error(`Unknown execution strategy: ${strategy}`);
    }

    const allGazettes = this.deduplicateGazettes(
      results.flatMap(r => r.gazettes)
    );

    return {
      territoryId,
      strategy,
      totalSpiders: spiders.length,
      executedSpiders: results.length,
      successfulSpiders: results.filter(r => r.success).length,
      totalGazettes: allGazettes.length,
      results,
      allGazettes
    };
  }

  /**
   * Execute spiders with priority-fallback strategy
   * Try highest priority first, fallback to others if it fails or finds no gazettes
   */
  private async executePriorityFallback(
    spiders: SpiderConfig[],
    dateRange: DateRange,
    env: SpiderExecutionEnv
  ): Promise<SpiderExecutionResult[]> {
    
    const results: SpiderExecutionResult[] = [];
    
    for (const config of spiders) {
      const startTime = Date.now();
      
      try {
        logger.info(`Executing spider ${config.id} (${config.spiderType})`);
        
        const spider = spiderRegistry.createSpider(config, dateRange, env.BROWSER);
        const gazettes = await spider.crawl();
        const executionTime = Date.now() - startTime;
        
        const result: SpiderExecutionResult = {
          spiderId: config.id,
          spiderType: config.spiderType,
          success: true,
          gazettes,
          executionTime,
          error: null
        };
        
        results.push(result);
        
        // If we found gazettes, we can stop (success)
        if (gazettes.length > 0) {
          logger.info(`Spider ${config.id} succeeded with ${gazettes.length} gazettes, stopping execution`);
          break;
        }
        
        logger.info(`Spider ${config.id} succeeded but found no gazettes, trying next spider`);
        
      } catch (error) {
        const executionTime = Date.now() - startTime;
        
        logger.error(`Spider ${config.id} failed:`, error as Error);
        
        results.push({
          spiderId: config.id,
          spiderType: config.spiderType,
          success: false,
          gazettes: [],
          executionTime,
          error: error as Error
        });
        
        // Continue to next spider on failure
      }
    }
    
    return results;
  }

  /**
   * Execute all spiders in parallel
   */
  private async executeAllParallel(
    spiders: SpiderConfig[],
    dateRange: DateRange,
    env: SpiderExecutionEnv
  ): Promise<SpiderExecutionResult[]> {
    
    logger.info(`Executing ${spiders.length} spiders in parallel`);
    
    const spiderPromises = spiders.map(async (config): Promise<SpiderExecutionResult> => {
      const startTime = Date.now();
      
      try {
        logger.info(`Starting parallel execution of spider ${config.id} (${config.spiderType})`);
        
        const spider = spiderRegistry.createSpider(config, dateRange, env.BROWSER);
        const gazettes = await spider.crawl();
        const executionTime = Date.now() - startTime;
        
        logger.info(`Spider ${config.id} completed with ${gazettes.length} gazettes in ${executionTime}ms`);
        
        return {
          spiderId: config.id,
          spiderType: config.spiderType,
          success: true,
          gazettes,
          executionTime,
          error: null
        };
      } catch (error) {
        const executionTime = Date.now() - startTime;
        
        logger.error(`Spider ${config.id} failed in ${executionTime}ms:`, error as Error);
        
        return {
          spiderId: config.id,
          spiderType: config.spiderType,
          success: false,
          gazettes: [],
          executionTime,
          error: error as Error
        };
      }
    });

    const results = await Promise.allSettled(spiderPromises);
    
    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          spiderId: spiders[index].id,
          spiderType: spiders[index].spiderType,
          success: false,
          gazettes: [],
          executionTime: 0,
          error: new Error(result.reason)
        };
      }
    });
  }

  /**
   * Deduplicate gazettes based on PDF URL and date
   */
  private deduplicateGazettes(gazettes: Gazette[]): Gazette[] {
    const seen = new Set<string>();
    return gazettes.filter(gazette => {
      const key = `${gazette.fileUrl}|${gazette.date}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Get execution summary for logging
   */
  getExecutionSummary(result: TerritoryExecutionResult): string {
    const successRate = result.totalSpiders > 0 
      ? Math.round((result.successfulSpiders / result.totalSpiders) * 100) 
      : 0;
    
    return `Territory ${result.territoryId}: ${result.successfulSpiders}/${result.totalSpiders} spiders succeeded (${successRate}%), found ${result.totalGazettes} gazettes`;
  }
}
