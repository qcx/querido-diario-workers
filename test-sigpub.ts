import { spiderRegistry } from './src/spiders/registry';

console.log('\n=== Teste de Configurações SIGPub ===\n');

// Get all SIGPub configurations
const sigpubConfigs = spiderRegistry.getConfigsByType('sigpub');

console.log(`Total de configurações SIGPub: ${sigpubConfigs.length}\n`);

// Display each configuration
for (const config of sigpubConfigs) {
  console.log(`ID: ${config.id}`);
  console.log(`Nome: ${config.name}`);
  console.log(`Territory ID: ${config.territoryId}`);
  console.log(`Start Date: ${config.startDate}`);
  console.log(`URL: ${config.config.url}`);
  console.log('---');
}

// Test spider creation
console.log('\n=== Teste de Criação de Spider ===\n');

const testConfig = sigpubConfigs[0];
if (testConfig) {
  try {
    const dateRange = {
      start: '2025-10-01',
      end: '2025-10-04'
    };
    
    const spider = spiderRegistry.createSpider(testConfig, dateRange);
    console.log(`✅ Spider criado com sucesso: ${testConfig.id}`);
    console.log(`   Tipo: ${spider.constructor.name}`);
  } catch (error) {
    console.error(`❌ Erro ao criar spider: ${error}`);
  }
}

console.log('\n=== Resumo ===\n');
console.log(`Estados configurados:`);
console.log(`  - Pernambuco (AMUPE): 184 municípios`);
console.log(`  - Ceará (APRECE): 184 municípios`);
console.log(`  - Paraíba (FAMUP): 223 municípios`);
console.log(`  - Rio Grande do Norte (FEMURN): 167 municípios`);
console.log(`\nTotal de municípios cobertos: 758`);
console.log(`Total de configurações: ${sigpubConfigs.length}\n`);
