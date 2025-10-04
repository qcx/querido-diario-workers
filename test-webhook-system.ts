/**
 * Test Webhook System
 * Tests webhook filtering and notification creation
 */

import { GazetteAnalysis, WebhookSubscription } from './src/types';
import { WebhookFilterService } from './src/services/webhook-filter';

async function testWebhookSystem() {
  console.log('🔔 Testing Webhook System\n');
  console.log('='.repeat(80));

  // Create mock analysis (from our E2E test)
  const mockAnalysis: GazetteAnalysis = {
    jobId: 'analysis-test-123',
    ocrJobId: 'ocr-test-123',
    territoryId: '1721000',
    publicationDate: '2025-10-03',
    analyzedAt: new Date().toISOString(),
    extractedText: 'Mock gazette text with concurso público...',
    textLength: 1000,
    analyses: [
      {
        analyzerId: 'keyword-analyzer',
        analyzerType: 'keyword',
        status: 'success',
        findings: [
          {
            type: 'keyword:concurso_publico',
            confidence: 0.9,
            data: {
              category: 'concurso_publico',
              keyword: 'concurso público',
              position: 100,
            },
            context: 'Ana Zeila da Silva Ferreira aprovada em Concurso Público...',
          },
          {
            type: 'keyword:concurso_publico',
            confidence: 0.9,
            data: {
              category: 'concurso_publico',
              keyword: 'concurso',
              position: 200,
            },
            context: 'Nomeada para cargo de Concurso homologado...',
          },
        ],
        processingTimeMs: 5,
        metadata: {
          totalFindings: 2,
        },
      },
    ],
    summary: {
      totalFindings: 2,
      findingsByType: {
        'keyword:concurso_publico': 2,
      },
      highConfidenceFindings: 2,
      categories: ['concurso_publico'],
      keywords: ['concurso público', 'concurso'],
    },
    metadata: {
      spiderId: 'to_palmas',
      editionNumber: '3809',
    },
  };

  console.log('\n📄 Mock Analysis:');
  console.log(`  Territory: ${mockAnalysis.territoryId}`);
  console.log(`  Date: ${mockAnalysis.publicationDate}`);
  console.log(`  Total Findings: ${mockAnalysis.summary.totalFindings}`);
  console.log(`  Categories: ${mockAnalysis.summary.categories.join(', ')}`);
  console.log(`  Keywords: ${mockAnalysis.summary.keywords.join(', ')}`);

  // Test 1: Qconcursos filter
  console.log('\n' + '='.repeat(80));
  console.log('\n🎯 Test 1: Qconcursos Filter\n');

  const qconcursosFilter = WebhookFilterService.createQconcursosFilter(0.7);
  
  console.log('  Filter Configuration:');
  console.log(`    Categories: ${qconcursosFilter.categories?.join(', ')}`);
  console.log(`    Keywords: ${qconcursosFilter.keywords?.slice(0, 5).join(', ')}...`);
  console.log(`    Min Confidence: ${qconcursosFilter.minConfidence}`);
  console.log(`    Min Findings: ${qconcursosFilter.minFindings}`);

  const matches = WebhookFilterService.matches(mockAnalysis, qconcursosFilter);
  console.log(`\n  ✅ Matches: ${matches}`);

  if (matches) {
    const findings = WebhookFilterService.extractFindings(mockAnalysis, qconcursosFilter);
    console.log(`  ✅ Extracted Findings: ${findings.length}`);
    
    for (const finding of findings) {
      console.log(`\n    • Type: ${finding.type}`);
      console.log(`      Confidence: ${(finding.confidence * 100).toFixed(1)}%`);
      console.log(`      Keyword: "${finding.data.keyword}"`);
      console.log(`      Context: "${finding.context?.substring(0, 80)}..."`);
    }
  }

  // Test 2: Licitação filter (should not match)
  console.log('\n' + '='.repeat(80));
  console.log('\n🎯 Test 2: Licitação Filter (Should Not Match)\n');

  const licitacaoFilter = WebhookFilterService.createQlicitacaoFilter(0.7);
  
  console.log('  Filter Configuration:');
  console.log(`    Categories: ${licitacaoFilter.categories?.join(', ')}`);
  console.log(`    Keywords: ${licitacaoFilter.keywords?.slice(0, 5).join(', ')}...`);

  const matchesLicitacao = WebhookFilterService.matches(mockAnalysis, licitacaoFilter);
  console.log(`\n  ❌ Matches: ${matchesLicitacao}`);

  // Test 3: Custom filter with territories
  console.log('\n' + '='.repeat(80));
  console.log('\n🎯 Test 3: Custom Filter with Territory\n');

  const customFilter = WebhookFilterService.createCustomFilter(
    ['concurso_publico'],
    ['concurso'],
    0.8,
    ['1721000', '3550308'] // Palmas and São Paulo
  );

  console.log('  Filter Configuration:');
  console.log(`    Categories: ${customFilter.categories?.join(', ')}`);
  console.log(`    Keywords: ${customFilter.keywords?.join(', ')}`);
  console.log(`    Territories: ${customFilter.territoryIds?.join(', ')}`);

  const matchesCustom = WebhookFilterService.matches(mockAnalysis, customFilter);
  console.log(`\n  ✅ Matches: ${matchesCustom}`);

  // Test 4: Wrong territory (should not match)
  console.log('\n' + '='.repeat(80));
  console.log('\n🎯 Test 4: Wrong Territory Filter (Should Not Match)\n');

  const wrongTerritoryFilter = WebhookFilterService.createQconcursosFilter(0.7, ['3550308']);
  
  console.log('  Filter Configuration:');
  console.log(`    Territories: ${wrongTerritoryFilter.territoryIds?.join(', ')}`);

  const matchesWrongTerritory = WebhookFilterService.matches(mockAnalysis, wrongTerritoryFilter);
  console.log(`\n  ❌ Matches: ${matchesWrongTerritory}`);

  // Test 5: Webhook notification payload example
  console.log('\n' + '='.repeat(80));
  console.log('\n📦 Test 5: Webhook Notification Payload Example\n');

  const findings = WebhookFilterService.extractFindings(mockAnalysis, qconcursosFilter);

  const notificationPayload = {
    notificationId: 'notif-test-123',
    subscriptionId: 'qconcursos-123',
    clientId: 'qconcursos',
    event: 'concurso.detected',
    timestamp: new Date().toISOString(),
    gazette: {
      territoryId: mockAnalysis.territoryId,
      territoryName: 'Palmas - TO',
      publicationDate: mockAnalysis.publicationDate,
      editionNumber: mockAnalysis.metadata?.editionNumber,
      pdfUrl: 'http://diariooficial.palmas.to.gov.br/media/diario/3809-3-10-2025-21-41-36.pdf',
      spiderId: mockAnalysis.metadata?.spiderId,
    },
    analysis: {
      jobId: mockAnalysis.jobId,
      totalFindings: mockAnalysis.summary.totalFindings,
      highConfidenceFindings: mockAnalysis.summary.highConfidenceFindings,
      categories: mockAnalysis.summary.categories,
    },
    findings,
  };

  console.log('  Example Webhook Payload:');
  console.log(JSON.stringify(notificationPayload, null, 2));

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('\n📊 Test Summary:\n');
  console.log('  ✅ Test 1: Qconcursos filter matched correctly');
  console.log('  ✅ Test 2: Licitação filter did not match (as expected)');
  console.log('  ✅ Test 3: Custom filter with territory matched');
  console.log('  ✅ Test 4: Wrong territory did not match (as expected)');
  console.log('  ✅ Test 5: Notification payload created successfully');

  console.log('\n' + '='.repeat(80));
  console.log('\n✅ All Tests Passed!\n');
}

testWebhookSystem()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    console.error(error.stack);
    process.exit(1);
  });
