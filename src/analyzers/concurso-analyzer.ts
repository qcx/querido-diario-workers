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

    // Get the pattern for detailed logging
    const detectedPattern = CONCURSO_PATTERNS.find(p => p.documentType === documentTypeResult.type);
    const tieredScore = detectedPattern ? this.calculateTieredKeywordScore(text, detectedPattern) : null;
    const conflicts = detectedPattern ? this.detectConflicts(text, detectedPattern) : null;
    
    logger.info('✓ Detected concurso document', {
      documentType: documentTypeResult.type,
      confidence: documentTypeResult.confidence.toFixed(3),
      details: {
        strongKeywords: tieredScore?.strongCount || 0,
        moderateKeywords: tieredScore?.moderateCount || 0,
        weakKeywords: tieredScore?.weakCount || 0,
        conflictingStages: conflicts?.conflictCount || 0,
        matchedKeywords: tieredScore?.matchedKeywords.slice(0, 5).map(m => ({
          keyword: m.keyword,
          tier: m.tier,
        })) || [],
        conflicts: conflicts?.conflictingKeywords.slice(0, 3) || [],
      },
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
      edital_retificacao: 'concurso_publico_retificacao',
      homologacao: 'concurso_publico_homologacao',
      prorrogacao: 'concurso_publico_prorrogacao',
      cancelamento: 'concurso_publico_cancelamento',
      resultado_parcial: 'concurso_publico_resultado',
      gabarito: 'concurso_publico_resultado',
      nao_classificado: 'concurso_publico',
    };

    // Extract context - ensure it's never empty
    const context = this.extractRelevantContext(text, documentTypeResult.type);
    if (!context || context.trim().length === 0) {
      logger.warn('Empty context extracted for concurso finding', {
        documentType: documentTypeResult.type,
        textLength: text.length,
      });
    }

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
        context || text.substring(0, 3000) // Fallback to first 3000 chars if context is empty
      )
    );

    return findings;
  }

  /**
   * Detect if a keyword appears in an active, historical, or reference context
   */
  private detectContextType(
    text: string,
    keyword: string,
    position: number
  ): 'active' | 'historical' | 'reference' {
    // Extract context window around the keyword (100 chars before and after)
    const contextStart = Math.max(0, position - 100);
    const contextEnd = Math.min(text.length, position + keyword.length + 100);
    const context = text.substring(contextStart, contextEnd).toLowerCase();
    
    // Check for table/list indicators (historical reference)
    const tableIndicators = [
      /\|\s*\w+\s*\|/, // Pipe-separated tables
      /---\s*---/, // Markdown table separators
      // Removed: /\d+[ªº°]\s+\w+/ - ordinals are common in active headings (e.g. "1ª Convocação")
      /edital.*\d{2,4}.*cargo/i, // Typical table headers
      /n[°º]\s*\d+.*data.*homologa[çc][ãa]o/i, // Reference tables
    ];
    
    for (const indicator of tableIndicators) {
      if (indicator.test(context)) {
        return 'historical';
      }
    }
    
    // Check for active action verbs near the keyword
    const activeVerbs = [
      /(?:torna|tornar)\s+p[uú]blic[oa]/i,
      /(?:prorroga|prorrogar)/i,
      /(?:retifica|retificar)/i,
      /(?:convoca|convocar)/i,
      /(?:homologa|homologar)/i,
      /(?:cancela|cancelar)/i,
      /(?:suspende|suspender)/i,
      /fica(?:m)?\s+\w+/i, // "fica prorrogado", "ficam convocados"
    ];
    
    const keywordPos = context.indexOf(keyword.toLowerCase());
    const beforeKeyword = context.substring(Math.max(0, keywordPos - 50), keywordPos);
    const afterKeyword = context.substring(keywordPos, Math.min(context.length, keywordPos + 50));
    
    for (const verb of activeVerbs) {
      if (verb.test(beforeKeyword) || verb.test(afterKeyword)) {
        return 'active';
      }
    }
    
    // Check for passive/reference indicators
    const referenceIndicators = [
      /conforme\s+(?:edital|publicado)/i,
      /referente\s+ao/i,
      /de\s+acordo\s+com/i,
      /nos\s+termos\s+do/i,
      /previsto\s+no/i,
    ];
    
    for (const indicator of referenceIndicators) {
      if (indicator.test(context)) {
        return 'reference';
      }
    }
    
    // Default to active if no clear indicators
    return 'active';
  }
  
  /**
   * Calculate tiered keyword score
   */
  private calculateTieredKeywordScore(
    text: string,
    pattern: any
  ): {
    score: number;
    strongCount: number;
    moderateCount: number;
    weakCount: number;
    matchedKeywords: Array<{ keyword: string; tier: string; context: string }>;
  } {
    const matchedKeywords: Array<{ keyword: string; tier: string; context: string }> = [];
    let strongCount = 0;
    let moderateCount = 0;
    let weakCount = 0;
    
    // Check strong keywords (weight: 1.0)
    for (const keyword of pattern.strongKeywords || []) {
      const lowerText = text.toLowerCase();
      const lowerKeyword = keyword.toLowerCase();
      let lastIndex = 0;
      
      while (true) {
        const index = lowerText.indexOf(lowerKeyword, lastIndex);
        if (index === -1) break;
        
        const contextType = this.detectContextType(text, keyword, index);
        
        // Only count active contexts for strong keywords
        if (contextType === 'active') {
          strongCount++;
          const contextStart = Math.max(0, index - 50);
          const contextEnd = Math.min(text.length, index + keyword.length + 50);
          matchedKeywords.push({
            keyword,
            tier: 'strong',
            context: text.substring(contextStart, contextEnd),
          });
          break; // Count each unique keyword only once
        }
        
        lastIndex = index + keyword.length;
      }
    }
    
    // Check moderate keywords (weight: 0.6)
    for (const keyword of pattern.moderateKeywords || []) {
      const lowerText = text.toLowerCase();
      const lowerKeyword = keyword.toLowerCase();
      
      if (lowerText.includes(lowerKeyword)) {
        moderateCount++;
        const index = lowerText.indexOf(lowerKeyword);
        const contextStart = Math.max(0, index - 50);
        const contextEnd = Math.min(text.length, index + keyword.length + 50);
        matchedKeywords.push({
          keyword,
          tier: 'moderate',
          context: text.substring(contextStart, contextEnd),
        });
      }
    }
    
    // Check weak keywords (weight: 0.3) - only if strong keywords exist
    if (strongCount > 0) {
      for (const keyword of pattern.weakKeywords || []) {
        const lowerText = text.toLowerCase();
        const lowerKeyword = keyword.toLowerCase();
        
        if (lowerText.includes(lowerKeyword)) {
          weakCount++;
          const index = lowerText.indexOf(lowerKeyword);
          const contextStart = Math.max(0, index - 50);
          const contextEnd = Math.min(text.length, index + keyword.length + 50);
          matchedKeywords.push({
            keyword,
            tier: 'weak',
            context: text.substring(contextStart, contextEnd),
          });
        }
      }
    }
    
    // Calculate weighted score
    const score = (strongCount * 1.0) + (moderateCount * 0.6) + (weakCount * 0.3);
    
    return { score, strongCount, moderateCount, weakCount, matchedKeywords };
  }
  
  /**
   * Detect conflicts with other document types
   */
  private detectConflicts(
    text: string,
    currentPattern: any
  ): {
    hasConflict: boolean;
    conflictCount: number;
    conflictingKeywords: Array<{ keyword: string; stage: string }>;
    conflictPenalty: number;
  } {
    const conflictingKeywords: Array<{ keyword: string; stage: string }> = [];
    let conflictCount = 0;
    
    // Check for conflict keywords from the current pattern
    if (currentPattern.conflictKeywords) {
      for (const keyword of currentPattern.conflictKeywords) {
        const lowerText = text.toLowerCase();
        const lowerKeyword = keyword.toLowerCase();
        
        if (lowerText.includes(lowerKeyword)) {
          // Find which stage this keyword belongs to
          let belongsToStage = 'unknown';
          for (const otherPattern of CONCURSO_PATTERNS) {
            if (otherPattern.documentType === currentPattern.documentType) continue;
            
            const allKeywords = [
              ...(otherPattern.strongKeywords || []),
              ...(otherPattern.moderateKeywords || []),
            ].map(k => k.toLowerCase());
            
            if (allKeywords.includes(lowerKeyword)) {
              belongsToStage = otherPattern.documentType;
              break;
            }
          }
          
          conflictingKeywords.push({ keyword, stage: belongsToStage });
          conflictCount++;
        }
      }
    }
    
    // Also check if strong keywords from OTHER patterns are present
    for (const otherPattern of CONCURSO_PATTERNS) {
      if (otherPattern.documentType === currentPattern.documentType) continue;
      
      for (const strongKeyword of otherPattern.strongKeywords || []) {
        const lowerText = text.toLowerCase();
        const lowerKeyword = strongKeyword.toLowerCase();
        let lastIndex = 0;
        
        while (true) {
          const index = lowerText.indexOf(lowerKeyword, lastIndex);
          if (index === -1) break;
          
          const contextType = this.detectContextType(text, strongKeyword, index);
          
          // Only count active contexts as conflicts
          if (contextType === 'active') {
            conflictingKeywords.push({ 
              keyword: strongKeyword, 
              stage: otherPattern.documentType 
            });
            conflictCount++;
            break; // Count each unique keyword once
          }
          
          lastIndex = index + strongKeyword.length;
        }
      }
    }
    
    // Calculate conflict penalty
    // More conflicts = higher penalty
    let conflictPenalty = 1.0;
    if (conflictCount > 0) {
      conflictPenalty = Math.max(0.4, 1.0 - (conflictCount * 0.15));
    }
    
    return {
      hasConflict: conflictCount > 0,
      conflictCount,
      conflictingKeywords,
      conflictPenalty,
    };
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
      let proximityBonus = 1.0;
      let contextBonus = 1.0;

      // Check regex patterns
      for (const regex of pattern.patterns) {
        if (regex.test(text)) {
          patternMatches++;
        }
      }

      // Check exclude patterns - HARD EXCLUSION
      let hasExclusion = false;
      if (pattern.excludePatterns) {
        for (const excludeRegex of pattern.excludePatterns) {
          if (excludeRegex.test(text)) {
            hasExclusion = true;
            break;
          }
        }
      }
      
      // If excluded, skip this pattern entirely (conservative approach)
      if (hasExclusion) {
        continue;
      }

      // Calculate tiered keyword scores
      const tieredScore = this.calculateTieredKeywordScore(text, pattern);
      
      // Check minimum strong keywords requirement
      if (pattern.minStrongKeywords && tieredScore.strongCount < pattern.minStrongKeywords) {
        continue; // Skip if minimum strong keywords not met
      }
      
      // Detect conflicts with other stages
      const conflicts = this.detectConflicts(text, pattern);

      // Collect all keywords for proximity analysis
      const allKeywords = [
        ...(pattern.strongKeywords || []),
        ...(pattern.moderateKeywords || []),
        ...(pattern.weakKeywords || []),
      ];

      // Apply proximity analysis if required
      if (pattern.proximity && tieredScore.matchedKeywords.length > 1) {
        const keywordPositions = ProximityAnalyzer.findKeywordPositions(
          text,
          allKeywords,
          false
        );
        
        if (keywordPositions.length > 1) {
          const bestGroup = ProximityAnalyzer.findBestKeywordGroup(
            keywordPositions,
            allKeywords,
            pattern.proximity.maxDistance
          );

          if (bestGroup) {
            // Check if minimum keywords are together
            const uniqueInGroup = new Set(bestGroup.keywords.map(p => p.keyword.toLowerCase())).size;
            if (uniqueInGroup >= (pattern.minKeywordsTogether || 2)) {
              proximityBonus = Math.min(bestGroup.averageProximity * 1.3, 1.5); // Boost for good proximity
            } else if (pattern.proximity.required) {
              // Required proximity not met
              proximityBonus = 0.5; // Penalty
            }
          } else if (pattern.proximity.required) {
            // No valid group found and proximity is required
            continue; // Skip this pattern
          }
        }
      }

      // Check for keywords in titles/headers for context bonus
      for (const title of structure.titles) {
        const titleKeywords = [
          ...(pattern.strongKeywords || []),
          ...(pattern.moderateKeywords || []),
        ];
        if (titleKeywords.some(kw => title.text.toLowerCase().includes(kw.toLowerCase()))) {
          contextBonus = 1.25; // Title match bonus
          break;
        }
      }

      // Calculate confidence with all factors
      const hasSignificantMatch = patternMatches > 0 || tieredScore.strongCount > 0 || 
                                   (tieredScore.moderateCount > 0 && tieredScore.score >= 1.0);
      
      if (hasSignificantMatch) {
        // New confidence calculation using tiered scores
        const patternScore = patternMatches / Math.max(pattern.patterns.length, 1);
        const keywordScore = Math.min(tieredScore.score / 2.0, 1.0); // Normalize
        
        // Weight: 60% keywords, 40% patterns (keywords more important now)
        const baseConfidence = (keywordScore * 0.6 + patternScore * 0.4) * pattern.weight;
        
        // Apply bonuses and penalties
        let adjustedConfidence = baseConfidence * proximityBonus * contextBonus * conflicts.conflictPenalty;
        
        // Cap confidence
        adjustedConfidence = Math.min(adjustedConfidence, 0.98);
        
        // Conservative threshold: require higher confidence when conflicts exist
        const minConfidence = conflicts.hasConflict ? 0.65 : 0.50;
        
        if (adjustedConfidence < minConfidence) {
          continue; // Skip low confidence matches
        }

        // Detailed logging for debugging
        logger.debug('Pattern evaluation', {
          documentType: pattern.documentType,
          patternMatches,
          tieredScore: {
            strong: tieredScore.strongCount,
            moderate: tieredScore.moderateCount,
            weak: tieredScore.weakCount,
            totalScore: tieredScore.score,
          },
          conflicts: {
            count: conflicts.conflictCount,
            penalty: conflicts.conflictPenalty,
            keywords: conflicts.conflictingKeywords.slice(0, 3), // First 3
          },
          bonuses: {
            proximity: proximityBonus,
            context: contextBonus,
          },
          confidence: adjustedConfidence,
        });

        // High-priority patterns with strong matches and no/low conflicts can short-circuit
        if (pattern.priority === 'primary' && 
            adjustedConfidence >= 0.85 && 
            conflicts.conflictCount <= 1 &&
            tieredScore.strongCount > 0) {
          logger.info('High confidence match found (short-circuit)', {
            documentType: pattern.documentType,
            confidence: adjustedConfidence,
            strongKeywords: tieredScore.strongCount,
            conflicts: conflicts.conflictCount,
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
        totalCandidates: results.length,
        topCandidates: results.slice(0, 3).map(r => ({
          type: r.type,
          confidence: r.confidence.toFixed(3),
        })),
      });
      return results[0];
    }
    
    // Log when no classification could be made
    if (results.length > 0) {
      logger.info('Document type detection failed - confidence too low', {
        topCandidate: results[0].type,
        confidence: results[0].confidence,
        threshold: 0.5,
      });
    } else {
      logger.info('Document type detection failed - no matches found');
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

    // Extract multiple cargos from table-like structures
    if (['edital_abertura', 'convocacao', 'homologacao'].includes(documentType)) {
      const cargos = this.extractCargosFromTable(text);
      if (cargos.length > 0) {
        // Merge with existing vagas data
        if (!data.vagas) {
          data.vagas = {};
        }
        data.vagas.porCargo = cargos;
        
        // Calculate total if not already present
        if (!data.vagas.total && cargos.length > 0) {
          data.vagas.total = cargos.reduce((sum, cargo) => sum + (cargo.vagas || 0), 0);
        }
      }
    }

    return data;
  }

  /**
   * Extract multiple cargos from table-like structures in text
   */
  private extractCargosFromTable(text: string): Array<{
    cargo: string;
    vagas: number;
    salario?: number;
    requisitos?: string;
    jornada?: string;
    escolaridade?: string;
    beneficios?: string[];
  }> {
    const cargos: any[] = [];
    
    // Try table patterns
    for (const pattern of EXTRACTION_PATTERNS.cargoTable) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const cargo = {
          cargo: match[1].trim(),
          vagas: parseInt(match[2], 10),
          salario: this.parseMoneyValue(match[3]),
        };
        
        // Look for additional info near this cargo mention
        const contextStart = Math.max(0, match.index - 200);
        const contextEnd = Math.min(text.length, match.index + match[0].length + 200);
        const context = text.substring(contextStart, contextEnd);
        
        // Try to extract requisitos
        for (const reqPattern of EXTRACTION_PATTERNS.requisitos) {
          const reqMatch = context.match(reqPattern);
          if (reqMatch) {
            cargo.requisitos = reqMatch[1].trim();
            break;
          }
        }
        
        // Try to extract escolaridade
        for (const escPattern of EXTRACTION_PATTERNS.escolaridade) {
          const escMatch = context.match(escPattern);
          if (escMatch) {
            cargo.escolaridade = escMatch[1].trim();
            break;
          }
        }
        
        // Try to extract jornada
        for (const jornadaPattern of EXTRACTION_PATTERNS.jornada) {
          const jornadaMatch = context.match(jornadaPattern);
          if (jornadaMatch) {
            cargo.jornada = jornadaMatch[1].trim();
            break;
          }
        }
        
        // Try to extract beneficios
        const beneficios: string[] = [];
        for (const beneficioPattern of EXTRACTION_PATTERNS.beneficios) {
          const beneficioMatch = context.match(beneficioPattern);
          if (beneficioMatch) {
            beneficios.push(beneficioMatch[0]);
          }
        }
        if (beneficios.length > 0) {
          cargo.beneficios = beneficios;
        }
        
        cargos.push(cargo);
      }
    }
    
    // Remove duplicates (same cargo name)
    const uniqueCargos = cargos.reduce((acc, cargo) => {
      const existing = acc.find((c: any) => c.cargo === cargo.cargo);
      if (!existing) {
        acc.push(cargo);
      }
      return acc;
    }, []);
    
    return uniqueCargos;
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
    // Ensure text is not empty
    if (!text || text.trim().length === 0) {
      logger.warn('extractRelevantContext called with empty text', {
        documentType,
      });
      return '';
    }

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
    
    // Safety check: if keywords not found for type, use generic keywords
    if (!relevantKeywords || relevantKeywords.length === 0) {
      logger.warn('No keywords defined for document type, using generic keywords', {
        documentType,
      });
      // Return first chunk as fallback
      return text.substring(0, maxLength);
    }
    
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

    // Final safety check
    if (!bestChunk || bestChunk.trim().length === 0) {
      logger.warn('Best chunk is empty, falling back to first chunk', {
        documentType,
        textLength: text.length,
      });
      return text.substring(0, maxLength);
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

  /**
   * Analyze a specific text section (for use by ConcursoValidator)
   * This is a public method that can be called to analyze validated ambiguous sections
   */
  public async analyzeTextSection(text: string, validatorContext?: {
    keyword: string;
    validationReason: string;
    validationConfidence: number;
  }): Promise<Finding | null> {
    logger.info('Analyzing validated text section', {
      textLength: text.length,
      keyword: validatorContext?.keyword,
    });

    // Step 1: Detect document type from the section
    const documentTypeResult = this.detectDocumentType(text);
    
    if (!documentTypeResult) {
      logger.debug('Could not classify concurso document type from validated section');
      return null;
    }

    logger.info('Detected concurso document from validated section', {
      documentType: documentTypeResult.type,
      confidence: documentTypeResult.confidence,
      keyword: validatorContext?.keyword,
    });

    // Step 2: Extract structured data using patterns
    const patternData = this.extractDataWithPatterns(text, documentTypeResult.type);

    // Step 3: If AI extraction is enabled, enhance with AI
    let finalData = patternData;
    let extractionMethod: 'pattern' | 'ai' | 'hybrid' = 'pattern';

    if (this.useAIExtraction && this.apiKey && documentTypeResult.confidence >= 0.6) {
      logger.info('Using AI to extract structured data from validated section', {
        documentType: documentTypeResult.type,
      });

      try {
        const aiData = await this.extractDataWithAI(text, documentTypeResult.type, patternData);
        if (aiData) {
          finalData = this.mergeExtractedData(patternData, aiData);
          extractionMethod = 'hybrid';
        }
      } catch (error) {
        logger.error('AI extraction failed for validated section, using pattern-based data only', error as Error);
      }
    }

    // Step 4: Create concurso data
    const concursoData: ConcursoData = {
      documentType: documentTypeResult.type,
      documentTypeConfidence: documentTypeResult.confidence,
      ...finalData,
    };

    // Map document type to webhook category
    const categoryMap: Record<ConcursoDocumentType, string> = {
      convocacao: 'concurso_publico_convocacao',
      edital_abertura: 'concurso_publico_abertura',
      edital_retificacao: 'concurso_publico_retificacao',
      homologacao: 'concurso_publico_homologacao',
      prorrogacao: 'concurso_publico_prorrogacao',
      cancelamento: 'concurso_publico_cancelamento',
      resultado_parcial: 'concurso_publico_resultado',
      gabarito: 'concurso_publico_resultado',
      nao_classificado: 'concurso_publico',
    };

    // Extract context - ensure it's never empty
    const context = this.extractRelevantContext(text, documentTypeResult.type);
    if (!context || context.trim().length === 0) {
      logger.warn('Empty context extracted for validated concurso finding', {
        documentType: documentTypeResult.type,
        textLength: text.length,
        validatorKeyword: validatorContext?.keyword,
      });
    }

    // Create finding with type 'concurso' so it gets stored in the database
    const finding = this.createFinding(
      'concurso',
      {
        category: categoryMap[documentTypeResult.type] || 'concurso_publico',
        concursoData,
        extractionMethod: extractionMethod + '_from_validated' as any,
        documentType: documentTypeResult.type,
        // Add validator context for traceability
        validatedBy: 'concurso-validator',
        validatorKeyword: validatorContext?.keyword,
        validationReason: validatorContext?.validationReason,
        validationConfidence: validatorContext?.validationConfidence,
      },
      documentTypeResult.confidence,
      context || text.substring(0, 3000) // Fallback to first 3000 chars if context is empty
    );

    logger.info('Created concurso finding from validated section', {
      documentType: documentTypeResult.type,
      confidence: finding.confidence,
      orgao: concursoData.orgao,
      totalVagas: concursoData.vagas?.total,
    });

    return finding;
  }
}

