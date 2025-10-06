#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

interface CityConfig {
  id: string;
  name: string;
  territoryId: string;
  stateCode?: string;
  spiderType?: string;
}

interface StateCoverage {
  state: string;
  total: number;
  unique: number;
  totalConfigs: number;
  uniquePercentage: number;
  fallbacks: number;
}

// Total municipalities per state (IBGE 2023) - TODOS OS ESTADOS
const STATE_TOTALS: Record<string, number> = {
  'AC': 22, 'AL': 102, 'AP': 16, 'AM': 62, 'BA': 417, 'CE': 184,
  'DF': 1, 'ES': 78, 'GO': 246, 'MA': 217, 'MT': 141, 'MS': 79,
  'MG': 853, 'PA': 144, 'PB': 223, 'PE': 185, 'PI': 224, 'PR': 399,
  'RJ': 92, 'RN': 167, 'RO': 52, 'RR': 15, 'RS': 497, 'SC': 295,
  'SE': 75, 'SP': 645, 'TO': 139
};

// Estado completo names for context
const STATE_NAMES: Record<string, string> = {
  'AC': 'Acre', 'AL': 'Alagoas', 'AP': 'Amapá', 'AM': 'Amazonas', 'BA': 'Bahia', 'CE': 'Ceará',
  'DF': 'Distrito Federal', 'ES': 'Espírito Santo', 'GO': 'Goiás', 'MA': 'Maranhão', 'MT': 'Mato Grosso', 
  'MS': 'Mato Grosso do Sul', 'MG': 'Minas Gerais', 'PA': 'Pará', 'PB': 'Paraíba', 'PE': 'Pernambuco', 
  'PI': 'Piauí', 'PR': 'Paraná', 'RJ': 'Rio de Janeiro', 'RN': 'Rio Grande do Norte', 'RO': 'Rondônia', 
  'RR': 'Roraima', 'RS': 'Rio Grande do Sul', 'SC': 'Santa Catarina', 'SE': 'Sergipe', 'SP': 'São Paulo', 
  'TO': 'Tocantins'
};

async function main() {
  console.log('📝 Atualizando README com todos os estados brasileiros...\n');

  // Read the fallback registry
  const registryPath = resolve(__dirname, 'src/spiders/configs/fallback-registry.json');
  const registry = JSON.parse(readFileSync(registryPath, 'utf-8'));
  
  console.log(`📊 Carregando dados do registry:`);
  console.log(`   🎯 ${registry.metadata.totalTerritories} territórios únicos`);
  console.log(`   📊 ${registry.metadata.totalConfigurations} configurações totais`);
  console.log(`   🔄 ${registry.metadata.totalFallbacks} fallbacks\n`);

  // Group by state
  const stateCounts = new Map<string, { unique: number; totalConfigs: number }>();
  
  for (const territory of registry.territories) {
    const state = territory.stateCode;
    const current = stateCounts.get(state) || { unique: 0, totalConfigs: 0 };
    
    current.unique += 1;
    current.totalConfigs += 1 + territory.fallbacks.length;
    
    stateCounts.set(state, current);
  }

  // Generate coverage for ALL states
  const coverage: StateCoverage[] = [];
  
  for (const [state, total] of Object.entries(STATE_TOTALS)) {
    const stats = stateCounts.get(state) || { unique: 0, totalConfigs: 0 };
    const uniquePercentage = (stats.unique / total) * 100;
    const fallbacks = stats.totalConfigs - stats.unique;
    
    coverage.push({
      state,
      total,
      unique: stats.unique,
      totalConfigs: stats.totalConfigs,
      uniquePercentage,
      fallbacks
    });
  }

  // Sort by coverage percentage (descending)
  coverage.sort((a, b) => b.uniquePercentage - a.uniquePercentage);

  // Calculate totals
  const totalMunicipalities = Object.values(STATE_TOTALS).reduce((a, b) => a + b, 0);
  const totalUnique = registry.metadata.totalTerritories;
  const totalConfigs = registry.metadata.totalConfigurations;
  const totalFallbacks = registry.metadata.totalFallbacks;
  const nationalCoverage = registry.metadata.nationalCoverage;

  console.log(`📈 COBERTURA NACIONAL COMPLETA:`);
  console.log(`   🎯 Únicos: ${totalUnique} de ${totalMunicipalities} (${nationalCoverage.toFixed(1)}%)`);
  console.log(`   📊 Total configs: ${totalConfigs}`);
  console.log(`   🔄 Fallbacks: ${totalFallbacks}`);
  console.log(`   📍 Estados cobertos: ${coverage.filter(c => c.unique > 0).length}/27\n`);

  // Generate complete markdown table with ALL states
  let markdownTable = `|| UF | Estado | Total | Únicos | Configs | Cobertura | Fallbacks | Progresso |\n`;
  markdownTable += `|----|--------|-------|---------|---------|-----------|-----------|-------|\n`;

  for (const { state, total, unique, totalConfigs, uniquePercentage, fallbacks } of coverage) {
    const progressBar = generateProgressBar(uniquePercentage);
    const stateName = STATE_NAMES[state];
    
    if (unique > 0) {
      markdownTable += `|| **${state}** | ${stateName} | ${total} | ${unique} | ${totalConfigs} | **${uniquePercentage.toFixed(1)}%** | +${fallbacks} | \`${progressBar}\` |\n`;
    } else {
      markdownTable += `|| ${state} | ${stateName} | ${total} | 0 | 0 | 0.0% | +0 | \`${progressBar}\` |\n`;
    }
  }

  console.log('📋 Tabela completa com todos os estados:\n');
  console.log(markdownTable);

  // Update README.md completely
  updateReadmeComplete(nationalCoverage, totalUnique, totalMunicipalities, totalConfigs, totalFallbacks, markdownTable);

  console.log('✅ README atualizado com todos os estados!');
  console.log(`   📊 ${coverage.filter(c => c.unique > 0).length} estados com cobertura`);
  console.log(`   🚫 ${coverage.filter(c => c.unique === 0).length} estados sem cobertura`);
  console.log(`   🔄 Sistema de fallback documentado`);
}

function generateProgressBar(percentage: number): string {
  const filled = Math.min(20, Math.max(0, Math.round(percentage / 5))); // 20 chars, each represents 5%
  const empty = Math.max(0, 20 - filled);
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function updateReadmeComplete(
  nationalCoverage: number, 
  totalUnique: number, 
  totalMunicipalities: number, 
  totalConfigs: number,
  totalFallbacks: number,
  markdownTable: string
) {
  const readmePath = resolve(__dirname, 'README.md');
  
  try {
    let content = readFileSync(readmePath, 'utf-8');
    
    // Update features section
    content = content.replace(
      /- ✅ \*\*[\d,]+ Cities\*\*:.*?national coverage\*\*\)/,
      `- ✅ **${totalUnique.toLocaleString()} Cities**: ${totalConfigs.toLocaleString()} total configs with fallback system (**${nationalCoverage.toFixed(1)}% national coverage**)`
    );
    
    // Clean up and update national coverage section
    const coverageStart = content.indexOf('## 📊 National Coverage');
    const nextSectionStart = content.indexOf('## ', coverageStart + 1);
    
    const newCoverageSection = `## 📊 National Coverage

**${totalUnique.toLocaleString()} of ${totalMunicipalities.toLocaleString()} Brazilian municipalities (${nationalCoverage.toFixed(1)}%)**

**🔄 Fallback System**: ${totalConfigs.toLocaleString()} total configurations providing ${totalFallbacks.toLocaleString()} fallbacks for improved reliability.

### Coverage by State

${markdownTable}

*Sistema de fallback implementado: múltiplas configurações por território garantem maior confiabilidade.*

*Last updated: ${new Date().toISOString().split('T')[0]}*

`;

    content = content.substring(0, coverageStart) + newCoverageSection + content.substring(nextSectionStart);
    
    writeFileSync(readmePath, content);
    console.log('   ✅ README.md completamente atualizado');
  } catch (error) {
    console.error('❌ Erro ao atualizar README.md:', error);
  }
}

main().catch(console.error);
