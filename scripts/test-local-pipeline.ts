#!/usr/bin/env tsx

/**
 * Script para testar pipeline completo localmente
 * Usa o local-test-worker para simular todo o fluxo sem filas
 */

import { serve } from '@hono/node-server';
import localTestWorker from '../src/local-test-worker';

interface TestConfig {
  cities: string[];
  startDate?: string;
  endDate?: string;
  enableOcr?: boolean;
  enableAnalysis?: boolean;
  enableWebhook?: boolean;
  mockWebhook?: boolean;
  port?: number;
}

const DEFAULT_CONFIG: TestConfig = {
  cities: ['am_1300144'], // Apuí-AM
  enableOcr: false, // Desabilitado por padrão (requer API key)
  enableAnalysis: true,
  enableWebhook: true,
  mockWebhook: true, // Mock por padrão para não afetar produção
  port: 3001
};

async function runLocalPipelineTest(config: TestConfig = {}) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };
  
  console.log('🧪 TESTE LOCAL DO PIPELINE COMPLETO');
  console.log('═'.repeat(60));
  console.log(`📍 Cidades: ${finalConfig.cities.join(', ')}`);
  console.log(`🔍 OCR: ${finalConfig.enableOcr ? '✅' : '❌'}`);
  console.log(`🤖 Analysis: ${finalConfig.enableAnalysis ? '✅' : '❌'}`);
  console.log(`📨 Webhook: ${finalConfig.enableWebhook ? (finalConfig.mockWebhook ? '🧪 Mock' : '✅ Real') : '❌'}`);
  console.log('');

  // Criar environment mock
  const env = {
    MISTRAL_API_KEY: process.env.MISTRAL_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    BROWSER: createMockBrowser()
  };

  try {
    // Start local server
    const server = serve({
      fetch: (request) => localTestWorker.fetch(request, env),
      port: finalConfig.port
    });

    console.log(`🚀 Server started on http://localhost:${finalConfig.port}`);

    // Give server time to start
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Execute test
    const response = await fetch(`http://localhost:${finalConfig.port}/test-pipeline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cities: finalConfig.cities,
        startDate: finalConfig.startDate,
        endDate: finalConfig.endDate,
        enableOcr: finalConfig.enableOcr,
        enableAnalysis: finalConfig.enableAnalysis,
        enableWebhook: finalConfig.enableWebhook,
        mockWebhook: finalConfig.mockWebhook
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    // Display results
    displayResults(result);

    // Close server
    server.close();
    
    return result;

  } catch (error: any) {
    console.error('❌ ERRO NO TESTE:', error.message);
    process.exit(1);
  }
}

function displayResults(result: any) {
  console.log('📊 RESULTADOS DO TESTE');
  console.log('═'.repeat(60));
  console.log(`⏱️  Tempo total: ${result.totalExecutionTime}ms`);
  console.log(`✅ Sucessos: ${result.summary.successful}/${result.summary.totalCities}`);
  console.log(`❌ Falhas: ${result.summary.failed}/${result.summary.totalCities}`);
  console.log('');

  console.log('📈 ESTATÍSTICAS:');
  console.log('─'.repeat(40));
  console.log(`📄 Total de gazetas: ${result.summary.totalGazettes}`);
  console.log(`🔍 OCRs processados: ${result.summary.totalOcrProcessed}`);
  console.log(`🤖 Análises realizadas: ${result.summary.totalAnalyses}`);
  console.log(`🎯 Concursos detectados: ${result.summary.totalConcursosDetected}`);
  console.log(`📨 Webhooks enviados: ${result.summary.totalWebhooksSent}`);
  console.log('');

  // Detailed results per city
  for (const cityResult of result.results) {
    console.log(`🏢 CIDADE: ${cityResult.cityId} (${cityResult.success ? '✅' : '❌'})`);
    console.log('─'.repeat(40));
    console.log(`  📄 Crawl: ${cityResult.pipeline.crawl.success ? '✅' : '❌'} (${cityResult.pipeline.crawl.gazetteCount} gazetas)`);
    console.log(`  🔍 OCR: ${cityResult.pipeline.ocr.success ? '✅' : '❌'} (${cityResult.pipeline.ocr.processedCount} processados)`);
    console.log(`  🤖 Analysis: ${cityResult.pipeline.analysis.success ? '✅' : '❌'} (${cityResult.pipeline.analysis.concursosDetected} concursos)`);
    console.log(`  📨 Webhook: ${cityResult.pipeline.webhook.success ? '✅' : '❌'} (${cityResult.pipeline.webhook.sentCount} enviados)`);
    console.log(`  ⏱️  Tempo: ${cityResult.executionTime}ms`);
    console.log('');

    if (!cityResult.success) {
      // Show errors
      if (cityResult.pipeline.crawl.error) {
        console.log(`    ❌ Crawl error: ${cityResult.pipeline.crawl.error}`);
      }
      if (cityResult.pipeline.ocr.error) {
        console.log(`    ❌ OCR error: ${cityResult.pipeline.ocr.error}`);
      }
      if (cityResult.pipeline.analysis.error) {
        console.log(`    ❌ Analysis error: ${cityResult.pipeline.analysis.error}`);
      }
      if (cityResult.pipeline.webhook.error) {
        console.log(`    ❌ Webhook error: ${cityResult.pipeline.webhook.error}`);
      }
      console.log('');
    }
  }

  // Success summary
  if (result.summary.totalConcursosDetected > 0) {
    console.log('🎉 SUCESSO! CONCURSOS PÚBLICOS DETECTADOS!');
    console.log('═'.repeat(60));
    console.log(`🎯 ${result.summary.totalConcursosDetected} concurso(s) encontrado(s)`);
    console.log(`📨 ${result.summary.totalWebhooksSent} webhook(s) enviado(s)`);
  } else {
    console.log('ℹ️  Nenhum concurso público detectado neste teste.');
  }
}

function createMockBrowser(): Fetcher {
  return {
    fetch: async (request: Request) => {
      // Mock browser for local testing - just forward to real fetch
      return fetch(request);
    }
  } as Fetcher;
}

// Parse command line arguments
function parseArgs(): TestConfig {
  const args = process.argv.slice(2);
  const config: TestConfig = { cities: [] };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    switch (arg) {
      case '--city':
        config.cities = args[++i].split(',');
        break;
      case '--start-date':
        config.startDate = args[++i];
        break;
      case '--end-date':
        config.endDate = args[++i];
        break;
      case '--enable-ocr':
        config.enableOcr = true;
        break;
      case '--disable-analysis':
        config.enableAnalysis = false;
        break;
      case '--disable-webhook':
        config.enableWebhook = false;
        break;
      case '--real-webhook':
        config.mockWebhook = false;
        break;
      case '--port':
        config.port = parseInt(args[++i]);
        break;
      case '--help':
        showHelp();
        process.exit(0);
        break;
    }
  }

  return config;
}

function showHelp() {
  console.log(`
🧪 TESTE LOCAL DO PIPELINE QUERIDO DIÁRIO

USAGE:
  npx tsx scripts/test-local-pipeline.ts [OPTIONS]

OPTIONS:
  --city <cities>           Lista de cidades (ex: am_1300144,sp_3550308)
  --start-date <date>       Data inicial (YYYY-MM-DD)
  --end-date <date>         Data final (YYYY-MM-DD)
  --enable-ocr             Habilita OCR real (requer MISTRAL_API_KEY)
  --disable-analysis       Desabilita análise de IA
  --disable-webhook        Desabilita envio de webhooks
  --real-webhook           Envia webhooks reais (padrão: mock)
  --port <port>            Porta do servidor local (padrão: 3001)
  --help                   Mostra esta ajuda

EXEMPLOS:
  # Teste básico com Apuí-AM (padrão)
  npx tsx scripts/test-local-pipeline.ts

  # Teste com múltiplas cidades
  npx tsx scripts/test-local-pipeline.ts --city am_1300144,sp_3550308

  # Teste completo com OCR real
  npx tsx scripts/test-local-pipeline.ts --enable-ocr

  # Teste enviando webhook real para n8n
  npx tsx scripts/test-local-pipeline.ts --real-webhook

VARIÁVEIS DE AMBIENTE:
  MISTRAL_API_KEY     - Para OCR (opcional)
  OPENAI_API_KEY      - Para análise de IA (opcional)
`);
}

// Main execution
async function main() {
  const config = parseArgs();
  
  if (config.cities.length === 0) {
    config.cities = DEFAULT_CONFIG.cities; // Use default
  }
  
  await runLocalPipelineTest(config);
}

// Check if script is being run directly
const isMainModule = process.argv[1] && process.argv[1].includes('test-local-pipeline');

if (isMainModule) {
  main().catch(console.error);
}

export { runLocalPipelineTest };
