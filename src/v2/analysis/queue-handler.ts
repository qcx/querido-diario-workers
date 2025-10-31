/**
 * Analysis Queue Handler - V2 Architecture
 * Orchestrates analysis workflow with callback pattern for webhook queue
 */

import { 
  DatabaseClient, 
  getDatabase, 
  schema, 
  GazetteRegistryRepository,
  OcrResultsRepository,
  AnalysisResultsRepository 
} from '../db';
import { CityKeywordAnalyzer } from './analyzers';
import { AnalysisOrchestrator } from './services/analysis-orchestrator';
import { CacheService } from './services/cache-service';
import { SpiderConfig, SpiderScope } from '../crawl/spiders';
import { logger } from '../../utils';
import type { 
  AnalysisQueueMessage, 
  AnalysisCallbackMessage,
  AnalysisQueueHandlerEnv,
  TerritoryInfo,
  AnalysisRunConfig,
  TerritoryAnalysisResult,
  AnalysisMetadata
} from './types';
import type { OcrResult, GazetteAnalysis, AnalysisConfig } from '../../types';

const RETRY_DELAY = 5;

/**
 * Analysis Queue Handler
 * Follows the same pattern as OcrQueueHandler with callback-based architecture
 */
export class AnalysisQueueHandler {
  private databaseClient!: DatabaseClient;
  private gazetteRegistryRepository!: GazetteRegistryRepository;
  private ocrResultsRepository!: OcrResultsRepository;
  private analysisResultsRepository!: AnalysisResultsRepository;
  private cacheService!: CacheService;

  constructor(private env: AnalysisQueueHandlerEnv) {
    this.databaseClient = getDatabase(this.env);
    this.env = env;

    this.gazetteRegistryRepository = new GazetteRegistryRepository(this.databaseClient);
    this.ocrResultsRepository = new OcrResultsRepository(this.databaseClient);
    this.analysisResultsRepository = new AnalysisResultsRepository(this.databaseClient);
    
    this.cacheService = new CacheService(
      {
        ANALYSIS_RESULTS: this.env.ANALYSIS_RESULTS,
        OCR_RESULTS: this.env.OCR_RESULTS,
        defaultTtl: 86400 // 24 hours
      },
      this.analysisResultsRepository,
      this.ocrResultsRepository
    );
  }

  /**
   * Process a batch of analysis messages with callback for webhook queue
   */
  async batchHandler(
    batch: MessageBatch<AnalysisQueueMessage>,
    webhookCallback: (message: AnalysisCallbackMessage) => Promise<void>
  ): Promise<void> {
    logger.info(`Analysis handler: Processing batch of ${batch.messages.length} messages`);
    
    for (const message of batch.messages) {
      await this.handle(message, webhookCallback);
    }
  }

  /**
   * Handle a single analysis message
   */
  private async handle(
    message: Message<AnalysisQueueMessage>,
    webhookCallback: (message: AnalysisCallbackMessage) => Promise<void>
  ): Promise<void> {
    const analysisMessage = message.body;
    const { gazette, gazetteCrawl, spiderConfig, crawlJobId, jobId } = analysisMessage;

    logger.info(`Processing analysis for job ${jobId}`, {
      jobId,
      gazetteId: gazette.id,
      territoryId: gazetteCrawl.territoryId,
      crawlJobId,
      spiderScope: spiderConfig.gazetteScope
    });

    try {
      // Detect if this is a state-level spider that needs splitting
      const runConfig: AnalysisRunConfig = {
        isStateLevelAnalysis: spiderConfig.gazetteScope === SpiderScope.STATE,
        spiderId: spiderConfig.id,
        gazetteScope: spiderConfig.gazetteScope
      };

      // Update gazette crawl status to processing
      await this.gazetteRegistryRepository.updateCrawlsStatus(gazetteCrawl.id, 'processing');

      if (runConfig.isStateLevelAnalysis) {
        // Handle state-level analysis with territory splitting
        await this.handleStateAnalysis(analysisMessage, runConfig, webhookCallback);
      } else {
        // Handle standard city-level analysis
        await this.handleCityAnalysis(analysisMessage, runConfig, webhookCallback);
      }

      // Update status to success
      await this.gazetteRegistryRepository.updateCrawlsStatus(gazetteCrawl.id, 'success');
      
      message.ack();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      
      logger.error('Failed to process analysis message', error as Error, {
        jobId,
        gazetteId: gazette.id,
        crawlJobId,
        error: errorMessage
      });

      // Update status to failed
      await this.gazetteRegistryRepository.updateCrawlsStatus(gazetteCrawl.id, 'failed');

      // Retry logic
      if (message.attempts < 3) {
        message.retry({ delaySeconds: RETRY_DELAY });
      } else {
        logger.error('Max retries reached for analysis', new Error('Max retries'), {
          jobId,
          crawlJobId,
          attempts: message.attempts
        });
        message.ack();
      }
    }
  }

  /**
   * Handle standard city-level analysis
   */
  private async handleCityAnalysis(
    message: AnalysisQueueMessage,
    _runConfig: AnalysisRunConfig,
    webhookCallback: (message: AnalysisCallbackMessage) => Promise<void>
  ): Promise<void> {
    const { gazette, gazetteCrawl, ocrResult, spiderConfig, jobId } = message;

    logger.info('Processing city-level analysis', {
      jobId,
      territoryId: gazetteCrawl.territoryId,
      gazetteId: gazette.id
    });

    // Load OCR text
    const ocrText = await this.loadOcrText(ocrResult, gazette.id);
    
    // Create analysis config
    const analysisConfig = this.createAnalysisConfig();
    
    // Create orchestrator and run analysis
    const orchestrator = new AnalysisOrchestrator(analysisConfig);
    const configSignature = await orchestrator.generateConfigSignature(analysisConfig, gazetteCrawl.territoryId);
    
    // Check cache first
    const cachedAnalysis = await this.cacheService.getCachedAnalysis(
      gazetteCrawl.territoryId,
      gazette.id,
      configSignature.configHash
    );

    let analysis: GazetteAnalysis;
    let analysisId: string;

    if (false) {
      logger.info('Using cached analysis', {
        jobId,
        territoryId: gazetteCrawl.territoryId,
        gazetteId: gazette.id
      });
      analysis = cachedAnalysis.analysis;
      analysisId = cachedAnalysis.id;
    } else {
      // Run new analysis
      const deterministicJobId = await this.generateDeterministicJobId(
        gazetteCrawl.territoryId,
        gazette.id,
        configSignature.configHash
      );

      analysis = await orchestrator.analyze(ocrText, gazetteCrawl.territoryId, deterministicJobId);
      
      // Store analysis
      const metadata: AnalysisMetadata = {
        sourceSpider: spiderConfig.id,
        gazetteScope: spiderConfig.gazetteScope,
        spiderType: spiderConfig.spiderType,
        power: gazette.power || undefined,
        editionNumber: gazette.editionNumber || undefined,
        isExtraEdition: gazette.isExtraEdition,
        processingTimeMs: analysis.analyses.reduce((sum, a) => sum + a.processingTimeMs, 0),
        configSignature
      };

      const analysisResult = await this.analysisResultsRepository.storeAnalysis(
        analysis,
        gazette.id,
        configSignature,
        metadata
      );

      analysisId = analysisResult.id;

      // Cache the analysis
      await this.cacheService.cacheAnalysis(
        gazetteCrawl.territoryId,
        gazette.id,
        configSignature.configHash,
        analysis,
        analysisResult.id
      );
    }

    // Link analysis to gazette crawl
    await this.gazetteRegistryRepository.linkAnalysisToGazetteCrawl(gazetteCrawl.id, analysisId);

    // Send webhook callback
    await webhookCallback({
      analysisResultId: analysisId,
      gazetteCrawlId: gazetteCrawl.id,
      territoryId: gazetteCrawl.territoryId,
      findingsCount: analysis.summary.totalFindings,
      categories: analysis.summary.categories,
      highConfidenceFindings: analysis.summary.highConfidenceFindings,
      keywords: analysis.summary.keywords,
      jobId: analysis.jobId,
      gazetteId: gazette.id,
      publicationDate: gazette.publicationDate,
      analyzedAt: analysis.analyzedAt
    });
  }

  /**
   * Handle state-level analysis with territory splitting
   */
  private async handleStateAnalysis(
    message: AnalysisQueueMessage,
    runConfig: AnalysisRunConfig,
    webhookCallback: (message: AnalysisCallbackMessage) => Promise<void>
  ): Promise<void> {
    const { gazette, gazetteCrawl, ocrResult, spiderConfig, jobId } = message;

    logger.info('Processing state-level analysis with territory splitting', {
      jobId,
      stateSpider: spiderConfig.id,
      gazetteId: gazette.id
    });

    // Load territories for this state spider
    const territories = await this.getTerritoriesForStateSpider(spiderConfig);
    
    if (territories.length === 0) {
      logger.warn('No territories found for state spider', {
        spiderId: spiderConfig.id,
        jobId
      });
      return;
    }

    // Load full OCR text once
    const fullOcrText = await this.loadOcrText(ocrResult, gazette.id);
    
    // Process each territory
    const results: TerritoryAnalysisResult[] = [];
    
    for (const territory of territories) {
      try {
        const result = await this.performTerritoryAnalysis(
          fullOcrText,
          territory,
          message,
          runConfig
        );
        
        if (result.hasContent) {
          results.push(result);
          
          // Send webhook for this territory
          const analysis = await this.analysisResultsRepository.getAnalysisById(result.analysisResultId);
          if (analysis) {
            await webhookCallback({
              analysisResultId: result.analysisResultId,
              gazetteCrawlId: gazetteCrawl.id,
              territoryId: territory.territoryId,
              findingsCount: result.findingsCount,
              categories: JSON.parse(analysis.categories),
              highConfidenceFindings: analysis.highConfidenceFindings,
              keywords: JSON.parse(analysis.keywords),
              jobId: analysis.jobId,
              gazetteId: gazette.id,
              publicationDate: gazette.publicationDate,
              analyzedAt: analysis.analyzedAt
            });
          }
        }
      } catch (error) {
        logger.error(`Failed to analyze territory ${territory.territoryId}`, error as Error, {
          jobId,
          territoryId: territory.territoryId,
          cityName: territory.cityName
        });
      }
    }

    logger.info('State-level analysis completed', {
      jobId,
      gazetteId: gazette.id,
      totalTerritories: territories.length,
      analyzedTerritories: results.filter(r => r.hasContent).length
    });
  }

  /**
   * Perform analysis for a specific territory
   */
  private async performTerritoryAnalysis(
    fullOcrText: OcrResult,
    territory: TerritoryInfo,
    message: AnalysisQueueMessage,
    _runConfig: AnalysisRunConfig
  ): Promise<TerritoryAnalysisResult> {
    const { gazette, spiderConfig } = message;
    
    // Create city keyword analyzer
    const cityAnalyzer = new CityKeywordAnalyzer({
      cityName: territory.cityName,
      cityRegex: territory.cityRegex || territory.cityName,
      territoryId: territory.territoryId,
      enabled: true
    });

    // Filter OCR text for this city
    const filteredOcr = cityAnalyzer.filterOcrResult(fullOcrText);
    
    // Check if we have any content for this city
    if (!filteredOcr.extractedText || filteredOcr.extractedText.trim().length === 0) {
      logger.info('No content found for territory', {
        territoryId: territory.territoryId,
        cityName: territory.cityName,
        gazetteId: gazette.id
      });
      
      return {
        territoryId: territory.territoryId,
        analysisResultId: '',
        findingsCount: 0,
        filteredTextLength: 0,
        hasContent: false
      };
    }

    // Create analysis config
    const analysisConfig = this.createAnalysisConfig();
    
    // Create orchestrator and run analysis
    const orchestrator = new AnalysisOrchestrator(analysisConfig);
    const configSignature = await orchestrator.generateConfigSignature(analysisConfig, territory.territoryId);
    
    // Add city filter to config hash for proper deduplication
    const territoryConfigHash = `${configSignature.configHash}:${territory.cityRegex || territory.cityName}`;
    
    // Check cache
    const cachedAnalysis = await this.cacheService.getCachedAnalysis(
      territory.territoryId,
      gazette.id,
      territoryConfigHash
    );

    let analysis: GazetteAnalysis;
    let analysisId: string;

    if (cachedAnalysis) {
      logger.info('Using cached territory analysis', {
        territoryId: territory.territoryId,
        gazetteId: gazette.id
      });
      analysis = cachedAnalysis.analysis;
      analysisId = cachedAnalysis.id;
    } else {
      // Run new analysis on filtered text
      const deterministicJobId = await this.generateDeterministicJobId(
        territory.territoryId,
        gazette.id,
        territoryConfigHash
      );

      analysis = await orchestrator.analyze(filteredOcr, territory.territoryId, deterministicJobId);
      
      // Store analysis with territory filter metadata
      const metadata: AnalysisMetadata = {
        isStateLevelAnalysis: true,
        territoryFilter: {
          cityName: territory.cityName,
          cityRegex: territory.cityRegex || territory.cityName,
          filteredTextLength: filteredOcr.extractedText.length,
          originalTextLength: fullOcrText.extractedText?.length || 0
        },
        sourceSpider: spiderConfig.id,
        gazetteScope: 'state',
        spiderType: spiderConfig.spiderType,
        power: gazette.power || undefined,
        editionNumber: gazette.editionNumber || undefined,
        isExtraEdition: gazette.isExtraEdition,
        processingTimeMs: analysis.analyses.reduce((sum, a) => sum + a.processingTimeMs, 0),
        configSignature
      };

      analysisId = await this.analysisResultsRepository.storeAnalysis(
        analysis,
        gazette.id,
        configSignature,
        metadata
      );

      // Cache the analysis
      await this.cacheService.cacheAnalysis(
        territory.territoryId,
        gazette.id,
        territoryConfigHash,
        analysis,
        analysisId
      );
    }

    return {
      territoryId: territory.territoryId,
      analysisResultId: analysisId,
      findingsCount: analysis.summary.totalFindings,
      filteredTextLength: filteredOcr.extractedText.length,
      hasContent: true
    };
  }

  /**
   * Load OCR text from cache or database
   */
  private async loadOcrText(
    ocrResultRecord: typeof schema.ocrResults.$inferSelect,
    gazetteId: string
  ): Promise<OcrResult> {
    // Try cache first
    const cachedOcr = await this.cacheService.getOcrResult(ocrResultRecord.id);
    
    if (cachedOcr) {
      return cachedOcr;
    }

    // Load from database
    const dbOcr = await this.ocrResultsRepository.findByGazetteId(gazetteId);
    
    if (!dbOcr || !dbOcr.extractedText) {
      throw new Error(`OCR text not found for gazette ${gazetteId}`);
    }

    // Parse metadata
    const metadata = JSON.parse(dbOcr.metadata || '{}');

    // Convert to OcrResult format
    const result: OcrResult = {
      jobId: metadata.jobId || ocrResultRecord.id,
      status: 'success',
      extractedText: dbOcr.extractedText,
      pdfUrl: metadata.pdfUrl || '',
      territoryId: metadata.territoryId || '',
      publicationDate: metadata.publicationDate || '',
      spiderId: metadata.spiderId || '',
      pagesProcessed: metadata.pagesProcessed,
      processingTimeMs: metadata.processingTimeMs,
      confidence: dbOcr.confidenceScore || undefined,
      language: dbOcr.languageDetected || undefined,
      completedAt: ocrResultRecord.createdAt,
      metadata
    };

    // Cache for future use
    await this.cacheService.cacheOcrResult(ocrResultRecord.id, result);

    return result;
  }

  /**
   * Get territories for a state-level spider
   */
  private async getTerritoriesForStateSpider(spiderConfig: SpiderConfig): Promise<TerritoryInfo[]> {
    // For now, we'll extract territory info from the spider config
    // In the future, this could load from a registry or database
    
    const territories: TerritoryInfo[] = [];
    
    // Check if spider has explicit territories configuration
    if ('territories' in spiderConfig.config && Array.isArray(spiderConfig.config.territories)) {
      return spiderConfig.config.territories;
    }
    
    // Otherwise, extract from current spider config (for single-city state spiders)
    if ('cityName' in spiderConfig.config) {
      territories.push({
        territoryId: spiderConfig.territoryId,
        cityName: spiderConfig.config.cityName as string,
        cityRegex: (spiderConfig.config as any).cityRegex
      });
    }
    
    return territories;
  }

  /**
   * Create analysis configuration
   */
  private createAnalysisConfig(): AnalysisConfig {
    return {
      analyzers: {
        keyword: {
          enabled: true,
          priority: 1,
          timeout: 10000
        },
        entity: {
          enabled: false, // Disabled by default
          priority: 2,
          timeout: 15000
        },
        concurso: {
          enabled: true,
          priority: 1.5,
          timeout: 20000,
          useAIExtraction: !!this.env.OPENAI_API_KEY,
          apiKey: this.env.OPENAI_API_KEY,
          model: 'gpt-4o-mini'
        },
        ai: {
          enabled: !!this.env.OPENAI_API_KEY,
          priority: 3,
          timeout: 30000,
          apiKey: this.env.OPENAI_API_KEY
        }
      }
    };
  }

  /**
   * Generate deterministic job ID for deduplication
   */
  private async generateDeterministicJobId(
    territoryId: string,
    gazetteId: string,
    configHash: string
  ): Promise<string> {
    const { shortHash } = await import('../../utils');
    const input = `${territoryId}:${gazetteId}:${configHash}`;
    const hash = await shortHash(input, 16);
    return `analysis-${hash}`;
  }
}
