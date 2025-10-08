/**
 * AI Analyzer - Uses LLM for semantic analysis
 */

import { BaseAnalyzer } from './base-analyzer';
import { OcrResult, Finding, AIAnalysisPrompt, AnalyzerConfig } from '../types';
import { logger } from '../utils';
import { AIAnalysisError, toAppError } from '../types/errors';

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
    this.model = config.model || 'gpt-4o-mini';
    this.prompts = config.prompts || this.getDefaultPrompts();
  }

  protected async performAnalysis(ocrResult: OcrResult): Promise<Finding[]> {
    const findings: Finding[] = [];

    // GPT-4o-mini supports 16k tokens (~64k characters)
    // Using 50k chars to leave room for prompts and responses
    const maxTextLength = 50000;
    const extractedText = ocrResult.extractedText || '';
    const text = extractedText.length > maxTextLength
      ? extractedText.substring(0, maxTextLength) + '...'
      : extractedText;

    // Check if we have detected document type context
    const detectedDocType = ocrResult.metadata?.detectedDocumentType;
    const detectedCategories = ocrResult.metadata?.detectedCategories || [];
    
    // Use context-aware prompts if document type is detected
    let prompts = this.prompts;
    if (detectedDocType) {
      const contextPrompts = this.getContextAwarePrompts(detectedDocType, detectedCategories);
      if (contextPrompts.length > 0) {
        prompts = [...contextPrompts, ...this.prompts.filter(p => p.name === 'urgency_assessment')];
        logger.info(`Using context-aware prompts for document type: ${detectedDocType}`);
      }
    }

    for (const prompt of prompts) {
      try {
        const result = await this.runAIAnalysis(text, prompt, ocrResult.metadata);
        findings.push(...result);
      } catch (error: any) {
        const aiError = error instanceof AIAnalysisError ? error : toAppError(error);
        logger.error(`AI analysis failed for prompt ${prompt.name}`, {
          promptName: prompt.name,
          error: aiError.toJSON()
        });
      }
    }

    return findings;
  }

  /**
   * Run AI analysis with a specific prompt
   */
  private async runAIAnalysis(text: string, prompt: AIAnalysisPrompt, _metadata?: Record<string, unknown>): Promise<Finding[]> {
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
      throw new AIAnalysisError(
        `AI API error: ${response.status} - ${errorText}`,
        'openai', // or detect from config
        'https://api.openai.com/v1/chat/completions',
        response.status,
        errorText
      );
    }

    const result: unknown = await response.json();
    
    // Basic validation of AI response structure
    if (!result || typeof result !== 'object') {
      throw new AIAnalysisError(
        'Invalid AI response format',
        'openai',
        'https://api.openai.com/v1/chat/completions',
        undefined,
        JSON.stringify(result).substring(0, 500)
      );
    }
    
    const typedResult = result as { choices?: { message?: { content?: string } }[] };
    if (!typedResult.choices || !typedResult.choices[0]?.message?.content) {
      throw new AIAnalysisError(
        'AI response missing expected structure',
        'openai',
        'https://api.openai.com/v1/chat/completions'
      );
    }
    
    const content = typedResult.choices[0].message.content;
    const analysis = JSON.parse(content);

    return this.parseAIResponse(analysis, prompt.name);
  }

  /**
   * Parse AI response into findings
   */
  private parseAIResponse(analysis: unknown, promptName: string): Finding[] {
    const findings: Finding[] = [];

    // Type guard for analysis object
    if (!analysis || typeof analysis !== 'object') {
      return findings;
    }

    const typedAnalysis = analysis as Record<string, unknown>;

    // Handle different response formats
    if (typedAnalysis.findings && Array.isArray(typedAnalysis.findings)) {
      for (const item of typedAnalysis.findings) {
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

  /**
   * Get context-aware prompts based on detected document type
   */
  private getContextAwarePrompts(
    documentType: string,
    categories: string[]
  ): AIAnalysisPrompt[] {
    const contextPrompts: AIAnalysisPrompt[] = [];

    // Concurso-specific prompts
    if (documentType.includes('edital_abertura') || categories.includes('concurso_publico_abertura')) {
      contextPrompts.push({
        name: 'concurso_edital_extraction',
        prompt: `You are analyzing a Brazilian public job opening announcement (Edital de Abertura de Concurso Público).

Extract the following structured information in JSON format:
{
  "findings": [
    {
      "type": "concurso_details",
      "confidence": 0.0-1.0,
      "description": "brief description",
      "data": {
        "orgao": "organization name",
        "editalNumero": "edital number",
        "totalVagas": number,
        "cargos": [
          {
            "nome": "position name",
            "vagas": number,
            "requisitos": "requirements",
            "salario": "salary",
            "cargaHoraria": "workload"
          }
        ],
        "inscricoes": {
          "inicio": "start date",
          "fim": "end date",
          "site": "registration website",
          "taxa": "registration fee"
        },
        "etapas": ["stage1", "stage2"],
        "cronograma": [
          {
            "evento": "event name",
            "data": "date"
          }
        ],
        "banca": "organizing company"
      }
    }
  ]
}

Focus on extracting accurate, actionable information for job seekers.`,
        maxTokens: 1500,
        temperature: 0.1,
      });
    }

    // Licitação-specific prompts
    if (categories.includes('licitacao')) {
      contextPrompts.push({
        name: 'licitacao_extraction',
        prompt: `You are analyzing a Brazilian public bidding document (Licitação).

Extract the following structured information in JSON format:
{
  "findings": [
    {
      "type": "licitacao_details",
      "confidence": 0.0-1.0,
      "description": "brief description",
      "data": {
        "modalidade": "pregão/tomada de preços/concorrência",
        "numero": "number",
        "objeto": "object description",
        "valorEstimado": "estimated value",
        "dataAbertura": "opening date",
        "horario": "time",
        "local": "location",
        "prazoEntrega": "delivery deadline",
        "contatoInformacoes": "contact info"
      }
    }
  ]
}`,
        maxTokens: 1000,
        temperature: 0.1,
      });
    }

    // Contract-specific prompts
    if (documentType.includes('contrato') || categories.includes('contrato')) {
      contextPrompts.push({
        name: 'contract_extraction',
        prompt: `You are analyzing a Brazilian government contract.

Extract key contract information in JSON format:
{
  "findings": [
    {
      "type": "contract_details",
      "confidence": 0.0-1.0,
      "description": "brief description",
      "data": {
        "numeroContrato": "contract number",
        "contratante": "contracting party",
        "contratado": "contracted party",
        "objeto": "object",
        "valor": "value",
        "prazo": "duration",
        "dataAssinatura": "signature date",
        "vigencia": "validity period"
      }
    }
  ]
}`,
        maxTokens: 800,
        temperature: 0.1,
      });
    }

    return contextPrompts;
  }
}
