/**
 * Smart Context Extraction Service
 * Extracts relevant text chunks using keyword-density scoring
 * Optimizes AI costs by sending only relevant content
 */

export interface ExtractionOptions {
  maxLength?: number;
  chunkSize?: number;
  overlapSize?: number;
  primaryKeywords?: string[];
  secondaryKeywords?: string[];
}

export interface ExtractionResult {
  text: string;
  score: number;
  startPosition: number;
  endPosition: number;
  keywordDensity: number;
  keywordsFoundCount: number;
}

export class ContextExtractor {
  /**
   * Extract the most relevant context from text using keyword-density scoring
   * This is the main method that should be used by analyzers
   */
  static extractRelevantContext(
    text: string,
    keywords: string[],
    maxLength: number = 2500,
    options?: ExtractionOptions
  ): string {
    if (!text || text.length === 0) {
      return '';
    }

    // If text is already small enough, return it
    if (text.length <= maxLength) {
      return text;
    }

    // Extract keywords categories
    const primaryKeywords = options?.primaryKeywords || keywords;
    const secondaryKeywords = options?.secondaryKeywords || [];

    // Find best chunk using keyword density
    const result = this.findBestChunk(
      text,
      primaryKeywords,
      secondaryKeywords,
      maxLength,
      options
    );

    return result.text;
  }

  /**
   * Extract context around a specific position in text
   * Useful when you know where the relevant content is
   */
  static extractAroundPosition(
    text: string,
    position: number,
    windowSize: number = 1500
  ): string {
    if (!text || text.length === 0) {
      return '';
    }

    const start = Math.max(0, position - windowSize);
    const end = Math.min(text.length, position + windowSize);
    
    let context = text.substring(start, end);
    
    // Add ellipsis if truncated
    if (start > 0) context = '...' + context;
    if (end < text.length) context = context + '...';
    
    return context.trim();
  }

  /**
   * Find the best chunk of text based on keyword density
   * Algorithm:
   * 1. Split text into overlapping chunks
   * 2. Score each chunk by keyword density
   * 3. Return highest-scoring chunk
   */
  private static findBestChunk(
    text: string,
    primaryKeywords: string[],
    secondaryKeywords: string[],
    maxLength: number,
    options?: ExtractionOptions
  ): ExtractionResult {
    const chunkSize = options?.chunkSize || maxLength;
    const overlapSize = options?.overlapSize || Math.floor(chunkSize * 0.2);
    
    const lowerText = text.toLowerCase();
    const chunks: ExtractionResult[] = [];
    
    // Generate chunks with overlap
    for (let i = 0; i < text.length; i += (chunkSize - overlapSize)) {
      const end = Math.min(i + chunkSize, text.length);
      const chunkText = text.substring(i, end);
      const chunkLower = lowerText.substring(i, end);
      
      // Score this chunk
      const score = this.scoreChunk(
        chunkLower,
        primaryKeywords,
        secondaryKeywords
      );
      
      // Count keywords found
      const keywordsFound = this.countKeywords(chunkLower, [
        ...primaryKeywords,
        ...secondaryKeywords,
      ]);
      
      // Calculate keyword density (keywords per 1000 chars)
      const density = (keywordsFound / chunkText.length) * 1000;
      
      chunks.push({
        text: chunkText,
        score,
        startPosition: i,
        endPosition: end,
        keywordDensity: density,
        keywordsFoundCount: keywordsFound,
      });
      
      // Stop if we've reached the end
      if (end >= text.length) break;
    }
    
    // Return chunk with highest score
    chunks.sort((a, b) => b.score - a.score);
    return chunks[0] || {
      text: text.substring(0, maxLength),
      score: 0,
      startPosition: 0,
      endPosition: maxLength,
      keywordDensity: 0,
      keywordsFoundCount: 0,
    };
  }

  /**
   * Score a text chunk based on keyword presence and density
   * Primary keywords get weight 1.0, secondary get weight 0.5
   */
  private static scoreChunk(
    chunkLower: string,
    primaryKeywords: string[],
    secondaryKeywords: string[]
  ): number {
    let score = 0;
    
    // Score primary keywords (weight: 1.0)
    for (const keyword of primaryKeywords) {
      const lowerKeyword = keyword.toLowerCase();
      const count = this.countOccurrences(chunkLower, lowerKeyword);
      score += count * 1.0;
    }
    
    // Score secondary keywords (weight: 0.5)
    for (const keyword of secondaryKeywords) {
      const lowerKeyword = keyword.toLowerCase();
      const count = this.countOccurrences(chunkLower, lowerKeyword);
      score += count * 0.5;
    }
    
    // Normalize by chunk length (prefer denser chunks)
    const normalizedScore = (score / chunkLower.length) * 1000;
    
    return normalizedScore;
  }

  /**
   * Count occurrences of a keyword in text
   */
  private static countOccurrences(text: string, keyword: string): number {
    let count = 0;
    let startIndex = 0;
    
    while (true) {
      const index = text.indexOf(keyword, startIndex);
      if (index === -1) break;
      count++;
      startIndex = index + keyword.length;
    }
    
    return count;
  }

  /**
   * Count total keywords found in text
   */
  private static countKeywords(text: string, keywords: string[]): number {
    let total = 0;
    for (const keyword of keywords) {
      total += this.countOccurrences(text, keyword.toLowerCase());
    }
    return total;
  }

  /**
   * Extract document-type-specific context for concurso documents
   */
  static extractConcursoContext(
    text: string,
    documentType: string,
    maxLength: number = 2500
  ): string {
    // Define document-type-specific keywords for better extraction
    const keywordsByType: Record<string, string[]> = {
      'edital_abertura': ['edital', 'vagas', 'inscrições', 'inscricoes', 'cargo', 'salário', 'salario'],
      'convocacao': ['convocação', 'convocacao', 'aprovados', 'candidatos', 'apresentação', 'apresentacao'],
      'homologacao': ['homologação', 'homologacao', 'resultado final', 'classificação', 'classificacao'],
      'retificacao': ['retificação', 'retificacao', 'alteração', 'alteracao', 'onde se lê', 'onde se le'],
      'prorrogacao': ['prorrogação', 'prorrogacao', 'prazo', 'data', 'adiamento'],
      'cancelamento': ['cancelamento', 'suspensão', 'suspensao', 'anulação', 'anulacao'],
      'resultado': ['resultado', 'gabarito', 'nota', 'classificação', 'classificacao'],
    };

    const keywords = keywordsByType[documentType] || [
      'concurso',
      'edital',
      'candidatos',
      'vagas',
    ];

    return this.extractRelevantContext(text, keywords, maxLength);
  }

  /**
   * Extract context for generic category classification
   */
  static extractGenericContext(
    text: string,
    detectedKeywords: string[],
    maxLength: number = 2500
  ): string {
    if (detectedKeywords.length === 0) {
      // No keywords, return beginning of text
      return text.substring(0, maxLength);
    }

    return this.extractRelevantContext(text, detectedKeywords, maxLength);
  }
}

