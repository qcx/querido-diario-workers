#!/usr/bin/env npx tsx
/**
 * Import OCR Results from Batch Files
 * Imports OCR results from batch JSON files into the D1 database
 */

import { drizzle } from 'drizzle-orm/d1';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { ocrResults } from '../../src/services/database/schema';

interface BatchFile {
  results: Array<{
    id: string;
    document_type: string;
    document_id: string;
    extracted_text: string;
    text_length: number;
    confidence_score: number | null;
    language_detected: string | null;
    processing_method: string | null;
    created_at: string;
    metadata: string | object; // Can be string or object
  }>;
}

interface ImportStats {
  totalBatches: number;
  totalRecords: number;
  successfulInserts: number;
  failedInserts: number;
  skippedRecords: number;
}

/**
 * Import OCR results from a single batch file
 */
async function importBatch(
  db: ReturnType<typeof drizzle>,
  batchPath: string,
  batchNumber: number
): Promise<{ success: number; failed: number; skipped: number }> {
  let success = 0;
  let failed = 0;
  let skipped = 0;

  try {
    console.log(`📦 Loading batch ${batchNumber} from ${batchPath}...`);
    const fileContent = readFileSync(batchPath, 'utf8');
    const parsedData = JSON.parse(fileContent);
    
    // Handle both { results: [...] } and [{ results: [...] }] formats
    let batch: BatchFile;
    if (Array.isArray(parsedData)) {
      // If it's an array, take the first element (should have results)
      batch = parsedData[0] as BatchFile;
    } else {
      batch = parsedData as BatchFile;
    }

    if (!batch.results || !Array.isArray(batch.results)) {
      console.warn(`⚠️  Batch ${batchNumber}: Invalid format, skipping`);
      console.warn(`   Expected format: { results: [...] } or [{ results: [...] }]`);
      console.warn(`   Actual format: ${Array.isArray(parsedData) ? 'array' : typeof parsedData}`);
      if (parsedData && typeof parsedData === 'object') {
        console.warn(`   Keys found: ${Object.keys(parsedData).join(', ')}`);
      }
      return { success: 0, failed: 0, skipped: 0 };
    }

    console.log(`  Found ${batch.results.length} records in batch ${batchNumber}`);

    for (const row of batch.results) {
      try {
        // Ensure metadata is a string (JSON string)
        let metadataString: string;
        if (typeof row.metadata === 'string') {
          metadataString = row.metadata;
        } else {
          metadataString = JSON.stringify(row.metadata || {});
        }

        // Insert into database
        await db.insert(ocrResults).values({
          id: row.id,
          documentType: row.document_type,
          documentId: row.document_id,
          extractedText: row.extracted_text,
          textLength: row.text_length,
          confidenceScore: row.confidence_score,
          languageDetected: row.language_detected || 'pt',
          processingMethod: row.processing_method || 'mistral',
          createdAt: row.created_at,
          metadata: metadataString,
        });

        success++;
      } catch (err: any) {
        // Get error message from various possible locations
        const errorMessage = 
          err?.message || 
          err?.cause?.message || 
          String(err);
        
        // Get error code from various possible locations
        const errorCode = 
          err?.code || 
          err?.errno || 
          err?.cause?.code || 
          err?.cause?.errno;
        
        // Check error message string (case-insensitive)
        const errorMessageLower = errorMessage.toLowerCase();
        
        // Check if it's a duplicate key error (SQLite unique constraint)
        // SQLite error codes: 
        // - 2067 = SQLITE_CONSTRAINT_UNIQUE (better-sqlite3)
        // - 1555 = SQLITE_CONSTRAINT_PRIMARYKEY
        // - 'SQLITE_CONSTRAINT_UNIQUE' = string code
        const isDuplicateError = 
          errorMessageLower.includes('unique constraint') ||
          errorMessageLower.includes('unique constraint failed') ||
          errorMessageLower.includes('primary key constraint') ||
          errorMessageLower.includes('duplicate') ||
          errorMessageLower.includes('already exists') ||
          errorCode === 'SQLITE_CONSTRAINT_UNIQUE' ||
          errorCode === 'SQLITE_CONSTRAINT' ||
          errorCode === 2067 ||
          errorCode === 1555 ||
          (typeof errorCode === 'number' && (errorCode === 2067 || errorCode === 1555));
        
        if (isDuplicateError) {
          skipped++;
          if (skipped % 100 === 0) {
            console.log(`  ⏭️  Skipped ${skipped} duplicate records so far...`);
          }
        } else {
          failed++;
          // Only show detailed error for first few failures to avoid spam
          if (failed <= 5) {
            console.error(`  ❌ Insert failed for record ${row.id}:`, errorMessage);
            if (errorCode) {
              console.error(`     Error code: ${errorCode}`);
            }
            // Show full error for debugging first error
            if (failed === 1) {
              console.error(`     Full error:`, err);
            }
          } else if (failed === 6) {
            console.error(`  ❌ ... (suppressing further error details, total failures: ${failed})`);
          }
        }
      }
    }

    console.log(`  ✅ Batch ${batchNumber} completed: ${success} inserted, ${failed} failed, ${skipped} skipped`);
    return { success, failed, skipped };
  } catch (err: any) {
    console.error(`  ❌ Failed to process batch ${batchNumber}:`, err?.message || err);
    // If we couldn't even parse the file, we don't know how many records it had
    return { success: 0, failed: 0, skipped: 0 };
  }
}

/**
 * Find all batch files in the directory
 */
function findBatchFiles(directory: string): string[] {
  try {
    const files = readdirSync(directory)
      .filter((file) => file.startsWith('batch_') && file.endsWith('.json'))
      .sort((a, b) => {
        // Extract batch number for sorting
        const numA = parseInt(a.match(/batch_(\d+)/)?.[1] || '0');
        const numB = parseInt(b.match(/batch_(\d+)/)?.[1] || '0');
        return numA - numB;
      })
      .map((file) => join(directory, file));

    return files;
  } catch (err) {
    console.error('Failed to read batch files directory:', err);
    return [];
  }
}

/**
 * Main import function
 */
export default {
  async run(env: any) {
    const db = drizzle(env.DB);

    if (!env.DB) {
      throw new Error('DB binding not found in environment. Make sure DB is available.');
    }

    console.log('🚀 Starting OCR Results Import');
    console.log('═'.repeat(60));

    // Get the directory where batch files are located
    const batchDir = join(process.cwd(), 'data', 'ocr_results');
    const batchFiles = findBatchFiles(batchDir);

    if (batchFiles.length === 0) {
      console.error('❌ No batch files found in', batchDir);
      return;
    }

    console.log(`📁 Found ${batchFiles.length} batch files to import`);
    console.log('');

    const stats: ImportStats = {
      totalBatches: batchFiles.length,
      totalRecords: 0,
      successfulInserts: 0,
      failedInserts: 0,
      skippedRecords: 0,
    };

    // Import each batch
    for (let i = 0; i < batchFiles.length; i++) {
      const batchFile = batchFiles[i];
      const batchNumber = parseInt(batchFile.match(/batch_(\d+)/)?.[1] || String(i));

      const result = await importBatch(db, batchFile, batchNumber);

      stats.totalRecords += result.success + result.failed + result.skipped;
      stats.successfulInserts += result.success;
      stats.failedInserts += result.failed;
      stats.skippedRecords += result.skipped;

      console.log('');
    }

    // Print summary
    console.log('═'.repeat(60));
    console.log('📊 Import Summary');
    console.log('═'.repeat(60));
    console.log(`Total batches processed: ${stats.totalBatches}`);
    console.log(`Total records found: ${stats.totalRecords}`);
    console.log(`✅ Successfully inserted: ${stats.successfulInserts}`);
    console.log(`❌ Failed inserts: ${stats.failedInserts}`);
    console.log(`⏭️  Skipped (duplicates): ${stats.skippedRecords}`);
    console.log('═'.repeat(60));

    if (stats.failedInserts > 0) {
      console.warn('⚠️  Some records failed to import. Check errors above.');
    } else {
      console.log('🎉 All batches imported successfully!');
    }
  },
};

// If run directly (not as a module), execute the import
if (import.meta.url === `file://${process.argv[1]}`) {
  // For local testing, you can provide a mock D1 environment
  // This would typically be run in a Cloudflare Worker context
  console.log('⚠️  This script is designed to run in a Cloudflare Worker environment.');
  console.log('⚠️  For local testing, use wrangler dev or provide a D1 database binding.');
  console.log('');
  console.log('Usage in Cloudflare Worker:');
  console.log('  import { importOcr } from "./data/ocr_results/import-ocr";');
  console.log('  await importOcr.run(env);');
}
