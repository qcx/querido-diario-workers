/**
 * Concurso Ambiguous Validator Service
 * Uses AI to validate ambiguous concurso-related keywords
 */

import { logger } from '../../utils';

export interface AmbiguousValidationResult {
  isValid: boolean;
  confidence: number;
  reason?: string;
}

export interface AmbiguousValidatorConfig {
  apiKey: string;
  model?: string;
  endpoint?: string;
  timeout?: number;
  confidenceThreshold?: number;
}

/**
 * Service for validating ambiguous concurso público findings using OpenAI
 */
export class ConcursoAmbiguousValidatorService {
  private apiKey: string;
  private model: string;
  private endpoint: string;
  private timeout: number;
  private confidenceThreshold: number;

  constructor(config: AmbiguousValidatorConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4o-mini';
    this.endpoint = config.endpoint || 'https://api.openai.com/v1/chat/completions';
    this.timeout = config.timeout || 30000;
    this.confidenceThreshold = config.confidenceThreshold || 0.7;
  }

  /**
   * Validate if an ambiguous keyword context is truly about concurso público
   */
  async validateAmbiguousFinding(context: string, keyword: string): Promise<AmbiguousValidationResult> {
    const startTime = Date.now();
    
    try {
      logger.info('Validating ambiguous concurso finding with AI', {
        keyword,
        contextLength: context.length,
      });

      const result = await this.callOpenAI(context, keyword);
      const processingTime = Date.now() - startTime;

      logger.info('AI validation completed', {
        keyword,
        isValid: result.isValid,
        confidence: result.confidence,
        processingTimeMs: processingTime,
      });

      return result;
    } catch (error: any) {
      logger.error('AI validation failed', error, {
        keyword,
        contextLength: context.length,
      });

      // Return negative result on error
      return {
        isValid: false,
        confidence: 0,
        reason: `Validation error: ${error.message}`,
      };
    }
  }

  /**
   * Call OpenAI API to validate the context
   */
  private async callOpenAI(context: string, keyword: string): Promise<AmbiguousValidationResult> {
    const prompt = this.buildPrompt(context, keyword);

    const requestBody = {
      model: this.model,
      messages: [
        {
          role: 'system',
          content: 'You are an expert in Brazilian public administration terminology. Your task is to classify whether text excerpts are about "concurso público" (Brazilian public job competitions).',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.1,
      max_tokens: 150,
      response_format: { type: 'json_object' },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json() as any;
      
      if (!data.choices || data.choices.length === 0) {
        throw new Error('No response from OpenAI API');
      }

      const content = data.choices[0].message.content as string;
      const parsed = JSON.parse(content);

      return {
        isValid: parsed.isValid || false,
        confidence: parsed.confidence || 0,
        reason: parsed.reason,
      };
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error(`OpenAI API timeout after ${this.timeout}ms`);
      }
      
      throw error;
    }
  }

  /**
   * Build the validation prompt
   */
  private buildPrompt(context: string, keyword: string): string {
    return `Analyze the following text excerpt from a Brazilian official gazette (diário oficial) to determine if the term "${keyword}" refers to a public service competition (concurso público) or something else.

Context:

${context}

Consider:

1. Is this about hiring public servants (servidores públicos)?
2. Is it a formal government selection process?

NOT a "concurso público":
- Private sector job offers 
- Educational contests or competitions
- Cultural or artistic competitions
- Awards or prizes

Respond in JSON format:

{
  "isValid": true/false,
  "confidence": 0.0-1.0,
  "reason": "Brief explanation"
}`;
  }

  /**
   * Get the confidence threshold for validation
   */
  getConfidenceThreshold(): number {
    return this.confidenceThreshold;
  }

  /**
   * Set a new confidence threshold
   */
  setConfidenceThreshold(threshold: number): void {
    this.confidenceThreshold = threshold;
  }
}
