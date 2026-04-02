/**
 * AI Integration Service - Thin wrapper around OpenAI API
 * Provides centralized error handling and retry logic
 * Business logic (prompt building, response parsing) lives in analyzers
 */

import { CostTracker, AIUsage } from '../services/cost-tracker';

export interface CostGateConfig {
  maxCostPerSession?: number;
  estimateBeforeCall?: boolean;
  strictMode?: boolean;
}

export interface AIServiceConfig {
  apiKey: string;
  model?: string;
  temperature?: number;
  maxRetries?: number;
  timeout?: number;
  costGate?: CostGateConfig;
}

export interface AICallOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
  operation?: string; // For cost tracking
  metadata?: Record<string, any>; // For cost tracking
  bypassCostGate?: boolean; // Allow critical operations to bypass cost limits
}

export class CostLimitError extends Error {
  constructor(message: string, public currentCost: number, public limit: number) {
    super(message);
    this.name = 'CostLimitError';
  }
}

export class AIIntegrationService {
  private apiKey: string;
  private model: string;
  private defaultTemperature: number;
  private maxRetries: number;
  private timeout: number;
  private baseUrl = 'https://api.openai.com/v1/chat/completions';
  private usageTracking: AIUsage[] = [];
  private costGateConfig: CostGateConfig;

  constructor(config: AIServiceConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4o-mini';
    this.defaultTemperature = config.temperature || 0.3;
    this.maxRetries = config.maxRetries || 2;
    this.timeout = config.timeout || 30000;
    this.costGateConfig = {
      maxCostPerSession: config.costGate?.maxCostPerSession || 0.05,
      estimateBeforeCall: config.costGate?.estimateBeforeCall !== false,
      strictMode: config.costGate?.strictMode || false,
    };
  }

  /**
   * Call OpenAI API with custom system and user prompts
   * Returns the raw response text for the caller to parse
   * Enforces cost gates to prevent excessive API spending
   */
  async call(options: AICallOptions): Promise<string> {
    const temperature = options.temperature ?? this.defaultTemperature;
    const maxTokens = options.maxTokens ?? 500;

    // Cost gate: Check if we should proceed with this call
    if (!options.bypassCostGate && this.costGateConfig.estimateBeforeCall) {
      const currentCost = this.getCurrentCost();
      const estimatedCost = this.estimateCost(options.userPrompt, maxTokens);
      const totalCost = currentCost + estimatedCost;
      
      if (totalCost > (this.costGateConfig.maxCostPerSession || 0.05)) {
        const message = `Cost limit would be exceeded: current $${currentCost.toFixed(4)} + estimated $${estimatedCost.toFixed(4)} > limit $${this.costGateConfig.maxCostPerSession?.toFixed(4)}`;
        
        if (this.costGateConfig.strictMode) {
          throw new CostLimitError(
            message,
            currentCost,
            this.costGateConfig.maxCostPerSession || 0.05
          );
        } else {
          // Log warning but don't throw in non-strict mode
          console.warn(`[AI Service] ${message} - Skipping AI call`);
          throw new Error('Cost limit exceeded - AI call skipped');
        }
      }
    }

    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.makeAPIRequest(
          options.systemPrompt,
          options.userPrompt,
          temperature,
          maxTokens,
          options.operation,
          options.metadata
        );
        return response;
      } catch (error) {
        lastError = error as Error;
        
        // Don't retry on certain errors
        if (this.isNonRetryableError(error)) {
          throw error;
        }
        
        // Wait before retrying (exponential backoff)
        if (attempt < this.maxRetries) {
          await this.sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }
    
    throw lastError || new Error('Max retries reached');
  }

  /**
   * Estimate cost for a potential API call
   */
  estimateCost(userPrompt: string, maxTokens: number = 500): number {
    return CostTracker.estimateCostFromText(
      userPrompt,
      'openai',
      this.model,
      maxTokens
    );
  }

  /**
   * Make actual API request to OpenAI
   */
  private async makeAPIRequest(
    systemPrompt: string,
    userPrompt: string,
    temperature: number,
    maxTokens: number,
    operation?: string,
    metadata?: Record<string, any>
  ): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: userPrompt,
            },
          ],
          temperature,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorBody}`);
      }
      
      const data: any = await response.json();
      
      if (!data.choices || data.choices.length === 0) {
        throw new Error('No response from OpenAI API');
      }
      
      // Track token usage and cost
      if (data.usage) {
        const usage = CostTracker.trackUsage(
          'openai',
          this.model,
          operation || 'ai-call',
          data.usage,
          metadata
        );
        this.usageTracking.push(usage);
      }
      
      return data.choices[0].message.content.trim();
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error?.name === 'AbortError') {
        throw new Error('OpenAI API request timeout');
      }
      throw error;
    }
  }

  /**
   * Check if error should not be retried
   */
  private isNonRetryableError(error: any): boolean {
    const message = error?.message || '';
    
    // Don't retry on authentication errors
    if (message.includes('401') || message.includes('403')) {
      return true;
    }
    
    // Don't retry on invalid request errors
    if (message.includes('400')) {
      return true;
    }
    
    return false;
  }

  /**
   * Get accumulated usage statistics
   */
  getUsageStats(): {
    totalCost: number;
    totalTokens: number;
    callCount: number;
    usages: AIUsage[];
  } {
    const aggregated = CostTracker.aggregateCosts(this.usageTracking);
    return {
      totalCost: aggregated.totalCost,
      totalTokens: aggregated.totalTokens,
      callCount: this.usageTracking.length,
      usages: [...this.usageTracking],
    };
  }

  /**
   * Reset usage tracking (call at start of new analysis)
   */
  resetUsageTracking(): void {
    this.usageTracking = [];
  }

  /**
   * Get current accumulated cost
   */
  getCurrentCost(): number {
    return this.usageTracking.reduce((sum, u) => sum + u.estimatedCost, 0);
  }

  /**
   * Sleep utility for retry backoff
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Factory function to create AI service instance
 */
export function createAIService(config: AIServiceConfig): AIIntegrationService | null {
  if (!config.apiKey) {
    return null;
  }
  
  return new AIIntegrationService(config);
}
