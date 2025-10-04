/**
 * Debug test for Mistral OCR API
 */

const MISTRAL_API_KEY = 'DgiTxvpYh2sj5tXT9GvvSjhNXIahj7Nz';
const TEST_PDF_URL = 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

async function testMistralOcrApi() {
  console.log('🔍 Testing Mistral OCR API\n');
  
  const payload = {
    model: 'mistral-ocr-latest',
    document: {
      type: 'document_url',
      document_url: TEST_PDF_URL,
    },
    include_image_base64: false,
  };

  console.log('📤 Request:');
  console.log(JSON.stringify(payload, null, 2));
  console.log('\n' + '-'.repeat(80) + '\n');

  try {
    const response = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MISTRAL_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    console.log(`📥 Response Status: ${response.status} ${response.statusText}`);
    console.log('\nResponse Headers:');
    response.headers.forEach((value, key) => {
      console.log(`  ${key}: ${value}`);
    });
    console.log('\n' + '-'.repeat(80) + '\n');

    const responseText = await response.text();
    console.log('📄 Response Body (raw):');
    console.log(responseText);
    console.log('\n' + '-'.repeat(80) + '\n');

    if (response.ok) {
      const result = JSON.parse(responseText);
      console.log('✅ Parsed Response:');
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('❌ Error Response');
    }
  } catch (error: any) {
    console.error('❌ Request failed:', error.message);
    console.error(error.stack);
  }
}

testMistralOcrApi();
