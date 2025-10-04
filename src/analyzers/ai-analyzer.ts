/**
 * AI Analyzer - Uses LLM for semantic analysis
 */

import { BaseAnalyzer } from './base-analyzer';
import { OcrResult, Finding, AIAnalysisPrompt, AnalyzerConfig } from '../types';
import { logger } from '../utils';

export class AIAnalyzer extends BaseAnalyzer {
  private apiKey: string;
  private prompts: AIAnalysisPrompt[];
  private model: string;

  constructor(
    config: AnalyzerConfig & {
      apiKey: string;
      prompts?: AIAnalysisPrompt[];
      model?: string;
    }
  ) {
    super('ai-analyzer', 'ai', config);
    
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4.1-mini';
    this.prompts = config.prompts || this.getDefaultPrompts();
  }

  protected async performAnalysis(ocrResult: OcrResult): Promise<Finding[]> {
    const findings: Finding[] = [];

    // Limit text length to avoid token limits
    const maxTextLength = 8000;
    const extractedText = ocrResult.extractedText || '';
    const text = extractedText.length > maxTextLength
      ? extractedText.substring(0, maxTextLength) + '...'
      : extractedText;

    for (const prompt of this.prompts) {
      try {
        const result = await this.runAIAnalysis(text, prompt);
        findings.push(...result);
      } catch (error: any) {
        logger.error(`AI analysis failed for prompt ${prompt.name}`, error);
      }
    }

    return findings;
  }

  /**
   * Run AI analysis with a specific prompt
   */
  private async runAIAnalysis(text: string, prompt: AIAnalysisPrompt): Promise<Finding[]> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: prompt.model || this.model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert in analyzing Brazilian official gazettes. Provide structured analysis in JSON format.',
          },
          {
            role: 'user',
            content: `${prompt.prompt}\n\nText to analyze:\n\n${text}`,
          },
        ],
        max_tokens: prompt.maxTokens || 1000,
        temperature: prompt.temperature || 0.3,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`AI API error: ${response.status} - ${errorText}`);
    }

    const result: any = await response.json();
    const content = result.choices[0].message.content;
    const analysis = JSON.parse(content);

    return this.parseAIResponse(analysis, prompt.name);
  }

  /**
   * Parse AI response into findings
   */
  private parseAIResponse(analysis: any, promptName: string): Finding[] {
    const findings: Finding[] = [];

    // Handle different response formats
    if (analysis.findings && Array.isArray(analysis.findings)) {
      for (const item of analysis.findings) {
        findings.push(
          this.createFinding(
            `ai:${promptName}`,
            {
              promptName,
              ...item,
            },
            item.confidence || 0.8
          )
        );
      }
    } else if (analysis.categories && Array.isArray(analysis.categories)) {
      for (const category of analysis.categories) {
        findings.push(
          this.createFinding(
            'ai:category',
            {
              promptName,
              category,
              confidence: analysis.confidence || 0.8,
            },
            analysis.confidence || 0.8
          )
        );
      }
    } else {
      // Generic finding with full analysis
      findings.push(
        this.createFinding(
          `ai:${promptName}`,
          {
            promptName,
            analysis,
          },
          0.7
        )
      );
    }

    return findings;
  }

  /**
   * Default AI analysis prompts
   */
  private getDefaultPrompts(): AIAnalysisPrompt[] {
    return [
      {
        name: 'content_classification',
        prompt: `Analyze this Brazilian official gazette text and classify its content into categories.

Return a JSON object with this structure:
{
  "categories": ["category1", "category2", ...],
  "confidence": 0.0-1.0,
  "summary": "brief summary"
}

Possible categories:
- concurso_publico (public job openings)
- licitacao (public bidding)
- contrato (contracts)
- nomeacao (appointments)
- exoneracao (dismissals)
- decreto (decrees)
- lei (laws)
- portaria (ordinances)
- orcamento (budget)
- convenio (agreements)
- outro (other)`,
        maxTokens: 500,
        temperature: 0.2,
      },
      {
        name: 'key_information_extraction',
        prompt: `Extract key information from this Brazilian official gazette text.

Return a JSON object with this structure:
{
  "findings": [
    {
      "type": "type_of_information",
      "value": "extracted_value",
      "confidence": 0.0-1.0,
      "description": "brief description"
    }
  ]
}

Extract:
- Dates (publication, deadlines, events)
- Values (monetary amounts, quantities)
- Organizations (companies, institutions)
- People (names, positions)
- Legal references (laws, decrees, articles)
- Locations (addresses, cities)`,
        maxTokens: 800,
        temperature: 0.1,
      },
      {
        name: 'urgency_assessment',
        prompt: `Assess the urgency and importance of this Brazilian official gazette text.

Return a JSON object with this structure:
{
  "urgency": "low|medium|high|critical",
  "importance": "low|medium|high",
  "confidence": 0.0-1.0,
  "reasons": ["reason1", "reason2", ...],
  "deadlines": ["deadline1", "deadline2", ...]
}

Consider:
- Presence of deadlines
- Public interest impact
- Legal obligations
- Time-sensitive actions required`,
        maxTokens: 400,
        temperature: 0.2,
      },
    ];
  }

  /**
   * Add custom prompt
   */
  addPrompt(prompt: AIAnalysisPrompt): void {
    this.prompts.push(prompt);
  }

  /**
   * Get all prompts
   */
  getPrompts(): AIAnalysisPrompt[] {
    return [...this.prompts];
  }
}
