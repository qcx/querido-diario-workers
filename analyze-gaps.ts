/**
 * Analyze coverage gaps and opportunities
 */

import * as fs from 'fs';

interface StateData {
  state: string;
  name: string;
  municipalities: number;
  region: string;
}

interface CoverageData {
  summary: {
    totalUniqueCities: number;
    totalPlatforms: number;
    totalStates: number;
  };
  states: Array<{
    state: string;
    count: number;
  }>;
}

async function analyzeGaps() {
  console.log('🔍 Analyzing Coverage Gaps and Opportunities\n');
  console.log('='.repeat(80));

  // Load Brazil municipalities data
  const brazilData = JSON.parse(
    fs.readFileSync('brazil-municipalities-by-state.json', 'utf-8')
  );

  // Load current coverage
  const coverageData: CoverageData = JSON.parse(
    fs.readFileSync('coverage-report.json', 'utf-8')
  );

  const totalBrazilMunicipalities = 5569;
  const currentCoverage = coverageData.summary.totalUniqueCities;
  const coveragePercentage = ((currentCoverage / totalBrazilMunicipalities) * 100).toFixed(2);

  console.log('\n📊 Overall Coverage\n');
  console.log(`Total Municipalities in Brazil: ${totalBrazilMunicipalities}`);
  console.log(`Currently Covered: ${currentCoverage}`);
  console.log(`Coverage Percentage: ${coveragePercentage}%`);
  console.log(`Gap: ${totalBrazilMunicipalities - currentCoverage} municipalities`);

  console.log('\n' + '='.repeat(80));
  console.log('\n🎯 Coverage by State (Gaps Analysis)\n');

  const gaps = [];

  for (const stateInfo of brazilData.byState) {
    const covered = coverageData.states.find(s => s.state === stateInfo.state);
    const coveredCount = covered ? covered.count : 0;
    const gap = stateInfo.municipalities - coveredCount;
    const percentage = ((coveredCount / stateInfo.municipalities) * 100).toFixed(1);

    gaps.push({
      state: stateInfo.state,
      name: stateInfo.name,
      region: stateInfo.region,
      total: stateInfo.municipalities,
      covered: coveredCount,
      gap,
      percentage: parseFloat(percentage),
    });
  }

  // Sort by gap (descending)
  gaps.sort((a, b) => b.gap - a.gap);

  console.log('State | Total | Covered | Gap    | Coverage %');
  console.log('-'.repeat(60));

  for (const gap of gaps) {
    const bar = '█'.repeat(Math.floor(gap.percentage / 5));
    console.log(
      `${gap.state.padEnd(5)} | ${gap.total.toString().padStart(5)} | ${gap.covered.toString().padStart(7)} | ${gap.gap.toString().padStart(6)} | ${gap.percentage.toString().padStart(5)}% ${bar}`
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n🚀 Top 10 Opportunities (Largest Gaps)\n');

  for (let i = 0; i < Math.min(10, gaps.length); i++) {
    const gap = gaps[i];
    console.log(
      `${(i + 1).toString().padStart(2)}. ${gap.name.padEnd(25)} Gap: ${gap.gap.toString().padStart(4)} (${gap.percentage}% covered)`
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n🏆 Best Covered States\n');

  const bestCovered = [...gaps].sort((a, b) => b.percentage - a.percentage).slice(0, 10);

  for (let i = 0; i < bestCovered.length; i++) {
    const state = bestCovered[i];
    console.log(
      `${(i + 1).toString().padStart(2)}. ${state.name.padEnd(25)} ${state.percentage}% (${state.covered}/${state.total})`
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n📈 States with Zero Coverage\n');

  const zeroCoverage = gaps.filter(g => g.covered === 0);

  if (zeroCoverage.length > 0) {
    for (const state of zeroCoverage) {
      console.log(`❌ ${state.name.padEnd(25)} ${state.total} municipalities`);
    }
  } else {
    console.log('✅ All states have at least some coverage!');
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n🎯 Strategic Recommendations\n');

  // Calculate ROI potential
  const recommendations = [];

  // 1. States with large gaps and low coverage
  const lowCoverage = gaps.filter(g => g.percentage < 50 && g.gap > 50);
  if (lowCoverage.length > 0) {
    recommendations.push({
      priority: 'HIGH',
      strategy: 'Focus on states with large gaps',
      states: lowCoverage.slice(0, 5).map(g => g.state).join(', '),
      potential: lowCoverage.slice(0, 5).reduce((sum, g) => sum + g.gap, 0),
    });
  }

  // 2. States with zero coverage
  if (zeroCoverage.length > 0) {
    recommendations.push({
      priority: 'HIGH',
      strategy: 'Establish presence in uncovered states',
      states: zeroCoverage.map(g => g.state).join(', '),
      potential: zeroCoverage.reduce((sum, g) => sum + g.total, 0),
    });
  }

  // 3. States with medium coverage (50-80%)
  const mediumCoverage = gaps.filter(g => g.percentage >= 50 && g.percentage < 80 && g.gap > 20);
  if (mediumCoverage.length > 0) {
    recommendations.push({
      priority: 'MEDIUM',
      strategy: 'Complete coverage in partially covered states',
      states: mediumCoverage.slice(0, 5).map(g => g.state).join(', '),
      potential: mediumCoverage.slice(0, 5).reduce((sum, g) => sum + g.gap, 0),
    });
  }

  for (let i = 0; i < recommendations.length; i++) {
    const rec = recommendations[i];
    console.log(`${i + 1}. [${rec.priority}] ${rec.strategy}`);
    console.log(`   States: ${rec.states}`);
    console.log(`   Potential: +${rec.potential} municipalities\n`);
  }

  // Save detailed gap analysis
  const gapReport = {
    summary: {
      totalBrazilMunicipalities,
      currentCoverage,
      coveragePercentage: parseFloat(coveragePercentage),
      gap: totalBrazilMunicipalities - currentCoverage,
    },
    gaps,
    recommendations,
  };

  fs.writeFileSync('gap-analysis.json', JSON.stringify(gapReport, null, 2));
  console.log('✅ Detailed gap analysis saved to gap-analysis.json');

  console.log('\n' + '='.repeat(80));
}

analyzeGaps()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Analysis failed:', error);
    console.error(error.stack);
    process.exit(1);
  });
