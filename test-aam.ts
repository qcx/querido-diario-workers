import { spiderRegistry } from './src/spiders/registry';
import { DateRange } from './src/types/spider-config';

/**
 * Script de teste para o AAM (Amazonas) via SIGPub
 * Testa alguns municípios do Amazonas
 */

async function testAAM() {
  console.log('🧪 Testando AAM (Amazonas) via SIGPub\n');

  // Municípios de teste do Amazonas
  const testCities = [
    'am_1302603', // Manaus
    'am_1300144', // Apuí
    'am_1303403', // Parintins
    'am_1301902', // Itacoatiara
    'am_1302504', // Manacapuru
  ];

  // Período de teste: últimos 7 dias
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 7);

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
    console.log(`   EntityId: ${(config.config as any).entityId}`);

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
  const allConfigs = spiderRegistry.getConfigsByType('sigpub');
  const amConfigs = allConfigs.filter(c => c.territoryId.startsWith('13'));
  console.log(`\n📊 Total de municípios AM no SIGPub: ${amConfigs.length}`);
  console.log(`📊 Total geral no SIGPub: ${allConfigs.length}`);
}

// Executar teste
testAAM().catch(console.error);
