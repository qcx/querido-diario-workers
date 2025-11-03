/**
 * Territory Service - Maps territory IDs to city names and states
 */

interface TerritoryInfo {
  id: string;
  name: string;
  stateCode: string;
  territoryId: string;
  spiderType: string;
  region?: string;
  aliases?: string[];
}

export class TerritoryService {
  private static territoryMap: Map<string, TerritoryInfo> = new Map();
  private static initialized = false;

  /**
   * Get enriched territory information by territory ID
   */
  static getTerritoryInfo(territoryId: string): TerritoryInfo | null {
    if (!this.initialized) {
      this.initializeTerritoryMap();
    }
    return this.territoryMap.get(territoryId) || null;
  }

  /**
   * Get formatted city name with state (e.g., "Apuí - AM")
   */
  static getFormattedCityName(territoryId: string): string {
    const territory = this.getTerritoryInfo(territoryId);
    if (!territory) {
      return territoryId; // Fallback to territory ID
    }
    return `${territory.name} - ${territory.stateCode}`;
  }

  /**
   * Get state name from state code
   */
  static getStateName(stateCode: string): string {
    const stateNames: { [key: string]: string } = {
      'AC': 'Acre',
      'AL': 'Alagoas', 
      'AP': 'Amapá',
      'AM': 'Amazonas',
      'BA': 'Bahia',
      'CE': 'Ceará',
      'DF': 'Distrito Federal',
      'ES': 'Espírito Santo',
      'GO': 'Goiás',
      'MA': 'Maranhão',
      'MT': 'Mato Grosso',
      'MS': 'Mato Grosso do Sul',
      'MG': 'Minas Gerais',
      'PA': 'Pará',
      'PB': 'Paraíba',
      'PR': 'Paraná',
      'PE': 'Pernambuco',
      'PI': 'Piauí',
      'RJ': 'Rio de Janeiro',
      'RN': 'Rio Grande do Norte',
      'RS': 'Rio Grande do Sul',
      'RO': 'Rondônia',
      'RR': 'Roraima',
      'SC': 'Santa Catarina',
      'SP': 'São Paulo',
      'SE': 'Sergipe',
      'TO': 'Tocantins'
    };
    return stateNames[stateCode] || stateCode;
  }

  /**
   * Get region from state code
   */
  static getRegion(stateCode: string): string {
    const regions: { [key: string]: string } = {
      'AC': 'Norte', 'AM': 'Norte', 'AP': 'Norte', 'PA': 'Norte', 'RO': 'Norte', 'RR': 'Norte', 'TO': 'Norte',
      'AL': 'Nordeste', 'BA': 'Nordeste', 'CE': 'Nordeste', 'MA': 'Nordeste', 'PB': 'Nordeste', 'PE': 'Nordeste', 'PI': 'Nordeste', 'RN': 'Nordeste', 'SE': 'Nordeste',
      'DF': 'Centro-Oeste', 'GO': 'Centro-Oeste', 'MT': 'Centro-Oeste', 'MS': 'Centro-Oeste',
      'ES': 'Sudeste', 'MG': 'Sudeste', 'RJ': 'Sudeste', 'SP': 'Sudeste',
      'PR': 'Sul', 'RS': 'Sul', 'SC': 'Sul'
    };
    return regions[stateCode] || 'Unknown';
  }

  /**
   * Initialize territory map with ALL territories from spider registry
   */
  private static initializeTerritoryMap(): void {
    // Import spider registry to get all cities
    const { spiderRegistry } = require('../spiders/registry');
    const allConfigs = spiderRegistry.getAllConfigs();

    // Convert spider configs to territory info
    allConfigs.forEach(config => {
      const stateCode = this.extractStateFromConfig(config);
      
      const territory: TerritoryInfo = {
        id: config.id,
        name: config.name || this.extractCityNameFromConfig(config),
        stateCode: stateCode,
        territoryId: config.territoryId,
        spiderType: config.spiderType,
        aliases: config.aliases // Include aliases from spider config
      };

      this.territoryMap.set(config.territoryId, territory);
    });

    console.log(`🗺️ TerritoryService loaded ${this.territoryMap.size} territories from spider registry`);
    this.initialized = true;
  }

  /**
   * Extract state code from spider config
   */
  private static extractStateFromConfig(config: any): string {
    // Try to get state code from ID (e.g., "pr_4104204" -> "PR")
    if (config.id && config.id.includes('_')) {
      const parts = config.id.split('_');
      if (parts.length >= 2) {
        return parts[0].toUpperCase();
      }
    }
    
    // Try to extract from territoryId IBGE code
    if (config.territoryId) {
      return this.extractStateFromTerritoryId(config.territoryId);
    }

    return 'UF';
  }

  /**
   * Extract city name from spider config
   */
  private static extractCityNameFromConfig(config: any): string {
    // Use the name field if available
    if (config.name) {
      // Remove state suffix (e.g., "Campo Largo - PR" -> "Campo Largo")
      return config.name.replace(/\s*-\s*[A-Z]{2}$/, '');
    }

    // Fallback to territory ID
    return config.territoryId || config.id || 'Unknown City';
  }

  /**
   * Create enriched territory information for webhooks
   */
  static createEnrichedTerritoryInfo(territoryId: string | undefined) {
    // Handle undefined/null territoryId gracefully
    if (!territoryId) {
      return {
        territoryId: 'unknown',
        territoryName: 'Unknown Territory',
        cityName: 'Unknown City',
        stateCode: 'UF',
        stateName: 'Unknown State',
        region: 'Unknown Region',
        formattedName: 'Unknown Territory',
        spiderType: 'unknown'
      };
    }

    // Try to get from our territory map first
    const territory = this.getTerritoryInfo(territoryId);
    
    if (territory) {
      return {
        territoryId,
        territoryName: territory.name,
        cityName: territory.name,
        stateCode: territory.stateCode,
        stateName: this.getStateName(territory.stateCode),
        region: this.getRegion(territory.stateCode),
        formattedName: `${territory.name} - ${territory.stateCode}`,
        spiderType: territory.spiderType
      };
    }

    // Simple fallback - just return basic info
    return {
      territoryId,
      territoryName: territoryId,
      cityName: territoryId,
      stateCode: 'UF',
      stateName: 'Unknown State',
      region: 'Unknown Region',
      formattedName: territoryId,
      spiderType: 'unknown'
    };
  }

  /**
   * Extract state code from territory ID (Enhanced IBGE mapping)
   */
  private static extractStateFromTerritoryId(territoryId: string): string {
    // Handle edge cases gracefully
    if (!territoryId || typeof territoryId !== 'string' || territoryId.length < 7) {
      return 'UF';
    }
      
    // Enhanced IBGE mapping based on first 2 digits
    const prefix = territoryId.substring(0, 2);
    
    // Norte
    if (prefix === '11') return 'RO'; // Rondônia
    if (prefix === '12') return 'AC'; // Acre
    if (prefix === '13') return 'AM'; // Amazonas
    if (prefix === '14') return 'RR'; // Roraima
    if (prefix === '15') return 'PA'; // Pará
    if (prefix === '16') return 'AP'; // Amapá
    if (prefix === '17') return 'TO'; // Tocantins
    
    // Nordeste
    if (prefix === '21') return 'MA'; // Maranhão
    if (prefix === '22') return 'PI'; // Piauí
    if (prefix === '23') return 'CE'; // Ceará
    if (prefix === '24') return 'RN'; // Rio Grande do Norte
    if (prefix === '25') return 'PB'; // Paraíba
    if (prefix === '26') return 'PE'; // Pernambuco
    if (prefix === '27') return 'AL'; // Alagoas
    if (prefix === '28') return 'SE'; // Sergipe
    if (prefix === '29') return 'BA'; // Bahia
    
    // Sudeste
    if (prefix === '31') return 'MG'; // Minas Gerais
    if (prefix === '32') return 'ES'; // Espírito Santo
    if (prefix === '33') return 'RJ'; // Rio de Janeiro
    if (prefix === '35') return 'SP'; // São Paulo
    
    // Sul
    if (prefix === '41') return 'PR'; // Paraná
    if (prefix === '42') return 'SC'; // Santa Catarina
    if (prefix === '43') return 'RS'; // Rio Grande do Sul
    
    // Centro-Oeste
    if (prefix === '50') return 'MS'; // Mato Grosso do Sul
    if (prefix === '51') return 'MT'; // Mato Grosso
    if (prefix === '52') return 'GO'; // Goiás
    if (prefix === '53') return 'DF'; // Distrito Federal
    
    return 'UF'; // Default fallback
  }
}
