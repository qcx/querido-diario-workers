
/**
 * Base class for all analyzers
 */

import { schema } from '../../db';

interface AnalyzerConfig {
  enabled: boolean;
  priority?: number;
  timeout?: number;
}

/**
 * Analysis result from a specific analyzer
 */
export interface AnalysisResult {
  analyzerId: string;
  analyzerType: string;
  status: 'success' | 'failure' | 'skipped';
  findings: Finding[];
  metadata?: Record<string, any>;
  processingTimeMs: number;
  error?: {
    message: string;
    code?: string;
  };
}

/**
 * A finding from analysis
 */
export interface Finding {
  type: string;
  confidence: number; // 0-1
  data: Record<string, any>;
  location?: {
    page?: number;
    line?: number;
    offset?: number;
  };
  context?: string; // Surrounding text
}

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
      enabled: config.enabled !== undefined ? config.enabled : false,
    };
  }

  /**
   * Analyze OCR result
   */
  async analyze(ocrResult: typeof schema.ocrResults.$inferSelect): Promise<AnalysisResult> {
    if (!this.config.enabled) {
      return this.createSkippedResult('Analyzer is disabled');
    }

    if (!ocrResult.extractedText || ocrResult.extractedText.length === 0) {
      return this.createSkippedResult('No text to analyze');
    }

    const startTime = Date.now();

    const findings = await this.runWithTimeout(
      () => this.performAnalysis(ocrResult),
      this.config.timeout!
    );

    const processingTimeMs = Date.now() - startTime;
    
    // Collect metadata including AI usage if available
    const baseMetadata = this.getMetadata(findings);
    const aiUsageMetadata = this.getAIUsageMetadata?.();
    
    return {
      analyzerId: this.analyzerId,
      analyzerType: this.analyzerType,
      status: 'success',
      findings,
      processingTimeMs,
      metadata: {
        ...baseMetadata,
        ...(aiUsageMetadata ? { aiUsage: aiUsageMetadata } : {}),
      },
    };
  }

  /**
   * Perform the actual analysis (to be implemented by subclasses)
   */
  protected abstract performAnalysis(ocrResult: typeof schema.ocrResults.$inferSelect): Promise<Finding[]>;

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
   * Get AI usage metadata (optional override for analyzers that use AI)
   */
  protected getAIUsageMetadata?(): Record<string, any>;

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
