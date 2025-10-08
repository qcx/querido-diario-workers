/**
 * Proximity Analyzer Utilities
 * Provides proximity-aware text analysis for better pattern matching
 */

export interface KeywordPosition {
  keyword: string;
  position: number; // Character position in text
  wordIndex: number; // Word index in document
  context: string; // Surrounding text
}

export interface ProximityResult {
  distance: number; // Distance in words
  charDistance: number; // Distance in characters
  sameWindow: boolean;
  sameParagraph: boolean;
  proximityScore: number; // 0-1 score based on distance
}

export interface TextWindow {
  text: string;
  startPos: number;
  endPos: number;
  wordCount: number;
}

export class ProximityAnalyzer {
  // Window sizes (in words)
  private static readonly WINDOW_SIZE = 500;
  private static readonly WINDOW_OVERLAP = 100;
  private static readonly PARAGRAPH_THRESHOLD = 50; // words
  private static readonly SECTION_THRESHOLD = 200; // words
  private static readonly PAGE_THRESHOLD = 500; // words

  /**
   * Find all positions of keywords in text
   */
  static findKeywordPositions(
    text: string,
    keywords: string[],
    caseSensitive: boolean = false
  ): KeywordPosition[] {
    const positions: KeywordPosition[] = [];
    const searchText = caseSensitive ? text : text.toLowerCase();
    const words = text.split(/\s+/);
    let currentWordIndex = 0;
    let currentCharIndex = 0;

    // Build word position map
    const wordPositions: Array<{ start: number; end: number; word: string }> = [];
    for (const word of words) {
      const wordStart = text.indexOf(word, currentCharIndex);
      wordPositions.push({
        start: wordStart,
        end: wordStart + word.length,
        word,
      });
      currentCharIndex = wordStart + word.length;
    }

    // Find each keyword
    for (const keyword of keywords) {
      const searchKeyword = caseSensitive ? keyword : keyword.toLowerCase();
      let lastIndex = 0;

      while (true) {
        const index = searchText.indexOf(searchKeyword, lastIndex);
        if (index === -1) break;

        // Find which word this position belongs to
        const wordIndex = wordPositions.findIndex(
          (wp) => index >= wp.start && index < wp.end
        );

        // Extract context (50 chars before and after)
        const contextStart = Math.max(0, index - 50);
        const contextEnd = Math.min(text.length, index + keyword.length + 50);
        const context = text.substring(contextStart, contextEnd);

        positions.push({
          keyword,
          position: index,
          wordIndex: wordIndex !== -1 ? wordIndex : currentWordIndex,
          context,
        });

        lastIndex = index + keyword.length;
      }
    }

    return positions.sort((a, b) => a.position - b.position);
  }

  /**
   * Calculate proximity between two keyword positions
   */
  static calculateProximity(
    pos1: KeywordPosition,
    pos2: KeywordPosition
  ): ProximityResult {
    const wordDistance = Math.abs(pos1.wordIndex - pos2.wordIndex);
    const charDistance = Math.abs(pos1.position - pos2.position);

    // Calculate proximity score based on word distance
    let proximityScore = 1.0;
    if (wordDistance <= this.PARAGRAPH_THRESHOLD) {
      proximityScore = 1.0; // Same paragraph
    } else if (wordDistance <= this.SECTION_THRESHOLD) {
      proximityScore = 0.8; // Same section
    } else if (wordDistance <= this.PAGE_THRESHOLD) {
      proximityScore = 0.6; // Same page
    } else {
      proximityScore = 0.3; // Different pages
    }

    return {
      distance: wordDistance,
      charDistance,
      sameWindow: wordDistance <= this.WINDOW_SIZE,
      sameParagraph: wordDistance <= this.PARAGRAPH_THRESHOLD,
      proximityScore,
    };
  }

  /**
   * Create sliding windows from text
   */
  static createSlidingWindows(text: string): TextWindow[] {
    const windows: TextWindow[] = [];
    const words = text.split(/\s+/);
    
    for (let i = 0; i < words.length; i += this.WINDOW_SIZE - this.WINDOW_OVERLAP) {
      const windowWords = words.slice(i, i + this.WINDOW_SIZE);
      const windowText = windowWords.join(' ');
      
      // Find actual character positions
      const firstWord = windowWords[0];
      const lastWord = windowWords[windowWords.length - 1];
      const startPos = text.indexOf(firstWord, i > 0 ? windows[windows.length - 1]?.startPos || 0 : 0);
      const endPos = text.indexOf(lastWord, startPos) + lastWord.length;
      
      windows.push({
        text: windowText,
        startPos,
        endPos,
        wordCount: windowWords.length,
      });
      
      // Stop if we've processed all words
      if (i + this.WINDOW_SIZE >= words.length) break;
    }
    
    return windows;
  }

  /**
   * Find best keyword group within proximity constraints
   */
  static findBestKeywordGroup(
    positions: KeywordPosition[],
    requiredKeywords: string[],
    maxDistance: number = 200
  ): {
    keywords: KeywordPosition[];
    averageProximity: number;
    allRequiredFound: boolean;
  } | null {
    if (positions.length === 0) return null;

    let bestGroup: KeywordPosition[] = [];
    let bestScore = 0;

    // Try each position as a starting point
    for (let i = 0; i < positions.length; i++) {
      const group: KeywordPosition[] = [positions[i]];
      const foundKeywords = new Set([positions[i].keyword.toLowerCase()]);

      // Find all keywords within maxDistance
      for (let j = 0; j < positions.length; j++) {
        if (i === j) continue;

        const proximity = this.calculateProximity(positions[i], positions[j]);
        if (proximity.distance <= maxDistance) {
          group.push(positions[j]);
          foundKeywords.add(positions[j].keyword.toLowerCase());
        }
      }

      // Calculate group score
      const uniqueKeywords = group.map(p => p.keyword.toLowerCase()).filter((v, i, a) => a.indexOf(v) === i);
      const requiredCount = requiredKeywords.filter(k => foundKeywords.has(k.toLowerCase())).length;
      const score = (requiredCount / requiredKeywords.length) * uniqueKeywords.length;

      if (score > bestScore) {
        bestScore = score;
        bestGroup = group;
      }
    }

    if (bestGroup.length === 0) return null;

    // Calculate average proximity
    let totalProximity = 0;
    let proximityCount = 0;
    for (let i = 0; i < bestGroup.length - 1; i++) {
      for (let j = i + 1; j < bestGroup.length; j++) {
        const proximity = this.calculateProximity(bestGroup[i], bestGroup[j]);
        totalProximity += proximity.proximityScore;
        proximityCount++;
      }
    }

    const averageProximity = proximityCount > 0 ? totalProximity / proximityCount : 1.0;
    const foundKeywords = new Set(bestGroup.map(p => p.keyword.toLowerCase()));
    const allRequiredFound = requiredKeywords.every(k => foundKeywords.has(k.toLowerCase()));

    return {
      keywords: bestGroup,
      averageProximity,
      allRequiredFound,
    };
  }

  /**
   * Extract potential document structure (titles, headers)
   */
  static extractDocumentStructure(text: string): {
    titles: Array<{ text: string; position: number; confidence: number }>;
    sections: Array<{ text: string; position: number; level: number }>;
  } {
    const titles: Array<{ text: string; position: number; confidence: number }> = [];
    const sections: Array<{ text: string; position: number; level: number }> = [];
    
    const lines = text.split('\n');
    let currentPos = 0;

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip empty lines
      if (!trimmedLine) {
        currentPos += line.length + 1;
        continue;
      }

      // Check for title patterns
      // ALL CAPS and short
      if (trimmedLine.length < 100 && trimmedLine === trimmedLine.toUpperCase() && /[A-Z]/.test(trimmedLine)) {
        titles.push({
          text: trimmedLine,
          position: currentPos,
          confidence: 0.9,
        });
      }
      
      // Numbered sections (e.g., "1. ", "1.1 ", "Art. 1º")
      if (/^(\d+\.?\d*\s+|Art\.\s*\d+|CAPÍTULO\s+[IVXLCDM]+|SEÇÃO\s+[IVXLCDM]+)/i.test(trimmedLine)) {
        const level = (trimmedLine.match(/\./g) || []).length + 1;
        sections.push({
          text: trimmedLine.substring(0, 100),
          position: currentPos,
          level,
        });
      }

      currentPos += line.length + 1;
    }

    return { titles, sections };
  }

  /**
   * Calculate proximity multiplier based on distance
   */
  static getProximityMultiplier(wordDistance: number): number {
    if (wordDistance <= this.PARAGRAPH_THRESHOLD) {
      return 1.5; // Same paragraph - highest boost
    } else if (wordDistance <= this.SECTION_THRESHOLD) {
      return 1.3; // Same section - good boost
    } else if (wordDistance <= this.PAGE_THRESHOLD) {
      return 1.1; // Same page - small boost
    } else {
      return 0.8; // Different pages - penalty
    }
  }
}
