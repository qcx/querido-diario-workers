/**
 * Script de teste para os spiders de Goiás (GO) e Santa Catarina (SC)
 */
import { spiderRegistry } from './src/spiders/registry';
import { DateRange } from './src/types';

async function testSpiders() {
  console.log('=== Testando Spiders GO e SC ===\n');

  // Testar spider de Goiás (AGM/SIGPub)
  console.log('1. Testando spider de Goiás (AGM)...');
  const goConfigs = spiderRegistry.getConfigsByType('sigpub')
    .filter(c => c.id.startsWith('go_'));
  
  console.log(`   Encontrados ${goConfigs.length} municípios de GO configurados`);
  
  if (goConfigs.length > 0) {
    const sampleGO = goConfigs[0];
    console.log(`   Exemplo: ${sampleGO.name} (${sampleGO.id})`);
    console.log(`   Config:`, JSON.stringify(sampleGO.config, null, 2));
  }

  // Testar spider de Santa Catarina (DOM/SC)
  console.log('\n2. Testando spider de Santa Catarina (DOM/SC)...');
  const scConfigs = spiderRegistry.getConfigsByType('dom_sc');
  
  console.log(`   Encontrados ${scConfigs.length} municípios de SC configurados`);
  
  if (scConfigs.length > 0) {
    const sampleSC = scConfigs[0];
    console.log(`   Exemplo: ${sampleSC.name} (${sampleSC.id})`);
    console.log(`   Config:`, JSON.stringify(sampleSC.config, null, 2));
  }

  // Estatísticas gerais
  console.log('\n3. Estatísticas gerais:');
  console.log(`   Total de spiders registrados: ${spiderRegistry.getCount()}`);
  console.log(`   Spiders GO (SIGPub): ${goConfigs.length}`);
  console.log(`   Spiders SC (DOM/SC): ${scConfigs.length}`);
  
  // Tentar criar uma instância de spider
  console.log('\n4. Testando criação de instâncias...');
  
  const dateRange: DateRange = {
    start: '2025-01-01',
    end: '2025-01-31'
  };

  try {
    if (goConfigs.length > 0) {
      const goSpider = spiderRegistry.createSpider(goConfigs[0], dateRange);
      console.log(`   ✓ Spider GO criado com sucesso: ${goSpider.constructor.name}`);
    }
  } catch (error) {
    console.log(`   ✗ Erro ao criar spider GO:`, error);
  }

  try {
    if (scConfigs.length > 0) {
      const scSpider = spiderRegistry.createSpider(scConfigs[0], dateRange);
      console.log(`   ✓ Spider SC criado com sucesso: ${scSpider.constructor.name}`);
    }
  } catch (error) {
    console.log(`   ✗ Erro ao criar spider SC:`, error);
  }

  console.log('\n=== Teste concluído ===');
}

testSpiders().catch(console.error);
