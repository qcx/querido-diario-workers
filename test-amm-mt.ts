import { spiderRegistry } from './src/spiders/registry';
import { DateRange } from './src/types/spider-config';

/**
 * Script de teste para o AMM-MT (Mato Grosso)
 * Testa os 3 municípios configurados
 */

async function testAmmMt() {
  console.log('🧪 Testando AMM-MT (Mato Grosso)\n');

  // Todos os municípios AMM-MT
  const testCities = [
    'mt_5101837', // Boa Esperança do Norte
    'mt_5103361', // Conquista D'Oeste
    'mt_5107800', // Santo Antônio de Leverger
  ];

  // Período de teste: últimos 30 dias (mais amplo para aumentar chances)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);

  const dateRange: DateRange = {
    start: startDate.toISOString().split('T')[0],
    end: endDate.toISOString().split('T')[0],
  };

  console.log(`📅 Período: ${dateRange.start} até ${dateRange.end}\n`);

  for (const cityId of testCities) {
    const config = spiderRegistry.getConfig(cityId);
    
    if (!config) {
      console.log(`❌ Configuração não encontrada para ${cityId}\n`);
      continue;
    }

    console.log(`🏙️  Testando: ${config.name} (${config.territoryId})`);
    console.log(`   Tipo: ${config.spiderType}`);
    console.log(`   URL: ${(config.config as any).url}`);
    console.log(`   Cidade: ${(config.config as any).cityName}`);

    try {
      const spider = spiderRegistry.createSpider(config, dateRange);
      const gazettes = await spider.crawl();

      if (gazettes.length > 0) {
        console.log(`✅ Encontrados ${gazettes.length} diários`);
        
        // Mostrar primeiro resultado
        const first = gazettes[0];
        console.log(`   📄 Exemplo: ${first.date} - ${first.fileUrl.substring(0, 60)}...`);
      } else {
        console.log(`⚠️  Nenhum diário encontrado no período`);
      }

      console.log(`   📊 Requisições: ${spider.getRequestCount()}`);
    } catch (error) {
      console.log(`❌ Erro: ${(error as Error).message}`);
    }

    console.log('');
  }

  // Estatísticas gerais
  const allConfigs = spiderRegistry.getConfigsByType('amm-mt');
  console.log(`\n📊 Total de municípios AMM-MT configurados: ${allConfigs.length}`);
}

// Executar teste
testAmmMt().catch(console.error);
