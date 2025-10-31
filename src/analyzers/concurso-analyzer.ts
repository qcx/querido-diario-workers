/**
 * Concurso Analyzer - Specialized analyzer for public contest documents
 * Detects document types and extracts structured data
 */

import { BaseAnalyzer } from './base-analyzer';
import { OcrResult, Finding, AnalyzerConfig, ConcursoData, ConcursoDocumentType } from '../types';
import { 
  CONCURSO_PATTERNS, 
  EXTRACTION_PATTERNS, 
  TITLE_PATTERNS,
  hasConcursoKeywords,
  hasAmbiguousConcursoKeywords,
  calculateTypeConfidence
} from './patterns/concurso-patterns';
import { ProximityAnalyzer } from './utils/proximity-analyzer';
import { logger } from '../utils';
import { CostTracker, AIUsage } from '../services/cost-tracker';

export interface ConcursoAnalyzerConfig extends AnalyzerConfig {
  useAIExtraction?: boolean;
  apiKey?: string;
  model?: string;
}

export class ConcursoAnalyzer extends BaseAnalyzer {
  private useAIExtraction: boolean;
  private apiKey?: string;
  private model: string;

  constructor(config: ConcursoAnalyzerConfig = { enabled: true }) {
    super('concurso-analyzer', 'concurso', config);
    
    this.useAIExtraction = config.useAIExtraction ?? false;
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4o-mini';
  }

  protected async performAnalysis(ocrResult: OcrResult): Promise<Finding[]> {
    const text = ocrResult.extractedText || '';
    const findings: Finding[] = [];

    // Quick check: does this contain concurso keywords?
    if (!hasConcursoKeywords(text)) {
      logger.debug('No concurso keywords found, skipping detailed analysis');
      return findings;
    }

    // Step 1: Detect document type
    const documentTypeResult = this.detectDocumentType(text);
    
    if (!documentTypeResult) {
      logger.debug('Could not classify concurso document type');
      return findings;
    }

    logger.info('Detected concurso document', {
      documentType: documentTypeResult.type,
      confidence: documentTypeResult.confidence,
    });

    // Step 2: Extract structured data using patterns
    const patternData = this.extractDataWithPatterns(text, documentTypeResult.type);

    // Step 3: If AI extraction is enabled and we have high confidence, enhance with AI
    let finalData = patternData;
    let extractionMethod: 'pattern' | 'ai' | 'hybrid' = 'pattern';

    if (this.useAIExtraction && this.apiKey && documentTypeResult.confidence >= 0.7) {
      logger.info('Using AI to extract structured data', {
        documentType: documentTypeResult.type,
      });

      try {
        const aiData = await this.extractDataWithAI(text, documentTypeResult.type, patternData);
        if (aiData) {
          finalData = this.mergeExtractedData(patternData, aiData);
          extractionMethod = 'hybrid';
        }
      } catch (error) {
        logger.error('AI extraction failed, using pattern-based data only', error as Error);
      }
    }

    // Step 4: Create finding with all extracted data
    const concursoData: ConcursoData = {
      documentType: documentTypeResult.type,
      documentTypeConfidence: documentTypeResult.confidence,
      ...finalData,
    };

    // Map document type to webhook category
    const categoryMap: Record<ConcursoDocumentType, string> = {
      convocacao: 'concurso_publico_convocacao',
      edital_abertura: 'concurso_publico_abertura',
      homologacao: 'concurso_publico_homologacao',
      retificacao: 'concurso_publico_retificacao',
      prorrogacao: 'concurso_publico_prorrogacao',
      cancelamento_suspensao: 'concurso_publico_cancelamento',
      resultado_parcial: 'concurso_publico_resultado',
      gabarito: 'concurso_publico_resultado',
      recurso_impugnacao: 'concurso_publico',
      nao_classificado: 'concurso_publico',
    };

    findings.push(
      this.createFinding(
        'concurso',
        {
          category: categoryMap[documentTypeResult.type] || 'concurso_publico',
          concursoData,
          extractionMethod,
          documentType: documentTypeResult.type,
        },
        documentTypeResult.confidence,
        this.extractRelevantContext(text, documentTypeResult.type)
      )
    );

    return findings;
  }

  /**
   * Detect the type of concurso document with proximity awareness
   */
  private detectDocumentType(text: string): { type: ConcursoDocumentType; confidence: number } | null {
    const results: Array<{ type: ConcursoDocumentType; confidence: number }> = [];
    
    // Extract document structure for context bonuses
    const structure = ProximityAnalyzer.extractDocumentStructure(text);

    // First, check title patterns for quick high-confidence matches
    for (const titlePattern of TITLE_PATTERNS) {
      for (const title of structure.titles) {
        for (const pattern of titlePattern.patterns) {
          if (pattern.test(title.text)) {
            logger.info('Title pattern match found', {
              documentType: titlePattern.documentType,
              titleText: title.text,
              confidence: titlePattern.baseConfidence * title.confidence
            });
            return {
              type: titlePattern.documentType,
              confidence: Math.min(titlePattern.baseConfidence * title.confidence, 0.95)
            };
          }
        }
      }
    }

    // Sort patterns by priority
    const sortedPatterns = [...CONCURSO_PATTERNS].sort((a, b) => {
      const priorityOrder = { primary: 0, secondary: 1, supporting: 2 };
      const aPriority = priorityOrder[a.priority || 'secondary'];
      const bPriority = priorityOrder[b.priority || 'secondary'];
      return aPriority - bPriority;
    });

    for (const pattern of sortedPatterns) {
      let patternMatches = 0;
      let keywordMatches = 0;
      let proximityBonus = 1.0;
      let contextBonus = 1.0;

      // Check regex patterns
      for (const regex of pattern.patterns) {
        if (regex.test(text)) {
          patternMatches++;
        }
      }

      // Check exclude patterns
      if (pattern.excludePatterns) {
        for (const excludeRegex of pattern.excludePatterns) {
          if (excludeRegex.test(text)) {
            patternMatches = Math.max(0, patternMatches - 1);
          }
        }
      }

      // Find keyword positions for proximity analysis
      const keywordPositions = ProximityAnalyzer.findKeywordPositions(
        text,
        pattern.keywords,
        false
      );

      // Count unique keywords found
      const foundKeywords = new Set(keywordPositions.map(p => p.keyword.toLowerCase()));
      keywordMatches = foundKeywords.size;

      // Apply proximity analysis if required
      if (pattern.proximity && keywordPositions.length > 1) {
        const bestGroup = ProximityAnalyzer.findBestKeywordGroup(
          keywordPositions,
          pattern.keywords,
          pattern.proximity.maxDistance
        );

        if (bestGroup) {
          // Check if minimum keywords are together
          const uniqueInGroup = new Set(bestGroup.keywords.map(p => p.keyword.toLowerCase())).size;
          if (uniqueInGroup >= (pattern.minKeywordsTogether || 2)) {
            proximityBonus = bestGroup.averageProximity * 1.3; // Boost for good proximity
          } else if (pattern.proximity.required) {
            // Required proximity not met
            proximityBonus = 0.5; // Penalty
          }
        } else if (pattern.proximity.required) {
          // No valid group found and proximity is required
          continue; // Skip this pattern
        }
      }

      // Check for keywords in titles/headers for context bonus
      for (const title of structure.titles) {
        if (pattern.keywords.some(kw => title.text.toLowerCase().includes(kw.toLowerCase()))) {
          contextBonus = 1.2; // Title match bonus
          break;
        }
      }

      // Calculate confidence with all factors
      if (patternMatches > 0 || keywordMatches > 0) {
        const baseConfidence = calculateTypeConfidence(
          patternMatches,
          pattern.patterns.length,
          keywordMatches,
          pattern.weight
        );

        const adjustedConfidence = Math.min(baseConfidence * proximityBonus * contextBonus, 1.0);

        // High-priority patterns with strong matches can short-circuit
        if (pattern.priority === 'primary' && adjustedConfidence >= 0.85) {
          logger.info('High confidence match found', {
            documentType: pattern.documentType,
            confidence: adjustedConfidence,
            patternMatches,
            keywordMatches,
            proximityBonus,
            contextBonus
          });
          return {
            type: pattern.documentType,
            confidence: adjustedConfidence,
          };
        }

        results.push({
          type: pattern.documentType,
          confidence: adjustedConfidence,
        });
      }
    }

    // Sort by confidence and return the best match
    results.sort((a, b) => b.confidence - a.confidence);

    if (results.length > 0 && results[0].confidence >= 0.5) {
      logger.info('Document type detected', {
        type: results[0].type,
        confidence: results[0].confidence,
        totalCandidates: results.length
      });
      return results[0];
    }

    // Fallback: if we detected concurso keywords but couldn't classify type
    if (hasConcursoKeywords(text)) {
      return {
        type: 'nao_classificado',
        confidence: 0.6,
      };
    }

    return null;
  }

  /**
   * Extract structured data using regex patterns
   */
  private extractDataWithPatterns(text: string, documentType: ConcursoDocumentType): Partial<ConcursoData> {
    const data: Partial<ConcursoData> = {};

    // Extract edital number
    for (const pattern of EXTRACTION_PATTERNS.editalNumero) {
      const match = text.match(pattern);
      if (match) {
        data.editalNumero = match[1];
        break;
      }
    }

    // Extract organization
    for (const pattern of EXTRACTION_PATTERNS.orgao) {
      const match = text.match(pattern);
      if (match) {
        data.orgao = match[1].trim();
        break;
      }
    }

    // Extract vacancies (only for relevant document types)
    if (['edital_abertura', 'convocacao', 'homologacao'].includes(documentType)) {
      const vagasMatch = text.match(EXTRACTION_PATTERNS.vagas[0]);
      if (vagasMatch) {
        data.vagas = {
          total: parseInt(vagasMatch[1], 10),
        };
      }
    }

    // Extract dates
    const datas: any = {};
    
    const inscricoesMatch = text.match(EXTRACTION_PATTERNS.inscricoes[0]);
    if (inscricoesMatch) {
      datas.inscricoesInicio = inscricoesMatch[1];
      datas.inscricoesFim = inscricoesMatch[2];
    }

    const provaMatch = text.match(EXTRACTION_PATTERNS.prova[0]);
    if (provaMatch) {
      datas.prova = provaMatch[1];
    }

    if (Object.keys(datas).length > 0) {
      data.datas = datas;
    }

    // Extract registration fee
    const taxaMatch = text.match(EXTRACTION_PATTERNS.taxa[0]);
    if (taxaMatch) {
      data.taxas = [{
        valor: this.parseMoneyValue(taxaMatch[1]),
      }];
    }

    // Extract banca
    for (const pattern of EXTRACTION_PATTERNS.banca) {
      const match = text.match(pattern);
      if (match) {
        if (pattern.source.includes('cnpj')) {
          data.banca = { ...data.banca, cnpj: match[1] };
        } else {
          data.banca = { ...data.banca, nome: match[1].trim() };
        }
      }
    }

    // Extract cities (for multi-city support)
    for (const pattern of EXTRACTION_PATTERNS.cidades) {
      const match = text.match(pattern);
      if (match) {
        const cidadesText = match[1];
        const cidades = cidadesText.split(/[,;]/).map(c => c.trim()).filter(c => c.length > 0);
        data.cidades = cidades.map(nome => ({ nome }));
        break;
      }
    }

    return data;
  }

  /**
   * Extract structured data using OpenAI
   */
  private async extractDataWithAI(
    text: string,
    documentType: ConcursoDocumentType,
    patternData: Partial<ConcursoData>
  ): Promise<Partial<ConcursoData> | null> {
    if (!this.apiKey) {
      return null;
    }

    try {
      // Limit text size for API call (use relevant context)
      const contextText = this.extractRelevantContext(text, documentType);
      
      const prompt = this.buildExtractionPrompt(documentType, contextText, patternData);

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
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
              content: 'You are a specialized assistant for extracting structured data from Brazilian public contest (concurso público) documents. Always respond with valid JSON.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.1,
          max_tokens: 1500,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const result = await response.json() as any;
      const content = result.choices?.[0]?.message?.content;
      
      // Track token usage and cost
      if (result.usage) {
        CostTracker.trackUsage(
          'openai',
          this.model,
          'concurso_extraction',
          result.usage,
          {
            documentType,
            territoryId: patternData.cidades?.[0]?.territoryId,
          }
        );
      }

      if (!content) {
        return null;
      }

      return JSON.parse(content);
    } catch (error) {
      logger.error('AI extraction failed', error as Error);
      return null;
    }
  }

  /**
   * Build prompt for AI extraction
   */
  private buildExtractionPrompt(
    documentType: ConcursoDocumentType,
    text: string,
    patternData: Partial<ConcursoData>
  ): string {
    const prompts: Record<ConcursoDocumentType, string> = {
      edital_abertura: `Extract detailed information from this PUBLIC CONTEST OPENING NOTICE (Edital de Abertura):

${text}

Pattern-based data already extracted (enhance/correct if needed):
${JSON.stringify(patternData, null, 2)}

Extract and return JSON with:
{
  "orgao": "organization name",
  "editalNumero": "edital number",
  "vagas": {
    "total": number,
    "porCargo": [{"cargo": "position name", "vagas": number, "salario": number, "requisitos": "requirements"}],
    "reservaPCD": number
  },
  "datas": {
    "inscricoesInicio": "DD/MM/YYYY",
    "inscricoesFim": "DD/MM/YYYY",
    "prova": "DD/MM/YYYY"
  },
  "taxas": [{"cargo": "position", "valor": number}],
  "banca": {"nome": "organization", "cnpj": "XX.XXX.XXX/XXXX-XX"},
  "cidades": [{"nome": "city name", "vagas": number}]
}`,

      convocacao: `Extract information from this CANDIDATE CONVOCATION (Convocação):

${text}

Pattern-based data:
${JSON.stringify(patternData, null, 2)}

Extract and return JSON with:
{
  "orgao": "organization",
  "editalNumero": "related edital number",
  "vagas": {"porCargo": [{"cargo": "position", "vagas": number}]},
  "datas": {"apresentacao": "DD/MM/YYYY"},
  "observacoes": ["important notes"]
}`,

      homologacao: `Extract information from this RESULT HOMOLOGATION (Homologação):

${text}

Pattern-based data:
${JSON.stringify(patternData, null, 2)}

Extract and return JSON with:
{
  "orgao": "organization",
  "editalNumero": "edital number",
  "vagas": {"total": number, "porCargo": [{"cargo": "position", "vagas": number}]},
  "status": "homologated/approved"
}`,

      edital_retificacao: `Extract changes from this EDITAL CORRECTION (Retificação):

${text}

Pattern-based data:
${JSON.stringify(patternData, null, 2)}

Extract and return JSON with what was changed:
{
  "orgao": "organization",
  "editalNumero": "edital being corrected",
  "observacoes": ["list of changes"]
}`,

      prorrogacao: `Extract information from this DEADLINE EXTENSION (Prorrogação):

${text}

Extract and return JSON:
{
  "orgao": "organization",
  "editalNumero": "edital number",
  "datas": {"inscricoesInicio": "DD/MM/YYYY", "inscricoesFim": "DD/MM/YYYY", "prova": "DD/MM/YYYY"},
  "observacoes": ["what was extended"]
}`,

      cancelamento: `Extract information from this CANCELLATION (Cancelamento):

${text}

Extract and return JSON:
{
  "orgao": "organization",
  "editalNumero": "edital number",
  "status": "cancelled/suspended",
  "observacoes": ["reason for cancellation"]
}`,

      resultado_parcial: `Extract information from this PARTIAL RESULT:

${text}

Extract and return JSON:
{
  "orgao": "organization",
  "editalNumero": "edital number",
  "status": "partial result phase",
  "observacoes": ["which phase/stage"]
}`,

      gabarito: `Extract information from this ANSWER KEY (Gabarito):

${text}

Extract and return JSON:
{
  "orgao": "organization",
  "editalNumero": "edital number",
  "observacoes": ["preliminary/final answer key"]
}`,

      nao_classificado: `Extract any available information from this UNCLASSIFIED concurso document:

${text}

Extract and return JSON with any identifiable fields:
{
  "orgao": "organization if found",
  "editalNumero": "edital number if found",
  "observacoes": ["any relevant information"]
}`,
    };

    return prompts[documentType];
  }

  /**
   * Merge pattern-based and AI-extracted data
   */
  private mergeExtractedData(
    patternData: Partial<ConcursoData>,
    aiData: Partial<ConcursoData>
  ): Partial<ConcursoData> {
    // AI data takes precedence, but we keep pattern data as fallback
    return {
      ...patternData,
      ...aiData,
      // Merge nested objects carefully
      vagas: aiData.vagas || patternData.vagas,
      datas: { ...patternData.datas, ...aiData.datas },
      banca: { ...patternData.banca, ...aiData.banca },
      cidades: aiData.cidades || patternData.cidades,
      observacoes: [
        ...(patternData.observacoes || []),
        ...(aiData.observacoes || []),
      ],
    };
  }

  /**
   * Extract relevant context around concurso information
   */
  private extractRelevantContext(text: string, documentType: ConcursoDocumentType): string {
    // For AI extraction, we want the most relevant part of the document
    // Limit to ~3000 characters to save on API costs
    
    const maxLength = 3000;
    
    if (text.length <= maxLength) {
      return text;
    }

    // Find the most relevant section based on document type
    const keywords: Record<ConcursoDocumentType, string[]> = {
      edital_abertura: ['edital', 'vagas', 'inscrições', 'cargo'],
      convocacao: ['convocação', 'aprovados', 'apresentação'],
      homologacao: ['homologação', 'resultado final', 'classificação'],
      edital_retificacao: ['retificação', 'alteração', 'onde se lê'],
      prorrogacao: ['prorrogação', 'prazo', 'data'],
      cancelamento: ['cancelamento', 'suspensão'],
      resultado_parcial: ['resultado', 'classificação', 'aprovados'],
      gabarito: ['gabarito', 'resposta'],
      nao_classificado: ['concurso', 'edital'],
    };

    const relevantKeywords = keywords[documentType];
    
    // Find section with most keyword matches
    const chunkSize = maxLength;
    let bestChunk = text.substring(0, chunkSize);
    let bestScore = 0;

    for (let i = 0; i < text.length - chunkSize; i += chunkSize / 2) {
      const chunk = text.substring(i, i + chunkSize);
      const lowerChunk = chunk.toLowerCase();
      
      const score = relevantKeywords.reduce((acc, kw) => {
        return acc + (lowerChunk.includes(kw.toLowerCase()) ? 1 : 0);
      }, 0);

      if (score > bestScore) {
        bestScore = score;
        bestChunk = chunk;
      }
    }

    return bestChunk;
  }

  /**
   * Parse money value from string
   */
  private parseMoneyValue(value: string): number {
    // Remove dots (thousand separators) and replace comma with dot (decimal)
    const normalized = value.replace(/\./g, '').replace(',', '.');
    return parseFloat(normalized);
  }

  /**
   * Get metadata about concurso findings
   */
  protected getMetadata(findings: Finding[]): Record<string, any> {
    const documentTypes: Record<string, number> = {};
    let hasAIExtraction = false;

    for (const finding of findings) {
      if (finding.data.documentType) {
        documentTypes[finding.data.documentType] = (documentTypes[finding.data.documentType] || 0) + 1;
      }
      if (finding.data.extractionMethod === 'ai' || finding.data.extractionMethod === 'hybrid') {
        hasAIExtraction = true;
      }
    }

    return {
      ...super.getMetadata(findings),
      documentTypes,
      hasAIExtraction,
      uniqueDocumentTypes: Object.keys(documentTypes),
    };
  }
}
