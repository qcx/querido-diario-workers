#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

interface CityConfig {
  id: string;
  name: string;
  territoryId: string;
  stateCode?: string;
}

interface ConfigFile {
  municipalities?: CityConfig[];
  cities?: CityConfig[];
  total?: number;
}

interface StateCoverage {
  state: string;
  total: number;
  covered: number;
  percentage: number;
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
  console.log('🔍 Verificando cobertura nacional de municípios...\n');

  const configDir = resolve(__dirname, 'src/spiders/configs');
  const cityConfigs = new Map<string, CityConfig>();
  const duplicates: Array<{ territoryId: string; configs: CityConfig[] }> = [];
  const stateCounts = new Map<string, number>();

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
        // File is directly an array
        cities = config;
      } else if (config.municipalities) {
        cities = config.municipalities;
      } else if (config.cities) {
        cities = config.cities;
      }

      console.log(`   ✅ ${cities.length} municípios encontrados`);

      for (const city of cities) {
        const territoryId = city.territoryId;
        
        // Determine state from territoryId
        const stateCode = city.stateCode || getStateFromTerritoryId(territoryId);
        
        // Check for duplicates
        if (cityConfigs.has(territoryId)) {
          const existing = cityConfigs.get(territoryId)!;
          duplicates.push({
            territoryId,
            configs: [existing, { ...city, stateCode }]
          });
        } else {
          cityConfigs.set(territoryId, { ...city, stateCode });
        }

        // Count by state
        stateCounts.set(stateCode, (stateCounts.get(stateCode) || 0) + 1);
      }
    } catch (error) {
      console.error(`❌ Erro ao processar ${fileName}:`, error);
    }
  }

  // Report duplicates
  console.log('\n🔍 Verificando duplicações...');
  if (duplicates.length > 0) {
    console.log(`\n⚠️  ${duplicates.length} duplicações encontradas:\n`);
    duplicates.forEach(dup => {
      console.log(`   🔴 TerritoryId: ${dup.territoryId}`);
      dup.configs.forEach((config, index) => {
        console.log(`      ${index + 1}. ${config.name} (${config.id})`);
      });
      console.log('');
    });
  } else {
    console.log('   ✅ Nenhuma duplicação encontrada!');
  }

  // Generate coverage report
  console.log('\n📊 Cobertura por Estado:\n');
  const coverage: StateCoverage[] = [];
  
  for (const [state, total] of Object.entries(STATE_TOTALS)) {
    const covered = stateCounts.get(state) || 0;
    const percentage = (covered / total) * 100;
    
    coverage.push({
      state,
      total,
      covered,
      percentage
    });
  }

  // Sort by coverage percentage (descending)
  coverage.sort((a, b) => b.percentage - a.percentage);

  // Calculate totals
  const totalMunicipalities = Object.values(STATE_TOTALS).reduce((a, b) => a + b, 0);
  const totalCovered = Array.from(stateCounts.values()).reduce((a, b) => a + b, 0);
  const nationalCoverage = (totalCovered / totalMunicipalities) * 100;

  console.log(`📈 COBERTURA NACIONAL: ${totalCovered} de ${totalMunicipalities} (${nationalCoverage.toFixed(1)}%)\n`);

  // Generate markdown table
  let markdownTable = `|| UF | Total | Covered | Coverage | Progress |\n`;
  markdownTable += `|----|-------|---------|----------|----------|\n`;

  for (const { state, total, covered, percentage } of coverage) {
    if (covered > 0) {
      const progressBar = generateProgressBar(percentage);
      markdownTable += `|| **${state}** | ${total} | ${covered} | **${percentage.toFixed(1)}%** | \`${progressBar}\` |\n`;
    }
  }

  // Add states with no coverage
  const noCoverageStates = coverage
    .filter(c => c.covered === 0)
    .map(c => c.state)
    .join(', ');
  
  const noCoverageTotal = coverage
    .filter(c => c.covered === 0)
    .reduce((sum, c) => sum + c.total, 0);

  if (noCoverageStates) {
    markdownTable += `|| Other states (${noCoverageStates}) | ${noCoverageTotal} | 0 | 0.0% | \`░░░░░░░░░░░░░░░░░░░░\` |\n`;
  }

  console.log('📋 Tabela Markdown gerada:\n');
  console.log(markdownTable);

  // Update README.md
  updateReadmeFile(nationalCoverage, totalCovered, totalMunicipalities, markdownTable);

  console.log('\n✅ Atualização concluída!');
  console.log(`   📊 ${totalCovered} municípios cobertos (${nationalCoverage.toFixed(1)}%)`);
  console.log(`   🔄 README.md atualizado`);
  if (duplicates.length > 0) {
    console.log(`   ⚠️  ${duplicates.length} duplicações encontradas (verifique acima)`);
  }
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

function generateProgressBar(percentage: number): string {
  const filled = Math.min(20, Math.max(0, Math.round(percentage / 5))); // 20 chars, each represents 5%
  const empty = Math.max(0, 20 - filled);
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function updateReadmeFile(nationalCoverage: number, totalCovered: number, totalMunicipalities: number, markdownTable: string) {
  const readmePath = resolve(__dirname, 'README.md');
  
  try {
    let content = readFileSync(readmePath, 'utf-8');
    
    // Update national coverage in features section
    content = content.replace(
      /- ✅ \*\*\d+,?\d* Cities\*\*: \d+ platform types implemented \(\*\*[\d.]+% national coverage\*\*\)/,
      `- ✅ **${totalCovered.toLocaleString()} Cities**: 17+ platform types implemented (**${nationalCoverage.toFixed(1)}% national coverage**)`
    );
    
    // Update national coverage section
    content = content.replace(
      /\*\*\d+,?\d* of \d+,?\d* Brazilian municipalities \([\d.]+%\)\*\*/,
      `**${totalCovered.toLocaleString()} of ${totalMunicipalities.toLocaleString()} Brazilian municipalities (${nationalCoverage.toFixed(1)}%)**`
    );
    
    // Update coverage table
    const tableStart = content.indexOf('|| UF | Total | Covered | Coverage | Progress |');
    const tableEnd = content.indexOf('|| Other states', tableStart);
    
    if (tableStart !== -1 && tableEnd !== -1) {
      const beforeTable = content.substring(0, tableStart);
      const afterTableLine = content.substring(content.indexOf('|\n', tableEnd) + 2);
      content = beforeTable + markdownTable + afterTableLine;
    }
    
    writeFileSync(readmePath, content);
    console.log('   ✅ README.md atualizado');
  } catch (error) {
    console.error('❌ Erro ao atualizar README.md:', error);
  }
}

main().catch(console.error);
