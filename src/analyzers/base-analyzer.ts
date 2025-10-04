/**
 * Base class for all analyzers
 */

import { OcrResult, AnalysisResult, Finding, AnalyzerConfig } from '../types';
import { logger } from '../utils';

export abstract class BaseAnalyzer {
  protected config: AnalyzerConfig;
  protected analyzerId: string;
  protected analyzerType: string;

  constructor(analyzerId: string, analyzerType: string, config: AnalyzerConfig = { enabled: true }) {
    this.analyzerId = analyzerId;
    this.analyzerType = analyzerType;
    this.config = {
      priority: 100,
      timeout: 30000,
      ...config,
      enabled: config.enabled !== undefined ? config.enabled : true,
    };
  }

  /**
   * Analyze OCR result
   */
  async analyze(ocrResult: OcrResult): Promise<AnalysisResult> {
    if (!this.config.enabled) {
      return this.createSkippedResult('Analyzer is disabled');
    }

    if (!ocrResult.extractedText || ocrResult.extractedText.length === 0) {
      return this.createSkippedResult('No text to analyze');
    }

    const startTime = Date.now();

    try {
      logger.info(`Starting analysis with ${this.analyzerId}`, {
        analyzerId: this.analyzerId,
        analyzerType: this.analyzerType,
        jobId: ocrResult.jobId,
        textLength: ocrResult.extractedText.length,
      });

      // Run analysis with timeout
      const findings = await this.runWithTimeout(
        () => this.performAnalysis(ocrResult),
        this.config.timeout!
      );

      const processingTimeMs = Date.now() - startTime;

      logger.info(`Analysis completed with ${this.analyzerId}`, {
        analyzerId: this.analyzerId,
        jobId: ocrResult.jobId,
        findingsCount: findings.length,
        processingTimeMs,
      });

      return {
        analyzerId: this.analyzerId,
        analyzerType: this.analyzerType,
        status: 'success',
        findings,
        processingTimeMs,
        metadata: this.getMetadata(findings),
      };
    } catch (error: any) {
      const processingTimeMs = Date.now() - startTime;

      logger.error(`Analysis failed for ${this.analyzerId}`, error, {
        analyzerId: this.analyzerId,
        jobId: ocrResult.jobId,
        processingTimeMs,
      });

      return {
        analyzerId: this.analyzerId,
        analyzerType: this.analyzerType,
        status: 'failure',
        findings: [],
        processingTimeMs,
        error: {
          message: error.message,
          code: error.code,
        },
      };
    }
  }

  /**
   * Perform the actual analysis (to be implemented by subclasses)
   */
  protected abstract performAnalysis(ocrResult: OcrResult): Promise<Finding[]>;

  /**
   * Get analyzer-specific metadata (optional override)
   */
  protected getMetadata(findings: Finding[]): Record<string, any> {
    return {
      totalFindings: findings.length,
      averageConfidence: findings.length > 0
        ? findings.reduce((sum, f) => sum + f.confidence, 0) / findings.length
        : 0,
    };
  }

  /**
   * Create a skipped result
   */
  protected createSkippedResult(reason: string): AnalysisResult {
    return {
      analyzerId: this.analyzerId,
      analyzerType: this.analyzerType,
      status: 'skipped',
      findings: [],
      processingTimeMs: 0,
      metadata: { reason },
    };
  }

  /**
   * Create a finding
   */
  protected createFinding(
    type: string,
    data: Record<string, any>,
    confidence: number = 1.0,
    context?: string
  ): Finding {
    return {
      type,
      confidence: Math.max(0, Math.min(1, confidence)),
      data,
      context,
    };
  }

  /**
   * Run function with timeout
   */
  private async runWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('Analysis timeout')), timeoutMs)
      ),
    ]);
  }

  /**
   * Get analyzer ID
   */
  getId(): string {
    return this.analyzerId;
  }

  /**
   * Get analyzer type
   */
  getType(): string {
    return this.analyzerType;
  }

  /**
   * Get analyzer priority
   */
  getPriority(): number {
    return this.config.priority || 100;
  }

  /**
   * Check if analyzer is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}
