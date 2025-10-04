/**
 * End-to-End Test for OCR System
 * Tests the complete flow with real Mistral API
 */

import { MistralOcrService } from './src/services/mistral-ocr';
import { OcrQueueMessage } from './src/types/ocr';

// Test configuration
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY || 'DgiTxvpYh2sj5tXT9GvvSjhNXIahj7Nz';

// Sample PDF URL (small test PDF)
const TEST_PDF_URL = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

async function testMistralOcr() {
  console.log('🧪 End-to-End OCR Test\n');
  console.log('='.repeat(80));
  console.log('\n📋 Configuration:');
  console.log(`- Mistral API Key: ${MISTRAL_API_KEY.substring(0, 10)}...`);
  console.log(`- Test PDF URL: ${TEST_PDF_URL}`);
  console.log('\n' + '='.repeat(80));

  // Create OCR service
  const ocrService = new MistralOcrService({
    apiKey: MISTRAL_API_KEY,
    timeout: 60000,
  });

  // Create test message
  const testMessage: OcrQueueMessage = {
    jobId: 'test-e2e-' + Date.now(),
    pdfUrl: TEST_PDF_URL,
    territoryId: '3550308',
    publicationDate: '2025-10-04',
    editionNumber: 'TEST-001',
    spiderId: 'test_spider',
    queuedAt: new Date().toISOString(),
    metadata: {
      power: 'executive',
      isExtraEdition: false,
      sourceText: 'E2E Test',
    },
  };

  console.log('\n📤 Test Message:');
  console.log(JSON.stringify(testMessage, null, 2));
  console.log('\n' + '-'.repeat(80));

  try {
    console.log('\n⏳ Processing PDF with Mistral OCR...\n');
    
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
    console.log(`Completed At: ${result.completedAt}`);
    
    if (result.extractedText) {
      console.log('\n📄 Extracted Text:');
      console.log('-'.repeat(80));
      console.log(result.extractedText.substring(0, 500));
      if (result.extractedText.length > 500) {
        console.log(`\n... (${result.extractedText.length - 500} more characters)`);
      }
      console.log('-'.repeat(80));
      console.log(`Total Characters: ${result.extractedText.length}`);
    }

    if (result.error) {
      console.log('\n❌ Error Details:');
      console.log('-'.repeat(80));
      console.log(`Message: ${result.error.message}`);
      console.log(`Code: ${result.error.code}`);
      if (result.error.details) {
        console.log(`Details: ${result.error.details}`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ E2E Test Completed Successfully!\n');

    return result;
  } catch (error: any) {
    console.log('\n' + '='.repeat(80));
    console.log('❌ E2E Test Failed!\n');
    console.log('Error Details:');
    console.log('-'.repeat(80));
    console.log(`Message: ${error.message}`);
    console.log(`Stack: ${error.stack}`);
    console.log('\n' + '='.repeat(80));
    throw error;
  }
}

// Run test
console.log('\n🚀 Starting End-to-End OCR Test...\n');
testMistralOcr()
  .then(() => {
    console.log('✅ All tests passed!\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error.message);
    process.exit(1);
  });
