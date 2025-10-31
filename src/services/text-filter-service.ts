/**
 * Text Filter Service - Intelligent filtering of gazette text by city/territory
 * 
 * Filters large state gazette OCR results to extract only sections relevant to specific cities.
 * Uses text normalization, pattern matching, and alias support for accurate filtering.
 */

import { logger } from '../utils';

export interface FilterResult {
  filteredText: string;
  originalLength: number;
  filteredLength: number;
  sectionsFound: number;
  reductionPercentage: number;
}

export interface SectionHeader {
  header: string;
  startIndex: number;
  normalizedHeader: string;
}

export class TextFilterService {
  /**
   * Filter text to include only sections relevant to a specific city
   * 
   * @param text - Full OCR text from state gazette
   * @param cityName - Primary name of the city (e.g., "Alta Floresta D'Oeste")
   * @param aliases - Additional name variations (e.g., ["Alta Floresta", "Alta Floresta D Oeste"])
   * @param includeContext - Whether to include surrounding paragraphs for context
   * @returns Filtered text containing only city-relevant sections
   */
  static filterTextByCity(
    text: string,
    cityName: string,
    aliases?: string[],
    includeContext: boolean = true
  ): FilterResult {
    if (!text || text.trim().length === 0) {
      return {
        filteredText: '',
        originalLength: 0,
        filteredLength: 0,
        sectionsFound: 0,
        reductionPercentage: 100,
      };
    }

    const originalLength = text.length;

    // Get all name variations for matching
    const nameVariations = this.getCityNameVariations(cityName, aliases);
    
    // Normalize all variations for matching
    const normalizedVariations = nameVariations.map(v => this.normalizeText(v));

    // Split text into sections (paragraphs separated by double newlines)
    const sections = text.split(/\n\n+/);
    
    // Filter relevant sections
    const relevantSectionIndices = new Set<number>();
    
    sections.forEach((section, index) => {
      const normalizedSection = this.normalizeText(section);
      
      // Check if section contains any city name variation
      const isRelevant = normalizedVariations.some(variation => 
        normalizedSection.includes(variation)
      );
      
      if (isRelevant) {
        relevantSectionIndices.add(index);
        
        // Include surrounding context (previous and next paragraphs)
        if (includeContext) {
          if (index > 0) {
            relevantSectionIndices.add(index - 1);
          }
          if (index < sections.length - 1) {
            relevantSectionIndices.add(index + 1);
          }
        }
      }
    });

    // Extract relevant sections in order
    const relevantSections = Array.from(relevantSectionIndices)
      .sort((a, b) => a - b)
      .map(index => sections[index]);

    const filteredText = relevantSections.join('\n\n');
    const filteredLength = filteredText.length;
    const reductionPercentage = originalLength > 0 
      ? Math.round(((originalLength - filteredLength) / originalLength) * 100)
      : 0;

    logger.debug('Text filtered by city', {
      cityName,
      originalLength,
      filteredLength,
      sectionsFound: relevantSectionIndices.size,
      reductionPercentage: `${reductionPercentage}%`,
      variationsUsed: nameVariations.length,
    });

    return {
      filteredText,
      originalLength,
      filteredLength,
      sectionsFound: relevantSectionIndices.size,
      reductionPercentage,
    };
  }

  /**
   * Normalize text for matching by removing accents, special characters, and normalizing whitespace
   * 
   * @param text - Text to normalize
   * @returns Normalized text in lowercase
   */
  static normalizeText(text: string): string {
    return text
      // Convert to lowercase
      .toLowerCase()
      // Remove accents using NFD decomposition
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      // Replace common variations
      .replace(/d'oeste/gi, 'd oeste')
      .replace(/d'agua/gi, 'd agua')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Get all possible name variations for a city
   * Includes common abbreviations, prefixes, and provided aliases
   * 
   * @param cityName - Primary city name
   * @param aliases - Additional name variations from config
   * @returns Array of all possible name variations
   */
  static getCityNameVariations(cityName: string, aliases?: string[]): string[] {
    const variations = new Set<string>();
    
    // Add original name
    variations.add(cityName);
    
    // Add aliases from config
    if (aliases && aliases.length > 0) {
      aliases.forEach(alias => variations.add(alias));
    }

    // Generate common variations
    const names = [cityName, ...(aliases || [])];
    
    names.forEach(name => {
      // Add base name
      variations.add(name);
      
      // Handle São/Santa/Santo variations
      if (name.includes('São')) {
        variations.add(name.replace('São', 'S.'));
        variations.add(name.replace('São', 'Sao'));
        variations.add(name.replace('São', 'S'));
      }
      
      if (name.includes('Santa')) {
        variations.add(name.replace('Santa', 'Sta.'));
        variations.add(name.replace('Santa', 'Sta'));
      }
      
      if (name.includes('Santo')) {
        variations.add(name.replace('Santo', 'Sto.'));
        variations.add(name.replace('Santo', 'Sto'));
      }

      // Handle D'Oeste, D'Água variations
      if (name.includes("D'")) {
        variations.add(name.replace("D'", 'D '));
        variations.add(name.replace("D'", 'd'));
      }

      // Add official prefixes (common in gazette headers)
      variations.add(`Prefeitura de ${name}`);
      variations.add(`Prefeitura Municipal de ${name}`);
      variations.add(`Município de ${name}`);
      variations.add(`Municipio de ${name}`); // Without accent
      variations.add(`Câmara Municipal de ${name}`);
      variations.add(`Camara Municipal de ${name}`); // Without accent
      variations.add(`Secretaria Municipal de ${name}`);
      variations.add(`Governo Municipal de ${name}`);
      
      // Add uppercase version for header matching
      variations.add(name.toUpperCase());
      variations.add(`MUNICÍPIO DE ${name.toUpperCase()}`);
      variations.add(`PREFEITURA MUNICIPAL DE ${name.toUpperCase()}`);
    });

    return Array.from(variations);
  }

  /**
   * Detect section headers in text that might indicate city boundaries
   * Useful for more sophisticated filtering in the future
   * 
   * @param text - Text to analyze
   * @returns Array of detected section headers with their positions
   */
  static detectSectionHeaders(text: string): SectionHeader[] {
    const headers: SectionHeader[] = [];
    
    // Common header patterns in Brazilian official gazettes
    const headerPatterns = [
      /^MUNICÍPIO DE ([A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞ\s'-]+)$/gm,
      /^PREFEITURA MUNICIPAL DE ([A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞ\s'-]+)$/gm,
      /^CÂMARA MUNICIPAL DE ([A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞ\s'-]+)$/gm,
      /^GOVERNO MUNICIPAL DE ([A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞ\s'-]+)$/gm,
    ];

    headerPatterns.forEach(pattern => {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        headers.push({
          header: match[0],
          startIndex: match.index,
          normalizedHeader: this.normalizeText(match[0]),
        });
      }
    });

    // Sort by position in text
    return headers.sort((a, b) => a.startIndex - b.startIndex);
  }

  /**
   * Filter text by detecting section boundaries (more advanced filtering)
   * This can be used when header patterns are reliable
   * 
   * @param text - Full text
   * @param cityName - City to filter for
   * @param aliases - City name aliases
   * @returns Filtered text containing only the city's section
   */
  static filterTextBySectionBoundaries(
    text: string,
    cityName: string,
    aliases?: string[]
  ): FilterResult {
    const headers = this.detectSectionHeaders(text);
    
    if (headers.length === 0) {
      // Fallback to paragraph-based filtering
      logger.debug('No section headers detected, using paragraph-based filtering');
      return this.filterTextByCity(text, cityName, aliases);
    }

    const nameVariations = this.getCityNameVariations(cityName, aliases);
    const normalizedVariations = nameVariations.map(v => this.normalizeText(v));

    // Find the header matching this city
    const cityHeaderIndex = headers.findIndex(header => 
      normalizedVariations.some(variation => 
        header.normalizedHeader.includes(variation)
      )
    );

    if (cityHeaderIndex === -1) {
      // City section not found, fallback to paragraph filtering
      logger.debug('City section header not found, using paragraph-based filtering');
      return this.filterTextByCity(text, cityName, aliases);
    }

    // Extract text from this city's header to the next header (or end of text)
    const startIndex = headers[cityHeaderIndex].startIndex;
    const endIndex = cityHeaderIndex < headers.length - 1
      ? headers[cityHeaderIndex + 1].startIndex
      : text.length;

    const filteredText = text.substring(startIndex, endIndex).trim();
    const originalLength = text.length;
    const filteredLength = filteredText.length;
    const reductionPercentage = Math.round(((originalLength - filteredLength) / originalLength) * 100);

    logger.debug('Text filtered by section boundaries', {
      cityName,
      originalLength,
      filteredLength,
      reductionPercentage: `${reductionPercentage}%`,
      sectionIndex: cityHeaderIndex,
      totalSections: headers.length,
    });

    return {
      filteredText,
      originalLength,
      filteredLength,
      sectionsFound: 1,
      reductionPercentage,
    };
  }
}

