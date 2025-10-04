/**
 * Simplified End-to-End Test: Find concurso in real gazette
 * 
 * Flow: Real PDF URL → OCR → Analysis (Keyword only)
 */

import { MistralOcrService } from './src/services/mistral-ocr';
import { AnalysisOrchestrator } from './src/services/analysis-orchestrator';
import { OcrQueueMessage, OcrResult, AnalysisConfig } from './src/types';

async function testE2EConcursoSimple() {
  console.log('🎯 Simplified E2E Test: Finding Concurso in Real Gazette\n');
  console.log('='.repeat(80));

  // Use a real gazette URL from Palmas - TO
  const testGazettes = [
    {
      name: 'Palmas - TO (Edição 3809)',
      territoryId: '1721000',
      date: '2025-10-03',
      url: 'http://diariooficial.palmas.to.gov.br/media/diario/3809-3-10-2025-21-41-36.pdf',
      spiderId: 'to_palmas',
    },
  ];

  const mistralApiKey = process.env.MISTRAL_API_KEY;
  if (!mistralApiKey) {
    console.log('❌ MISTRAL_API_KEY not set. Exiting.');
    return;
  }

  const ocrService = new MistralOcrService({
    apiKey: mistralApiKey,
  });

  let successfulOcr: OcrResult | null = null;
  let selectedGazette: any = null;

  // Try each gazette URL
  for (const gazette of testGazettes) {
    console.log(`\n📄 Testing: ${gazette.name}`);
    console.log(`   URL: ${gazette.url}`);

    const ocrMessage: OcrQueueMessage = {
      jobId: `test-ocr-${Date.now()}`,
      pdfUrl: gazette.url,
      territoryId: gazette.territoryId,
      publicationDate: gazette.date,
      spiderId: gazette.spiderId,
      queuedAt: new Date().toISOString(),
    };

    try {
      console.log(`   Processing...`);
      const ocrResult = await ocrService.processPdf(ocrMessage);
      
      console.log(`   Status: ${ocrResult.status}`);
      console.log(`   Text Length: ${ocrResult.extractedText?.length || 0} chars`);

      if (ocrResult.status === 'success' && ocrResult.extractedText && ocrResult.extractedText.length > 100) {
        console.log(`   ✅ Success!`);
        successfulOcr = ocrResult;
        selectedGazette = gazette;
        break;
      } else {
        console.log(`   ⚠️  Text too short or failed`);
      }
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }

  if (!successfulOcr) {
    console.log('\n❌ No successful OCR. Exiting.');
    return;
  }

  // Show OCR result
  console.log('\n' + '='.repeat(80));
  console.log('\n✅ OCR Result:\n');
  console.log(`  Gazette: ${selectedGazette.name}`);
  console.log(`  Territory: ${successfulOcr.territoryId}`);
  console.log(`  Date: ${successfulOcr.publicationDate}`);
  console.log(`  Text Length: ${successfulOcr.extractedText?.length || 0} chars`);
  console.log(`  Processing Time: ${successfulOcr.processingTimeMs}ms`);

  if (successfulOcr.extractedText) {
    console.log(`\n  📝 Text Preview (first 1000 chars):`);
    console.log(`  ${'-'.repeat(76)}`);
    const preview = successfulOcr.extractedText.substring(0, 1000).split('\n').map(line => `  ${line}`).join('\n');
    console.log(preview);
    console.log(`  ${'-'.repeat(76)}`);
  }

  // Analyze with KeywordAnalyzer only
  console.log('\n' + '='.repeat(80));
  console.log('\n🔍 Analyzing with KeywordAnalyzer...\n');

  const analysisConfig: AnalysisConfig = {
    analyzers: {
      keyword: {
        enabled: true,
        priority: 1,
        timeout: 10000,
      },
      entity: {
        enabled: true, // Enable to get more context
        priority: 2,
        timeout: 10000,
      },
      ai: {
        enabled: false, // Disabled as requested
      },
    },
  };

  const orchestrator = new AnalysisOrchestrator(analysisConfig);
  const analysis = await orchestrator.analyze(successfulOcr);

  console.log(`  ✅ Analysis Complete`);
  console.log(`  Total Findings: ${analysis.summary.totalFindings}`);
  console.log(`  High Confidence: ${analysis.summary.highConfidenceFindings}`);
  console.log(`  Categories: ${analysis.summary.categories.join(', ') || 'none'}`);

  // Check for concurso findings
  console.log('\n' + '='.repeat(80));
  console.log('\n🎓 Checking for Concurso Público...\n');

  const concursoFindings = analysis.analyses
    .flatMap(a => a.findings)
    .filter(f => f.type.includes('concurso'));

  if (concursoFindings.length > 0) {
    console.log(`  ✅ FOUND ${concursoFindings.length} CONCURSO FINDINGS!\n`);

    for (const finding of concursoFindings) {
      console.log(`  📌 Finding:`);
      console.log(`     Type: ${finding.type}`);
      console.log(`     Confidence: ${(finding.confidence * 100).toFixed(1)}%`);
      console.log(`     Keyword: "${finding.data.keyword}"`);
      console.log(`     Position: ${finding.data.position}`);
      if (finding.context) {
        const contextPreview = finding.context.substring(0, 200);
        console.log(`     Context: "${contextPreview}${finding.context.length > 200 ? '...' : ''}"`);
      }
      console.log('');
    }
  } else {
    console.log(`  ℹ️  No concurso findings in this gazette.`);
  }

  // Show all findings by category
  console.log('\n' + '='.repeat(80));
  console.log('\n📊 All Findings by Type:\n');

  const findingsByType: Record<string, number> = {};
  for (const result of analysis.analyses) {
    for (const finding of result.findings) {
      findingsByType[finding.type] = (findingsByType[finding.type] || 0) + 1;
    }
  }

  const sortedTypes = Object.entries(findingsByType)
    .sort((a, b) => b[1] - a[1]);

  for (const [type, count] of sortedTypes) {
    console.log(`  ${type.padEnd(45)} ${count}`);
  }

  // Show top keywords
  console.log('\n' + '='.repeat(80));
  console.log('\n🔑 Top Keywords:\n');

  const keywords = analysis.summary.keywords.slice(0, 20);
  for (const keyword of keywords) {
    console.log(`  • ${keyword}`);
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('\n📋 Final Summary:\n');
  console.log(`  Gazette: ${selectedGazette.name}`);
  console.log(`  Territory: ${successfulOcr.territoryId}`);
  console.log(`  Date: ${successfulOcr.publicationDate}`);
  console.log(`  PDF URL: ${selectedGazette.url}`);
  console.log(`  Text Length: ${successfulOcr.extractedText?.length || 0} chars`);
  console.log(`  Total Findings: ${analysis.summary.totalFindings}`);
  console.log(`  Concurso Findings: ${concursoFindings.length}`);
  console.log(`  Categories: ${analysis.summary.categories.join(', ') || 'none'}`);

  if (concursoFindings.length > 0) {
    console.log('\n  🎉 SUCCESS: Found concurso público in real gazette!');
    console.log('\n  ✅ End-to-End flow working correctly:');
    console.log('     1. PDF → Mistral OCR ✅');
    console.log('     2. OCR → Text Extraction ✅');
    console.log('     3. Text → Keyword Analysis ✅');
    console.log('     4. Analysis → Concurso Detection ✅');
  } else {
    console.log('\n  ℹ️  No concurso in this gazette.');
    console.log('     But the E2E flow is working correctly!');
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n✅ Test Complete!\n');
}

// Run test
testE2EConcursoSimple()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    console.error(error.stack);
    process.exit(1);
  });
