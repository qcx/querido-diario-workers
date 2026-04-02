/**
 * Analysis Queue Handler - V2 Architecture
 * Orchestrates analysis workflow with callback pattern for webhook queue
 */

import { 
  DatabaseClient, 
  getDatabase,
  GazetteRegistryRepository,
  OcrResultsRepository,
  AnalysisResultsRepository,
  ConcursoFindingsRepository
} from '../db';
import { CacheService } from './services/cache-service';
import { sha256Hash, logger } from '../../utils';
import type { 
  AnalysisQueueMessage, 
  AnalysisCallbackMessage,
} from './types';
import { type AnalysisConfig, getAnalysisConfig } from './analyzers/config';
import { createAnalysisProcessor } from './analyzers/processor';

export interface AnalysisQueueHandlerEnv extends Env {}

/**
 * Analysis Queue Handler
 * Follows the same pattern as OcrQueueHandler with callback-based architecture
 */
export class AnalysisQueueHandler {
  private databaseClient!: DatabaseClient;
  private gazetteRegistryRepository!: GazetteRegistryRepository;
  private ocrResultsRepository!: OcrResultsRepository;
  private analysisResultsRepository!: AnalysisResultsRepository;
  private concursoFindingsRepository!: ConcursoFindingsRepository;
  private cacheService!: CacheService;

  constructor(private env: AnalysisQueueHandlerEnv) {
    this.databaseClient = getDatabase(this.env);
    this.env = env;

    this.gazetteRegistryRepository = new GazetteRegistryRepository(this.databaseClient);
    this.ocrResultsRepository = new OcrResultsRepository(this.databaseClient);
    this.analysisResultsRepository = new AnalysisResultsRepository(this.databaseClient);
    this.concursoFindingsRepository = new ConcursoFindingsRepository(this.databaseClient);
    
    this.cacheService = new CacheService(
      this.env,
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
    const startTime = Date.now();
    const analysisMessage = message.body;
    
    const { gazette, gazetteCrawl, jobId, ocrResultId, crawlJobId, spiderConfig } = analysisMessage;

    try {
      const config = getAnalysisConfig(this.env);
      const configSignature = await this.generateConfigSignature(config, gazetteCrawl.territoryId, gazette.id);

      // Check cache for existing analysis
      const cachedAnalysis = await this.cacheService.getCachedAnalysis(configSignature.configHash);

      if (cachedAnalysis) {
        const { analysis } = cachedAnalysis;

        await this.gazetteRegistryRepository.linkAnalysisAndUpdateStatus(
          gazetteCrawl.id,
          analysis.id,
          'success'
        );

        message.ack();
        return;
      }

      const ocrResult = await this.cacheService.getOcrResult(gazette.pdfUrl, ocrResultId);

      if (!ocrResult) {
        message.retry();
        return;
      }

      const processor = createAnalysisProcessor(config);
      const processorResult = await processor.process(ocrResult);

      // Build metadata
      const metadata = {
        sourceSpider: spiderConfig.id,
        gazetteScope: spiderConfig.gazetteScope,
        spiderType: spiderConfig.spiderType,
        processingTimeMs: processorResult.totalProcessingTimeMs
      };

      // Store analysis results
      const analysisRecord = await this.analysisResultsRepository.storeAnalysis(
        processorResult,
        ocrResult,
        gazette.id,
        gazetteCrawl.territoryId,
        gazette.publicationDate,
        jobId,
        configSignature,
        metadata
      );

      // Link analysis to gazette crawl and update status
      await this.gazetteRegistryRepository.linkAnalysisAndUpdateStatus(
        gazetteCrawl.id,
        analysisRecord.id,
        'success'
      );

      // Store analysis in cache
      await this.cacheService.cacheAnalysis(analysisRecord);

      // Extract and store concurso findings
      const allFindings = processorResult.analyzerResults.flatMap(result => result.findings);
      const concursoFindings = allFindings.filter(
        finding => finding.type === 'concurso' || finding.type.startsWith('concurso:')
      );

      if (concursoFindings.length > 0) {

        for (const finding of concursoFindings) {
          try {
            await this.concursoFindingsRepository.storeConcursoFinding(
              finding,
              analysisRecord.jobId,
              gazette.id,
              gazetteCrawl.territoryId
            );
          } catch (error) {
            logger.error('Failed to store concurso finding', error as Error, {
              jobId,
              findingType: finding.type
            });
          }
        }
      }

      message.ack();
    } catch (error) {

      // Update gazette crawl status on final failure
      if (message.attempts >= 3) {
        message.ack();
      } else {
        message.retry();
      }
    }
  }

  private async generateConfigSignature(config: AnalysisConfig, territoryId: string, gazetteId: string) {
    const enabledAnalyzers = Object.entries(config.analyzers)
      .filter(([, cfg]) => Boolean((cfg as { enabled?: boolean } | undefined)?.enabled))
      .map(([name]) => name)
      .sort();

    // Generate hash from stable representation
    const hashInput = {
      version: '1.0.0',
      analyzers: enabledAnalyzers,
      territoryId,
      gazetteId,
      configHash: ''
    };

    const fullHash = await sha256Hash(JSON.stringify(hashInput));
    hashInput.configHash = fullHash.substring(0, 32); // Truncate to 32 chars for compatibility

    return hashInput;
  }
}
