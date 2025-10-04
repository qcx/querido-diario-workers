/**
 * Verify if there are more SIGPub municipalities to implement
 */

import * as fs from 'fs';

async function verifySigpubCoverage() {
  console.log('🔍 Verificando Cobertura Real do SIGPub\n');
  console.log('='.repeat(80));

  // Load SIGPub cities configuration
  const sigpubCitiesPath = 'src/spiders/configs/sigpub-cities.json';
  
  if (!fs.existsSync(sigpubCitiesPath)) {
    console.log('❌ Arquivo sigpub-cities.json não encontrado');
    return;
  }

  const sigpubCities = JSON.parse(fs.readFileSync(sigpubCitiesPath, 'utf-8'));
  
  console.log(`\n📊 Estatísticas do SIGPub\n`);
  console.log(`Total de municípios configurados: ${sigpubCities.length}`);
  
  // Group by state
  const byState: Record<string, number> = {};
  
  for (const city of sigpubCities) {
    const state = city.stateCode || city.id.substring(0, 2).toUpperCase();
    byState[state] = (byState[state] || 0) + 1;
  }
  
  console.log(`\nEstados cobertos: ${Object.keys(byState).length}`);
  console.log('\n📍 Municípios por Estado:\n');
  
  const sortedStates = Object.entries(byState).sort((a, b) => b[1] - a[1]);
  
  for (const [state, count] of sortedStates) {
    console.log(`${state}: ${count.toString().padStart(4)} municípios`);
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('\n🎯 Análise de Estados Não Cobertos pelo SIGPub\n');
  
  const brazilStates = [
    'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
    'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
    'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
  ];
  
  const uncoveredStates = brazilStates.filter(state => !byState[state]);
  
  if (uncoveredStates.length > 0) {
    console.log('Estados SEM cobertura SIGPub:');
    console.log(uncoveredStates.join(', '));
  } else {
    console.log('✅ Todos os estados têm pelo menos alguma cobertura SIGPub!');
  }
  
  console.log('\n' + '='.repeat(80));
  console.log('\n💡 Conclusão\n');
  
  if (uncoveredStates.length > 0) {
    console.log(`⚠️  SIGPub NÃO cobre ${uncoveredStates.length} estados.`);
    console.log('   Esses estados precisam de outras plataformas ou não têm presença SIGPub.');
  } else {
    console.log('✅ SIGPub tem presença em todos os 27 estados!');
    console.log('   A estratégia de "expandir SIGPub" pode não ser viável.');
  }
  
  console.log('\n📝 Recomendação:\n');
  console.log('   1. Verificar se os 1.573 municípios SIGPub já estão todos implementados');
  console.log('   2. Se sim, focar em OUTRAS plataformas para expandir cobertura');
  console.log('   3. Pesquisar plataformas dominantes nos estados não cobertos (SP, BA, etc.)');
  
  console.log('\n' + '='.repeat(80));
}

verifySigpubCoverage()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Verification failed:', error);
    console.error(error.stack);
    process.exit(1);
  });
