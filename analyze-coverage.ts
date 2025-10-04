/**
 * Analyze city coverage by platform and state
 */

import * as fs from 'fs';
import * as path from 'path';

interface CityConfig {
  id: string;
  name: string;
  stateCode: string;
  territoryId: string;
  spiderType?: string;
  [key: string]: any;
}

interface PlatformStats {
  platform: string;
  totalCities: number;
  stateDistribution: Record<string, number>;
  cities: CityConfig[];
}

async function analyzeCoverage() {
  console.log('📊 Analyzing City Coverage\n');
  console.log('='.repeat(80));

  const configsDir = path.join(process.cwd(), 'src/spiders/configs');
  const files = fs.readdirSync(configsDir).filter(f => f.endsWith('-cities.json'));

  const platformStats: PlatformStats[] = [];
  const allCities = new Set<string>();
  const citiesByState: Record<string, Set<string>> = {};

  for (const file of files) {
    const platform = file.replace('-cities.json', '').replace(/-/g, '_');
    const filePath = path.join(configsDir, file);
    
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const cities: CityConfig[] = JSON.parse(content);

      const stateDistribution: Record<string, number> = {};

      for (const city of cities) {
        const territoryId = city.territoryId || city.id;
        const stateCode = city.stateCode || 'UNKNOWN';

        allCities.add(territoryId);

        if (!citiesByState[stateCode]) {
          citiesByState[stateCode] = new Set();
        }
        citiesByState[stateCode].add(territoryId);

        stateDistribution[stateCode] = (stateDistribution[stateCode] || 0) + 1;
      }

      platformStats.push({
        platform,
        totalCities: cities.length,
        stateDistribution,
        cities,
      });

      console.log(`\n✅ ${platform}: ${cities.length} cities`);
    } catch (error: any) {
      console.error(`❌ Error reading ${file}:`, error.message);
    }
  }

  // Sort by total cities
  platformStats.sort((a, b) => b.totalCities - a.totalCities);

  console.log('\n' + '='.repeat(80));
  console.log('\n📈 Coverage Summary\n');

  console.log(`Total Unique Cities: ${allCities.size}`);
  console.log(`Total Platforms: ${platformStats.length}`);
  console.log(`Total States Covered: ${Object.keys(citiesByState).length}`);

  console.log('\n' + '='.repeat(80));
  console.log('\n🏆 Top 10 Platforms by City Count\n');

  for (let i = 0; i < Math.min(10, platformStats.length); i++) {
    const stats = platformStats[i];
    const topStates = Object.entries(stats.stateDistribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([state, count]) => `${state}:${count}`)
      .join(', ');

    console.log(`${i + 1}. ${stats.platform.padEnd(30)} ${stats.totalCities.toString().padStart(5)} cities (${topStates})`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n🗺️  Coverage by State\n');

  const stateStats = Object.entries(citiesByState)
    .map(([state, cities]) => ({ state, count: cities.size }))
    .sort((a, b) => b.count - a.count);

  for (const { state, count } of stateStats) {
    const bar = '█'.repeat(Math.floor(count / 20));
    console.log(`${state.padEnd(10)} ${count.toString().padStart(4)} cities ${bar}`);
  }

  // Save detailed report
  const report = {
    summary: {
      totalUniqueCities: allCities.size,
      totalPlatforms: platformStats.length,
      totalStates: Object.keys(citiesByState).length,
    },
    platforms: platformStats.map(p => ({
      platform: p.platform,
      totalCities: p.totalCities,
      stateDistribution: p.stateDistribution,
    })),
    states: stateStats,
  };

  fs.writeFileSync('coverage-report.json', JSON.stringify(report, null, 2));
  console.log('\n✅ Detailed report saved to coverage-report.json');

  console.log('\n' + '='.repeat(80));
}

analyzeCoverage()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Analysis failed:', error);
    console.error(error.stack);
    process.exit(1);
  });
