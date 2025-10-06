#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

interface CityConfig {
  id: string;
  name: string;
  territoryId: string;
  stateCode?: string;
  spiderType?: string;
  startDate?: string;
  config?: any;
}

interface ConfigFile {
  municipalities?: CityConfig[];
  cities?: CityConfig[];
  total?: number;
}

interface TerritoryFallback {
  territoryId: string;
  name: string;
  stateCode: string;
  configs: CityConfig[];
}

interface StateCoverage {
  state: string;
  total: number;
  unique: number;      // Unique territories covered
  totalConfigs: number; // Total configurations (with fallbacks)
  uniquePercentage: number;
}

// Total municipalities per state (IBGE 2023)
const STATE_TOTALS: Record<string, number> = {
  'AC': 22, 'AL': 102, 'AP': 16, 'AM': 62, 'BA': 417, 'CE': 184,
  'DF': 1, 'ES': 78, 'GO': 246, 'MA': 217, 'MT': 141, 'MS': 79,
  'MG': 853, 'PA': 144, 'PB': 223, 'PR': 399, 'PE': 185, 'PI': 224,
  'RJ': 92, 'RN': 167, 'RS': 497, 'RO': 52, 'RR': 15, 'SC': 295,
  'SP': 645, 'SE': 75, 'TO': 139
};

async function main() {
  console.log('🔄 Implementando sistema de fallback para municípios...\n');

  const configDir = resolve(__dirname, 'src/spiders/configs');
  const territoryMap = new Map<string, TerritoryFallback>();
  let totalConfigs = 0;

  // Read all city configuration files
  const configFiles = [
    'doe-sp-cities.json',
    'sigpub-cities.json', 
    'dom-sc-cities.json',
    'diario-ba-cities.json',
    'amm-mt-cities.json',
    'siganet_cities.json',
    'ptio-cities.json',
    'municipio-online-cities.json',
    'modernizacao-cities.json',
    'instar-cities.json',
    'dosp-cities.json',
    'diof-cities.json',
    'dioenet-cities.json',
    'diario-oficial-br-cities.json',
    'barco_digital_cities.json',
    'atende-v2-cities.json',
    'aplus-cities.json',
    'administracao-publica-cities.json',
    'adiarios-v2-cities.json',
    'adiarios-v1-cities.json',
    'doem-cities.json'
  ];

  for (const fileName of configFiles) {
    const filePath = resolve(configDir, fileName);
    
    try {
      console.log(`📄 Processando ${fileName}...`);
      const content = readFileSync(filePath, 'utf-8');
      const config: ConfigFile = JSON.parse(content);
      
      // Handle different file formats
      let cities: CityConfig[] = [];
      if (Array.isArray(config)) {
        cities = config;
      } else if (config.municipalities) {
        cities = config.municipalities;
      } else if (config.cities) {
        cities = config.cities;
      }

      console.log(`   ✅ ${cities.length} configurações encontradas`);
      totalConfigs += cities.length;

      for (const city of cities) {
        const territoryId = city.territoryId;
        const stateCode = city.stateCode || getStateFromTerritoryId(territoryId);
        
        // Add spider type from filename if not present
        const spiderType = city.spiderType || inferSpiderTypeFromFile(fileName);
        
        const enrichedConfig = {
          ...city,
          stateCode,
          spiderType,
          source: fileName
        };

        if (territoryMap.has(territoryId)) {
          // Add as fallback
          const existing = territoryMap.get(territoryId)!;
          existing.configs.push(enrichedConfig);
          
          // Update name to the most descriptive one
          if (city.name && !isServiceName(city.name) && city.name.length > existing.name.length) {
            existing.name = city.name;
          }
        } else {
          // Create new territory entry
          territoryMap.set(territoryId, {
            territoryId,
            name: city.name,
            stateCode,
            configs: [enrichedConfig]
          });
        }
      }
    } catch (error) {
      console.error(`❌ Erro ao processar ${fileName}:`, error);
    }
  }

  // Generate fallback statistics
  console.log('\n📊 Estatísticas do Sistema de Fallback:\n');
  
  let territoriesWithFallback = 0;
  let maxFallbacks = 0;
  const fallbackCounts = new Map<number, number>();

  for (const territory of territoryMap.values()) {
    const fallbackCount = territory.configs.length;
    fallbackCounts.set(fallbackCount, (fallbackCounts.get(fallbackCount) || 0) + 1);
    
    if (fallbackCount > 1) {
      territoriesWithFallback++;
      maxFallbacks = Math.max(maxFallbacks, fallbackCount);
    }
  }

  console.log(`🎯 Territórios únicos: ${territoryMap.size}`);
  console.log(`📝 Total de configurações: ${totalConfigs}`);
  console.log(`🔄 Territórios com fallback: ${territoriesWithFallback}`);
  console.log(`📈 Máximo de fallbacks: ${maxFallbacks}\n`);

  // Show fallback distribution
  console.log('🔢 Distribuição de fallbacks:');
  for (let i = 1; i <= maxFallbacks; i++) {
    const count = fallbackCounts.get(i) || 0;
    if (count > 0) {
      console.log(`   ${i} config${i > 1 ? 's' : ' '}: ${count} territórios`);
    }
  }

  // Generate coverage by state
  console.log('\n📊 Cobertura por Estado (com sistema de fallback):\n');
  const coverage: StateCoverage[] = [];
  const stateCounts = new Map<string, { unique: number; totalConfigs: number }>();
  
  for (const territory of territoryMap.values()) {
    const state = territory.stateCode;
    const current = stateCounts.get(state) || { unique: 0, totalConfigs: 0 };
    
    current.unique += 1;
    current.totalConfigs += territory.configs.length;
    
    stateCounts.set(state, current);
  }

  for (const [state, total] of Object.entries(STATE_TOTALS)) {
    const stats = stateCounts.get(state) || { unique: 0, totalConfigs: 0 };
    const uniquePercentage = (stats.unique / total) * 100;
    
    coverage.push({
      state,
      total,
      unique: stats.unique,
      totalConfigs: stats.totalConfigs,
      uniquePercentage
    });
  }

  // Sort by coverage percentage (descending)
  coverage.sort((a, b) => b.uniquePercentage - a.uniquePercentage);

  // Calculate totals
  const totalMunicipalities = Object.values(STATE_TOTALS).reduce((a, b) => a + b, 0);
  const totalUnique = Array.from(stateCounts.values()).reduce((sum, stats) => sum + stats.unique, 0);
  const totalConfigsCount = Array.from(stateCounts.values()).reduce((sum, stats) => sum + stats.totalConfigs, 0);
  const nationalCoverage = (totalUnique / totalMunicipalities) * 100;

  console.log(`📈 COBERTURA NACIONAL:`);
  console.log(`   🎯 Únicos: ${totalUnique} de ${totalMunicipalities} (${nationalCoverage.toFixed(1)}%)`);
  console.log(`   📊 Total configs: ${totalConfigsCount} (${(totalConfigsCount - totalUnique)} fallbacks)`);
  console.log(`   🔄 Redundância média: ${(totalConfigsCount / totalUnique).toFixed(1)}x\n`);

  // Generate markdown table with fallback info
  let markdownTable = `|| UF | Total | Unique | Configs | Coverage | Fallbacks | Progress |\n`;
  markdownTable += `|----|-------|--------|---------|----------|-----------|----------|\n`;

  for (const { state, total, unique, totalConfigs, uniquePercentage } of coverage) {
    if (unique > 0) {
      const fallbacks = totalConfigs - unique;
      const progressBar = generateProgressBar(uniquePercentage);
      markdownTable += `|| **${state}** | ${total} | ${unique} | ${totalConfigs} | **${uniquePercentage.toFixed(1)}%** | +${fallbacks} | \`${progressBar}\` |\n`;
    }
  }

  // Add states with no coverage
  const noCoverageStates = coverage
    .filter(c => c.unique === 0)
    .map(c => c.state)
    .join(', ');
  
  const noCoverageTotal = coverage
    .filter(c => c.unique === 0)
    .reduce((sum, c) => sum + c.total, 0);

  if (noCoverageStates) {
    markdownTable += `|| Other states (${noCoverageStates}) | ${noCoverageTotal} | 0 | 0 | 0.0% | +0 | \`░░░░░░░░░░░░░░░░░░░░\` |\n`;
  }

  console.log('📋 Nova tabela Markdown (com sistema de fallback):\n');
  console.log(markdownTable);

  // Generate fallback registry file
  const fallbackRegistry = {
    metadata: {
      generatedAt: new Date().toISOString(),
      totalTerritories: territoryMap.size,
      totalConfigurations: totalConfigsCount,
      totalFallbacks: totalConfigsCount - territoryMap.size,
      nationalCoverage: nationalCoverage
    },
    territories: Array.from(territoryMap.values()).map(territory => ({
      territoryId: territory.territoryId,
      name: territory.name,
      stateCode: territory.stateCode,
      primary: territory.configs[0],
      fallbacks: territory.configs.slice(1)
    }))
  };

  // Save fallback registry
  const registryPath = resolve(configDir, 'fallback-registry.json');
  writeFileSync(registryPath, JSON.stringify(fallbackRegistry, null, 2));
  console.log(`\n💾 Registry de fallbacks salvo: ${registryPath}`);

  // Show examples of territories with most fallbacks
  const topFallbacks = Array.from(territoryMap.values())
    .sort((a, b) => b.configs.length - a.configs.length)
    .slice(0, 10);

  console.log('\n🔝 Top 10 territórios com mais fallbacks:\n');
  topFallbacks.forEach((territory, index) => {
    console.log(`   ${index + 1}. ${territory.name} (${territory.territoryId})`);
    console.log(`      📍 ${territory.configs.length} configurações:`);
    territory.configs.forEach((config, i) => {
      console.log(`         ${i === 0 ? '🥇' : '🥈'} ${config.spiderType} - ${config.source}`);
    });
    console.log('');
  });

  // Update README with new coverage info
  updateReadmeWithFallbacks(nationalCoverage, totalUnique, totalMunicipalities, totalConfigsCount, markdownTable);

  console.log('✅ Sistema de fallback implementado!');
  console.log(`   🎯 ${totalUnique} territórios únicos (${nationalCoverage.toFixed(1)}%)`);
  console.log(`   📊 ${totalConfigsCount} configurações totais`);
  console.log(`   🔄 ${totalConfigsCount - totalUnique} fallbacks disponíveis`);
  console.log(`   💾 Registry salvo em: fallback-registry.json`);
}

function getStateFromTerritoryId(territoryId: string): string {
  const prefix = territoryId.substring(0, 2);
  
  const stateMap: Record<string, string> = {
    '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
    '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
    '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
    '41': 'PR', '42': 'SC', '43': 'RS',
    '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF'
  };
  
  return stateMap[prefix] || 'UNKNOWN';
}

function inferSpiderTypeFromFile(fileName: string): string {
  return fileName.replace('-cities.json', '').replace('_cities.json', '');
}

function isServiceName(name: string): boolean {
  const serviceKeywords = [
    'secretaria', 'instituto', 'fundação', 'consórcio', 'departamento',
    'serviço', 'autarquia', 'hospital', 'bombeiros', 'desenvolvimento'
  ];
  
  return serviceKeywords.some(keyword => 
    name.toLowerCase().includes(keyword)
  );
}

function generateProgressBar(percentage: number): string {
  const filled = Math.min(20, Math.max(0, Math.round(percentage / 5))); // 20 chars, each represents 5%
  const empty = Math.max(0, 20 - filled);
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function updateReadmeWithFallbacks(nationalCoverage: number, totalUnique: number, totalMunicipalities: number, totalConfigs: number, markdownTable: string) {
  const readmePath = resolve(__dirname, 'README.md');
  
  try {
    let content = readFileSync(readmePath, 'utf-8');
    
    // Update features section with fallback info
    content = content.replace(
      /- ✅ \*\*[\d,]+ Cities\*\*: \d+\+ platform types implemented \(\*\*[\d.]+% national coverage\*\*\)/,
      `- ✅ **${totalUnique.toLocaleString()} Cities**: ${totalConfigs.toLocaleString()} total configs with fallback system (**${nationalCoverage.toFixed(1)}% national coverage**)`
    );
    
    // Update national coverage section
    content = content.replace(
      /\*\*[\d,]+ of [\d,]+ Brazilian municipalities \([\d.]+%\)\*\*/,
      `**${totalUnique.toLocaleString()} of ${totalMunicipalities.toLocaleString()} Brazilian municipalities (${nationalCoverage.toFixed(1)}%)**`
    );
    
    // Add fallback info after national coverage
    const coverageLineIndex = content.indexOf('Brazilian municipalities');
    if (coverageLineIndex !== -1) {
      const lineEnd = content.indexOf('\n', coverageLineIndex);
      const fallbackInfo = `\n\n**🔄 Fallback System**: ${totalConfigs.toLocaleString()} total configurations providing ${(totalConfigs - totalUnique).toLocaleString()} fallbacks for improved reliability.`;
      content = content.substring(0, lineEnd) + fallbackInfo + content.substring(lineEnd);
    }
    
    // Update coverage table
    const tableStart = content.indexOf('|| UF | Total | Covered | Coverage | Progress |');
    if (tableStart !== -1) {
      const tableEnd = content.indexOf('\n\n', tableStart);
      const beforeTable = content.substring(0, tableStart);
      const afterTable = content.substring(tableEnd);
      content = beforeTable + markdownTable + afterTable;
    }
    
    writeFileSync(readmePath, content);
    console.log('   ✅ README.md atualizado com sistema de fallback');
  } catch (error) {
    console.error('❌ Erro ao atualizar README.md:', error);
  }
}

main().catch(console.error);
