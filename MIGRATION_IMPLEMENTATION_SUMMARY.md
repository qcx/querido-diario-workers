# Gazette Registry Flow Migration - Implementation Summary

## Changes Completed

### 1. Schema Updates (`src/services/database/schema.ts`)
- ✅ Added `GAZETTE_REGISTRY_STATUSES` constant with all status values
- ✅ Added `GAZETTE_CRAWL_STATUSES` constant

### 2. Type Definitions (`src/types/gazette.ts`)
- ✅ Added `GazetteRegistryStatus` type
- ✅ Added `GazetteCrawlStatus` type
- ✅ Added `CreateGazetteCrawlInput` interface
- ✅ Added `GazetteCrawlRecord` interface
- ✅ Added `GazetteRegistryRecord` interface

### 3. Repository Extensions (`src/services/database/drizzle-gazette-repo.ts`)
- ✅ Added `getGazetteByPdfUrl()` - Find gazette by PDF URL
- ✅ Added `updateGazetteStatus()` - Update gazette_registry status
- ✅ Added `createGazetteCrawl()` - Create gazette_crawl record
- ✅ Added `updateGazetteCrawlStatus()` - Update single crawl status
- ✅ Added `updateCrawlsStatusByGazetteId()` - Update all crawls for a gazette
- ✅ Added `getGazetteCrawlsByGazetteId()` - Get all crawls for a gazette
- ✅ Fixed `registerGazette()` and `registerGazettes()` to match actual schema
- ⚠️ Deprecated old methods that referenced non-existent fields

### 4. Crawl Processor (`src/goodfellow/crawl-processor.ts`)
- ✅ Replaced batch gazette registration with individual processing
- ✅ Implemented PDF URL lookup for duplicate detection
- ✅ Added status-based routing logic:
  - `ocr_failure`: Create failed gazette_crawl, skip OCR
  - `ocr_success`: Create success gazette_crawl, reuse existing OCR result
  - `pending|uploaded|ocr_processing|ocr_retrying`: Create processing gazette_crawl, retry OCR
  - New gazette: Create gazette_registry + gazette_crawl, send to OCR
- ✅ Added detailed logging for each scenario
- ✅ Added processing summary with counts

### 5. OCR Processor (`src/goodfellow/ocr-processor.ts`)
- ✅ Added gazette lookup by territory + publication date
- ✅ Implemented status checking before OCR:
  - `ocr_success`: Reuse existing result, skip processing
  - `ocr_processing|ocr_retrying`: Retry message (wait for completion)
  - `ocr_failure`: Mark as retrying and reprocess
  - `pending|uploaded`: Start OCR processing
- ✅ Added gazette status updates:
  - Before: Update to `ocr_processing`
  - After success: Update to `ocr_success` + update all gazette_crawls to 'success'
  - After failure: Update to `ocr_failure` + update all gazette_crawls to 'failed'
- ✅ Added status updates in exception handler
- ✅ Backwards compatibility for gazettes without registry entry

## New Flow Diagram

```
Spider Crawl
    ↓
Check gazette_registry by PDF URL
    ↓
    ├─ Not Found → Create new gazette_registry (pending) + gazette_crawl (created) → OCR Queue
    │
    ├─ Found (ocr_failure) → Create gazette_crawl (failed) → END (Skip OCR)
    │
    ├─ Found (ocr_success) → Create gazette_crawl (success) → OCR Queue (will skip to Analysis)
    │
    └─ Found (pending/uploaded/ocr_processing/ocr_retrying) → Create gazette_crawl (processing) → OCR Queue (retry)

OCR Queue
    ↓
Check gazette_registry status
    ↓
    ├─ ocr_success → Reuse result → Analysis Queue
    │
    ├─ ocr_processing/ocr_retrying → Retry message (wait)
    │
    └─ pending/uploaded/ocr_failure → Process OCR
        ↓
        ├─ Success → Update gazette to 'ocr_success' + crawls to 'success' → Analysis Queue
        │
        └─ Failure → Update gazette to 'ocr_failure' + crawls to 'failed' → Error Log
```

## Testing Checklist

### Unit Tests Needed
- [ ] Test `getGazetteByPdfUrl()` with existing and non-existing PDFs
- [ ] Test `createGazetteCrawl()` creates proper record
- [ ] Test `updateGazetteStatus()` transitions
- [ ] Test `updateCrawlsStatusByGazetteId()` updates all related crawls

### Integration Tests Needed
- [ ] **Duplicate Detection**: Crawl same PDF URL twice
  - First crawl: Should create gazette_registry + gazette_crawl + send to OCR
  - Second crawl: Should find existing, check status, route accordingly
  
- [ ] **OCR Success Flow**: 
  - Crawl gazette → OCR succeeds → Recrawl same gazette
  - Expected: Second crawl creates gazette_crawl with 'success', skips OCR
  
- [ ] **OCR Failure Flow**:
  - Crawl gazette → OCR fails → Recrawl same gazette
  - Expected: Second crawl creates gazette_crawl with 'failed', skips OCR
  
- [ ] **OCR In-Progress Flow**:
  - Crawl gazette → OCR starts but doesn't finish → Recrawl same gazette
  - Expected: Second crawl creates gazette_crawl with 'processing', re-enqueues OCR
  
- [ ] **Status Transitions**:
  - Verify gazette_registry status updates: pending → ocr_processing → ocr_success
  - Verify gazette_registry status updates: pending → ocr_processing → ocr_failure
  - Verify gazette_crawls status updates when gazette status changes

### Performance Tests
- [ ] Test with large batch (100+ gazettes) with mix of new/existing
- [ ] Measure impact of PDF URL lookups on performance
- [ ] Verify database query efficiency with indexes

## Database Schema Notes

### gazette_registry Fields
- `id` - Primary key
- `publication_date` - ISO date
- `edition_number` - Edition identifier
- `pdf_url` - **UNIQUE** - Used for deduplication
- `pdf_r2_key` - R2 storage key
- `is_extra_edition` - Boolean
- `power` - Government power
- `created_at` - Timestamp
- **`status`** - OCR processing status (NEW)
- `metadata` - JSON

### gazette_crawls Fields (Tracks crawl history)
- `id` - Primary key
- `job_id` - Crawl job identifier (UNIQUE per crawl)
- `territory_id` - IBGE code
- `spider_id` - Spider identifier
- `gazette_id` - FK to gazette_registry
- **`status`** - Crawl result status (NEW)
- `scraped_at` - When crawled
- `created_at` - Record creation

## Migration Notes

- **No data migration required** - Existing gazettes will have default status='pending'
- **Backwards compatible** - OCR processor handles gazettes without registry entry
- **Audit trail preserved** - Each crawl creates a gazette_crawl record
- **Deprecated methods** - Old methods that queried non-existent fields are marked deprecated

## Next Steps

1. Run unit tests for new repository methods
2. Run integration tests for full pipeline
3. Monitor first production crawl for:
   - Duplicate detection working correctly
   - Status transitions logging properly
   - OCR result reuse functioning
   - Performance acceptable
4. Update dashboard to show:
   - gazette_crawls statistics
   - Gazette status distribution
   - Duplicate detection metrics

