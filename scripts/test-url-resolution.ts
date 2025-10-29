/**
 * Test URL Resolution Script
 * 
 * This script tests the URL resolution functionality with known redirect URLs
 * and real gazette URLs to ensure it works correctly.
 * 
 * Usage: bun run scripts/test-url-resolution.ts
 */

import { resolveFinalUrl } from '../src/utils/url-resolver';
import { logger } from '../src/utils/logger';

interface TestCase {
  name: string;
  url: string;
  expectRedirect: boolean;
  shouldSucceed: boolean;
}

const testCases: TestCase[] = [
  {
    name: 'Direct URL (no redirect)',
    url: 'https://www.example.com/direct.pdf',
    expectRedirect: false,
    shouldSucceed: false, // Will fail because example.com returns 404
  },
  {
    name: 'HTTP to HTTPS redirect',
    url: 'http://github.com',
    expectRedirect: true,
    shouldSucceed: true,
  },
  {
    name: 'Short URL redirect',
    url: 'https://bit.ly/3QJZm7V', // Example short URL
    expectRedirect: true,
    shouldSucceed: true,
  },
  {
    name: 'Invalid URL',
    url: 'not-a-valid-url',
    expectRedirect: false,
    shouldSucceed: false,
  },
  {
    name: 'Non-existent domain',
    url: 'https://this-domain-definitely-does-not-exist-12345.com/file.pdf',
    expectRedirect: false,
    shouldSucceed: false,
  },
];

async function testUrlResolution() {
  logger.info('Starting URL resolution tests...\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const testCase of testCases) {
    logger.info(`Test: ${testCase.name}`);
    logger.info(`  URL: ${testCase.url}`);
    
    try {
      const startTime = Date.now();
      const resolvedUrl = await resolveFinalUrl(testCase.url, {
        maxRedirects: 10,
        timeout: 10000,
        retries: 1,
      });
      const duration = Date.now() - startTime;
      
      const wasRedirected = resolvedUrl !== testCase.url;
      
      logger.info(`  Result: SUCCESS`);
      logger.info(`  Resolved to: ${resolvedUrl}`);
      logger.info(`  Was redirected: ${wasRedirected}`);
      logger.info(`  Duration: ${duration}ms`);
      
      if (testCase.shouldSucceed) {
        logger.info(`  ✓ Test PASSED`);
        passed++;
      } else {
        logger.warn(`  ✗ Test FAILED (expected failure, but succeeded)`);
        failed++;
      }
      
    } catch (error) {
      logger.info(`  Result: FAILED`);
      logger.info(`  Error: ${(error as Error).message}`);
      
      if (!testCase.shouldSucceed) {
        logger.info(`  ✓ Test PASSED (expected failure)`);
        passed++;
      } else {
        logger.warn(`  ✗ Test FAILED (expected success)`);
        failed++;
      }
    }
    
    logger.info('');
  }
  
  // Test with real gazette URLs (if available)
  logger.info('========== Testing with Real Gazette URLs ==========\n');
  
  const realGazetteUrls = [
    'https://sai.io.org.br/Handler.ashx?f=diario&query=123&c=456&m=0',
    'https://www.doe.sp.gov.br/executivo/caderno1/2025/janeiro/01',
    'https://diof.ro.gov.br/data/uploads/2025/01/DOE-01-01-2025.pdf',
  ];
  
  for (const url of realGazetteUrls) {
    logger.info(`Testing real gazette URL:`);
    logger.info(`  URL: ${url}`);
    
    try {
      const startTime = Date.now();
      const resolvedUrl = await resolveFinalUrl(url, {
        maxRedirects: 10,
        timeout: 15000,
        retries: 2,
      });
      const duration = Date.now() - startTime;
      
      const wasRedirected = resolvedUrl !== url;
      
      logger.info(`  Result: SUCCESS`);
      logger.info(`  Resolved to: ${resolvedUrl}`);
      logger.info(`  Was redirected: ${wasRedirected}`);
      logger.info(`  Duration: ${duration}ms`);
      
    } catch (error) {
      logger.info(`  Result: FAILED`);
      logger.info(`  Error: ${(error as Error).message}`);
    }
    
    logger.info('');
  }
  
  // Performance test
  logger.info('========== Performance Test ==========\n');
  logger.info('Testing concurrent URL resolutions...');
  
  const concurrentUrls = [
    'http://github.com',
    'http://google.com',
    'http://cloudflare.com',
    'http://wikipedia.org',
    'http://stackoverflow.com',
  ];
  
  const startTime = Date.now();
  const results = await Promise.allSettled(
    concurrentUrls.map(url => resolveFinalUrl(url, {
      maxRedirects: 5,
      timeout: 10000,
      retries: 1,
    }))
  );
  const duration = Date.now() - startTime;
  
  const successful = results.filter(r => r.status === 'fulfilled').length;
  logger.info(`Resolved ${successful}/${concurrentUrls.length} URLs concurrently in ${duration}ms`);
  logger.info(`Average time per URL: ${Math.round(duration / concurrentUrls.length)}ms\n`);
  
  // Summary
  logger.info('========== SUMMARY ==========');
  logger.info(`Tests passed: ${passed}`);
  logger.info(`Tests failed: ${failed}`);
  logger.info(`Total tests: ${passed + failed}`);
  logger.info(`Success rate: ${Math.round((passed / (passed + failed)) * 100)}%`);
  
  return { passed, failed };
}

// Run the script
if (import.meta.main) {
  testUrlResolution()
    .then(({ passed, failed }) => {
      if (failed === 0) {
        logger.info('\n✓ All tests passed!');
        process.exit(0);
      } else {
        logger.warn(`\n✗ ${failed} test(s) failed`);
        process.exit(1);
      }
    })
    .catch((error) => {
      logger.error('Test script failed', error as Error);
      process.exit(1);
    });
}

export { testUrlResolution };

