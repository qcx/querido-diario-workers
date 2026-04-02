/**
 * V2 AI Cost Tracker Service
 * Tracks token usage and costs for AI providers in v2 analyzers
 * Separate from v1 for independent evolution and monitoring
 */

export interface AIUsage {
  provider: 'openai' | 'mistral';
  model: string;
  operation: string;  // e.g., 'detection', 'classification', 'validation'
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  estimatedCost: number; // in USD
  timestamp: string;
  metadata?: {
    analyzerId?: string;
    analyzerType?: string;
    territoryId?: string;
    [key: string]: any;
  };
}

/**
 * Model pricing as of 2024
 * Prices are per 1K tokens
 */
const MODEL_PRICING = {
  openai: {
    'gpt-4o': { input: 0.005, output: 0.015 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 },
    'gpt-4': { input: 0.03, output: 0.06 },
    'gpt-3.5-turbo': { input: 0.0005, output: 0.0015 },
  },
  mistral: {
    'mistral-ocr-latest': { input: 0.004, output: 0.012 },
    'mistral-large-latest': { input: 0.004, output: 0.012 },
    'mistral-medium-latest': { input: 0.0027, output: 0.0081 },
    'mistral-small-latest': { input: 0.0002, output: 0.0006 },
  },
};

export class CostTracker {
  /**
   * Calculate cost for token usage
   */
  static calculateCost(
    provider: 'openai' | 'mistral',
    model: string,
    promptTokens: number,
    completionTokens: number
  ): number {
    const pricing = MODEL_PRICING[provider]?.[model];
    
    if (!pricing) {
      console.warn(`[V2 CostTracker] Unknown model pricing: ${provider}/${model}`);
      // Default to a reasonable estimate based on gpt-4o-mini pricing
      return (promptTokens * 0.00015 + completionTokens * 0.0006) / 1000;
    }

    const inputCost = (promptTokens / 1000) * pricing.input;
    const outputCost = (completionTokens / 1000) * pricing.output;
    
    return inputCost + outputCost;
  }

  /**
   * Estimate cost before making API call
   * Useful for cost gates
   */
  static estimateCost(
    provider: 'openai' | 'mistral',
    model: string,
    estimatedPromptTokens: number,
    estimatedCompletionTokens: number = 500
  ): number {
    return this.calculateCost(provider, model, estimatedPromptTokens, estimatedCompletionTokens);
  }

  /**
   * Estimate tokens from text length
   * Rough approximation: 1 token ≈ 4 characters for English
   */
  static estimateTokensFromText(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /**
   * Estimate cost from text length
   */
  static estimateCostFromText(
    text: string,
    provider: 'openai' | 'mistral',
    model: string,
    estimatedCompletionTokens: number = 500
  ): number {
    const promptTokens = this.estimateTokensFromText(text);
    return this.estimateCost(provider, model, promptTokens, estimatedCompletionTokens);
  }

  /**
   * Track AI usage
   */
  static trackUsage(
    provider: 'openai' | 'mistral',
    model: string,
    operation: string,
    usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number },
    metadata?: Record<string, any>
  ): AIUsage {
    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;
    const totalTokens = usage.total_tokens || (promptTokens + completionTokens);
    
    const estimatedCost = this.calculateCost(provider, model, promptTokens, completionTokens);

    const aiUsage: AIUsage = {
      provider,
      model,
      operation,
      tokens: {
        prompt: promptTokens,
        completion: completionTokens,
        total: totalTokens,
      },
      estimatedCost,
      timestamp: new Date().toISOString(),
      metadata,
    };

    console.log(`[V2 CostTracker] AI usage: ${operation} - ${totalTokens} tokens - $${estimatedCost.toFixed(4)}`, metadata);

    return aiUsage;
  }

  /**
   * Format cost for display
   */
  static formatCost(cost: number): string {
    if (cost < 0.01) {
      return `$${(cost * 100).toFixed(2)}¢`;
    }
    return `$${cost.toFixed(4)}`;
  }

  /**
   * Aggregate costs from multiple usage records
   */
  static aggregateCosts(usages: AIUsage[]): {
    totalCost: number;
    totalTokens: number;
    byAnalyzer: Record<string, { cost: number; tokens: number; calls: number }>;
    byOperation: Record<string, { cost: number; tokens: number; calls: number }>;
  } {
    const result = {
      totalCost: 0,
      totalTokens: 0,
      byAnalyzer: {} as Record<string, { cost: number; tokens: number; calls: number }>,
      byOperation: {} as Record<string, { cost: number; tokens: number; calls: number }>,
    };

    for (const usage of usages) {
      result.totalCost += usage.estimatedCost;
      result.totalTokens += usage.tokens.total;
      
      // By analyzer
      const analyzerId = usage.metadata?.analyzerId || 'unknown';
      if (!result.byAnalyzer[analyzerId]) {
        result.byAnalyzer[analyzerId] = { cost: 0, tokens: 0, calls: 0 };
      }
      result.byAnalyzer[analyzerId].cost += usage.estimatedCost;
      result.byAnalyzer[analyzerId].tokens += usage.tokens.total;
      result.byAnalyzer[analyzerId].calls += 1;
      
      // By operation
      if (!result.byOperation[usage.operation]) {
        result.byOperation[usage.operation] = { cost: 0, tokens: 0, calls: 0 };
      }
      result.byOperation[usage.operation].cost += usage.estimatedCost;
      result.byOperation[usage.operation].tokens += usage.tokens.total;
      result.byOperation[usage.operation].calls += 1;
    }

    return result;
  }

  /**
   * Calculate savings from skipped AI calls
   */
  static calculateSavings(
    skippedCalls: number,
    avgCostPerCall: number
  ): number {
    return skippedCalls * avgCostPerCall;
  }
}

