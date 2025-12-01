#!/usr/bin/env node

/**
 * Script para comparar URLs do CSV com URLs das configurações de spiders
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Normaliza URL para comparação
 */
function normalizeUrl(url) {
  if (!url) return null;
  
  try {
    // Remove espaços e converte para minúsculas
    url = url.trim().toLowerCase();
    
    // Remove trailing slash
    url = url.replace(/\/+$/, '');
    
    // Remove protocolo para comparação mais flexível
    // Mas mantemos para casos onde o mesmo domínio tem http e https
    const urlObj = new URL(url);
    
    // Normaliza o domínio
    let normalized = `${urlObj.protocol}//${urlObj.hostname}`;
    
    // Adiciona pathname normalizado (sem trailing slash)
    const pathname = urlObj.pathname.replace(/\/+$/, '') || '/';
    normalized += pathname;
    
    // Adiciona search params ordenados (se houver)
    if (urlObj.search) {
      normalized += urlObj.search;
    }
    
    return normalized;
  } catch (e) {
    // Se não for URL válida, retorna normalizado simples
    return url.trim().toLowerCase().replace(/\/+$/, '');
  }
}

/**
 * Extrai dados do CSV incluindo informações de municípios
 */
function extractDataFromCsv(csvPath) {
  const content = fs.readFileSync(csvPath, 'utf-8');
  const lines = content.split('\n');
  const urls = new Set();
  const municipios = [];
  const municipiosUnicos = new Map(); // Chave: "municipio-estado"
  const duplicatas = [];
  
  // Pula o header
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    const parts = line.split(';');
    if (parts.length >= 3) {
      const municipio = parts[0].trim();
      const estado = parts[1].trim();
      const url = parts[2].trim();
      
      const temDiario = url && url.startsWith('http');
      const chave = `${municipio}-${estado}`.toLowerCase();
      
      const dadosMunicipio = {
        municipio,
        estado,
        url: url || null,
        temDiario,
        urlNormalized: temDiario ? normalizeUrl(url) : null,
        linha: i + 1
      };
      
      municipios.push(dadosMunicipio);
      
      // Verifica se já existe
      if (municipiosUnicos.has(chave)) {
        duplicatas.push({
          chave,
          original: municipiosUnicos.get(chave),
          duplicata: dadosMunicipio
        });
      } else {
        municipiosUnicos.set(chave, dadosMunicipio);
      }
      
      if (temDiario) {
        const normalized = normalizeUrl(url);
        if (normalized) {
          urls.add(normalized);
        }
      }
    }
  }
  
  return { 
    urls, 
    municipios,
    municipiosUnicos: Array.from(municipiosUnicos.values()),
    duplicatas
  };
}

/**
 * Extrai URLs de um arquivo JSON de configuração
 */
function extractUrlsFromJson(jsonPath) {
  const content = fs.readFileSync(jsonPath, 'utf-8');
  const data = JSON.parse(content);
  const urls = new Set();
  
  function extractFromObject(obj) {
    if (Array.isArray(obj)) {
      obj.forEach(item => extractFromObject(item));
    } else if (obj && typeof obj === 'object') {
      // Procura por campos que contêm URLs
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'baseUrl' || key === 'url' || key === 'apiUrl') {
          if (typeof value === 'string' && value.startsWith('http')) {
            const normalized = normalizeUrl(value);
            if (normalized) {
              urls.add(normalized);
            }
          }
        } else if (key === 'config' && typeof value === 'object') {
          extractFromObject(value);
        } else if (typeof value === 'object') {
          extractFromObject(value);
        }
      }
    }
  }
  
  extractFromObject(data);
  return urls;
}

/**
 * Extrai URLs de todos os arquivos de configuração de spiders
 */
function extractUrlsFromSpiderConfigs() {
  const configsDir = path.join(__dirname, '../src/spiders/configs');
  const v2ConfigsDir = path.join(__dirname, '../src/spiders/v2/configs');
  const allUrls = new Set();
  
  // Processa arquivos JSON em configs/
  if (fs.existsSync(configsDir)) {
    const files = fs.readdirSync(configsDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(configsDir, file);
        try {
          const urls = extractUrlsFromJson(filePath);
          urls.forEach(url => allUrls.add(url));
          console.log(`Processed ${file}: ${urls.size} URLs`);
        } catch (error) {
          console.error(`Error processing ${file}:`, error.message);
        }
      }
    }
  }
  
  // Processa arquivos JSON em v2/configs/
  if (fs.existsSync(v2ConfigsDir)) {
    const files = fs.readdirSync(v2ConfigsDir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(v2ConfigsDir, file);
        try {
          const urls = extractUrlsFromJson(filePath);
          urls.forEach(url => allUrls.add(url));
          console.log(`Processed v2/${file}: ${urls.size} URLs`);
        } catch (error) {
          console.error(`Error processing v2/${file}:`, error.message);
        }
      }
    }
  }
  
  return allUrls;
}

/**
 * Extrai domínio base de um URL
 */
function getBaseDomain(url) {
  try {
    const urlObj = new URL(url);
    // Remove www. para comparação
    let hostname = urlObj.hostname.replace(/^www\./, '');
    return `${urlObj.protocol}//${hostname}`;
  } catch (e) {
    // Fallback simples
    try {
      const match = url.match(/^(https?:\/\/)(?:www\.)?([^\/]+)/);
      if (match) {
        return match[1] + match[2];
      }
    } catch (e2) {
      // Ignora
    }
    return null;
  }
}

/**
 * Compara URLs e encontra os que estão no CSV mas não nas spiders
 */
function findMissingUrls(csvUrls, spiderUrls) {
  const missing = [];
  const foundUrls = [];
  
  // Cria um mapa de domínios base das spiders para busca rápida
  const spiderDomains = new Set();
  const spiderBaseDomains = new Set(); // Domínios sem www
  
  for (const spiderUrl of spiderUrls) {
    spiderDomains.add(spiderUrl);
    const baseDomain = getBaseDomain(spiderUrl);
    if (baseDomain) {
      spiderBaseDomains.add(baseDomain);
    }
  }
  
  for (const csvUrl of csvUrls) {
    let found = false;
    
    // 1. Tenta match exato primeiro
    if (spiderDomains.has(csvUrl)) {
      found = true;
      foundUrls.push({ csvUrl, matchType: 'exact', spiderUrl: csvUrl });
    } else {
      // 2. Tenta match por domínio base
      const csvBaseDomain = getBaseDomain(csvUrl);
      if (csvBaseDomain && spiderBaseDomains.has(csvBaseDomain)) {
        found = true;
        // Encontra o URL da spider correspondente
        for (const spiderUrl of spiderUrls) {
          if (getBaseDomain(spiderUrl) === csvBaseDomain) {
            foundUrls.push({ csvUrl, matchType: 'domain', spiderUrl });
            break;
          }
        }
      }
    }
    
    if (!found) {
      missing.push(csvUrl);
    }
  }
  
  return { missing, foundUrls };
}

// Executa a análise
console.log('=== Análise Completa: Municípios e Diários ===\n');

console.log('1. Extraindo dados do CSV...');
const csvPath = path.join(__dirname, '../diarios.csv');
const { urls: csvUrls, municipios, municipiosUnicos, duplicatas } = extractDataFromCsv(csvPath);

const municipiosComDiario = municipiosUnicos.filter(m => m.temDiario);
const municipiosSemDiario = municipiosUnicos.filter(m => !m.temDiario);

console.log(`   Total de linhas no CSV: ${municipios.length}`);
console.log(`   Municípios ÚNICOS: ${municipiosUnicos.length}`);
if (duplicatas.length > 0) {
  console.log(`   ⚠️  Municípios DUPLICADOS encontrados: ${duplicatas.length} pares`);
}
console.log(`   Municípios ÚNICOS COM diário: ${municipiosComDiario.length}`);
console.log(`   Municípios ÚNICOS SEM diário: ${municipiosSemDiario.length}`);
console.log(`   URLs únicos no CSV: ${csvUrls.size}\n`);

console.log('2. Extraindo URLs das configurações de spiders...');
const spiderUrls = extractUrlsFromSpiderConfigs();
console.log(`   Encontrados ${spiderUrls.size} URLs únicos nas spiders\n`);

console.log('3. Comparando URLs...');
const { missing: missingUrls, foundUrls } = findMissingUrls(csvUrls, spiderUrls);
console.log(`   URLs do CSV não encontrados nas spiders: ${missingUrls.length}\n`);

// Mapeia quais municípios têm URLs que estão nas spiders
const urlsEncontradosSet = new Set(foundUrls.map(f => f.csvUrl));
const municipiosComSpider = municipiosComDiario.filter(m => 
  m.urlNormalized && urlsEncontradosSet.has(m.urlNormalized)
);
const municipiosSemSpider = municipiosComDiario.filter(m => 
  m.urlNormalized && !urlsEncontradosSet.has(m.urlNormalized)
);

console.log('=== RESULTADO DETALHADO ===\n');

console.log('📊 ESTATÍSTICAS GERAIS (por municípios únicos):');
console.log(`   Total de municípios ÚNICOS no CSV: ${municipiosUnicos.length}`);
if (duplicatas.length > 0) {
  console.log(`   Total de linhas no CSV (incluindo duplicatas): ${municipios.length}`);
  console.log(`   Municípios duplicados: ${duplicatas.length} pares\n`);
}
console.log(`   Municípios ÚNICOS COM diário oficial: ${municipiosComDiario.length} (${(municipiosComDiario.length / municipiosUnicos.length * 100).toFixed(2)}%)`);
console.log(`   Municípios ÚNICOS SEM diário oficial: ${municipiosSemDiario.length} (${(municipiosSemDiario.length / municipiosUnicos.length * 100).toFixed(2)}%)\n`);

console.log('🕷️  COBERTURA DAS SPIDERS:');
console.log(`   Municípios COM diário que JÁ TÊM spider: ${municipiosComSpider.length} (${(municipiosComSpider.length / municipiosComDiario.length * 100).toFixed(2)}%)`);
console.log(`   Municípios COM diário que NÃO TÊM spider: ${municipiosSemSpider.length} (${(municipiosSemSpider.length / municipiosComDiario.length * 100).toFixed(2)}%)\n`);

console.log('🔗 ANÁLISE DE URLs:');
console.log(`   Total de URLs únicos no CSV: ${csvUrls.size}`);
console.log(`   Total de URLs nas spiders: ${spiderUrls.size}`);
console.log(`   URLs do CSV NÃO presentes nas spiders: ${missingUrls.length}`);
console.log(`   URLs do CSV presentes nas spiders: ${foundUrls.length}`);
console.log(`   Taxa de cobertura de URLs: ${(foundUrls.length / csvUrls.size * 100).toFixed(2)}%\n`);

// Estatísticas de match
const exactMatches = foundUrls.filter(f => f.matchType === 'exact').length;
const domainMatches = foundUrls.filter(f => f.matchType === 'domain').length;
console.log(`   - Matches exatos: ${exactMatches}`);
console.log(`   - Matches por domínio: ${domainMatches}\n`);

// Salva os URLs faltantes em um arquivo
if (missingUrls.length > 0) {
  const outputPath = path.join(__dirname, '../missing-spider-urls.txt');
  fs.writeFileSync(outputPath, missingUrls.join('\n'), 'utf-8');
  console.log(`✅ Lista de URLs faltantes salva em: ${outputPath}`);
}

// Salva lista de municípios sem spider
if (municipiosSemSpider.length > 0) {
  const municipiosSemSpiderPath = path.join(__dirname, '../municipios-sem-spider.csv');
  const csvContent = 'municipio;estado;url_diario_eletronico\n' +
    municipiosSemSpider.map(m => `${m.municipio};${m.estado};${m.url || ''}`).join('\n');
  fs.writeFileSync(municipiosSemSpiderPath, csvContent, 'utf-8');
  console.log(`✅ Lista de municípios sem spider salva em: ${municipiosSemSpiderPath}`);
}

// Mostra alguns exemplos
if (missingUrls.length > 0) {
  console.log('\n=== Exemplos de URLs faltantes (primeiros 20) ===');
  missingUrls.slice(0, 20).forEach((url, idx) => {
    console.log(`${idx + 1}. ${url}`);
  });
  if (missingUrls.length > 20) {
    console.log(`... e mais ${missingUrls.length - 20} URLs`);
  }
  
  // Agrupa por domínio para análise
  console.log('\n=== Análise por domínio (top 10 domínios faltantes) ===');
  const domainCounts = {};
  missingUrls.forEach(url => {
    const domain = getBaseDomain(url);
    if (domain) {
      domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    }
  });
  
  const sortedDomains = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);
  
  sortedDomains.forEach(([domain, count], idx) => {
    console.log(`${idx + 1}. ${domain}: ${count} URLs`);
  });
}

// Análise por estado
console.log('\n=== Análise por Estado (top 10 estados com mais municípios sem spider) ===');
const estadoCounts = {};
municipiosSemSpider.forEach(m => {
  estadoCounts[m.estado] = (estadoCounts[m.estado] || 0) + 1;
});

const sortedEstados = Object.entries(estadoCounts)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 10);

sortedEstados.forEach(([estado, count], idx) => {
  const totalNoEstado = municipiosComDiario.filter(m => m.estado === estado).length;
  console.log(`${idx + 1}. ${estado}: ${count}/${totalNoEstado} municípios sem spider`);
});

// Análise de duplicatas
if (duplicatas.length > 0) {
  console.log('\n=== Análise de Municípios Duplicados ===');
  console.log(`Total de pares duplicados: ${duplicatas.length}\n`);
  
  // Agrupa por município
  const duplicatasPorMunicipio = {};
  duplicatas.forEach(d => {
    if (!duplicatasPorMunicipio[d.chave]) {
      duplicatasPorMunicipio[d.chave] = [];
    }
    duplicatasPorMunicipio[d.chave].push(d);
  });
  
  console.log('Top 10 municípios com mais duplicatas:');
  const sortedDuplicatas = Object.entries(duplicatasPorMunicipio)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 10);
  
  sortedDuplicatas.forEach(([chave, dups], idx) => {
    const municipio = dups[0].original;
    console.log(`${idx + 1}. ${municipio.municipio} - ${municipio.estado}: ${dups.length + 1} ocorrências`);
    dups.forEach((dup, i) => {
      const urlOriginal = dup.original.url || '(sem URL)';
      const urlDuplicata = dup.duplicata.url || '(sem URL)';
      if (urlOriginal !== urlDuplicata) {
        console.log(`   - Linha ${dup.original.linha}: ${urlOriginal}`);
        console.log(`   - Linha ${dup.duplicata.linha}: ${urlDuplicata}`);
      }
    });
  });
}

