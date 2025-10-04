/**
 * Test OCR with real gazette PDF
 */

import { MistralOcrService } from './src/services/mistral-ocr';
import { OcrQueueMessage } from './src/types/ocr';

const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || 'DgiTxvpYh2sj5tXT9GvvSjhNXIahj7Nz';

// Real gazette PDF URL (example from DOEM)
const REAL_GAZETTE_URL = 'https://doem.org.br/ba/abaira/diarios/2025/10/03/4a2e0c6d7b8e9f0a1b2c3d4e5f6a7b8c.pdf';

async function testRealGazette() {
  console.log('🧪 Testing OCR with Real Gazette PDF\n');
  console.log('='.repeat(80));
  console.log(`\n📄 Gazette URL: ${REAL_GAZETTE_URL}`);
  console.log('\n' + '='.repeat(80));

  const ocrService = new MistralOcrService({
    apiKey: MISTRAL_API_KEY,
    timeout: 120000,
  });

  const testMessage: OcrQueueMessage = {
    jobId: 'real-gazette-' + Date.now(),
    pdfUrl: REAL_GAZETTE_URL,
    territoryId: '2900108', // Abaíra - BA
    publicationDate: '2025-10-03',
    editionNumber: '001',
    spiderId: 'ba_abaira',
    queuedAt: new Date().toISOString(),
    metadata: {
      power: 'executive',
      isExtraEdition: false,
    },
  };

  try {
    console.log('\n⏳ Processing real gazette PDF with Mistral OCR...\n');
    
    const startTime = Date.now();
    const result = await ocrService.processPdf(testMessage);
    const duration = Date.now() - startTime;

    console.log('\n' + '='.repeat(80));
    console.log('✅ OCR Processing Completed!\n');
    console.log('📊 Results:');
    console.log('-'.repeat(80));
    console.log(`Job ID: ${result.jobId}`);
    console.log(`Status: ${result.status}`);
    console.log(`Processing Time: ${result.processingTimeMs}ms (${duration}ms total)`);
    
    if (result.extractedText) {
      console.log('\n📄 Extracted Text (first 1000 characters):');
      console.log('-'.repeat(80));
      console.log(result.extractedText.substring(0, 1000));
      if (result.extractedText.length > 1000) {
        console.log(`\n... (${result.extractedText.length - 1000} more characters)`);
      }
      console.log('\n' + '-'.repeat(80));
      console.log(`Total Characters: ${result.extractedText.length}`);
      console.log(`Total Words: ~${result.extractedText.split(/\s+/).length}`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Real Gazette Test Completed Successfully!\n');

    return result;
  } catch (error: any) {
    console.log('\n' + '='.repeat(80));
    console.log('❌ Real Gazette Test Failed!\n');
    console.log('Error Details:');
    console.log('-'.repeat(80));
    console.log(`Message: ${error.message}`);
    console.log('\n' + '='.repeat(80));
    throw error;
  }
}

console.log('\n🚀 Starting Real Gazette OCR Test...\n');
testRealGazette()
  .then(() => {
    console.log('✅ Test passed!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  });
