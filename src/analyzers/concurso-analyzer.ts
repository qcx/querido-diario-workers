/**
 * Concurso Analyzer - Specialized analyzer for public contest documents
 * Focuses on detecting document types and extracting structured data
 * 
 * Note: Runs AFTER ConcursoValidator (priority 2 vs 1.5)
 * ConcursoValidator handles keyword detection and validation
 * This analyzer focuses purely on data extraction
 */

import { BaseAnalyzer } from './base-analyzer';
import { OcrResult, Finding, AnalyzerConfig, ConcursoData, ConcursoDocumentType } from '../types';
import { 
  CONCURSO_PATTERNS, 
  EXTRACTION_PATTERNS, 
  TITLE_PATTERNS
} from './patterns/concurso-patterns';
import { ProximityAnalyzer } from './utils/proximity-analyzer';
import { logger } from '../utils';
import { CostTracker } from '../services/cost-tracker';
import { parseBrazilianDate } from '../utils/date-utils';

export interface ConcursoAnalyzerConfig extends AnalyzerConfig {
  useAIExtraction?: boolean;
  apiKey: string; // Now required for AI validation
  model?: string;
}

interface SegmentInfo {
  text: string;
  title: string;
  startPosition: number;
  endPosition: number;
  keywords: Array<{keyword: string; type: 'certain' | 'ambiguous'}>;
  hasCertainKeywords: boolean;
  hasAmbiguousKeywords: boolean;
}

interface KeywordOccurrence {
  keyword: string;
  type: 'certain' | 'ambiguous';
  position: number;
  context: string;
}

interface ValidationResult {
  isValid: boolean;
  confidence: number;
  reason: string;
  usage?: any;
}

export class ConcursoAnalyzer extends BaseAnalyzer {
  private useAIExtraction: boolean;
  private apiKey: string;
  private model: string;
  private validationCache: Map<string, ValidationResult>;

  constructor(config: ConcursoAnalyzerConfig) {
    super('concurso-analyzer', 'concurso', config);
    
    this.useAIExtraction = config.useAIExtraction ?? false;
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4o-mini';
    this.validationCache = new Map();
  }

  /**
   * Main analysis flow: keyword detection → hybrid segmentation → validation → classification
   */
  protected async performAnalysis(ocrResult: OcrResult): Promise<Finding[]> {
    const text = ocrResult.extractedText || '';
    const findings: Finding[] = [];
    const startTime = Date.now();
    const MAX_PROCESSING_TIME = 150000; // 150 seconds (leave 30s buffer before 180s timeout)

    logger.info('ConcursoAnalyzer: Starting unified analysis flow');

    // Step 1: Find all keywords (certain + ambiguous)
    const keywords = this.findAllKeywordOccurrences(text);
    
    if (keywords.length === 0) {
      logger.debug('No concurso keywords found in document');
      return findings;
    }

    logger.info(`Found ${keywords.length} keyword occurrences`, {
      certain: keywords.filter(k => k.type === 'certain').length,
      ambiguous: keywords.filter(k => k.type === 'ambiguous').length,
    });

    // Step 2: Hybrid segmentation using structural boundaries AND keyword positions
    const segments = this.hybridSegmentation(text, keywords);
    
    logger.info(`Created ${segments.length} segments with concurso keywords`, {
      segmentsWithCertain: segments.filter(s => s.hasCertainKeywords).length,
      segmentsWithAmbiguous: segments.filter(s => s.hasAmbiguousKeywords).length,
    });

    // Step 3: Process each segment with timeout protection
    let processedSegments = 0;
    for (const segment of segments) {
      // Check if approaching timeout
      const elapsedMs = Date.now() - startTime;
      if (elapsedMs > MAX_PROCESSING_TIME) {
        logger.warn('Approaching timeout, returning partial results', {
          processedSegments,
          totalSegments: segments.length,
          elapsedMs,
          findingsCreated: findings.length,
        });
        break;
      }
      try {
        // Path A: Certain keywords → direct classification (takes priority)
        if (segment.hasCertainKeywords) {
          const finding = await this.processSegmentWithCertainKeywords(segment);
          if (finding) {
            findings.push(finding);
          }
          // Skip ambiguous processing if certain keywords found
          continue;
        }
        
        // Path B: Ambiguous keywords → AI validation first (only if no certain keywords)
        if (segment.hasAmbiguousKeywords) {
          const validatedFindings = await this.processSegmentWithAmbiguousKeywords(segment);
          findings.push(...validatedFindings);
        }
      } catch (error) {
        logger.error('Failed to process segment', error as Error, {
          segmentTitle: segment.title,
        });
      }
      
      processedSegments++;
    }

    const elapsedMs = Date.now() - startTime;
    logger.info(`Analysis complete: ${findings.length} findings created`, {
      processedSegments,
      totalSegments: segments.length,
      elapsedMs,
      timedOut: processedSegments < segments.length,
    });
    return findings;
  }

  /**
   * Find all keyword occurrences (certain + ambiguous) in text
   */
  private findAllKeywordOccurrences(text: string): KeywordOccurrence[] {
    const occurrences: KeywordOccurrence[] = [];
    
    // Keep certain keywords restrictive - only explicit "concurso público" mentions
    const certainKeywords = ['concurso público', 'concurso publico', 'concursos públicos', 'concursos publicos'];
    const ambiguousKeywords = [
      'processo seletivo simplificado',
      'seleção pública',
      'seleção simplificada',
      'processo seletivo',
      'processo de escolha',
      'processo de seleção',
      'concurso', // Check last (after compound phrases)
    ];
    
    const lowerText = text.toLowerCase();
    
    // Find certain keywords
    for (const keyword of certainKeywords) {
      let lastIndex = 0;
      while (true) {
        const index = lowerText.indexOf(keyword, lastIndex);
        if (index === -1) break;
        
        // Extract context (500 chars before and after)
        const contextStart = Math.max(0, index - 500);
        const contextEnd = Math.min(text.length, index + keyword.length + 500);
        const context = text.substring(contextStart, contextEnd);
        
        occurrences.push({
          keyword,
          type: 'certain',
          position: index,
          context,
        });
        
        lastIndex = index + keyword.length;
      }
    }
    
    // Find ambiguous keywords (but skip if already found as certain)
    for (const keyword of ambiguousKeywords) {
      let lastIndex = 0;
      while (true) {
        const index = lowerText.indexOf(keyword, lastIndex);
        if (index === -1) break;
        
        // Check if this position overlaps with a certain keyword
        const overlapsCertain = occurrences.some(
          occ => occ.type === 'certain' && 
          Math.abs(occ.position - index) < 50
        );
        
        if (!overlapsCertain) {
          const contextStart = Math.max(0, index - 500);
          const contextEnd = Math.min(text.length, index + keyword.length + 500);
          const context = text.substring(contextStart, contextEnd);
          
          occurrences.push({
            keyword,
            type: 'ambiguous',
            position: index,
            context,
          });
        }
        
        lastIndex = index + keyword.length;
      }
    }
    
    // Sort by position
    occurrences.sort((a, b) => a.position - b.position);
    
    return occurrences;
  }

  /**
   * Hybrid segmentation: Use structural boundaries AND keyword positions
   * Enhanced to prioritize concurso-specific sections
   */
  private hybridSegmentation(
    text: string,
    keywordOccurrences: KeywordOccurrence[]
  ): SegmentInfo[] {
    const segments: SegmentInfo[] = [];
    
    // Step 1: Find structural boundaries with priority for concurso headers
    const structure = ProximityAnalyzer.extractDocumentStructure(text);
    const documentBoundaries: Array<{ position: number; title: string; isConcursoHeader: boolean; priority: number }> = [];
    
    // Enhanced patterns for document headers with concurso priority
    const concursoHeaderPatterns = [
      // High priority - specific concurso headers
      /(?:^|\n)\s*(?:#\s*)?(?:EDITAL\s+DE\s+(?:CONVOCA[ÇC][ÃA]O|ABERTURA|HOMOLOGA[ÇC][ÃA]O|RETIFICA[ÇC][ÃA]O))[^\n]*(?:\n|$)/gi,
      /(?:^|\n)\s*(?:#\s*)?(?:CONVOCA[ÇC][ÃA]O)[^\n]*(?:CONCURSO|P[ÚU]BLICO)[^\n]*(?:\n|$)/gi,
      /(?:^|\n)\s*(?:#\s*)?(?:[\d]+[ªº]?\s*CONVOCA[ÇC][ÃA]O)[^\n]*(?:\n|$)/gi,
    ];
    
    // Medium priority - general document headers that might contain concurso content
    const generalHeaderPattern = /(?:^|\n)\s*(?:#\s*)?(?:DECRETO|PORTARIA|EDITAL|RESOLUÇÃO|RESOLUCAO|LEI|COMUNICADO)\s+N?[°º]?\s*[\d.,/-]+[^\n]*(?:\n|$)/gi;
    
    // First, find high-priority concurso headers
    for (const pattern of concursoHeaderPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        if (match.index !== undefined) {
          documentBoundaries.push({
            position: match.index,
            title: match[0].trim(),
            isConcursoHeader: true,
            priority: 1
          });
        }
      }
    }
    
    // Then find general headers
    let match: RegExpExecArray | null;
    while ((match = generalHeaderPattern.exec(text)) !== null) {
      if (match.index !== undefined) {
        // Check if this overlaps with an existing concurso header
        const existing = documentBoundaries.find(b => Math.abs(b.position - match!.index!) < 50);
        if (!existing) {
          documentBoundaries.push({
            position: match.index,
            title: match[0].trim(),
            isConcursoHeader: false,
            priority: 2
          });
        }
      }
    }
    
    // Also check for titles from structure analysis with concurso priority
    for (const title of structure.titles) {
      const isConcursoTitle = /(?:EDITAL\s+DE\s+(?:CONVOCA[ÇC][ÃA]O|ABERTURA|HOMOLOGA[ÇC][ÃA]O)|CONVOCA[ÇC][ÃA]O.*(?:CONCURSO|P[ÚU]BLICO|PROCESSO\s+(?:DE\s+ESCOLHA|SELETIVO(?:\s+SIMPLIFICADO)?)))/i.test(title.text);
      const isGeneralTitle = /(?:DECRETO|PORTARIA|EDITAL|RESOLUÇÃO|RESOLUCAO|LEI)\s+N?[°º]?\s*[\d.,/-]+/i.test(title.text);
      
      if (isConcursoTitle || isGeneralTitle) {
        const existing = documentBoundaries.find(b => Math.abs(b.position - title.position) < 50);
        if (!existing) {
          documentBoundaries.push({
            position: title.position,
            title: title.text,
            isConcursoHeader: isConcursoTitle,
            priority: isConcursoTitle ? 1 : 2
          });
        }
      }
    }
    
    // Sort boundaries by priority first, then position
    documentBoundaries.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority; // Lower priority number = higher priority
      }
      return a.position - b.position;
    });
    
    logger.debug(`Found ${documentBoundaries.length} structural boundaries`, {
      concursoHeaders: documentBoundaries.filter(b => b.isConcursoHeader).length,
      generalHeaders: documentBoundaries.filter(b => !b.isConcursoHeader).length,
    });
    
    // If no boundaries found, treat whole document as one segment
    if (documentBoundaries.length === 0) {
      // Check if any keywords found
      if (keywordOccurrences.length > 0) {
        const keywords = keywordOccurrences.map(k => ({ keyword: k.keyword, type: k.type }));
        segments.push({
          text,
          title: 'Full Document',
          startPosition: 0,
          endPosition: text.length,
          keywords,
          hasCertainKeywords: keywords.some(k => k.type === 'certain'),
          hasAmbiguousKeywords: keywords.some(k => k.type === 'ambiguous'),
        });
      }
      return segments;
    }
    
    // Re-sort by position for segment creation
    const sortedBoundaries = [...documentBoundaries].sort((a, b) => a.position - b.position);
    
    // Step 2: Create segments based on boundaries with concurso relevance scoring
    for (let i = 0; i < sortedBoundaries.length; i++) {
      const boundary = sortedBoundaries[i];
      const start = boundary.position;
      const end = i + 1 < sortedBoundaries.length 
        ? sortedBoundaries[i + 1].position 
        : text.length;
      
      const segmentText = text.substring(start, end).trim();
      
      // Only include segments that have substantial content (>100 chars)
      if (segmentText.length <= 100) {
        continue;
      }
      
      // Find keywords in this segment
      const segmentKeywords = keywordOccurrences
        .filter(k => k.position >= start && k.position < end)
        .map(k => ({ keyword: k.keyword, type: k.type }));
      
      // Calculate segment relevance score
      const relevanceScore = this.calculateSegmentRelevance(segmentText, boundary, segmentKeywords);
      
      // Include segments with keywords OR high concurso relevance
      if (segmentKeywords.length > 0 || relevanceScore > 0.7) {
        // Check if segment is large (>5000 chars) and keywords are far apart
        if (segmentText.length > 5000 && segmentKeywords.length > 1) {
          // Split further around keyword positions
          const subSegments = this.splitLargeSegment(
            segmentText,
            start,
            keywordOccurrences.filter(k => k.position >= start && k.position < end),
            boundary.title
          );
          segments.push(...subSegments);
        } else {
          segments.push({
            text: segmentText,
            title: boundary.title,
            startPosition: start,
            endPosition: end,
            keywords: segmentKeywords,
            hasCertainKeywords: segmentKeywords.some(k => k.type === 'certain'),
            hasAmbiguousKeywords: segmentKeywords.some(k => k.type === 'ambiguous'),
          });
        }
      }
    }
    
    // Step 3: Handle content before first boundary if it contains keywords
    if (sortedBoundaries.length > 0 && sortedBoundaries[0].position > 500) {
      const preContent = text.substring(0, sortedBoundaries[0].position).trim();
      const preKeywords = keywordOccurrences
        .filter(k => k.position < sortedBoundaries[0].position)
        .map(k => ({ keyword: k.keyword, type: k.type }));
      
      if (preContent.length > 100 && preKeywords.length > 0) {
        segments.unshift({
          text: preContent,
          title: 'Document Header/Preamble',
          startPosition: 0,
          endPosition: sortedBoundaries[0].position,
          keywords: preKeywords,
          hasCertainKeywords: preKeywords.some(k => k.type === 'certain'),
          hasAmbiguousKeywords: preKeywords.some(k => k.type === 'ambiguous'),
        });
      }
    }
    
    // Step 4: Sort segments by concurso relevance (prioritize concurso sections)
    segments.sort((a, b) => {
      const aRelevance = this.calculateSegmentRelevance(a.text, { title: a.title, isConcursoHeader: /(?:EDITAL\s+DE\s+(?:CONVOCA[ÇC][ÃA]O|ABERTURA)|CONVOCA[ÇC][ÃA]O)/i.test(a.title) }, a.keywords);
      const bRelevance = this.calculateSegmentRelevance(b.text, { title: b.title, isConcursoHeader: /(?:EDITAL\s+DE\s+(?:CONVOCA[ÇC][ÃA]O|ABERTURA)|CONVOCA[ÇC][ÃA]O)/i.test(b.title) }, b.keywords);
      
      // Higher relevance first
      if (aRelevance !== bRelevance) {
        return bRelevance - aRelevance;
      }
      
      // Then by position
      return a.startPosition - b.startPosition;
    });
    
    return segments;
  }

  /**
   * Split large segments around keyword positions
   */
  private splitLargeSegment(
    segmentText: string,
    basePosition: number,
    keywordOccurrences: KeywordOccurrence[],
    baseTitle: string
  ): SegmentInfo[] {
    const subSegments: SegmentInfo[] = [];
    
    // Group keywords that are close together (within 3000 chars)
    const keywordGroups: Array<KeywordOccurrence[]> = [];
    let currentGroup: KeywordOccurrence[] = [];
    
    for (let i = 0; i < keywordOccurrences.length; i++) {
      if (currentGroup.length === 0) {
        currentGroup.push(keywordOccurrences[i]);
      } else {
        const lastInGroup = currentGroup[currentGroup.length - 1];
        const distance = keywordOccurrences[i].position - lastInGroup.position;
        
        if (distance <= 3000) {
          currentGroup.push(keywordOccurrences[i]);
        } else {
          keywordGroups.push([...currentGroup]);
          currentGroup = [keywordOccurrences[i]];
        }
      }
    }
    
    if (currentGroup.length > 0) {
      keywordGroups.push(currentGroup);
    }
    
    // Create sub-segments around each group
    for (let i = 0; i < keywordGroups.length; i++) {
      const group = keywordGroups[i];
      const firstKeyword = group[0];
      const lastKeyword = group[group.length - 1];
      
      // Extract context around this group (2000 chars before first, 2000 after last)
      const localStart = Math.max(0, firstKeyword.position - basePosition - 2000);
      const localEnd = Math.min(
        segmentText.length,
        lastKeyword.position - basePosition + lastKeyword.keyword.length + 2000
      );
      
      const subText = segmentText.substring(localStart, localEnd).trim();
      const subKeywords = group.map(k => ({ keyword: k.keyword, type: k.type }));
      
      subSegments.push({
        text: subText,
        title: `${baseTitle} (Part ${i + 1})`,
        startPosition: basePosition + localStart,
        endPosition: basePosition + localEnd,
        keywords: subKeywords,
        hasCertainKeywords: subKeywords.some(k => k.type === 'certain'),
        hasAmbiguousKeywords: subKeywords.some(k => k.type === 'ambiguous'),
      });
    }
    
    return subSegments;
  }

  /**
   * Calculate segment relevance score for concurso content prioritization
   */
  private calculateSegmentRelevance(
    segmentText: string, 
    boundary: { title: string; isConcursoHeader?: boolean }, 
    keywords: Array<{ keyword: string; type: 'certain' | 'ambiguous' }>
  ): number {
    let score = 0;
    
    // Base score from header type
    if (boundary.isConcursoHeader) {
      score += 0.8; // High base score for concurso headers
    }
    
    // Score from title content
    const titleLower = boundary.title.toLowerCase();
    if (/edital\s+de\s+convoca[çc][ãa]o/i.test(titleLower)) {
      score += 0.9;
    } else if (/edital\s+de\s+abertura/i.test(titleLower)) {
      score += 0.9;
    } else if (/convoca[çc][ãa]o/i.test(titleLower)) {
      score += 0.7;
    } else if (/edital.*concurso/i.test(titleLower)) {
      score += 0.6;
    }
    
    // Score from keywords
    const certainKeywords = keywords.filter(k => k.type === 'certain').length;
    const ambiguousKeywords = keywords.filter(k => k.type === 'ambiguous').length;
    
    score += certainKeywords * 0.3; // Each certain keyword adds 0.3
    score += ambiguousKeywords * 0.1; // Each ambiguous keyword adds 0.1
    
    // Score from content analysis
    const textLower = segmentText.toLowerCase();
    
    // Strong concurso indicators
    if (/candidatos?\s+(?:aprovados?|convocados?|classificados?)/i.test(textLower)) {
      score += 0.4;
    }
    if (/inscri[çc][õo]es?\s+(?:abertas?|iniciadas?)/i.test(textLower)) {
      score += 0.4;
    }
    if (/concurso\s+p[úu]blico/i.test(textLower)) {
      score += 0.3;
    }
    if (/edital\s+n[°º]?\s*\d+/i.test(textLower)) {
      score += 0.2;
    }
    
    // Negative indicators (budget, other administrative content)
    if (/or[çc]amento|financeiro|receita|despesa|cr[ée]dito\s+adicional/i.test(textLower)) {
      score -= 0.3;
    }
    
    // Cap the score at 1.0
    return Math.min(score, 1.0);
  }

  /**
   * Process segment with certain keywords (skip AI validation)
   */
  private async processSegmentWithCertainKeywords(segment: SegmentInfo): Promise<Finding | null> {
    logger.info('Processing segment with certain keywords', {
      title: segment.title,
      keywords: segment.keywords.filter(k => k.type === 'certain').map(k => k.keyword),
    });
    
    // 1. Detect document type (existing logic)
    const documentTypeResult = await this.detectDocumentType(segment.text, true, segment.title);
    
    if (!documentTypeResult) {
      logger.warn('Could not classify segment with certain keywords', {
        segmentTitle: segment.title,
      });
      return null;
    }

    // Get the pattern for detailed logging
    const detectedPattern = CONCURSO_PATTERNS.find(p => p.documentType === documentTypeResult.type);
    const tieredScore = detectedPattern ? this.calculateTieredKeywordScore(segment.text, detectedPattern) : null;
    
    logger.info('Detected concurso document type', {
      documentType: documentTypeResult.type,
      confidence: documentTypeResult.confidence.toFixed(3),
      segmentTitle: segment.title,
      strongKeywords: tieredScore?.strongCount || 0,
    });
    
    // 2. Extract structured data (existing logic)
    let data = this.extractDataWithPatterns(segment.text, documentTypeResult.type);
    
    // 3. Optional AI enhancement if configured
    let extractionMethod: 'pattern' | 'ai' | 'hybrid' | 'certain' = 'certain';
    if (this.useAIExtraction && this.apiKey) {
      try {
        const aiData = await this.extractDataWithAI(segment.text, documentTypeResult.type, data);
        if (aiData) {
          data = this.mergeExtractedData(data, aiData);
          extractionMethod = 'hybrid';
        }
      } catch (error) {
        logger.error('AI extraction failed for certain keyword segment', error as Error);
      }
    }
    
    // 4. Create finding
    return this.createConcursoFinding(documentTypeResult, data, segment, extractionMethod);
  }

  /**
   * Process segment with ambiguous keywords (needs AI validation)
   */
  private async processSegmentWithAmbiguousKeywords(segment: SegmentInfo): Promise<Finding[]> {
    const findings: Finding[] = [];
    
    logger.info('Processing segment with ambiguous keywords', {
      title: segment.title,
      keywords: segment.keywords.filter(k => k.type === 'ambiguous').map(k => k.keyword),
    });
    
    // Get unique keywords only to avoid redundant validation
    const uniqueKeywords = new Map<string, typeof segment.keywords[0]>();
    segment.keywords
      .filter(k => k.type === 'ambiguous')
      .forEach(k => {
        const key = k.keyword.toLowerCase();
        if (!uniqueKeywords.has(key)) {
          uniqueKeywords.set(key, k);
        }
      });
    
    logger.debug('Deduplicated ambiguous keywords', {
      original: segment.keywords.filter(k => k.type === 'ambiguous').length,
      unique: uniqueKeywords.size,
    });
    
    // Validate each unique keyword once
    for (const [_, kw] of uniqueKeywords) {
      try {
        const validation = await this.validateAmbiguousKeyword(segment.text, kw.keyword);
        
        // Find keyword position for context
        const keywordIndex = segment.text.toLowerCase().indexOf(kw.keyword.toLowerCase());
        const contextStart = Math.max(0, keywordIndex - 150);
        const contextEnd = Math.min(segment.text.length, keywordIndex + kw.keyword.length + 150);
        const textContext = keywordIndex >= 0 
          ? segment.text.substring(contextStart, contextEnd).replace(/\s+/g, ' ')
          : '';
        
        // Always log validation result for debugging
        logger.info('AI validation result', {
          keyword: kw.keyword,
          isValid: validation.isValid,
          confidence: validation.confidence,
          reason: validation.reason,
          segmentTitle: segment.title,
          textContext,
        });
        
        if (validation.isValid) {          
          // AI confirmed: proceed to classification with proximity flag
          const documentTypeResult = await this.detectDocumentType(
            segment.text, 
            true, 
            segment.title,
            validation.isValid ? kw.keyword : undefined  // Pass validated keyword
          );
          
          if (documentTypeResult) {
            let data = this.extractDataWithPatterns(segment.text, documentTypeResult.type);
            
            // Optional AI enhancement for data extraction
            if (this.useAIExtraction && this.apiKey) {
              try {
                const aiData = await this.extractDataWithAI(segment.text, documentTypeResult.type, data);
                if (aiData) {
                  data = this.mergeExtractedData(data, aiData);
                }
              } catch (error) {
                logger.error('AI extraction failed for validated segment', error as Error);
              }
            }
            
            const finding = this.createConcursoFinding(
              documentTypeResult, 
              data, 
              segment, 
              'ambiguous_validated'
            );
            
            // Add validation metadata
            finding.data.validationResult = validation;
            finding.data.validatedKeyword = kw.keyword;
            
            findings.push(finding);
            
            logger.info('Created finding from validated ambiguous keyword', {
              keyword: kw.keyword,
              documentType: documentTypeResult.type,
              confidence: finding.confidence,
            });
          } else {
            logger.warn('Could not classify document type after AI validation', {
              keyword: kw.keyword,
              segmentTitle: segment.title,
            });
          }
        } else {
          // AI rejected: log only (don't create finding)
          logger.debug('Ambiguous keyword rejected by AI', {
            keyword: kw.keyword,
            reason: validation.reason,
            segmentTitle: segment.title,
          });
        }
      } catch (error) {
        logger.error('Failed to validate ambiguous keyword', error as Error, {
          keyword: kw.keyword,
          segmentTitle: segment.title,
        });
      }
    }
    
    return findings;
  }

  /**
   * Validate ambiguous keyword with AI (moved from ConcursoValidator)
   */
  private async validateAmbiguousKeyword(
    text: string,
    keyword: string
  ): Promise<{isValid: boolean; confidence: number; reason: string; usage?: any}> {
    // Check cache first
    const cacheKey = keyword.toLowerCase();
    if (this.validationCache.has(cacheKey)) {
      const cached = this.validationCache.get(cacheKey)!;
      logger.debug('Using cached validation result', { keyword, isValid: cached.isValid });
      return cached;
    }

    // Enhanced prompt with specific criteria for Brazilian public administration
    const prompt = `Analyze the following text excerpt from a Brazilian official gazette (diário oficial) to determine if the term "${keyword}" refers to a public service competition that should be tracked as "concurso público" for transparency purposes.

Context:
${text}

IMPORTANT: In Brazilian public administration, different terms are used for public competitions:

1. "CONCURSO PÚBLICO" = Traditional formal competition for permanent positions
2. "PROCESSO SELETIVO SIMPLIFICADO" = Simplified public competition (still formal, still public)
3. "SELEÇÃO PÚBLICA" = Public selection process (formal competition)
4. "PROCESSO SELETIVO" = Can be either public competition OR private selection

KEY PRINCIPLE: If it's a FORMAL GOVERNMENT SELECTION for PUBLIC POSITIONS published in an OFFICIAL GAZETTE, it should be considered "concurso público" for transparency tracking purposes.

INDICATORS FOR "CONCURSO PÚBLICO" (should be tracked):
✓ Published in official gazette (diário oficial)
✓ Government entity conducting selection (prefeitura, secretaria, órgão público)
✓ Formal edital with number (e.g., "Edital nº 01/2025")
✓ Public positions (even if temporary or simplified)
✓ Formal process stages (prorrogação, homologação, convocação, etc.)
✓ References to public administration laws
✓ Mentions of "vagas", "candidatos", "inscrições"
✓ Administrative acts (prorrogação, retificação, resultado)
✓ Even if labeled "simplificado" or "temporário" - still public competition

SPECIAL CASES - STILL "CONCURSO PÚBLICO":
✓ "Processo Seletivo Simplificado" = Simplified but still public competition
✓ "Seleção Pública" = Public selection = public competition
✓ Temporary positions in government = still public competition
✓ Substitute positions = still public competition
✓ Contract positions in government = still public competition
✓ Prorrogação/extension of any public selection = administrative act of public competition

INDICATORS FOR "NOT CONCURSO PÚBLICO" (should NOT be tracked):
✗ Private company selections
✗ Internal corporate processes
✗ Academic competitions (unless for public teaching positions)
✗ Cultural contests/awards
✗ Sports competitions
✗ Private sector hiring
✗ No government entity involved

CONTEXT CLUES FOR YOUR TEXT:
- Is this published in an official gazette? (Strong indicator = YES)
- Is a government entity (prefeitura, secretaria) involved? (Strong indicator = YES)
- Are there formal administrative acts (prorrogação, edital, homologação)? (Strong indicator = YES)
- Does it mention public positions or government jobs? (Strong indicator = YES)

EXAMPLES:
- "Edital de Prorrogação de Processos Seletivos Simplificados" = YES (government extending public competitions)
- "Processo Seletivo para Professor Municipal" = YES (public teaching position)
- "Seleção Pública para Médico" = YES (public health position)
- "Processo Seletivo da Empresa XYZ" = NO (private company)

Respond in JSON format:
{
  "isPublicServiceCompetition": true/false,
  "isConcursoPublico": true/false,
  "confidence": 0.0-1.0,
  "reason": "Brief explanation focusing on whether this is a government selection process that should be tracked for transparency",
  "indicators": ["list", "of", "key", "indicators", "found"],
  "governmentEntity": "name of government entity if found",
  "documentType": "type of document (edital, prorrogação, etc.) if identifiable"
}`;

    try {
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
              content: 'You are an expert in Brazilian public administration and legal documents. You must distinguish between formal public service competitions (concursos públicos) and other types of selections.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.1,
          max_tokens: 300,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const apiResponse = await response.json() as any;
      const content = apiResponse.choices?.[0]?.message?.content;
      const usage = apiResponse.usage;

      // Track token usage
      if (usage) {
        CostTracker.trackUsage(
          'openai',
          this.model,
          'concurso_validation',
          usage,
          { keyword }
        );
      }

      if (!content) {
        throw new Error('No content in OpenAI response');
      }

      const analysis = JSON.parse(content);
      
      // Validate as concurso público if marked as public service competition
      const isValid = analysis.isConcursoPublico === true && 
                      analysis.isPublicServiceCompetition === true;
      
      const validationResult = {
        isValid,
        confidence: analysis.confidence || 0.5,
        reason: analysis.reason || 'No reason provided',
        usage,
      };

      // Cache the result
      this.validationCache.set(cacheKey, validationResult);
      
      return validationResult;
    } catch (error) {
      logger.error('AI validation failed', error as Error, { keyword });
      // Default to false on error to avoid false positives
      const errorResult = { isValid: false, confidence: 0, reason: 'Validation error' };
      // Cache error results too to avoid retrying failed validations
      this.validationCache.set(cacheKey, errorResult);
      return errorResult;
    }
  }

  /**
   * Create concurso finding from validated segment
   */
  private createConcursoFinding(
    documentType: {type: ConcursoDocumentType; confidence: number},
    data: Partial<ConcursoData>,
    segment: SegmentInfo,
    source: 'pattern' | 'ai' | 'hybrid' | 'certain' | 'ambiguous_validated'
  ): Finding {
    const concursoData: ConcursoData = {
      documentType: documentType.type,
      documentTypeConfidence: documentType.confidence,
      ...data,
    };
    
    const categoryMap: Record<ConcursoDocumentType, string> = {
      convocacao: 'concurso_publico_convocacao',
      edital_abertura: 'concurso_publico_abertura',
      edital_retificacao: 'concurso_publico_retificacao',
      homologacao: 'concurso_publico_homologacao',
      prorrogacao: 'concurso_publico_prorrogacao',
      cancelamento: 'concurso_publico_cancelamento',
      resultado_parcial: 'concurso_publico_resultado',
      resultado_insencao: 'concurso_publico_insencao',
      reclassificacao_resultado: 'concurso_publico_reclassificacao',
      nomeacao_exoneracao: 'concurso_publico_nomeacao_exoneracao',
      gabarito: 'concurso_publico_resultado',
      nao_classificado: 'concurso_publico',
    };
    
    const context = this.extractRelevantContext(segment.text, documentType.type);
    
    return this.createFinding(
      'concurso',
      {
        category: categoryMap[documentType.type] || 'concurso_publico',
        concursoData,
        extractionMethod: source,
        documentType: documentType.type,
        segmentTitle: segment.title,
        keywords: segment.keywords,
      },
      documentType.confidence,
      context || segment.text.substring(0, 3000)
    );
  }

  /**
   * Detect if a keyword appears in an active, historical, or reference context
   */
  private detectContextType(
    text: string,
    keyword: string,
    position: number
  ): 'active' | 'historical' | 'reference' {
    // Extract context window around the keyword (300 chars before and after for better context)
    const contextStart = Math.max(0, position - 300);
    const contextEnd = Math.min(text.length, position + keyword.length + 300);
    const context = text.substring(contextStart, contextEnd).toLowerCase();
    
    // Check for table/list indicators (historical reference)
    const tableIndicators = [
      /\|\s*\w+\s*\|/, // Pipe-separated tables
      /---\s*---/, // Markdown table separators
      /n[°º]\s*\d+.*data.*homologa[çc][ãa]o/i, // Reference tables
    ];
    
    for (const indicator of tableIndicators) {
      if (indicator.test(context)) {
        console.log('-----------------------------> Historical context', {
          context,
          keyword,
          position,
          text,
        });     
        return 'historical';
      }
    }
    
    // Enhanced reference indicators - check these FIRST before active verbs
    const referenceIndicators = [
      // Existing reference patterns
      /conforme\s+(?:edital|publicado)/i,
      /referente\s+ao/i,
      /de\s+acordo\s+com/i,
      /nos\s+termos\s+do/i,
      /previsto\s+no/i,
      
      // NEW: Nomeacao-specific reference patterns
      /exigidos?\s+no?\s+edital/i,
      /constantes?\s+no?\s+edital/i,
      /estabelecidos?\s+no?\s+edital/i,
      /dispostos?\s+no?\s+edital/i,
      /mencionados?\s+no?\s+edital/i,
      /previstos?\s+no?\s+edital/i,
      
      // NEW: General reference patterns for documents citing other documents
      /(?:conforme|segundo|previsto|estabelecido|determinado|disposto)\s+(?:do|da|no|na)\s+edital\s+(?:de\s+)?(?:abertura|concurso)/i,
      /(?:segundo|conforme|como)\s+(?:previsto|estabelecido|determinado)\s+(?:do|da|no|na)\s+edital\s+(?:de\s+)?(?:abertura|concurso)/i,
      /em\s+conformidade\s+com/i,
      /de\s+acordo\s+com\s+o\s+(?:edital|disposto)/i,
      
      // NEW: Patterns indicating requirements or conditions from other documents
      /(?:requisitos?|condi[çc][õo]es?|exig[êe]ncias?).*(?:do|no)\s+edital/i,
      /documentos?\s+(?:necess[áa]rios?|exigidos?).*edital/i,
      /prazo.*(?:legal|estabelecido|previsto)/i
    ];
    
    for (const indicator of referenceIndicators) {
      if (indicator.test(context)) {
        console.log('-----------------------------> Reference context', {
          context,
          keyword,
          position,
          text,
        });     
        return 'reference';
      }
    }
    
    // Check for active action verbs near the keyword (only after checking references)
    const activeVerbs = [
      /(?:torna|tornar)\s+p[uú]blic[oa]/i,
      /(?:prorroga|prorrogar)/i,
      /(?:retifica|retificar)/i,
      /(?:convoca|convocar)/i,
      /(?:homologa|homologar)/i,
      /(?:cancela|cancelar)/i,
      /(?:suspende|suspender)/i,
      /fica(?:m)?\s+\w+/i, // "fica prorrogado", "ficam convocados"
      /(?:disp[õo]e\s+sobre|trata\s+(?:da|de))\s+(?:a\s+)?convoca[çc][ãa]o/i, 
      // NEW: Additional active verbs for better detection (more flexible patterns)
      /resolve/i, // "resolve nomear" - check for resolve anywhere in context
      /fica\s+(?:nomeado|nomeada|exonerado|exonerada)/i,
      /(?:autoriza|autorizado)/i,
      /(?:designa|designado)/i,
      /para\s+realizar\s+a?\s+inscri[çc][ãa]o/i, // "para realizar a inscrição"
      /formalizar[ãa]o\s+pedido\s+de/i, // "formalizarão pedido de"
      /ficar[ãa]o\s+abertas?/i, // "ficarão abertas"
      /(?:nomear|nomea[çc][ãa]o)\s+(?:d[oa]s?\s+)?candidat[oa]s?\s+aprovad[oa]s?/i, // "nomear candidatos aprovados", "nomeação dos candidatos aprovados"
      /(?:exonerar|exonera[çc][ãa]o)\s+(?:d[oa]s?\s+)?(?:candidat[oa]s?|servidor[ae]s?|funcion[áa]ri[oa]s?)/i, // "exonerar candidatos", "exoneração dos servidores"
    ];
    
    const keywordPos = context.indexOf(keyword.toLowerCase());
    const beforeKeyword = context.substring(Math.max(0, keywordPos - 75), keywordPos);
    const afterKeyword = context.substring(keywordPos, Math.min(context.length, keywordPos + 75));
    
    for (const verb of activeVerbs) {
      if (verb.test(beforeKeyword) || verb.test(afterKeyword)) {
        return 'active';
      }
    }
    
    // Default to reference if no clear active indicators (more conservative approach)
    return 'reference';
  }
  
  /**
   * Check if validated keyword is close to any strong keywords from patterns
   * Used to boost confidence when AI validates an ambiguous term
   */
  private checkProximityToStrongKeywords(
    text: string,
    validatedKeyword: string,
    maxDistance: number
  ): boolean {
    // Find position of validated keyword
    const lowerText = text.toLowerCase();
    const keywordIndex = lowerText.indexOf(validatedKeyword.toLowerCase());
    if (keywordIndex === -1) return false;
    
    // Check all patterns for strong keywords
    for (const pattern of CONCURSO_PATTERNS) {
      for (const strongKeyword of pattern.strongKeywords || []) {
        const strongIndex = lowerText.indexOf(strongKeyword.toLowerCase());
        if (strongIndex !== -1) {
          // Calculate word distance
          const wordDistance = text.substring(
            Math.min(keywordIndex, strongIndex),
            Math.max(keywordIndex, strongIndex)
          ).split(/\s+/).length;
          
          if (wordDistance <= maxDistance) {
            logger.debug('Found nearby strong keyword for AI validated term', {
              validatedKeyword,
              strongKeyword,
              wordDistance,
              maxDistance,
            });
            return true;
          }
        }
      }
    }
    
    return false;
  }
  
  /**
   * Calculate tiered keyword score
   */
  private calculateTieredKeywordScore(
    text: string,
    pattern: any,
    aiValidatedKeyword?: string
  ): {
    score: number;
    strongCount: number;
    moderateCount: number;
    weakCount: number;
    referenceCount: number;
    matchedKeywords: Array<{ keyword: string; tier: string; context: string }>;
  } {
    const matchedKeywords: Array<{ keyword: string; tier: string; context: string }> = [];
    let strongCount = 0;
    let moderateCount = 0;
    let weakCount = 0;
    let referenceCount = 0;
    
    // Check strong keywords (weight: 1.0 for active, 0.2 for reference)
    for (const keyword of pattern.strongKeywords || []) {
      const lowerText = text.toLowerCase();
      const lowerKeyword = keyword.toLowerCase();
      let lastIndex = 0;
      
      while (true) {
        const index = lowerText.indexOf(lowerKeyword, lastIndex);
        if (index === -1) break;
        
        const contextType = this.detectContextType(text, keyword, index);

        logger.debug('-----------------------------> Context type', {
          contextType,
          keyword,
          index,
          matchedKeywords,
          referenceCount,
        });
        
        // NEW: Override reference context if AI validated nearby keyword
        if (contextType === 'reference' && aiValidatedKeyword) {
          // Check if validated keyword is nearby (within 200 chars)
          const contextStart = Math.max(0, index - 300);
          const contextEnd = Math.min(text.length, index + keyword.length + 300);
          const contextWindow = text.substring(contextStart, contextEnd).toLowerCase();
          
          if (contextWindow.includes(aiValidatedKeyword.toLowerCase())) {
            // Treat as active since AI validated this is legitimate concurso content
            strongCount++;
            const displayContextStart = Math.max(0, index - 50);
            const displayContextEnd = Math.min(text.length, index + keyword.length + 50);
            matchedKeywords.push({
              keyword,
              tier: 'strong',
              context: text.substring(displayContextStart, displayContextEnd) + ' [AI proximity validated]',
            });
            logger.debug('Context override: reference→active due to AI validation proximity', {
              keyword,
              aiValidatedKeyword,
            });
            break;
          }
        }
        
        // Count active contexts as strong
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
        
        // Count reference contexts as weak with reduced weight
        if (contextType === 'reference') {
          referenceCount++;
          const contextStart = Math.max(0, index - 50);
          const contextEnd = Math.min(text.length, index + keyword.length + 50);
          matchedKeywords.push({
            keyword,
            tier: 'reference',
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
    
    // Calculate weighted score with enhanced reference penalty
    // Reference contexts get very low weight (0.1) to prevent false positives
    const score = (strongCount * 1.0) + (moderateCount * 0.6) + (weakCount * 0.3) + (referenceCount * 0.1);
    
    return { score, strongCount, moderateCount, weakCount, referenceCount, matchedKeywords };
  }
  
  /**
   * Detect conflicts with other document types
   * Enhanced to be less aggressive for segmented documents and concurso-specific contexts
   */
  private detectConflicts(
    text: string,
    currentPattern: any,
    isSegmentedDocument: boolean = false
  ): {
    hasConflict: boolean;
    conflictCount: number;
    conflictingKeywords: Array<{ keyword: string; stage: string }>;
    conflictPenalty: number;
  } {
    const conflictingKeywords: Array<{ keyword: string; stage: string }> = [];
    let conflictCount = 0;
    let significantConflicts = 0; // Track only significant conflicts
    
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
          significantConflicts++; // Explicit conflicts are always significant
        }
      }
    }
    
    // Check for strong keywords from OTHER patterns with enhanced context awareness
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
          
          // Enhanced conflict detection logic
          if (contextType === 'active') {
            // Check if this is a significant conflict or just a reference
            const isSignificantConflict = this.isSignificantConflict(
              text, 
              strongKeyword, 
              index, 
              currentPattern.documentType, 
              otherPattern.documentType,
              isSegmentedDocument
            );
            
            conflictingKeywords.push({ 
              keyword: strongKeyword, 
              stage: otherPattern.documentType 
            });
            conflictCount++;
            
            if (isSignificantConflict) {
              significantConflicts++;
            }
            
            break; // Count each unique keyword once
          }
          
          lastIndex = index + strongKeyword.length;
        }
      }
    }
    
    // Enhanced conflict penalty calculation
    let conflictPenalty = 1.0;
    if (conflictCount > 0) {
      // Use significant conflicts for penalty calculation, not all conflicts
      const conflictsToUse = Math.max(significantConflicts, Math.ceil(conflictCount * 0.3));
      
      if (isSegmentedDocument) {
        // Very lenient for segmented documents - focus on section-specific content
        const penaltyMultiplier = 0.05; // Much reduced penalty
        const minPenalty = 0.75; // Higher minimum confidence retention
        conflictPenalty = Math.max(minPenalty, 1.0 - (conflictsToUse * penaltyMultiplier));
      } else {
        // Standard penalty for non-segmented documents
        const penaltyMultiplier = 0.12;
        const minPenalty = 0.5;
        conflictPenalty = Math.max(minPenalty, 1.0 - (conflictsToUse * penaltyMultiplier));
      }
    }
    
    return {
      hasConflict: conflictCount > 0,
      conflictCount,
      conflictingKeywords,
      conflictPenalty,
    };
  }

  /**
   * Determine if a conflict is significant or just a reference/mention
   */
  private isSignificantConflict(
    text: string,
    keyword: string,
    position: number,
    currentType: string,
    conflictType: string,
    isSegmentedDocument: boolean
  ): boolean {
    // Extract context around the keyword (200 chars before and after)
    const contextStart = Math.max(0, position - 200);
    const contextEnd = Math.min(text.length, position + keyword.length + 200);
    const context = text.substring(contextStart, contextEnd).toLowerCase();
    
    // For segmented documents, be more lenient - conflicts in different sections are less significant
    if (isSegmentedDocument) {
      // Check if the conflict is in a different section header
      const sectionHeaderPattern = /(?:^|\n)\s*(?:decreto|portaria|edital|resolução|lei)\s+/i;
      const beforeKeyword = text.substring(Math.max(0, position - 500), position);
      const afterKeyword = text.substring(position, Math.min(text.length, position + 500));
      
      // If there's a section boundary between current position and conflict, it's less significant
      if (sectionHeaderPattern.test(beforeKeyword) || sectionHeaderPattern.test(afterKeyword)) {
        return false;
      }
    }
    
    // Specific conflict type analysis
    if (currentType === 'convocacao' && conflictType === 'edital_abertura') {
      // "abertura de inscrições" in a convocacao document is often just a reference
      if (keyword.includes('abertura') && /(?:conforme|segundo|edital\s+n[°º]?\s*\d+)/i.test(context)) {
        return false;
      }
    }
    
    if (currentType === 'edital_abertura' && conflictType === 'convocacao') {
      // "convocação" in an edital_abertura might just be describing future steps
      if (keyword.includes('convocação') && /(?:futura|posterior|após|cronograma)/i.test(context)) {
        return false;
      }
    }
    
    // Budget/financial content conflicts are rarely significant for concurso documents
    if (/orçamento|financeiro|receita|despesa|crédito\s+adicional/i.test(context)) {
      return false;
    }
    
    // Default: consider it significant if we can't determine otherwise
    return true;
  }

  /**
   * Classify document intent using AI when there are conflicts or low confidence
   */
  private async classifyDocumentIntent(
    text: string, 
    conflictingTypes: Array<{ type: ConcursoDocumentType; confidence: number }>,
    segmentTitle?: string
  ): Promise<{ type: ConcursoDocumentType; confidence: number } | null> {
    if (!this.apiKey) {
      logger.warn('AI intent classification requested but no API key available');
      return null;
    }

    try {
      // Use enhanced context extraction that prioritizes concurso sections
      const contextText = this.extractRelevantContext(text, 'nao_classificado');
      
      const conflictingTypesList = conflictingTypes.map(t => t.type).join(', ');
      
      // Enhanced prompt with better guidance for concurso documents
      const prompt = `You are analyzing a Brazilian official gazette document that contains PUBLIC CONTEST (concurso público) content.

CRITICAL DISTINCTION:
- An "EDITAL" (notice) DESCRIBES rules and procedures (including how future convocations will work)
- A "CONVOCAÇÃO" (summoning) ACTUALLY CALLS specific named candidates to take action NOW

SEGMENT TITLE: ${segmentTitle || 'Not provided'}

TEXT TO ANALYZE:
${contextText}

DETECTED POSSIBLE TYPES: ${conflictingTypesList}

DOCUMENT TYPE DEFINITIONS:

🎯 EDITAL_ABERTURA (Contest Opening Notice):
- Header contains "EDITAL" with number (e.g., "EDITAL Nº 01/2025")
- DESCRIBES procedures, rules, requirements, schedules
- Uses FUTURE or CONDITIONAL tense ("serão convocados", "candidatos deverão")
- Contains sections ABOUT various topics (inscrições, provas, convocação, etc.)
- Announces NEW contest with registration period
- May contain a section "DA CONVOCAÇÃO" describing HOW convocations WILL work

🎯 CONVOCACAO (Actual Candidate Summoning):
- Header is "EDITAL DE CONVOCAÇÃO" or standalone "CONVOCAÇÃO"  
- CALLS specific named candidates (lists names, CPFs, classifications)
- Uses PRESENT/IMPERATIVE tense ("convoca", "fica convocado", "apresentar-se")
- Gives specific dates/locations for candidates to appear
- References a PREVIOUS edital by number
- Action-oriented: candidates must do something NOW

🎯 NOMEACAO (Appointment):
- Contains "PORTARIA" or "DECRETO" with "NOMEAÇÃO"
- Actually appoints specific people to positions
- Uses "nomear", "fica nomeado"
      
KEY INDICATORS:

If segment title contains "EDITAL N" or "EDITAL DE ABERTURA" → likely EDITAL_ABERTURA
If text has section headers like "DA CONVOCAÇÃO" but is DESCRIBING procedures → EDITAL_ABERTURA
If text LISTS specific candidate names being called → CONVOCACAO
If text says "inscrições abertas" or "abertura de inscrições" → EDITAL_ABERTURA

ANALYSIS STEPS:
1. Check segment title first - does it say "EDITAL N°"? → Strong indicator of EDITAL_ABERTURA
2. Is the text DESCRIBING how things will work (procedural) or EXECUTING an action (calling candidates)?
3. Does it list specific candidate names? → CONVOCACAO
4. Does it describe registration requirements and procedures? → EDITAL_ABERTURA

What is the PRIMARY document type?

Respond in JSON format:
{
  "documentType": "convocacao|edital_abertura|nomeacao|homologacao|edital_retificacao|prorrogacao",
  "confidence": 0.0-1.0,
  "reasoning": "Explain whether this is describing procedures (edital) or executing an action (convocacao/nomeacao)",
  "mainAction": "The primary action: describing rules OR calling candidates OR appointing people",
  "sectionFound": "The specific section header found",
  "isDescriptive": true/false,
  "listsSpecificCandidates": true/false
}`;

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
              content: 'You are an expert in Brazilian public contest (concurso público) documents. Focus EXCLUSIVELY on concurso-related content and ignore other administrative sections like budget laws, general decrees, etc. Look for specific section headers and concurso-specific language patterns.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.1,
          max_tokens: 500,
          response_format: { type: 'json_object' },
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const result = await response.json() as any;
      const content = result.choices?.[0]?.message?.content;
      const usage = result.usage;

      // Track token usage
      if (usage) {
        CostTracker.trackUsage(
          'openai',
          this.model,
          'concurso_intent_classification',
          usage,
          { segmentTitle, conflictingTypes: conflictingTypesList }
        );
      }

      if (!content) {
        throw new Error('No content in OpenAI response');
      }

      const analysis = JSON.parse(content);
      
      // Validate the response
      if (!analysis.documentType || !analysis.confidence) {
        logger.warn('Invalid AI intent classification response', { analysis });
        return null;
      }

      logger.info('AI intent classification result', {
        documentType: analysis.documentType,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
        mainAction: analysis.mainAction,
        sectionFound: analysis.sectionFound,
        segmentTitle,
      });
      
      return {
        type: analysis.documentType as ConcursoDocumentType,
        confidence: Math.min(analysis.confidence, 0.95), // Cap confidence
      };
    } catch (error) {
      logger.error('AI intent classification failed', error as Error, {
        segmentTitle,
        conflictingTypes: conflictingTypes.map(t => t.type).join(', '),
      });
      return null;
    }
  }

  /**
   * Detect the type of concurso document with two-pass classification system
   */
  private async detectDocumentType(text: string, isSegmentedDocument: boolean = false, segmentTitle?: string, aiValidatedKeyword?: string): Promise<{ type: ConcursoDocumentType; confidence: number } | null> {
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
      let matchedExcludePattern: RegExp | undefined;
      let excludeContext = '';
      
      if (pattern.excludePatterns) {
        for (const excludeRegex of pattern.excludePatterns) {
          const match = text.match(excludeRegex);
          if (match) {
            hasExclusion = true;
            matchedExcludePattern = excludeRegex;
            // Get context around the match
            const matchIndex = text.indexOf(match[0]);
            const contextStart = Math.max(0, matchIndex - 100);
            const contextEnd = Math.min(text.length, matchIndex + match[0].length + 100);
            excludeContext = text.substring(contextStart, contextEnd).replace(/\s+/g, ' ');
            break;
          }
        }
      }
      
      // If excluded, skip this pattern entirely (conservative approach)
      if (hasExclusion) {
        logger.debug('Pattern excluded by exclude patterns', {
          documentType: pattern.documentType,
          isSegmentedDocument,
          matchedExcludePattern: matchedExcludePattern?.source,
          excludeContext,
          segmentTitle: segmentTitle || structure.titles[0]?.text || '',
        });
        continue;
      }

      // Calculate tiered keyword scores
      const tieredScore = this.calculateTieredKeywordScore(text, pattern, aiValidatedKeyword);
      
      // Check minimum strong keywords requirement
      if (pattern.minStrongKeywords && tieredScore.strongCount < pattern.minStrongKeywords) {
        logger.debug('Pattern skipped due to insufficient strong keywords', {
          documentType: pattern.documentType,
          requiredStrongKeywords: pattern.minStrongKeywords,
          foundStrongKeywords: tieredScore.strongCount,
          matchedKeywords: tieredScore.matchedKeywords.filter(k => k.tier === 'strong').map(k => ({
            keyword: k.keyword,
            context: k.context,
          })),
          allMatchedKeywordTiers: tieredScore.matchedKeywords.map(k => k.tier),
          textPreview: text.substring(0, 300).replace(/\s+/g, ' '),
          segmentTitle: segmentTitle || structure.titles[0]?.text || '',
          isSegmentedDocument,
        });
        continue; // Skip if minimum strong keywords not met
      }
      
      // Detect conflicts with other stages
      const conflicts = this.detectConflicts(text, pattern, isSegmentedDocument);

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
        // Be more lenient for segmented documents
        const minConfidence = conflicts.hasConflict 
          ? (isSegmentedDocument ? 0.55 : 0.65) 
          : (isSegmentedDocument ? 0.40 : 0.50);
        
        if (adjustedConfidence < minConfidence) {
          logger.debug('Pattern skipped due to low confidence', {
            documentType: pattern.documentType,
            adjustedConfidence,
            minConfidence,
            isSegmentedDocument,
            strongKeywords: tieredScore.strongCount,
            conflicts: conflicts.conflictCount,
          });
          continue; // Skip low confidence matches
        }

        // Detailed logging for debugging
        logger.debug('Pattern evaluation', {
          documentType: pattern.documentType,
          patternMatches,
          isSegmentedDocument,
          tieredScore: {
            strong: tieredScore.strongCount,
            moderate: tieredScore.moderateCount,
            weak: tieredScore.weakCount,
            reference: tieredScore.referenceCount,
            totalScore: tieredScore.score,
            matchedKeywords: tieredScore.matchedKeywords.slice(0, 3).map(m => m.keyword),
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
          thresholds: {
            minConfidence: conflicts.hasConflict 
              ? (isSegmentedDocument ? 0.55 : 0.65) 
              : (isSegmentedDocument ? 0.40 : 0.50),
            adjustedConfidence,
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

    // PASS 1: Sort by confidence and check for high-confidence matches
    results.sort((a, b) => b.confidence - a.confidence);

    // High confidence threshold for Pass 1 (no AI needed)
    const highConfidenceThreshold = 0.75;
    const lowConfidenceThreshold = 0.5;
    
    if (results.length > 0 && results[0].confidence >= highConfidenceThreshold) {
      logger.info('Document type detected (Pass 1 - High confidence)', {
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
    
    // PASS 2: Check if we need AI validation for ambiguous cases
    const needsAIValidation = results.length > 0 && (
      // Low confidence on top result
      results[0].confidence < highConfidenceThreshold ||
      // Multiple competing results with similar confidence
      (results.length > 1 && (results[0].confidence - results[1].confidence) < 0.2) ||
      // Potential edital_abertura vs nomeacao conflict
      (results.some(r => r.type === 'edital_abertura') && results.some(r => r.type === 'nomeacao'))
    );

    if (needsAIValidation && this.apiKey) {
      logger.info('Attempting AI intent classification (Pass 2)', {
        reason: results.length > 1 ? 'multiple_candidates' : 'low_confidence',
        topCandidates: results.slice(0, 3).map(r => ({
          type: r.type,
          confidence: r.confidence.toFixed(3),
        })),
      });

      try {
        const aiResult = await this.classifyDocumentIntent(text, results.slice(0, 3), segmentTitle);
        
        if (aiResult && aiResult.confidence >= 0.6) {
          logger.info('AI intent classification successful', {
            aiType: aiResult.type,
            aiConfidence: aiResult.confidence,
            originalTopType: results[0]?.type,
            originalTopConfidence: results[0]?.confidence,
          });
          
          // Use AI result if it's confident
          return aiResult;
        } else {
          logger.warn('AI intent classification failed or low confidence', {
            aiResult,
            fallbackToOriginal: true,
          });
        }
      } catch (error) {
        logger.error('AI intent classification error', error as Error);
      }
    }

    // Fallback to Pass 1 results if AI validation fails or isn't needed
    if (results.length > 0 && results[0].confidence >= lowConfidenceThreshold) {
      logger.info('Document type detected (Pass 1 fallback)', {
        type: results[0].type,
        confidence: results[0].confidence,
        totalCandidates: results.length,
        aiValidationAttempted: needsAIValidation,
      });
      return results[0];
    }
    
    // Log when no classification could be made
    if (results.length > 0) {
      logger.info('Document type detection failed - confidence too low', {
        topCandidate: results[0].type,
        confidence: results[0].confidence,
        threshold: lowConfidenceThreshold,
        aiValidationAttempted: needsAIValidation,
      });
    } else {
      logger.info('Document type detection failed - no matches found');
    }

    return null;
  }

  /**
   * Parse and validate a date string, normalizing to DD/MM/YYYY format
   * Uses lenient validation: logs warnings but returns normalized date if parseable
   */
  private parseAndValidateDate(dateStr: string): string | null {
    if (!dateStr || dateStr.trim().length === 0) {
      return null;
    }

    try {
      // Use existing parseBrazilianDate function
      const date = parseBrazilianDate(dateStr);
      
      // Check if date is valid
      if (isNaN(date.getTime())) {
        logger.warn('Invalid date format detected', { dateStr });
        return null;
      }

      // Validate the date components match (handles Feb 30, etc.)
      const day = date.getDate();
      const month = date.getMonth() + 1; // getMonth() returns 0-11
      const year = date.getFullYear();
      
      // Re-parse to check if the date is real
      const reconstructed = new Date(year, month - 1, day);
      if (reconstructed.getFullYear() !== year || 
          reconstructed.getMonth() !== month - 1 || 
          reconstructed.getDate() !== day) {
        logger.warn('Invalid date value detected (e.g., Feb 30)', { dateStr, parsed: `${day}/${month}/${year}` });
        return null;
      }

      // Normalize to DD/MM/YYYY format
      const normalized = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
      
      return normalized;
    } catch (error) {
      logger.warn('Error parsing date', { dateStr, error });
      return null;
    }
  }

  /**
   * Normalize cargo name by removing prefixes and normalizing whitespace
   */
  private normalizeCargoName(name: string): string {
    return name
      .replace(/\s+/g, ' ')  // Normalize whitespace
      .replace(/^(cargo|função|emprego)[:\s]+/i, '')  // Remove prefix
      .trim();
  }

  /**
   * Extract a field from context using multiple patterns
   * Returns the first match found, or undefined if none found
   */
  private extractField(context: string, patterns: RegExp[]): string | undefined {
    for (const pattern of patterns) {
      const match = context.match(pattern);
      if (match && match[1]) {
        const extracted = match[1].trim();
        // Limit length to prevent excessive text
        return extracted.substring(0, 200);
      }
    }
    return undefined;
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
        // Normalize format: replace separators with "/" and pad numbers if needed
        let editalNum = match[1].replace(/[._-]/g, '/');
        // Ensure format is consistent (e.g., "001/2024" not "1/2024")
        const parts = editalNum.split('/');
        if (parts.length === 2) {
          // Pad first part if it's a number and less than 3 digits
          if (/^\d+$/.test(parts[0]) && parts[0].length < 3) {
            parts[0] = parts[0].padStart(3, '0');
          }
          editalNum = parts.join('/');
        }
        data.editalNumero = editalNum;
        break;
      }
    }

    // Extract organization
    for (const pattern of EXTRACTION_PATTERNS.orgao) {
      const match = text.match(pattern);
      if (match) {
        let orgaoName = match[1].trim();
        // Remove common noise words at the end
        orgaoName = orgaoName.replace(/\s*(?:através|por\s+meio|mediante|conforme|comunica|torna)$/i, '');
        // Remove trailing punctuation
        orgaoName = orgaoName.replace(/[,;]+$/, '').trim();
        if (orgaoName.length > 0) {
          data.orgao = orgaoName;
          break;
        }
      }
    }

    // Extract vacancies (only for relevant document types)
    if (['edital_abertura', 'convocacao', 'homologacao'].includes(documentType)) {
      let totalVagas = 0;
      let reservaPCD: number | undefined;
      
      // Try all vacancy patterns
      for (const pattern of EXTRACTION_PATTERNS.vagas) {
        const match = text.match(pattern);
        if (match) {
          totalVagas = parseInt(match[1], 10);
          
          // Check for PCD reservations nearby (within 200 chars)
          const matchIndex = text.indexOf(match[0]);
          if (matchIndex !== -1) {
            const contextStart = Math.max(0, matchIndex - 200);
            const contextEnd = Math.min(text.length, matchIndex + match[0].length + 200);
            const context = text.substring(contextStart, contextEnd);
            
            // Try to find PCD reservation patterns
            for (const reservaPattern of EXTRACTION_PATTERNS.reservaVagas) {
              const reservaMatch = context.match(reservaPattern);
              if (reservaMatch) {
                reservaPCD = parseInt(reservaMatch[1], 10);
                break;
              }
            }
          }
          
          // Set vagas data
          data.vagas = {
            total: totalVagas,
            ...(reservaPCD !== undefined ? { reservaPCD } : {}),
          };
          
          break;
        }
      }
    }

    // Extract dates
    const datas: any = {};
    
    // Try all inscription patterns
    for (const pattern of EXTRACTION_PATTERNS.inscricoes) {
      const match = text.match(pattern);
      if (match && match[1] && match[2]) {
        const inicio = this.parseAndValidateDate(match[1]);
        const fim = this.parseAndValidateDate(match[2]);
        if (inicio && fim) {
          datas.inscricoesInicio = inicio;
          datas.inscricoesFim = fim;
          break;
        }
      }
    }

    // Try all exam date patterns
    for (const pattern of EXTRACTION_PATTERNS.prova) {
      const match = text.match(pattern);
      if (match && match[1]) {
        // Handle written date format (e.g., "15 de março de 2024")
        let dateStr = match[1];
        if (match.length > 3 && match[2] && match[3]) {
          // Reconstruct from written format
          const monthNames: { [key: string]: string } = {
            'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
            'abril': '04', 'maio': '05', 'junho': '06',
            'julho': '07', 'agosto': '08', 'setembro': '09',
            'outubro': '10', 'novembro': '11', 'dezembro': '12'
          };
          const month = monthNames[match[2].toLowerCase()];
          if (month) {
            dateStr = `${match[1].padStart(2, '0')}/${month}/${match[3]}`;
          }
        }
        
        const dataProva = this.parseAndValidateDate(dateStr);
        if (dataProva) {
          datas.prova = dataProva;
          break;
        }
      }
    }

    // Extract exemption-specific dates (for resultado_insencao document type)
    if (documentType === 'resultado_insencao') {
      // Appeal deadline
      for (const pattern of EXTRACTION_PATTERNS.prazoRecursoIsencao) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const prazoRecurso = this.parseAndValidateDate(match[1]);
          if (prazoRecurso) {
            datas.recursos = prazoRecurso;
            break;
          }
        }
      }

      // Result publication date
      for (const pattern of EXTRACTION_PATTERNS.divulgacaoResultadoIsencao) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const dataResultado = this.parseAndValidateDate(match[1]);
          if (dataResultado) {
            datas.resultado = dataResultado;
            break;
          }
        }
      }

      // Exemption request period
      for (const pattern of EXTRACTION_PATTERNS.periodoInscricaoIsencao) {
        const match = text.match(pattern);
        if (match && match[1] && match[2]) {
          const inicio = this.parseAndValidateDate(match[1]);
          const fim = this.parseAndValidateDate(match[2]);
          if (inicio && fim) {
            datas.inscricoesInicio = inicio;
            datas.inscricoesFim = fim;
            break;
          }
        }
      }
    }

    // Extract reclassification-specific data (for reclassificacao_resultado document type)
    if (documentType === 'reclassificacao_resultado') {
      // Extract process numbers
      const processNumbers: string[] = [];
      for (const pattern of EXTRACTION_PATTERNS.processoAdministrativo) {
        const matches = text.matchAll(new RegExp(pattern.source, pattern.flags + 'g'));
        for (const match of matches) {
          if (match[1] && !processNumbers.includes(match[1])) {
            processNumbers.push(match[1]);
          }
        }
      }
      
      if (processNumbers.length > 0) {
        if (!data.observacoes) {
          data.observacoes = [];
        }
        data.observacoes.push(`Processos: ${processNumbers.join(', ')}`);
      }

      // Authorization date
      for (const pattern of EXTRACTION_PATTERNS.dataAutorizacaoReclassificacao) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const dataAutorizacao = this.parseAndValidateDate(match[1]);
          if (dataAutorizacao) {
            datas.resultado = dataAutorizacao;
            break;
          }
        }
      }

      // Effective date
      for (const pattern of EXTRACTION_PATTERNS.dataEfetivaReclassificacao) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const dataEfetiva = this.parseAndValidateDate(match[1]);
          if (dataEfetiva) {
            if (!datas.resultado) {
              datas.resultado = dataEfetiva;
            }
            break;
          }
        }
      }
    }

    // Extract exoneração/nomeação-specific data
    if (documentType === 'exoneracao' || documentType === 'nomeacao') {
      // Extract portaria number
      for (const pattern of EXTRACTION_PATTERNS.portariaNumero) {
        const match = text.match(pattern);
        if (match && match[1]) {
          data.editalNumero = match[1];
          break;
        }
      }

      // Extract employee name
      for (const pattern of EXTRACTION_PATTERNS.nomeServidor) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const nome = match[1].trim();
          if (!data.observacoes) {
            data.observacoes = [];
          }
          data.observacoes.push(`Servidor: ${nome}`);
          break;
        }
      }

      // Extract position/cargo
      for (const pattern of EXTRACTION_PATTERNS.cargoServidor) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const cargo = match[1].trim();
          if (!data.observacoes) {
            data.observacoes = [];
          }
          data.observacoes.push(`Cargo: ${cargo}`);
          break;
        }
      }

      // Extract registration number
      for (const pattern of EXTRACTION_PATTERNS.matriculaServidor) {
        const match = text.match(pattern);
        if (match && match[1]) {
          if (!data.observacoes) {
            data.observacoes = [];
          }
          data.observacoes.push(`Matrícula: ${match[1]}`);
          break;
        }
      }

      // Extract RG/CI
      for (const pattern of EXTRACTION_PATTERNS.rgServidor) {
        const match = text.match(pattern);
        if (match && match[1]) {
          if (!data.observacoes) {
            data.observacoes = [];
          }
          data.observacoes.push(`RG: ${match[1]}`);
          break;
        }
      }

      // Extract effective date
      for (const pattern of EXTRACTION_PATTERNS.dataEfetivacaoExoneracao) {
        const match = text.match(pattern);
        if (match && match[1]) {
          let dateStr = match[1];
          
          // Handle written date format (e.g., "03 de novembro de 2025")
          if (match.length > 3 && match[2] && match[3]) {
            const monthNames: { [key: string]: string } = {
              'janeiro': '01', 'fevereiro': '02', 'março': '03', 'marco': '03',
              'abril': '04', 'maio': '05', 'junho': '06',
              'julho': '07', 'agosto': '08', 'setembro': '09',
              'outubro': '10', 'novembro': '11', 'dezembro': '12'
            };
            const month = monthNames[match[2].toLowerCase()];
            if (month) {
              dateStr = `${match[1].padStart(2, '0')}/${month}/${match[3]}`;
            }
          }
          
          const dataEfetivacao = this.parseAndValidateDate(dateStr);
          if (dataEfetivacao) {
            datas.resultado = dataEfetivacao;
            break;
          }
        }
      }

      // For exoneração, check if voluntary (a pedido)
      if (documentType === 'exoneracao') {
        for (const pattern of EXTRACTION_PATTERNS.tipoDesligamento) {
          const match = text.match(pattern);
          if (match) {
            if (!data.observacoes) {
              data.observacoes = [];
            }
            data.observacoes.push('Tipo: Voluntário (a pedido)');
            break;
          }
        }
      }
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
    const cargos: Map<string, any> = new Map(); // Use Map for better deduplication
    
    // Try table patterns
    for (const pattern of EXTRACTION_PATTERNS.cargoTable) {
      pattern.lastIndex = 0; // Reset regex
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const cargoNome = this.normalizeCargoName(match[1]);
        
        // Look for additional info in a LARGER context (500 chars instead of 200)
        const contextStart = Math.max(0, match.index - 500);
        const contextEnd = Math.min(text.length, match.index + match[0].length + 500);
        const context = text.substring(contextStart, contextEnd);
        
        // Create or update cargo entry
        const cargo = cargos.get(cargoNome) || {
          cargo: cargoNome,
          vagas: parseInt(match[2], 10) || 0,
          salario: match[3] ? this.parseMoneyValue(match[3]) : undefined,
        };
        
        // Extract additional fields using helper method
        if (!cargo.requisitos) {
          cargo.requisitos = this.extractField(context, EXTRACTION_PATTERNS.requisitos);
        }
        if (!cargo.escolaridade) {
          cargo.escolaridade = this.extractField(context, EXTRACTION_PATTERNS.escolaridade);
        }
        if (!cargo.jornada) {
          cargo.jornada = this.extractField(context, EXTRACTION_PATTERNS.jornada);
        }
        
        // Try to extract beneficios (can have multiple)
        if (!cargo.beneficios) {
          const beneficios: string[] = [];
          for (const beneficioPattern of EXTRACTION_PATTERNS.beneficios) {
            const beneficioMatch = context.match(beneficioPattern);
            if (beneficioMatch) {
              beneficios.push(beneficioMatch[0].substring(0, 100)); // Limit length
            }
          }
          if (beneficios.length > 0) {
            cargo.beneficios = beneficios;
          }
        }
        
        cargos.set(cargoNome, cargo);
      }
    }
    
    return Array.from(cargos.values());
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

      resultado_insencao: `Extract information from this EXEMPTION RESULT (Resultado de Isenção):

${text}

Extract and return JSON:
{
  "orgao": "organization",
  "editalNumero": "edital number",
  "observacoes": ["exemption results and deadlines"]
}`,

      reclassificacao_resultado: `Extract information from this RECLASSIFICATION (Reclassificação):

${text}

Extract and return JSON:
{
  "orgao": "organization",
  "editalNumero": "edital number",
  "observacoes": ["reclassification details and candidate information"]
}`,

      exoneracao: `Extract information from this DISMISSAL/RESIGNATION (Exoneração):

${text}

Extract and return JSON:
{
  "orgao": "organization",
  "observacoes": ["employee information and dismissal details"]
}`,

      nomeacao: `Extract information from this APPOINTMENT (Nomeação):

${text}

Extract and return JSON:
{
  "orgao": "organization",
  "editalNumero": "related edital number if any",
  "observacoes": ["appointment details and employee information"]
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
   * Enhanced to prioritize concurso-specific sections over other document content
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
    // Limit to ~5000 characters to balance API costs and context coverage
    const maxLength = 5000;
    
    if (text.length <= maxLength) {
      return text;
    }

    // Step 1: Try to find concurso-specific sections first
    const concursoSection = this.findConcursoSection(text, documentType, maxLength);
    if (concursoSection) {
      logger.debug('Found dedicated concurso section for context extraction', {
        documentType,
        sectionLength: concursoSection.length,
      });
      return concursoSection;
    }

    // Step 2: Fallback to enhanced keyword-based extraction
    return this.extractByKeywordScoring(text, documentType, maxLength);
  }

  /**
   * Find dedicated concurso sections by looking for structural headers
   */
  private findConcursoSection(text: string, documentType: ConcursoDocumentType, maxLength: number): string | null {
    // Define section header patterns for each document type
    const sectionPatterns: Record<ConcursoDocumentType, RegExp[]> = {
      convocacao: [
        /(?:^|\n)\s*(?:EDITAL\s+DE\s+)?CONVOCA[ÇC][ÃA]O[^\n]*(?:\n|$)/i,
        /(?:^|\n)\s*[\d]+[ªº]?\s*CONVOCA[ÇC][ÃA]O[^\n]*(?:\n|$)/i,
        /(?:^|\n)\s*CONVOCA[ÇC][ÃA]O.*CONCURSO\s+P[ÚU]BLICO[^\n]*(?:\n|$)/i,
      ],
      edital_abertura: [
        /(?:^|\n)\s*EDITAL\s+DE\s+ABERTURA[^\n]*(?:\n|$)/i,
        /(?:^|\n)\s*EDITAL\s+DE\s+CONCURSO\s+P[ÚU]BLICO[^\n]*(?:\n|$)/i,
        /(?:^|\n)\s*ABERTURA\s+DE\s+CONCURSO[^\n]*(?:\n|$)/i,
      ],
      homologacao: [
        /(?:^|\n)\s*(?:EDITAL\s+DE\s+)?HOMOLOGA[ÇC][ÃA]O[^\n]*(?:\n|$)/i,
        /(?:^|\n)\s*RESULTADO\s+FINAL\s+HOMOLOGADO[^\n]*(?:\n|$)/i,
      ],
      edital_retificacao: [
        /(?:^|\n)\s*(?:EDITAL\s+DE\s+)?RETIFICA[ÇC][ÃA]O[^\n]*(?:\n|$)/i,
        /(?:^|\n)\s*ERRATA[^\n]*(?:\n|$)/i,
      ],
      nomeacao: [
        /(?:^|\n)\s*(?:PORTARIA\s+DE\s+)?NOMEA[ÇC][ÃA]O[^\n]*(?:\n|$)/i,
        /(?:^|\n)\s*DECRETO.*NOMEA[ÇC][ÃA]O[^\n]*(?:\n|$)/i,
      ],
      // Add fallback patterns for other types
      prorrogacao: [/(?:^|\n)\s*PRORROGA[ÇC][ÃA]O[^\n]*(?:\n|$)/i],
      cancelamento: [/(?:^|\n)\s*CANCELAMENTO[^\n]*(?:\n|$)/i],
      resultado_parcial: [/(?:^|\n)\s*RESULTADO[^\n]*(?:\n|$)/i],
      resultado_insencao: [/(?:^|\n)\s*ISEN[ÇC][ÃA]O[^\n]*(?:\n|$)/i],
      reclassificacao_resultado: [/(?:^|\n)\s*RECLASSIFICA[ÇC][ÃA]O[^\n]*(?:\n|$)/i],
      exoneracao: [/(?:^|\n)\s*EXONERA[ÇC][ÃA]O[^\n]*(?:\n|$)/i],
      gabarito: [/(?:^|\n)\s*GABARITO[^\n]*(?:\n|$)/i],
      nao_classificado: [],
    };

    const patterns = sectionPatterns[documentType] || [];
    
    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match && match.index !== undefined) {
        // Extract section starting from the header
        const sectionStart = match.index;
        
        // Find the next major section or end of document
        const nextSectionPattern = /(?:\n\s*(?:DECRETO|PORTARIA|EDITAL|RESOLUÇÃO|LEI|COMUNICADO)\s+N?[°º]?\s*[\d.,/-]+)/i;
        const nextSectionMatch = nextSectionPattern.exec(text.substring(sectionStart + match[0].length));
        
        const sectionEnd = nextSectionMatch 
          ? sectionStart + match[0].length + nextSectionMatch.index!
          : Math.min(text.length, sectionStart + maxLength * 2); // Allow larger sections for concurso content
        
        const section = text.substring(sectionStart, sectionEnd).trim();
        
        // Return the section, truncated if necessary
        return section.length > maxLength 
          ? section.substring(0, maxLength) 
          : section;
      }
    }

    return null;
  }

  /**
   * Enhanced keyword-based extraction with section scoring
   */
  private extractByKeywordScoring(text: string, documentType: ConcursoDocumentType, maxLength: number): string {
    // Enhanced keywords with weights
    const keywordWeights: Record<ConcursoDocumentType, Array<{keyword: string; weight: number}>> = {
      edital_abertura: [
        {keyword: 'inscrições abertas', weight: 3},
        {keyword: 'abertura de inscrições', weight: 3},
        {keyword: 'edital de abertura', weight: 2},
        {keyword: 'vagas', weight: 2},
        {keyword: 'cargo', weight: 1},
        {keyword: 'concurso público', weight: 1},
      ],
      convocacao: [
        {keyword: 'convocação', weight: 3},
        {keyword: 'candidatos aprovados', weight: 3},
        {keyword: 'convoca', weight: 2},
        {keyword: 'apresentação', weight: 2},
        {keyword: 'documentos', weight: 1},
        {keyword: 'posse', weight: 1},
      ],
      homologacao: [
        {keyword: 'homologação', weight: 3},
        {keyword: 'resultado final', weight: 3},
        {keyword: 'classificação final', weight: 2},
        {keyword: 'aprovados', weight: 1},
      ],
      nomeacao: [
        {keyword: 'nomeação', weight: 3},
        {keyword: 'nomear', weight: 2},
        {keyword: 'candidato aprovado', weight: 2},
        {keyword: 'servidor', weight: 1},
      ],
      // Add other types with basic keywords
      edital_retificacao: [{keyword: 'retificação', weight: 3}, {keyword: 'alteração', weight: 2}],
      prorrogacao: [{keyword: 'prorrogação', weight: 3}, {keyword: 'prazo', weight: 2}],
      cancelamento: [{keyword: 'cancelamento', weight: 3}, {keyword: 'suspensão', weight: 2}],
      resultado_parcial: [{keyword: 'resultado', weight: 2}, {keyword: 'classificação', weight: 2}],
      resultado_insencao: [{keyword: 'isenção', weight: 3}, {keyword: 'taxa', weight: 2}],
      reclassificacao_resultado: [{keyword: 'reclassificação', weight: 3}],
      exoneracao: [{keyword: 'exoneração', weight: 3}, {keyword: 'sem efeito', weight: 2}],
      gabarito: [{keyword: 'gabarito', weight: 3}, {keyword: 'resposta', weight: 2}],
      nao_classificado: [{keyword: 'concurso', weight: 1}, {keyword: 'edital', weight: 1}],
    };

    const relevantKeywords = keywordWeights[documentType] || keywordWeights.nao_classificado;
    
    // Find section with highest weighted score, avoiding budget/financial content
    const chunkSize = maxLength;
    let bestChunk = text.substring(0, chunkSize);
    let bestScore = 0;

    for (let i = 0; i < text.length - chunkSize; i += chunkSize / 2) {
      const chunk = text.substring(i, i + chunkSize);
      const lowerChunk = chunk.toLowerCase();
      
      // Calculate weighted score
      let score = relevantKeywords.reduce((acc, {keyword, weight}) => {
        const matches = (lowerChunk.match(new RegExp(keyword.toLowerCase(), 'g')) || []).length;
        return acc + (matches * weight);
      }, 0);
      
      // Penalize budget/financial content
      if (/orçamento|financeiro|receita|despesa|crédito\s+adicional/i.test(lowerChunk)) {
        score *= 0.3; // Heavy penalty
      }
      
      // Bonus for concurso-specific structural elements
      if (/edital\s+de\s+(?:convocação|abertura)|convocação.*concurso/i.test(lowerChunk)) {
        score *= 1.5;
      }

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
   * Handles ranges, validates realistic ranges, and logs warnings for suspicious values
   */
  private parseMoneyValue(value: string): number {
    if (!value || value.trim().length === 0) {
      return 0;
    }

    // Clean the value
    let cleaned = value.trim().replace(/R\$?\s*/i, '');
    
    // Handle ranges - take the first value (e.g., "R$ 2.000 a 3.000" -> "2.000")
    const rangeMatch = cleaned.match(/([\d.,]+)\s*(?:a|até|-)\s*[\d.,]+/);
    if (rangeMatch) {
      cleaned = rangeMatch[1];
    }
    
    // Remove thousand separators (dots) and convert comma to decimal point
    cleaned = cleaned.replace(/\./g, '').replace(',', '.');
    
    const parsed = parseFloat(cleaned);
    
    // Validate: check for NaN
    if (isNaN(parsed)) {
      logger.warn('Invalid money value format', { original: value, cleaned });
      return 0;
    }
    
    // Validation: realistic salary range (R$ 1,000 to R$ 50,000)
    // Log warning for suspicious values but still return them (lenient approach)
    if (parsed < 1000) {
      logger.warn('Suspiciously low salary value detected', { 
        original: value, 
        parsed,
        threshold: 1000 
      });
    } else if (parsed > 50000) {
      logger.warn('Suspiciously high salary value detected', { 
        original: value, 
        parsed,
        threshold: 50000 
      });
    }
    
    return parsed;
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


