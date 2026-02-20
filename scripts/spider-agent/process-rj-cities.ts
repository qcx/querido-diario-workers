#!/usr/bin/env bun
/**
 * Script to process RJ cities from CSV and create spider configurations
 * Following the spider-agent cursor rules
 */

import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

interface CityData {
  cidade: string;
  uf: string;
  url: string;
}

interface IBGECity {
  id: number;
  nome: string;
}

interface CityResult {
  cidade: string;
  url: string;
  status: 'skipped_already_exists' | 'used_existing_spider' | 'created_new_spider' | 'needs_review';
  spiderType?: string;
  territoryId?: string;
  citySlug?: string;
  error?: string;
  matchedPattern?: string;
  matchScore?: number;
  filesCreated?: string[];
  testResult?: string;
  gazettesFound?: number;
  attemptsLog?: string[];
  reason?: string;
}

interface Report {
  timestamp: string;
  csvFile: string;
  stateCode: string;
  configFile: string;
  summary: {
    total: number;
    created_new_spider: number;
    used_existing_spider: number;
    skipped_already_exists: number;
    needs_review: number;
  };
  results: CityResult[];
}

// Helper function to create slug from city name
function createSlug(cityName: string): string {
  return cityName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Fetch IBGE codes for RJ
async function fetchIBGECodes(): Promise<Map<string, number>> {
  const response = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados/RJ/municipios');
  const cities: IBGECity[] = await response.json();
  
  const map = new Map<string, number>();
  for (const city of cities) {
    map.set(city.nome.toUpperCase(), city.id);
  }
  
  return map;
}

// Classify URL to determine spider type
function classifyURL(url: string): { spiderType: string; requiresClientRendering: boolean; citySlug?: string } | null {
  if (!url || url === 'no url' || !url.trim()) {
    return null;
  }

  const urlLower = url.toLowerCase();
  
  // Platform: Instar Tecnologia
  if (urlLower.includes('instartecnologia.com.br')) {
    return { spiderType: 'instar', requiresClientRendering: false };
  }
  
  // Platform: GeoSIAP
  if (urlLower.includes('geosiap.net.br')) {
    return { spiderType: 'geosiap', requiresClientRendering: true };
  }
  
  // Platform: Diário Municipal (AEMERJ)
  if (urlLower.includes('diariomunicipal.com.br/aemerj')) {
    return { spiderType: 'diariomunicipal', requiresClientRendering: false };
  }
  
  // Platform: A Executivo
  if (urlLower.includes('aexecutivo.com.br')) {
    return { spiderType: 'aexecutivo', requiresClientRendering: false };
  }
  
  // Platform: Boletim Oficial BR
  if (urlLower.includes('boletimoficialbr.com.br')) {
    return { spiderType: 'boletimoficialbr', requiresClientRendering: false };
  }
  
  // Platform: Diário Oficial Online
  if (urlLower.includes('diario-oficial.online')) {
    return { spiderType: 'diariooficialonline', requiresClientRendering: false };
  }
  
  // Custom city sites - will need to be analyzed separately
  // Pattern: doweb.{city}.rj.gov.br
  if (urlLower.includes('.rj.gov.br')) {
    return null; // Needs custom spider
  }
  
  return null; // Needs review
}

async function main() {
  console.log('🚀 Starting RJ cities processing...');
  
  // Read CSV
  const csvPath = join(process.cwd(), 'diarios_oficiais_rj_consolidado.csv');
  const csvContent = readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').slice(1); // Skip header
  
  // Parse cities from CSV
  const cities: CityData[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    
    const match = line.match(/"([^"]+)","([^"]+)","([^"]+)"/);
    if (match) {
      const [, cidade, uf, url] = match;
      if (cidade && uf === 'RJ' && url && url !== 'no url') {
        cities.push({ cidade: cidade.trim(), uf, url: url.trim() });
      }
    }
  }
  
  console.log(`📋 Found ${cities.length} cities in CSV`);
  
  // Fetch IBGE codes
  console.log('🔍 Fetching IBGE codes...');
  const ibgeMap = await fetchIBGECodes();
  
  // Load existing configs
  const configPath = join(process.cwd(), 'src/spiders/v2/configs/rj.json');
  let existingConfigs: any[] = [];
  try {
    existingConfigs = JSON.parse(readFileSync(configPath, 'utf-8'));
  } catch (e) {
    // File doesn't exist yet, start with empty array
  }
  
  // Process cities
  const results: CityResult[] = [];
  const newConfigs: any[] = [...existingConfigs];
  
  for (const city of cities) {
    const citySlug = createSlug(city.cidade);
    const configId = `rj_${citySlug}`;
    
    // Check if already exists
    const exists = existingConfigs.find(c => c.id === configId || c.name.includes(city.cidade));
    if (exists && exists.spiders && exists.spiders.length > 0 && exists.spiders[0].spiderType) {
      results.push({
        cidade: city.cidade,
        url: city.url,
        status: 'skipped_already_exists',
        existingSpider: exists.spiders[0].spiderType
      } as any);
      console.log(`⏭️  Skipped ${city.cidade} - already exists`);
      continue;
    }
    
    // Get IBGE code
    const ibgeCode = ibgeMap.get(city.cidade.toUpperCase());
    if (!ibgeCode) {
      results.push({
        cidade: city.cidade,
        url: city.url,
        status: 'needs_review',
        reason: `IBGE code not found for ${city.cidade}`
      });
      console.log(`⚠️  ${city.cidade} - IBGE code not found`);
      continue;
    }
    
    // Classify URL
    const classification = classifyURL(city.url);
    
    if (!classification) {
      // Needs custom spider - for now mark as needs_review
      results.push({
        cidade: city.cidade,
        url: city.url,
        status: 'needs_review',
        reason: 'Custom site - needs browser analysis'
      });
      console.log(`🔍 ${city.cidade} - needs custom spider analysis`);
      continue;
    }
    
    // Create config using existing spider type
    const newConfig = {
      id: configId,
      name: `${city.cidade} - RJ`,
      territoryId: String(ibgeCode),
      stateCode: 'RJ',
      active: true,
      spiders: [{
        spiderType: classification.spiderType,
        priority: 1,
        active: true,
        gazetteScope: 'city',
        config: {
          type: classification.spiderType,
          baseUrl: city.url,
          url: city.url,
          requiresClientRendering: classification.requiresClientRendering,
          citySlug: classification.citySlug || citySlug
        }
      }]
    };
    
    // Remove old config if exists (without valid spider)
    const oldIndex = newConfigs.findIndex(c => c.id === configId);
    if (oldIndex >= 0) {
      newConfigs.splice(oldIndex, 1);
    }
    
    newConfigs.push(newConfig);
    
    results.push({
      cidade: city.cidade,
      url: city.url,
      status: 'used_existing_spider',
      spiderType: classification.spiderType,
      territoryId: String(ibgeCode),
      citySlug: citySlug
    });
    
    console.log(`✅ ${city.cidade} - using ${classification.spiderType}`);
  }
  
  // Save configs
  newConfigs.sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(configPath, JSON.stringify(newConfigs, null, 2) + '\n');
  
  // Generate report
  const summary = {
    total: cities.length,
    created_new_spider: results.filter(r => r.status === 'created_new_spider').length,
    used_existing_spider: results.filter(r => r.status === 'used_existing_spider').length,
    skipped_already_exists: results.filter(r => r.status === 'skipped_already_exists').length,
    needs_review: results.filter(r => r.status === 'needs_review').length
  };
  
  const report: Report = {
    timestamp: new Date().toISOString(),
    csvFile: 'diarios_oficiais_rj_consolidado.csv',
    stateCode: 'RJ',
    configFile: 'src/spiders/v2/configs/rj.json',
    summary,
    results
  };
  
  const reportPath = join(process.cwd(), `scripts/spider-agent/reports/${Date.now()}-rj-report.json`);
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  
  console.log('\n📊 Summary:');
  console.log(`  Total: ${summary.total}`);
  console.log(`  Used existing spider: ${summary.used_existing_spider}`);
  console.log(`  Skipped (already exists): ${summary.skipped_already_exists}`);
  console.log(`  Needs review: ${summary.needs_review}`);
  console.log(`\n📁 Config saved to: ${configPath}`);
  console.log(`📁 Report saved to: ${reportPath}`);
}

main().catch(console.error);
