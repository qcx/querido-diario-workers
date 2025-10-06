#!/usr/bin/env node
/**
 * Utility to find city configurations by name or partial ID
 * 
 * Usage: npx tsx scripts/find-city.ts <search-term>
 * Examples:
 *   npx tsx scripts/find-city.ts manaus
 *   npx tsx scripts/find-city.ts acajutiba
 *   npx tsx scripts/find-city.ts am_manaus
 *   npx tsx scripts/find-city.ts 1302603
 */

import { spiderRegistry } from '../src/spiders/registry';
import { SpiderConfig } from '../src/types';

interface CityMatch {
  config: SpiderConfig;
  matchType: 'id' | 'name' | 'territoryId' | 'partial';
  score: number;
}

function findCities(searchTerm: string): CityMatch[] {
  const allConfigs = spiderRegistry.getAllConfigs();
  const matches: CityMatch[] = [];
  const search = searchTerm.toLowerCase().trim();

  for (const config of allConfigs) {
    // Exact ID match (highest priority)
    if (config.id.toLowerCase() === search) {
      matches.push({ config, matchType: 'id', score: 100 });
      continue;
    }

    // Territory ID match
    if (config.territoryId === search) {
      matches.push({ config, matchType: 'territoryId', score: 90 });
      continue;
    }

    // Name exact match
    const cleanName = config.name.toLowerCase().replace(/\s*-\s*[a-z]{2}$/i, '');
    if (cleanName === search) {
      matches.push({ config, matchType: 'name', score: 80 });
      continue;
    }

    // Name partial match
    if (cleanName.includes(search)) {
      const score = search.length / cleanName.length * 70;
      matches.push({ config, matchType: 'partial', score });
      continue;
    }

    // ID partial match (e.g., searching "manaus" finds "am_1302603")
    if (config.id.toLowerCase().includes(search)) {
      const score = search.length / config.id.length * 60;
      matches.push({ config, matchType: 'partial', score });
    }
  }

  // Sort by score (highest first)
  return matches.sort((a, b) => b.score - a.score);
}

function formatSpiderType(spiderType: string): string {
  const typeColors: Record<string, string> = {
    'doem': '🟢',
    'sigpub': '🔵', 
    'diario-ba': '🟡',
    'instar': '🟠',
    'adiarios_v1': '🟣',
    'adiarios_v2': '🟪',
    'dom_sc': '⚪',
    'amm-mt': '🔴',
  };
  
  return `${typeColors[spiderType] || '⚫'} ${spiderType}`;
}

function displayResults(matches: CityMatch[], searchTerm: string): void {
  console.log(`🔍 Searching for: "${searchTerm}"\n`);

  if (matches.length === 0) {
    console.log('❌ No cities found matching your search.');
    console.log('\n💡 Tips:');
    console.log('  • Try partial city names (e.g., "manaus", "acaju")');
    console.log('  • Use IBGE codes (e.g., "1302603")');
    console.log('  • Check spelling and try without accents');
    return;
  }

  console.log(`✅ Found ${matches.length} matching cit${matches.length === 1 ? 'y' : 'ies'}:\n`);

  // Group by match type for better display
  const groups = {
    exact: matches.filter(m => m.score >= 80),
    partial: matches.filter(m => m.score < 80)
  };

  if (groups.exact.length > 0) {
    console.log('🎯 Exact/Close Matches:');
    for (const match of groups.exact.slice(0, 5)) {
      console.log(`  ${formatSpiderType(match.config.spiderType)} ${match.config.id}`);
      console.log(`     📍 ${match.config.name}`);
      console.log(`     🏷️  Territory: ${match.config.territoryId}`);
      console.log(`     🧪 Test: bun run test:city ${match.config.id}`);
      console.log('');
    }
  }

  if (groups.partial.length > 0) {
    console.log('📝 Partial Matches:');
    for (const match of groups.partial.slice(0, 10)) {
      console.log(`  ${formatSpiderType(match.config.spiderType)} ${match.config.id}`);
      console.log(`     📍 ${match.config.name}`);
      console.log('');
    }
  }

  // Show test command for best match
  if (matches.length > 0) {
    const bestMatch = matches[0];
    console.log('─'.repeat(60));
    console.log(`🚀 To test the best match (${bestMatch.config.name}):`);
    console.log(`   bun run test:city ${bestMatch.config.id}`);
  }
}

async function main() {
  const searchTerm = process.argv[2];

  if (!searchTerm) {
    console.error('❌ Error: Search term is required');
    console.log('\nUsage: npx tsx scripts/find-city.ts <search-term>');
    console.log('\nExamples:');
    console.log('  npx tsx scripts/find-city.ts manaus');
    console.log('  npx tsx scripts/find-city.ts acajutiba');  
    console.log('  npx tsx scripts/find-city.ts am_manaus');
    console.log('  npx tsx scripts/find-city.ts 1302603');
    process.exit(1);
  }

  try {
    const matches = findCities(searchTerm);
    displayResults(matches, searchTerm);
  } catch (error: any) {
    console.error(`\n❌ Error searching for cities: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
