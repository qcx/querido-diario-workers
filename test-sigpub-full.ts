import { spiderRegistry } from './src/spiders/registry';

console.log('\n=== Teste Completo de Funcionalidade SIGPub ===\n');

async function testAllStates() {
  const sigpubConfigs = spiderRegistry.getConfigsByType('sigpub');
  
  console.log(`📋 Total de configurações SIGPub: ${sigpubConfigs.length}\n`);

  // Test date range - last 3 days
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 3);
  
  const dateRange = {
    start: startDate.toISOString().split('T')[0],
    end: endDate.toISOString().split('T')[0]
  };
  
  console.log(`📅 Período de teste: ${dateRange.start} até ${dateRange.end}\n`);
  console.log('─'.repeat(80) + '\n');

  let totalSuccess = 0;
  let totalErrors = 0;
  let totalGazettes = 0;

  for (const config of sigpubConfigs) {
    console.log(`\n🔍 Testando: ${config.name}`);
    console.log(`   ID: ${config.id}`);
    console.log(`   URL: ${config.config.url}`);
    console.log(`   Territory ID: ${config.territoryId}`);
    
    try {
      // Create spider
      const spider = spiderRegistry.createSpider(config, dateRange);
      console.log(`   ✅ Spider criado com sucesso`);
      
      // Attempt to crawl
      console.log(`   🕷️  Iniciando crawl...`);
      const startTime = Date.now();
      
      const gazettes = await spider.crawl();
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      console.log(`   ⏱️  Tempo de execução: ${duration}s`);
      console.log(`   📰 Diários encontrados: ${gazettes.length}`);
      
      if (gazettes.length > 0) {
        console.log(`\n   📄 Exemplo de diário encontrado:`);
        const example = gazettes[0];
        console.log(`      - Data: ${example.date}`);
        console.log(`      - URL: ${example.url}`);
        console.log(`      - Edição: ${example.edition_number || 'N/A'}`);
        console.log(`      - Poder: ${example.power || 'N/A'}`);
      }
      
      totalSuccess++;
      totalGazettes += gazettes.length;
      console.log(`   ✅ Teste concluído com sucesso`);
      
    } catch (error: any) {
      console.error(`   ❌ Erro durante o teste: ${error.message}`);
      console.error(`   Stack: ${error.stack?.split('\n')[0]}`);
      totalErrors++;
    }
    
    console.log('\n' + '─'.repeat(80));
  }

  // Summary
  console.log('\n\n=== Resumo dos Testes ===\n');
  console.log(`Total de configurações testadas: ${sigpubConfigs.length}`);
  console.log(`✅ Sucessos: ${totalSuccess}`);
  console.log(`❌ Erros: ${totalErrors}`);
  console.log(`📰 Total de diários encontrados: ${totalGazettes}`);
  console.log(`📊 Taxa de sucesso: ${((totalSuccess / sigpubConfigs.length) * 100).toFixed(1)}%`);
  
  if (totalGazettes > 0) {
    console.log(`\n🎉 Média de diários por estado: ${(totalGazettes / totalSuccess).toFixed(1)}`);
  }
  
  console.log('\n' + '='.repeat(80) + '\n');
  
  if (totalErrors === 0) {
    console.log('✅ TODOS OS TESTES PASSARAM COM SUCESSO! 🎊');
  } else {
    console.log(`⚠️  ${totalErrors} teste(s) falharam. Revise os erros acima.`);
  }
  
  console.log('\n');
}

// Run tests
testAllStates().catch(error => {
  console.error('\n❌ Erro fatal durante os testes:', error);
  process.exit(1);
});
