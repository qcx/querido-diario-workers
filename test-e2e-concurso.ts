/**
 * End-to-End Test: Find a real concurso público
 * 
 * Flow: Spider → OCR → Analysis (Keyword only)
 */

import { spiderRegistry } from './src/spiders/registry';
import { MistralOcrService } from './src/services/mistral-ocr';
import { AnalysisOrchestrator } from './src/services/analysis-orchestrator';
import { OcrQueueMessage, OcrResult, AnalysisConfig } from './src/types';

async function testE2EConcurso() {
  console.log('🎯 End-to-End Test: Finding Real Concurso Público\n');
  console.log('='.repeat(80));

  // Step 1: Find a gazette with spider
  console.log('\n📡 Step 1: Crawling for recent gazettes...\n');
  
  // Test multiple cities to find one with gazettes
  const testCities = [
    { id: 'ba_acajutiba', territoryId: '2900306', type: 'doem' },
    { id: 'ba_alagoinhas', territoryId: '2900405', type: 'doem' },
    { id: 'ba_amelia_rodrigues', territoryId: '2901007', type: 'doem' },
  ];

  let selectedGazette: any = null;
  let selectedCity: any = null;

  for (const city of testCities) {
    try {
      console.log(`  Testing ${city.id}...`);
      
      const spider = spiderRegistry.createSpider(
        {
          id: city.id,
          name: city.id,
          territoryId: city.territoryId,
          spiderType: city.type,
          config: { type: city.type },
        },
        {
          start: '2025-09-01',
          end: '2025-10-04',
        }
      );

      const gazettes = await spider.crawl();
      
      if (gazettes.length > 0) {
        console.log(`    ✅ Found ${gazettes.length} gazettes`);
        selectedGazette = gazettes[0];
        selectedCity = city;
        break;
      } else {
        console.log(`    ⚠️  No gazettes found`);
      }
    } catch (error: any) {
      console.log(`    ❌ Error: ${error.message}`);
    }
  }

  if (!selectedGazette) {
    console.log('\n❌ No gazettes found in any city. Exiting.');
    return;
  }

  console.log('\n✅ Selected Gazette:');
  console.log(`  City: ${selectedCity.id}`);
  console.log(`  Territory: ${selectedGazette.territoryId}`);
  console.log(`  Date: ${selectedGazette.date}`);
  console.log(`  Edition: ${selectedGazette.editionNumber || 'N/A'}`);
  console.log(`  URL: ${selectedGazette.fileUrl}`);

  // Step 2: OCR the PDF
  console.log('\n' + '='.repeat(80));
  console.log('\n📄 Step 2: Processing PDF with Mistral OCR...\n');

  const mistralApiKey = process.env.MISTRAL_API_KEY;
  if (!mistralApiKey) {
    console.log('❌ MISTRAL_API_KEY not set. Exiting.');
    return;
  }

  const ocrService = new MistralOcrService({
    apiKey: mistralApiKey,
  });

  const ocrMessage: OcrQueueMessage = {
    jobId: `test-ocr-${Date.now()}`,
    pdfUrl: selectedGazette.fileUrl,
    territoryId: selectedGazette.territoryId,
    publicationDate: selectedGazette.date,
    editionNumber: selectedGazette.editionNumber,
    spiderId: selectedCity.id,
    queuedAt: new Date().toISOString(),
    metadata: {
      power: selectedGazette.power,
      isExtraEdition: selectedGazette.isExtraEdition,
    },
  };

  console.log(`  Processing: ${selectedGazette.fileUrl}`);
  console.log(`  Job ID: ${ocrMessage.jobId}`);

  let ocrResult: OcrResult;
  try {
    ocrResult = await ocrService.processPdf(ocrMessage);
    
    console.log(`\n  ✅ OCR Status: ${ocrResult.status}`);
    console.log(`  Pages: ${ocrResult.pagesProcessed || 'N/A'}`);
    console.log(`  Text Length: ${ocrResult.extractedText?.length || 0} chars`);
    console.log(`  Processing Time: ${ocrResult.processingTimeMs}ms`);

    if (ocrResult.status !== 'success') {
      console.log(`\n  ❌ OCR failed: ${ocrResult.error?.message}`);
      return;
    }

    // Show first 500 chars
    if (ocrResult.extractedText) {
      console.log(`\n  📝 Text Preview (first 500 chars):`);
      console.log(`  ${'-'.repeat(76)}`);
      console.log(`  ${ocrResult.extractedText.substring(0, 500)}...`);
      console.log(`  ${'-'.repeat(76)}`);
    }
  } catch (error: any) {
    console.log(`\n  ❌ OCR Error: ${error.message}`);
    return;
  }

  // Step 3: Analyze with KeywordAnalyzer only
  console.log('\n' + '='.repeat(80));
  console.log('\n🔍 Step 3: Analyzing with KeywordAnalyzer...\n');

  const analysisConfig: AnalysisConfig = {
    analyzers: {
      keyword: {
        enabled: true,
        priority: 1,
        timeout: 10000,
      },
      entity: {
        enabled: false, // Disabled for this test
      },
      ai: {
        enabled: false, // Disabled as requested
      },
    },
  };

  const orchestrator = new AnalysisOrchestrator(analysisConfig);
  const analysis = await orchestrator.analyze(ocrResult);

  console.log(`  ✅ Analysis Complete`);
  console.log(`  Total Findings: ${analysis.summary.totalFindings}`);
  console.log(`  High Confidence: ${analysis.summary.highConfidenceFindings}`);
  console.log(`  Categories: ${analysis.summary.categories.join(', ')}`);

  // Step 4: Check for concurso findings
  console.log('\n' + '='.repeat(80));
  console.log('\n🎓 Step 4: Checking for Concurso Público...\n');

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
        console.log(`     Context: "${finding.context}"`);
      }
      console.log('');
    }
  } else {
    console.log(`  ⚠️  No concurso findings in this gazette.`);
  }

  // Show all findings by category
  console.log('\n' + '='.repeat(80));
  console.log('\n📊 All Findings by Category:\n');

  const findingsByCategory: Record<string, number> = {};
  for (const result of analysis.analyses) {
    for (const finding of result.findings) {
      const category = finding.data.category || finding.type;
      findingsByCategory[category] = (findingsByCategory[category] || 0) + 1;
    }
  }

  const sortedCategories = Object.entries(findingsByCategory)
    .sort((a, b) => b[1] - a[1]);

  for (const [category, count] of sortedCategories) {
    console.log(`  ${category.padEnd(40)} ${count}`);
  }

  // Summary
  console.log('\n' + '='.repeat(80));
  console.log('\n📋 Summary:\n');
  console.log(`  City: ${selectedCity.id}`);
  console.log(`  Territory: ${selectedGazette.territoryId}`);
  console.log(`  Date: ${selectedGazette.date}`);
  console.log(`  PDF URL: ${selectedGazette.fileUrl}`);
  console.log(`  Text Length: ${ocrResult.extractedText?.length || 0} chars`);
  console.log(`  Total Findings: ${analysis.summary.totalFindings}`);
  console.log(`  Concurso Findings: ${concursoFindings.length}`);
  console.log(`  Categories Found: ${analysis.summary.categories.join(', ')}`);

  if (concursoFindings.length > 0) {
    console.log('\n  🎉 SUCCESS: Found concurso público in real gazette!');
  } else {
    console.log('\n  ℹ️  No concurso in this gazette, but system is working correctly.');
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n✅ End-to-End Test Complete!\n');
}

// Run test
testE2EConcurso()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    console.error(error.stack);
    process.exit(1);
  });
