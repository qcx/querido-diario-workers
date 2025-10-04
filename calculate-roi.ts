/**
 * Calculate ROI and prioritize implementation strategies
 */

import * as fs from 'fs';

interface GapData {
  summary: {
    totalBrazilMunicipalities: number;
    currentCoverage: number;
    coveragePercentage: number;
    gap: number;
  };
  gaps: Array<{
    state: string;
    name: string;
    region: string;
    total: number;
    covered: number;
    gap: number;
    percentage: number;
  }>;
}

interface Strategy {
  id: string;
  name: string;
  description: string;
  targetStates: string[];
  estimatedMunicipalities: number;
  estimatedEffort: number; // 1-10 scale
  roi: number; // municipalities / effort
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  implementation: string;
  dependencies: string[];
}

async function calculateROI() {
  console.log('💰 Calculating ROI and Prioritizing Strategies\n');
  console.log('='.repeat(80));

  const gapData: GapData = JSON.parse(
    fs.readFileSync('gap-analysis.json', 'utf-8')
  );

  const strategies: Strategy[] = [];

  // Strategy 1: Expand SIGPub to uncovered states
  const sigpubStates = ['SP', 'BA', 'SC', 'GO', 'AL'];
  const sigpubPotential = sigpubStates.reduce((sum, state) => {
    const gap = gapData.gaps.find(g => g.state === state);
    return sum + (gap ? gap.gap : 0);
  }, 0);

  strategies.push({
    id: 'sigpub-expansion',
    name: 'Expandir SIGPub para Estados Não Cobertos',
    description: 'SIGPub já cobre 1.573 municípios. Expandir para SP, BA, SC, GO, AL',
    targetStates: sigpubStates,
    estimatedMunicipalities: sigpubPotential,
    estimatedEffort: 3, // Plataforma já implementada
    roi: sigpubPotential / 3,
    priority: 'CRITICAL',
    implementation: 'Adicionar configurações de cidades desses estados ao sigpub-cities.json',
    dependencies: ['Verificar se SIGPub tem presença nesses estados'],
  });

  // Strategy 2: Integrate with São Paulo State System
  const spGap = gapData.gaps.find(g => g.state === 'SP');
  if (spGap) {
    strategies.push({
      id: 'sp-state-integration',
      name: 'Integração com Sistema Estadual de SP',
      description: 'Integrar com DOE.SP.GOV.BR e Imprensa Oficial',
      targetStates: ['SP'],
      estimatedMunicipalities: spGap.gap,
      estimatedEffort: 7, // Sistema novo, complexo
      roi: spGap.gap / 7,
      priority: 'HIGH',
      implementation: 'Criar spider para DOE.SP.GOV.BR ou parceria com Imprensa Oficial',
      dependencies: ['Análise técnica do sistema', 'Possível parceria institucional'],
    });
  }

  // Strategy 3: Partner with municipal consortia
  const consortiaStates = ['SP', 'BA', 'SC', 'GO', 'MA'];
  const consortiaPotential = consortiaStates.reduce((sum, state) => {
    const gap = gapData.gaps.find(g => g.state === state);
    return sum + (gap ? gap.gap : 0);
  }, 0);

  strategies.push({
    id: 'consortia-partnerships',
    name: 'Parcerias com Consórcios Intermunicipais',
    description: 'Firmar parcerias com consórcios para cobertura em massa',
    targetStates: consortiaStates,
    estimatedMunicipalities: Math.floor(consortiaPotential * 0.6), // 60% via consórcios
    estimatedEffort: 5, // Negociação + implementação
    roi: Math.floor((consortiaPotential * 0.6) / 5),
    priority: 'HIGH',
    implementation: 'Contatar CIVAP, CINDESP, e outros consórcios grandes',
    dependencies: ['Identificar consórcios ativos', 'Proposta de parceria'],
  });

  // Strategy 4: Complete partial coverage states
  const partialStates = gapData.gaps.filter(g => g.percentage > 40 && g.percentage < 80);
  const partialPotential = partialStates.reduce((sum, g) => sum + g.gap, 0);

  strategies.push({
    id: 'complete-partial',
    name: 'Completar Estados Parcialmente Cobertos',
    description: 'Focar em MG, RS, PR que já têm >40% de cobertura',
    targetStates: partialStates.map(g => g.state),
    estimatedMunicipalities: partialPotential,
    estimatedEffort: 4, // Infraestrutura já existe
    roi: partialPotential / 4,
    priority: 'MEDIUM',
    implementation: 'Adicionar municípios faltantes às plataformas existentes',
    dependencies: ['Identificar quais plataformas os municípios usam'],
  });

  // Strategy 5: Implement new platforms
  const newPlatforms = ['IOSOFT', 'Instituto Inova Cidades', 'RedeDOM'];
  strategies.push({
    id: 'new-platforms',
    name: 'Implementar Novas Plataformas',
    description: 'Criar spiders para IOSOFT, Inova Cidades, RedeDOM',
    targetStates: ['Vários'],
    estimatedMunicipalities: 200, // Estimativa conservadora
    estimatedEffort: 8, // Plataformas novas, desconhecidas
    roi: 200 / 8,
    priority: 'LOW',
    implementation: 'Análise técnica + desenvolvimento de spiders',
    dependencies: ['Pesquisa de cobertura dessas plataformas'],
  });

  // Strategy 6: Partner with ABM/CNM
  strategies.push({
    id: 'national-associations',
    name: 'Parceria com ABM e CNM',
    description: 'Parceria institucional com associações nacionais',
    targetStates: ['Todos'],
    estimatedMunicipalities: 1000, // Potencial de influência
    estimatedEffort: 6, // Negociação longa
    roi: 1000 / 6,
    priority: 'MEDIUM',
    implementation: 'Proposta institucional + roadshow',
    dependencies: ['Preparar apresentação', 'Contato com liderança'],
  });

  // Sort by ROI (descending)
  strategies.sort((a, b) => b.roi - a.roi);

  console.log('\n📊 Estratégias Priorizadas por ROI\n');
  console.log('Rank | Estratégia                              | Municípios | Esforço | ROI   | Prioridade');
  console.log('-'.repeat(100));

  for (let i = 0; i < strategies.length; i++) {
    const s = strategies[i];
    console.log(
      `${(i + 1).toString().padStart(4)} | ${s.name.padEnd(39)} | ${s.estimatedMunicipalities.toString().padStart(10)} | ${s.estimatedEffort.toString().padStart(7)} | ${s.roi.toFixed(1).padStart(5)} | ${s.priority}`
    );
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n🎯 Detalhamento das Top 3 Estratégias\n');

  for (let i = 0; i < Math.min(3, strategies.length); i++) {
    const s = strategies[i];
    console.log(`${i + 1}. ${s.name} [${s.priority}]`);
    console.log(`   ID: ${s.id}`);
    console.log(`   Descrição: ${s.description}`);
    console.log(`   Estados-alvo: ${s.targetStates.join(', ')}`);
    console.log(`   Potencial: +${s.estimatedMunicipalities} municípios`);
    console.log(`   Esforço: ${s.estimatedEffort}/10`);
    console.log(`   ROI: ${s.roi.toFixed(1)} municípios/esforço`);
    console.log(`   Implementação: ${s.implementation}`);
    console.log(`   Dependências:`);
    for (const dep of s.dependencies) {
      console.log(`     - ${dep}`);
    }
    console.log('');
  }

  console.log('='.repeat(80));
  console.log('\n📈 Projeção de Cobertura\n');

  let currentCoverage = gapData.summary.currentCoverage;
  const totalMunicipalities = gapData.summary.totalBrazilMunicipalities;

  console.log(`Cobertura Atual: ${currentCoverage} (${gapData.summary.coveragePercentage.toFixed(2)}%)`);
  console.log('');

  const roadmap = [
    { phase: 'Fase 1 (3 meses)', strategies: ['sigpub-expansion'] },
    { phase: 'Fase 2 (6 meses)', strategies: ['consortia-partnerships', 'complete-partial'] },
    { phase: 'Fase 3 (12 meses)', strategies: ['sp-state-integration', 'national-associations'] },
  ];

  for (const phase of roadmap) {
    const phaseGain = phase.strategies.reduce((sum, strategyId) => {
      const strategy = strategies.find(s => s.id === strategyId);
      return sum + (strategy ? strategy.estimatedMunicipalities : 0);
    }, 0);

    currentCoverage += phaseGain;
    const percentage = ((currentCoverage / totalMunicipalities) * 100).toFixed(2);

    console.log(`${phase.phase}:`);
    console.log(`  Estratégias: ${phase.strategies.join(', ')}`);
    console.log(`  Ganho: +${phaseGain} municípios`);
    console.log(`  Cobertura acumulada: ${currentCoverage} (${percentage}%)`);
    console.log('');
  }

  console.log('='.repeat(80));

  // Save detailed ROI analysis
  const roiReport = {
    summary: {
      currentCoverage: gapData.summary.currentCoverage,
      totalMunicipalities: gapData.summary.totalBrazilMunicipalities,
      gap: gapData.summary.gap,
    },
    strategies,
    roadmap,
  };

  fs.writeFileSync('roi-analysis.json', JSON.stringify(roiReport, null, 2));
  console.log('\n✅ Detailed ROI analysis saved to roi-analysis.json');

  console.log('\n' + '='.repeat(80));
}

calculateROI()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Analysis failed:', error);
    console.error(error.stack);
    process.exit(1);
  });
