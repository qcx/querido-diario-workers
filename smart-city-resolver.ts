#!/usr/bin/env bun

import { getUnmappedCities } from './resolve-remaining-cities';

interface IBGEMunicipality {
  id: number;
  nome: string;
}

class SmartCityResolver {
  private spMunicipalities: IBGEMunicipality[] = [];
  private cityIndex = new Map<string, string>(); // normalized name -> IBGE code

  async init() {
    console.log('📚 Loading IBGE municipalities database...');
    
    // Load the complete IBGE data
    const fs = require('fs');
    const ibgeData = JSON.parse(fs.readFileSync('./ibge-sp-municipios.json', 'utf8'));
    this.spMunicipalities = ibgeData;
    
    console.log(`✅ Loaded ${this.spMunicipalities.length} SP municipalities from IBGE`);
    
    // Create comprehensive index with all possible variations
    for (const municipality of this.spMunicipalities) {
      const variations = this.generateAllVariations(municipality.nome);
      
      for (const variation of variations) {
        const normalized = this.normalizeForMatching(variation);
        if (!this.cityIndex.has(normalized)) {
          this.cityIndex.set(normalized, municipality.id.toString());
        }
      }
    }
    
    console.log(`📝 Created index with ${this.cityIndex.size} name variations`);
  }

  private generateAllVariations(cityName: string): string[] {
    const variations = new Set<string>();
    
    // Original name
    variations.add(cityName);
    
    // Without accents
    const withoutAccents = cityName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
    variations.add(withoutAccents);
    
    // Common transformations
    const transformations = [
      // Saint variations
      (name: string) => name.replace(/^São\s+/i, 'Sao '),
      (name: string) => name.replace(/^Santa\s+/i, 'Santa '),
      (name: string) => name.replace(/^Santo\s+/i, 'Santo '),
      
      // Apostrophe variations
      (name: string) => name.replace(/d'Oeste/gi, 'D\'oeste'),
      (name: string) => name.replace(/D'Oeste/gi, 'd\'Oeste'), 
      (name: string) => name.replace(/d'oeste/gi, 'D\'Oeste'),
      
      // Hyphen variations
      (name: string) => name.replace(/-/g, ' '),
      (name: string) => name.replace(/\s+/g, '-'),
      
      // Common misspellings
      (name: string) => name.replace(/Luiz/gi, 'Luis'),
      (name: name) => name.replace(/Luis/gi, 'Luiz'),
    ];
    
    const currentVariations = Array.from(variations);
    for (const transformation of transformations) {
      for (const variation of currentVariations) {
        variations.add(transformation(variation));
      }
    }
    
    return Array.from(variations);
  }

  private normalizeForMatching(name: string): string {
    return name
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  findExactMatch(cityName: string): string | null {
    const normalized = this.normalizeForMatching(cityName);
    return this.cityIndex.get(normalized) || null;
  }

  findBestFuzzyMatch(cityName: string): { code: string; confidence: number; matchedName: string } | null {
    const targetNormalized = this.normalizeForMatching(cityName);
    let bestMatch: { code: string; confidence: number; matchedName: string } | null = null;
    
    for (const municipality of this.spMunicipalities) {
      const variations = this.generateAllVariations(municipality.nome);
      
      for (const variation of variations) {
        const normalized = this.normalizeForMatching(variation);
        const confidence = this.calculateSimilarity(targetNormalized, normalized);
        
        if (confidence > 0.85) { // High threshold
          if (!bestMatch || confidence > bestMatch.confidence) {
            bestMatch = {
              code: municipality.id.toString(),
              confidence,
              matchedName: municipality.nome
            };
          }
        }
      }
    }
    
    return bestMatch;
  }

  private calculateSimilarity(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;
    
    if (longer.length === 0) return 1.0;
    
    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
    
    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
    
    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,     // deletion
          matrix[j - 1][i] + 1,     // insertion
          matrix[j - 1][i - 1] + indicator // substitution
        );
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  async resolveAllRemaining(): Promise<void> {
    console.log('🔧 Smart City Resolver - Final Resolution');
    console.log('=======================================\n');
    
    const unmappedCities = await getUnmappedCities();
    
    // Filter out non-municipal entities
    const realCities = unmappedCities.filter(city => {
      const name = city.name.toLowerCase();
      const original = city.originalName.toLowerCase();
      
      const nonMunicipalKeywords = [
        'secretaria', 'departamento', 'hospital', 'fundação', 'instituto', 
        'consórcio', 'serviço', 'centro universitário', 'autarquia', 'união'
      ];
      
      return !nonMunicipalKeywords.some(keyword => 
        name.includes(keyword) || original.includes(keyword)
      );
    });
    
    console.log(`🎯 Processing ${realCities.length} real municipalities (filtered from ${unmappedCities.length} total entities)\n`);
    
    const newMappings: any[] = [];
    const exactMatches: string[] = [];
    const fuzzyMatches: string[] = [];
    const notFound: string[] = [];

    for (const [index, city] of realCities.entries()) {
      console.log(`🔍 [${index + 1}/${realCities.length}] ${city.name}...`);
      
      // Try exact match first
      const exactMatch = this.findExactMatch(city.name);
      
      if (exactMatch) {
        const municipality = this.spMunicipalities.find(m => m.id.toString() === exactMatch);
        console.log(`   ✅ EXACT: ${municipality?.nome} (${exactMatch})`);
        exactMatches.push(city.name);
        
        this.addToMappings(newMappings, city.name, exactMatch, municipality!.nome);
        continue;
      }
      
      // Try fuzzy match
      const fuzzyMatch = this.findBestFuzzyMatch(city.name);
      
      if (fuzzyMatch && fuzzyMatch.confidence > 0.85) {
        console.log(`   ✅ FUZZY: ${fuzzyMatch.matchedName} (${fuzzyMatch.code}) - ${(fuzzyMatch.confidence * 100).toFixed(1)}%`);
        fuzzyMatches.push(city.name);
        
        this.addToMappings(newMappings, city.name, fuzzyMatch.code, fuzzyMatch.matchedName);
        continue;
      }
      
      console.log(`   ❌ NOT FOUND: ${city.name}`);
      notFound.push(city.name);
    }

    // Update configuration file
    const fs = require('fs');
    const existingConfig = JSON.parse(fs.readFileSync('./src/spiders/configs/doe-sp-cities-generated.json', 'utf8'));
    
    // Merge and sort
    const allMappings = [...existingConfig, ...newMappings];
    allMappings.sort((a, b) => a.name.localeCompare(b.name));
    
    // Write updated file
    const configContent = JSON.stringify(allMappings, null, 2);
    fs.writeFileSync('./src/spiders/configs/doe-sp-cities-generated.json', configContent);

    console.log(`\n📊 Final Resolution Results:`);
    console.log(`   ✅ Exact matches: ${exactMatches.length}`);
    console.log(`   🎯 Fuzzy matches: ${fuzzyMatches.length}`);
    console.log(`   ❌ Not found: ${notFound.length}`);
    console.log(`   📄 New cities added: ${newMappings.length}`);
    console.log(`   🏛️  Total cities in config: ${allMappings.length}`);

    if (exactMatches.length > 0) {
      console.log(`\n🎉 Exact matches found:`);
      exactMatches.forEach(city => console.log(`   ✅ ${city}`));
    }

    if (fuzzyMatches.length > 0) {
      console.log(`\n🎯 Fuzzy matches found:`);
      fuzzyMatches.forEach(city => console.log(`   🎯 ${city}`));
    }

    if (notFound.length > 0) {
      console.log(`\n❌ Could not resolve (${notFound.length}):`);
      notFound.forEach(city => console.log(`   ❌ ${city}`));
    }

    console.log(`\n🎊 Smart resolution completed! Final total: ${allMappings.length} cities configured.`);
  }

  private addToMappings(mappings: any[], cityName: string, ibgeCode: string, officialName: string): void {
    const config = {
      id: `sp_${cityName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_')}`,
      name: `${officialName} - SP`,
      territoryId: ibgeCode,
      startDate: "2020-01-01",
      spiderType: "dosp" as const,
      config: {
        type: "dosp" as const,
        apiUrl: "https://do-api-web-search.doe.sp.gov.br/v2/summary/structured",
        journalId: "d65936d7-1ca8-4267-934e-1dea132fa237",
        sectionId: "b3477daf-479d-4f3d-7d60-08db6b94d2bf",
        territoryFilter: cityName.toUpperCase()
      }
    };
    
    mappings.push(config);
  }
}

async function main() {
  const resolver = new SmartCityResolver();
  
  try {
    await resolver.init();
    await resolver.resolveAllRemaining();
    
  } catch (error) {
    console.error('❌ Error in smart city resolution:', error);
  }
}

main().catch(console.error);
