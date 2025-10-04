import { spiderRegistry } from './src/spiders/registry';
import { DateRange } from './src/types/spider-config';

/**
 * Script de teste para o spider Diário Oficial BA
 * Testa alguns municípios da Bahia
 */

async function testDiarioBa() {
  console.log('🧪 Testando Spider Diário Oficial BA\n');

  // Municípios de teste
  const testCities = [
    'ba_2927408', // Salvador
    'ba_2910800', // Feira de Santana
    'ba_2933307', // Vitória da Conquista
    'ba_2919207', // Ilhéus
    'ba_2913606', // Itabuna
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
  const allConfigs = spiderRegistry.getConfigsByType('diario-ba');
  console.log(`\n📊 Total de municípios BA configurados: ${allConfigs.length}`);
}

// Executar teste
testDiarioBa().catch(console.error);
