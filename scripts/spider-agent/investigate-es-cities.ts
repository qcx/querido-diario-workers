#!/usr/bin/env bun

/**
 * Script para investigar URLs de diários oficiais das cidades de ES
 */

interface CityInfo {
  name: string;
  ibge: string;
  slug: string;
  possibleUrls: string[];
}

const cities: CityInfo[] = [
  { name: "Serra", ibge: "3205002", slug: "serra", possibleUrls: [
    "https://www.serra.es.gov.br/diario-oficial",
    "https://diariooficial.serra.es.gov.br",
    "https://www.serra.es.gov.br/diariooficial",
  ]},
  { name: "Vila Velha", ibge: "3205200", slug: "vila_velha", possibleUrls: [
    "https://www.vilavelha.es.gov.br/diario-oficial",
    "https://diariooficial.vilavelha.es.gov.br",
    "https://www.vilavelha.es.gov.br/diariooficial",
  ]},
  { name: "Cariacica", ibge: "3201308", slug: "cariacica", possibleUrls: [
    "https://diariooficial.cariacica.es.gov.br",
    "https://www.cariacica.es.gov.br/diario-oficial",
  ]},
  { name: "Vitória", ibge: "3205309", slug: "vitoria", possibleUrls: [
    "https://diariooficial.vitoria.es.gov.br",
    "https://www.vitoria.es.gov.br/diario-oficial",
  ]},
  { name: "Cachoeiro de Itapemirim", ibge: "3201209", slug: "cachoeiro_de_itapemirim", possibleUrls: [
    "https://www.cachoeiro.es.gov.br/diario-oficial",
    "https://diariooficial.cachoeiro.es.gov.br",
  ]},
  { name: "Linhares", ibge: "3203205", slug: "linhares", possibleUrls: [
    "https://www.linhares.es.gov.br/diario-oficial",
    "https://diariooficial.linhares.es.gov.br",
  ]},
  { name: "Guarapari", ibge: "3202405", slug: "guarapari", possibleUrls: [
    "https://www.guarapari.es.gov.br/diario-oficial",
    "https://diariooficial.guarapari.es.gov.br",
  ]},
  { name: "São Mateus", ibge: "3204906", slug: "sao_mateus", possibleUrls: [
    "https://www.saomateus.es.gov.br/diario-oficial",
    "https://diariooficial.saomateus.es.gov.br",
  ]},
  { name: "Colatina", ibge: "3201506", slug: "colatina", possibleUrls: [
    "https://www.colatina.es.gov.br/diario-oficial",
    "https://diariooficial.colatina.es.gov.br",
  ]},
  { name: "Aracruz", ibge: "3200607", slug: "aracruz", possibleUrls: [
    "https://www.aracruz.es.gov.br/diario-oficial",
    "https://diariooficial.aracruz.es.gov.br",
  ]},
  { name: "Viana", ibge: "3205101", slug: "viana", possibleUrls: [
    "https://www.viana.es.gov.br/diario-oficial",
    "https://diariooficial.viana.es.gov.br",
  ]},
  { name: "Nova Venécia", ibge: "3203908", slug: "nova_venecia", possibleUrls: [
    "https://www.novavenecia.es.gov.br/diario-oficial",
    "https://diariooficial.novavenecia.es.gov.br",
  ]},
  { name: "Barra de São Francisco", ibge: "3200904", slug: "barra_de_sao_francisco", possibleUrls: [
    "https://www.barradesaofrancisco.es.gov.br/diario-oficial",
    "https://diariooficial.barradesaofrancisco.es.gov.br",
  ]},
  { name: "Marataízes", ibge: "3203320", slug: "marataizes", possibleUrls: [
    "https://www.marataizes.es.gov.br/diario-oficial",
    "https://diariooficial.marataizes.es.gov.br",
  ]},
  { name: "Santa Maria de Jetibá", ibge: "3204559", slug: "santa_maria_de_jetiba", possibleUrls: [
    "https://www.santamariadejetiba.es.gov.br/diario-oficial",
    "https://diariooficial.santamariadejetiba.es.gov.br",
  ]},
  { name: "Itapemirim", ibge: "3202801", slug: "itapemirim", possibleUrls: [
    "https://www.itapemirim.es.gov.br/diario-oficial",
    "https://diariooficial.itapemirim.es.gov.br",
  ]},
  { name: "Castelo", ibge: "3201407", slug: "castelo", possibleUrls: [
    "https://www.castelo.es.gov.br/diario-oficial",
    "https://diariooficial.castelo.es.gov.br",
  ]},
  { name: "Domingos Martins", ibge: "3201902", slug: "domingos_martins", possibleUrls: [
    "https://www.domingosmartins.es.gov.br/diario-oficial",
    "https://diariooficial.domingosmartins.es.gov.br",
  ]},
  { name: "Afonso Cláudio", ibge: "3200102", slug: "afonso_claudio", possibleUrls: [
    "https://www.afonsoclaudio.es.gov.br/diario-oficial",
    "https://diariooficial.afonsoclaudio.es.gov.br",
  ]},
  { name: "Baixo Guandu", ibge: "3200805", slug: "baixo_guandu", possibleUrls: [
    "https://www.baixoguandu.es.gov.br/diario-oficial",
    "https://diariooficial.baixoguandu.es.gov.br",
  ]},
  { name: "Anchieta", ibge: "3200409", slug: "anchieta", possibleUrls: [
    "https://www.anchieta.es.gov.br/diario-oficial",
    "https://diariooficial.anchieta.es.gov.br",
  ]},
  { name: "Guaçuí", ibge: "3202306", slug: "guacui", possibleUrls: [
    "https://www.guacui.es.gov.br/diario-oficial",
    "https://diariooficial.guacui.es.gov.br",
  ]},
  { name: "Alegre", ibge: "3200201", slug: "alegre", possibleUrls: [
    "https://www.alegre.es.gov.br/diario-oficial",
    "https://diariooficial.alegre.es.gov.br",
  ]},
  { name: "Jaguaré", ibge: "3203056", slug: "jaguare", possibleUrls: [
    "https://www.jaguare.es.gov.br/diario-oficial",
    "https://diariooficial.jaguare.es.gov.br",
  ]},
  { name: "Iúna", ibge: "3203007", slug: "iuna", possibleUrls: [
    "https://www.iuna.es.gov.br/diario-oficial",
    "https://diariooficial.iuna.es.gov.br",
  ]},
  { name: "Conceição da Barra", ibge: "3201605", slug: "conceicao_da_barra", possibleUrls: [
    "https://www.conceicaodabarra.es.gov.br/diario-oficial",
    "https://diariooficial.conceicaodabarra.es.gov.br",
  ]},
  { name: "Sooretama", ibge: "3205010", slug: "sooretama", possibleUrls: [
    "https://www.sooretama.es.gov.br/diario-oficial",
    "https://diariooficial.sooretama.es.gov.br",
  ]},
  { name: "Ibatiba", ibge: "3202454", slug: "ibatiba", possibleUrls: [
    "https://www.ibatiba.es.gov.br/diario-oficial",
    "https://diariooficial.ibatiba.es.gov.br",
  ]},
];

async function testUrl(url: string): Promise<{ status: number; contentType: string; hasGazetteSignals: boolean; needsJS: boolean }> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      redirect: 'follow',
    });
    
    const contentType = response.headers.get('content-type') || '';
    const html = await response.text();
    
    // Check for gazette signals
    const hasGazetteSignals = /di[áa]rio\s+oficial|doe|dom|imprensa\s+oficial/i.test(html) ||
      /\.pdf/i.test(html) ||
      /edicao|edi[çc][ãa]o/i.test(html);
    
    // Check if needs JS
    const needsJS = /<script[^>]*>|__next|react|vue|angular/i.test(html) && 
      !/<table|\.pdf|href.*pdf/i.test(html);
    
    return {
      status: response.status,
      contentType,
      hasGazetteSignals,
      needsJS,
    };
  } catch (error) {
    return {
      status: 0,
      contentType: '',
      hasGazetteSignals: false,
      needsJS: false,
    };
  }
}

async function investigateCity(city: CityInfo) {
  console.log(`\n🔍 Investigando ${city.name}...`);
  
  for (const url of city.possibleUrls) {
    const result = await testUrl(url);
    if (result.status === 200 && result.hasGazetteSignals) {
      console.log(`  ✅ Encontrado: ${url}`);
      console.log(`     Status: ${result.status}`);
      console.log(`     Content-Type: ${result.contentType}`);
      console.log(`     Precisa JS: ${result.needsJS}`);
      return { url, ...result };
    } else if (result.status === 200) {
      console.log(`  ⚠️  URL responde mas sem sinais de diário: ${url}`);
    } else if (result.status > 0) {
      console.log(`  ❌ ${url} - Status: ${result.status}`);
    }
  }
  
  console.log(`  ❌ Nenhuma URL válida encontrada para ${city.name}`);
  return null;
}

async function main() {
  console.log('🚀 Iniciando investigação de cidades de ES...\n');
  
  const results: Array<{ city: CityInfo; url: string | null; result: any }> = [];
  
  for (const city of cities) {
    const result = await investigateCity(city);
    results.push({ city, url: result?.url || null, result });
    await new Promise(resolve => setTimeout(resolve, 1000)); // Rate limiting
  }
  
  console.log('\n\n📊 RESUMO:');
  console.log('='.repeat(80));
  const found = results.filter(r => r.url);
  const notFound = results.filter(r => !r.url);
  
  console.log(`\n✅ URLs encontradas: ${found.length}`);
  found.forEach(r => {
    console.log(`   ${r.city.name}: ${r.url}`);
  });
  
  console.log(`\n❌ URLs não encontradas: ${notFound.length}`);
  notFound.forEach(r => {
    console.log(`   ${r.city.name}`);
  });
}

main().catch(console.error);
