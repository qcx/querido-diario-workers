/**
 * AI Cost Tracker Service
 * Tracks token usage and costs for all AI providers (OpenAI, Mistral, etc.)
 */

import { logger } from '../utils';

export interface AIUsage {
  provider: 'openai' | 'mistral';
  model: string;
  operation: string;  // e.g., 'ocr', 'analysis', 'concurso_validation'
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  estimatedCost: number; // in USD
  timestamp: string;
  metadata?: {
    jobId?: string;
    territoryId?: string;
    analysisType?: string;
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
    'mistral-ocr-latest': { input: 0.004, output: 0.012 },  // Estimated
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
      logger.warn(`Unknown model pricing: ${provider}/${model}`);
      // Default to a reasonable estimate
      return (promptTokens * 0.001 + completionTokens * 0.003) / 1000;
    }

    const inputCost = (promptTokens / 1000) * pricing.input;
    const outputCost = (completionTokens / 1000) * pricing.output;
    
    return inputCost + outputCost;
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

    logger.info('AI usage tracked', {
      provider,
      model,
      operation,
      tokens: totalTokens,
      cost: estimatedCost.toFixed(4),
      ...metadata,
    });

    return aiUsage;
  }

  /**
   * Format cost for display
   */
  static formatCost(cost: number): string {
    if (cost < 0.01) {
      return `$${(cost * 100).toFixed(2)}¢`;
    }
    return `$${cost.toFixed(3)}`;
  }

  /**
   * Aggregate costs by various dimensions
   */
  static aggregateCosts(usages: AIUsage[]): {
    total: number;
    byProvider: Record<string, number>;
    byModel: Record<string, number>;
    byOperation: Record<string, number>;
    byTerritory?: Record<string, number>;
  } {
    const result = {
      total: 0,
      byProvider: {} as Record<string, number>,
      byModel: {} as Record<string, number>,
      byOperation: {} as Record<string, number>,
      byTerritory: {} as Record<string, number>,
    };

    for (const usage of usages) {
      result.total += usage.estimatedCost;
      
      // By provider
      result.byProvider[usage.provider] = (result.byProvider[usage.provider] || 0) + usage.estimatedCost;
      
      // By model
      const modelKey = `${usage.provider}/${usage.model}`;
      result.byModel[modelKey] = (result.byModel[modelKey] || 0) + usage.estimatedCost;
      
      // By operation
      result.byOperation[usage.operation] = (result.byOperation[usage.operation] || 0) + usage.estimatedCost;
      
      // By territory
      if (usage.metadata?.territoryId) {
        result.byTerritory[usage.metadata.territoryId] = 
          (result.byTerritory[usage.metadata.territoryId] || 0) + usage.estimatedCost;
      }
    }

    return result;
  }

  /**
   * Calculate average costs
   */
  static calculateAverages(usages: AIUsage[]): {
    avgCostPerOperation: number;
    avgTokensPerOperation: number;
    avgCostPerThousandTokens: number;
  } {
    if (usages.length === 0) {
      return {
        avgCostPerOperation: 0,
        avgTokensPerOperation: 0,
        avgCostPerThousandTokens: 0,
      };
    }

    const totalCost = usages.reduce((sum, u) => sum + u.estimatedCost, 0);
    const totalTokens = usages.reduce((sum, u) => sum + u.tokens.total, 0);

    return {
      avgCostPerOperation: totalCost / usages.length,
      avgTokensPerOperation: totalTokens / usages.length,
      avgCostPerThousandTokens: totalTokens > 0 ? (totalCost / totalTokens) * 1000 : 0,
    };
  }
}
