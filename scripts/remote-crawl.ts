#!/usr/bin/env node
/**
 * Script para executar crawling remotamente no Cloudflare Workers
 * 
 * Usage: npx tsx scripts/remote-crawl.ts [command] [options]
 */

const WORKER_URL = 'https://querido-diario-worker.qconcursos.workers.dev';

interface CrawlResponse {
  success: boolean;
  message?: string;
  tasksEnqueued?: number;
  totalCities?: number;
  dateRange?: { startDate: string; endDate: string };
  platform?: string;
  estimatedTimeMinutes?: number;
  error?: string;
}

interface StatsResponse {
  total: number;
  platforms: Record<string, number>;
  webhookConfigured: boolean;
  endpoint: string;
}

async function makeRequest(endpoint: string, method: 'GET' | 'POST' = 'GET', body?: any): Promise<any> {
  const url = `${WORKER_URL}${endpoint}`;
  
  console.log(`🔗 ${method} ${url}`);
  
  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Querido-Diario-Remote-Client/1.0'
      },
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`❌ Request failed: ${(error as Error).message}`);
    throw error;
  }
}

async function crawlTodayYesterday(platform?: string): Promise<void> {
  console.log('🚀 INICIANDO CRAWLING REMOTO - HOJE E ONTEM');
  console.log('═'.repeat(60));
  
  if (platform) {
    console.log(`📊 Plataforma: ${platform}`);
  } else {
    console.log('📊 Plataforma: Todas');
  }
  console.log('');

  try {
    const response: CrawlResponse = await makeRequest('/crawl/today-yesterday', 'POST', { platform });

    if (response.success) {
      console.log('✅ CRAWLING INICIADO COM SUCESSO');
      console.log('─'.repeat(40));
      console.log(`📋 Tasks enfileiradas: ${response.tasksEnqueued}`);
      console.log(`🏢 Total de cidades: ${response.totalCities}`);
      console.log(`📅 Período: ${response.dateRange?.startDate} até ${response.dateRange?.endDate}`);
      console.log(`⏱️  Tempo estimado: ${response.estimatedTimeMinutes} minutos`);
      console.log('');
      console.log('🔄 PROCESSAMENTO AUTOMÁTICO ATIVO:');
      console.log('   1. Gazetas sendo coletadas em paralelo');
      console.log('   2. OCR será executado automaticamente');
      console.log('   3. Análise de IA detectará concursos públicos'); 
      console.log('   4. Webhooks serão enviados para: https://n8n.grupoq.io/webhook/webhook-concursos');
      console.log('');
      console.log('📊 MONITORAMENTO:');
      console.log('   • Cloudflare Dashboard: https://dash.cloudflare.com/');
      console.log('   • Webhook Logs: https://n8n.grupoq.io/');
      console.log('   • Status: npx tsx scripts/remote-crawl.ts status');
    } else {
      console.error('❌ FALHA AO INICIAR CRAWLING:', response.error);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ ERRO DE CONEXÃO:', (error as Error).message);
    process.exit(1);
  }
}

async function crawlCities(cities: string[], startDate?: string, endDate?: string): Promise<void> {
  console.log('🚀 INICIANDO CRAWLING REMOTO - CIDADES ESPECÍFICAS');
  console.log('═'.repeat(60));
  console.log(`🏢 Cidades: ${cities.join(', ')}`);
  console.log('');

  // Use provided dates or default to last 7 days for better coverage
  const defaultStartDate = startDate || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // last 7 days
  const defaultEndDate = endDate || new Date().toISOString().split('T')[0]; // hoje

  try {
    const response: CrawlResponse = await makeRequest('/crawl/cities', 'POST', { 
      cities,
      startDate: defaultStartDate,
      endDate: defaultEndDate
    });

    if (response.success) {
      console.log('✅ CRAWLING INICIADO COM SUCESSO');
      console.log('─'.repeat(40));
      console.log(`📋 Tasks enfileiradas: ${response.tasksEnqueued}`);
      console.log(`📅 Período: ${response.dateRange?.start} até ${response.dateRange?.end}`);
      console.log('');
      console.log('🔄 PROCESSAMENTO AUTOMÁTICO ATIVO');
    } else {
      console.error('❌ FALHA AO INICIAR CRAWLING:', response.error);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ ERRO DE CONEXÃO:', (error as Error).message);
    process.exit(1);
  }
}

async function getStats(): Promise<void> {
  console.log('📊 ESTATÍSTICAS DO SISTEMA');
  console.log('═'.repeat(60));

  try {
    const response: StatsResponse = await makeRequest('/stats');

    console.log(`🏢 Total de cidades: ${response.total}`);
    console.log(`📨 Webhook configurado: ${response.webhookConfigured ? '✅' : '❌'}`);
    console.log(`🔗 Endpoint: ${response.endpoint}`);
    console.log('');
    console.log('📈 Por plataforma:');
    console.log('─'.repeat(40));
    
    for (const [platform, count] of Object.entries(response.platforms)) {
      const percentage = ((count / response.total) * 100).toFixed(1);
      console.log(`   ${platform.padEnd(20)} ${count.toString().padStart(4)} (${percentage}%)`);
    }
  } catch (error) {
    console.error('❌ ERRO AO OBTER ESTATÍSTICAS:', (error as Error).message);
    process.exit(1);
  }
}

async function healthCheck(): Promise<void> {
  console.log('🔍 VERIFICANDO STATUS DO SISTEMA');
  console.log('═'.repeat(60));

  try {
    const response = await makeRequest('/');
    
    console.log('✅ SISTEMA OPERACIONAL');
    console.log('─'.repeat(40));
    console.log(`📋 Serviço: ${response.service}`);
    console.log(`🔢 Versão: ${response.version}`);
    console.log(`🕷️  Spiders registrados: ${response.spidersRegistered}`);
    console.log(`🛠️  Handlers: ${response.handlers?.join(', ') || 'HTTP'}`);
    console.log('');
    console.log('🌐 Workers deployados:');
    console.log('   • Principal: ✅ https://querido-diario-worker.qconcursos.workers.dev');
    console.log('   • OCR: ✅ https://querido-diario-ocr-worker.qconcursos.workers.dev (queue only)');
    console.log('   • Análise: ✅ https://querido-diario-analysis-worker.qconcursos.workers.dev');
    console.log('   • Webhook: ✅ https://querido-diario-webhook-worker.qconcursos.workers.dev');
  } catch (error) {
    console.error('❌ SISTEMA INDISPONÍVEL:', (error as Error).message);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  console.log('🕷️  QUERIDO DIÁRIO - CRAWLING REMOTO NO CLOUDFLARE');
  console.log('═'.repeat(70));
  console.log('Execução remota de crawling de gazetas oficiais brasileiras');
  console.log('');

  switch (command) {
    case 'today-yesterday':
    case 'hoje-ontem':
      const platform = args.find(arg => arg.startsWith('--platform='))?.split('=')[1];
      await crawlTodayYesterday(platform);
      break;

    case 'cities':
    case 'cidades':
      const cities = args.slice(1).filter(arg => !arg.startsWith('--'));
      if (cities.length === 0) {
        console.error('❌ Erro: Especifique pelo menos uma cidade');
        console.log('\nExemplo: npx tsx scripts/remote-crawl.ts cities am_1302603 ba_2927408');
        process.exit(1);
      }
      await crawlCities(cities);
      break;

    case 'stats':
    case 'status':
    case 'estatisticas':
      await getStats();
      break;

    case 'health':
    case 'ping':
    case 'check':
      await healthCheck();
      break;

    default:
      console.log('🚀 COMANDOS DISPONÍVEIS:');
      console.log('─'.repeat(40));
      console.log('   today-yesterday      Crawl hoje e ontem (todas as cidades)');
      console.log('   cities <ids...>      Crawl cidades específicas');
      console.log('   stats                Mostrar estatísticas do sistema');
      console.log('   health               Verificar status do sistema');
      console.log('');
      console.log('🎯 EXEMPLOS:');
      console.log('   # Crawl hoje e ontem - todas as cidades');
      console.log('   npx tsx scripts/remote-crawl.ts today-yesterday');
      console.log('');
      console.log('   # Crawl hoje e ontem - apenas plataforma SIGPUB'); 
      console.log('   npx tsx scripts/remote-crawl.ts today-yesterday --platform=sigpub');
      console.log('');
      console.log('   # Crawl cidades específicas');
      console.log('   npx tsx scripts/remote-crawl.ts cities am_1302603 ba_2927408');
      console.log('');
      console.log('   # Verificar status');
      console.log('   npx tsx scripts/remote-crawl.ts health');
      console.log('');
      if (command) {
        console.error(`❌ Comando desconhecido: ${command}`);
        process.exit(1);
      }
  }
}

// Executar se chamado diretamente
main().catch((error) => {
  console.error('❌ ERRO CRÍTICO:', error.message);
  process.exit(1);
});
