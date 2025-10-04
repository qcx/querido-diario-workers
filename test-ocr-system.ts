/**
 * Test script for OCR system
 * Tests the complete flow: spider -> gazette -> OCR queue
 */

import { OcrQueueSender } from './src/services/ocr-queue-sender';
import { Gazette } from './src/types/gazette';
import { OcrQueueMessage } from './src/types/ocr';

// Mock queue for testing
class MockOcrQueue {
  private messages: OcrQueueMessage[] = [];

  async send(message: OcrQueueMessage): Promise<void> {
    console.log('\n📤 Message sent to OCR queue:');
    console.log(JSON.stringify(message, null, 2));
    this.messages.push(message);
  }

  async sendBatch(messages: OcrQueueMessage[]): Promise<void> {
    console.log(`\n📤 Batch of ${messages.length} messages sent to OCR queue:`);
    for (const message of messages) {
      console.log(JSON.stringify(message, null, 2));
      this.messages.push(message);
    }
  }

  getMessages(): OcrQueueMessage[] {
    return this.messages;
  }

  clear(): void {
    this.messages = [];
  }
}

async function testOcrQueueSender() {
  console.log('🧪 Testing OCR Queue Sender\n');
  console.log('=' .repeat(80));

  // Create mock queue
  const mockQueue = new MockOcrQueue();
  const ocrSender = new OcrQueueSender(mockQueue as any);

  // Test 1: Single gazette
  console.log('\n📋 Test 1: Sending single gazette');
  console.log('-'.repeat(80));

  const singleGazette: Gazette = {
    date: '2025-10-04',
    editionNumber: '1234',
    fileUrl: 'https://example.com/gazette-2025-10-04.pdf',
    isExtraEdition: false,
    power: 'executive',
    territoryId: '3550308',
    scrapedAt: new Date().toISOString(),
    sourceText: 'Test gazette',
  };

  await ocrSender.sendGazette(singleGazette, 'sp_sao_paulo');

  // Test 2: Multiple gazettes
  console.log('\n📋 Test 2: Sending multiple gazettes');
  console.log('-'.repeat(80));

  const multipleGazettes: Gazette[] = [
    {
      date: '2025-10-01',
      editionNumber: '1231',
      fileUrl: 'https://example.com/gazette-2025-10-01.pdf',
      isExtraEdition: false,
      power: 'executive',
      territoryId: '3550308',
      scrapedAt: new Date().toISOString(),
    },
    {
      date: '2025-10-02',
      editionNumber: '1232',
      fileUrl: 'https://example.com/gazette-2025-10-02.pdf',
      isExtraEdition: true,
      power: 'legislative',
      territoryId: '3550308',
      scrapedAt: new Date().toISOString(),
    },
    {
      date: '2025-10-03',
      fileUrl: 'https://example.com/gazette-2025-10-03.pdf',
      isExtraEdition: false,
      power: 'executive_legislative',
      territoryId: '3550308',
      scrapedAt: new Date().toISOString(),
    },
  ];

  await ocrSender.sendGazettes(multipleGazettes, 'sp_sao_paulo');

  // Summary
  console.log('\n📊 Test Summary');
  console.log('='.repeat(80));
  console.log(`Total messages sent: ${mockQueue.getMessages().length}`);
  console.log(`OCR Queue enabled: ${ocrSender.isEnabled()}`);

  // Test 3: Disabled queue
  console.log('\n📋 Test 3: Disabled queue (should not send)');
  console.log('-'.repeat(80));

  const disabledSender = new OcrQueueSender(undefined);
  console.log(`OCR Queue enabled: ${disabledSender.isEnabled()}`);
  
  await disabledSender.sendGazette(singleGazette, 'sp_sao_paulo');
  console.log('✓ No error when queue is disabled');

  console.log('\n✅ All tests completed successfully!\n');
}

// Run tests
testOcrQueueSender().catch(error => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
