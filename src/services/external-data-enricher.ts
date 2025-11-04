/**
 * External Data Enricher Service
 * Enriches concurso data with external sources and territory normalization
 */

import { logger } from '../utils';
import { TerritoryService } from './territory-service';

export interface TerritoryMatch {
  original: string;
  matched: boolean;
  territoryId?: string;
  normalizedName?: string;
  confidence: number;
  suggestions?: string[];
}

export interface EnrichmentCache {
  cnpjCache: Map<string, any>;
  territoryCache: Map<string, TerritoryMatch>;
}

/**
 * Territory normalizer
 */
export class TerritoryNormalizer {
  /**
   * Normalize city name and find territory ID
   */
  static async normalize(cityName: string): Promise<TerritoryMatch> {
    if (!cityName) {
      return {
        original: cityName,
        matched: false,
        confidence: 0,
      };
    }

    const result: TerritoryMatch = {
      original: cityName,
      matched: false,
      confidence: 0,
    };

    try {
      // Clean city name
      const cleaned = this.cleanCityName(cityName);
      
      // Try exact match first
      const exactMatch = await this.findExactMatch(cleaned);
      if (exactMatch) {
        return {
          ...result,
          matched: true,
          territoryId: exactMatch.territoryId,
          normalizedName: exactMatch.name,
          confidence: 1.0,
        };
      }

      // Try fuzzy match
      const fuzzyMatch = await this.findFuzzyMatch(cleaned);
      if (fuzzyMatch) {
        return {
          ...result,
          matched: true,
          territoryId: fuzzyMatch.territoryId,
          normalizedName: fuzzyMatch.name,
          confidence: fuzzyMatch.confidence,
          suggestions: fuzzyMatch.suggestions,
        };
      }

      return result;
    } catch (error) {
      logger.debug('Failed to normalize territory', { cityName, error });
      return result;
    }
  }

  /**
   * Clean city name for matching
   */
  private static cleanCityName(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // Remove accents
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s]/g, ''); // Remove special characters
  }

  /**
   * Find exact territory match
   */
  private static async findExactMatch(cleanedName: string): Promise<any> {
    // This would query the territory database
    // For now, using TerritoryService which has a static mapping
    
    // Try to extract state code if present
    const stateMatch = cleanedName.match(/\b([A-Z]{2})\b/);
    
    // Common variations
    const variations = [
      cleanedName,
      cleanedName.replace(/\bmunicip(io|al)\b/gi, '').trim(),
      cleanedName.replace(/\bprefeitura\b/gi, '').trim(),
    ];

    for (const variation of variations) {
      // Note: TerritoryService.getTerritoryInfo requires a territory ID
      // We need to search by name, which isn't directly supported
      // This is a placeholder for future database query
      
      // TODO: Implement database query for territory by name
    }

    return null;
  }

  /**
   * Find fuzzy territory match
   */
  private static async findFuzzyMatch(cleanedName: string): Promise<any> {
    // Implement fuzzy matching using Levenshtein distance or similar
    // This would query the territory database and find closest matches
    
    // TODO: Implement fuzzy matching algorithm
    return null;
  }

  /**
   * Normalize multiple cities
   */
  static async normalizeMultiple(cityNames: string[]): Promise<TerritoryMatch[]> {
    const results: TerritoryMatch[] = [];
    
    for (const cityName of cityNames) {
      const match = await this.normalize(cityName);
      results.push(match);
    }

    return results;
  }

  /**
   * Extract cities from text
   */
  static extractCitiesFromText(text: string): string[] {
    const cities: string[] = [];
    
    // Pattern 1: "Município de [City]"
    const pattern1 = /munic[ií]pio\s+de\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç\s]+)/gi;
    let match;
    while ((match = pattern1.exec(text)) !== null) {
      cities.push(match[1].trim());
    }

    // Pattern 2: "Cidade: [City]" or "Cidades: [City1], [City2]"
    const pattern2 = /cidades?:\s*([^.\n]+)/gi;
    while ((match = pattern2.exec(text)) !== null) {
      const citiesList = match[1].split(/[,;]/);
      cities.push(...citiesList.map(c => c.trim()));
    }

    // Pattern 3: "Prefeitura Municipal de [City]"
    const pattern3 = /prefeitura\s+municipal\s+de\s+([A-ZÁÉÍÓÚÂÊÔÃÕÇ][a-záéíóúâêôãõç\s]+)/gi;
    while ((match = pattern3.exec(text)) !== null) {
      cities.push(match[1].trim());
    }

    // Remove duplicates and filter out very short names
    const unique = [...new Set(cities)];
    return unique.filter(c => c.length >= 3);
  }

  /**
   * Validate territory ID format
   */
  static validateTerritoryId(territoryId: string): boolean {
    // Brazilian IBGE territory codes are 7 digits
    return /^\d{7}$/.test(territoryId);
  }
}

/**
 * CNPJ data enricher (stub for future API integration)
 */
export class CNPJEnricher {
  private static cache: Map<string, any> = new Map();
  
  /**
   * Enrich banca data with CNPJ information
   * Note: This is a stub. Real implementation would call Receita Federal API
   */
  static async enrichBancaData(cnpj: string, bancaName?: string): Promise<any> {
    if (!cnpj) return null;

    // Check cache first
    const cached = this.cache.get(cnpj);
    if (cached) {
      return cached;
    }

    // TODO: Implement Receita Federal API integration
    // For now, return basic validation
    const result = {
      cnpj,
      validated: false,
      source: 'local',
      razaoSocial: bancaName || null,
      situacao: 'unknown',
      dataConsulta: new Date().toISOString(),
    };

    // Cache result (with TTL of 24 hours in production)
    this.cache.set(cnpj, result);

    return result;
  }

  /**
   * Validate CNPJ online (stub)
   */
  static async validateOnline(cnpj: string): Promise<boolean> {
    // TODO: Implement online validation
    // This would call an external API to validate CNPJ
    logger.info('CNPJ online validation not implemented yet', { cnpj });
    return false;
  }

  /**
   * Clear cache
   */
  static clearCache(): void {
    this.cache.clear();
  }
}

/**
 * Common known banca organizations
 */
export const KNOWN_BANCAS = {
  'FGV': {
    fullName: 'Fundação Getulio Vargas',
    cnpj: '33.641.663/0001-44',
  },
  'CESPE': {
    fullName: 'Centro de Seleção e de Promoção de Eventos',
    cnpj: '00.038.174/0001-43',
  },
  'CESGRANRIO': {
    fullName: 'Fundação CESGRANRIO',
    cnpj: '29.220.114/0001-06',
  },
  'FCC': {
    fullName: 'Fundação Carlos Chagas',
    cnpj: '60.727.302/0001-04',
  },
  'VUNESP': {
    fullName: 'Fundação para o Vestibular da UNESP',
    cnpj: '55.236.832/0001-02',
  },
  'FUNDEP': {
    fullName: 'Fundação de Desenvolvimento da Pesquisa',
    cnpj: '17.523.299/0001-65',
  },
  'INSTITUTO AOCP': {
    fullName: 'Instituto AOCP',
    cnpj: '07.588.949/0001-83',
  },
  'IBFC': {
    fullName: 'Instituto Brasileiro de Formação e Capacitação',
    cnpj: '10.687.412/0001-01',
  },
};

/**
 * External data enricher service
 */
export class ExternalDataEnricher {
  /**
   * Enrich concurso data with external information
   */
  static async enrichConcursoData(data: any): Promise<any> {
    const enriched = { ...data };
    const externalData: any = {};

    // Enrich cities with territory IDs
    if (data.cidades && Array.isArray(data.cidades)) {
      const enrichedCities = await this.enrichCities(data.cidades);
      enriched.cidades = enrichedCities;
      externalData.citiesEnriched = true;
    }

    // Enrich banca with known data
    if (data.banca) {
      const enrichedBanca = await this.enrichBanca(data.banca);
      if (enrichedBanca) {
        enriched.banca = { ...enriched.banca, ...enrichedBanca };
        externalData.bancaEnriched = true;
      }
    }

    // Add external enrichment metadata
    enriched._externalEnrichment = {
      ...externalData,
      enrichedAt: new Date().toISOString(),
    };

    return enriched;
  }

  /**
   * Enrich cities array with territory information
   */
  private static async enrichCities(cidades: any[]): Promise<any[]> {
    const enriched: any[] = [];

    for (const cidade of cidades) {
      const cityName = typeof cidade === 'string' ? cidade : cidade.nome;
      
      if (!cityName) {
        enriched.push(cidade);
        continue;
      }

      const territoryMatch = await TerritoryNormalizer.normalize(cityName);
      
      enriched.push({
        ...(typeof cidade === 'object' ? cidade : {}),
        nome: cityName,
        territoryId: territoryMatch.territoryId,
        normalizedName: territoryMatch.normalizedName || cityName,
        matched: territoryMatch.matched,
        confidence: territoryMatch.confidence,
      });
    }

    return enriched;
  }

  /**
   * Enrich banca with known information
   */
  private static async enrichBanca(banca: any): Promise<any> {
    if (!banca.nome) return null;

    const bancaName = banca.nome.toUpperCase().trim();
    
    // Check if it's a known banca
    for (const [key, data] of Object.entries(KNOWN_BANCAS)) {
      if (bancaName.includes(key)) {
        return {
          fullName: data.fullName,
          knownBanca: true,
          abbreviation: key,
          // Only add CNPJ if not already present
          ...((!banca.cnpj || !banca.cnpj_valid) && { cnpj: data.cnpj, cnpj_valid: true }),
        };
      }
    }

    // If CNPJ is present, try to enrich
    if (banca.cnpj) {
      const enrichedData = await CNPJEnricher.enrichBancaData(banca.cnpj, banca.nome);
      if (enrichedData) {
        return {
          externalData: enrichedData,
        };
      }
    }

    return null;
  }
}

