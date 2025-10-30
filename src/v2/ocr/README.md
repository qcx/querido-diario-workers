# OCR Module - V2 Architecture

This module implements OCR processing following the V2 architecture pattern with callback-based queue integration.

## Architecture

- **MistralService**: Pure Mistral API client (no R2, DB, or caching)
- **OcrQueueHandler**: Orchestrates OCR workflow with callback pattern for analysis queue

## Usage

### Basic Integration

```typescript
import { OcrQueueHandler } from './v2/ocr';

// In your worker/server
export default {
  async queue(batch: MessageBatch<OcrQueueMessage>, env: OcrQueueHandlerEnv): Promise<void> {
    const handler = new OcrQueueHandler(env);

    // Process batch with callback for analysis queue
    await handler.batchHandler(batch, async (analysisMsg) => {
      // Send to analysis queue
      await env.ANALYSIS_QUEUE.send(analysisMsg);
    });
  }
}
```

### Environment Variables

```typescript
interface OcrQueueHandlerEnv {
  DB: D1Database;                    // Required: D1 database
  MISTRAL_API_KEY: string;           // Required: Mistral API key
  GAZETTE_PDFS?: R2Bucket;           // Optional: R2 bucket for PDF storage
  R2_PUBLIC_URL?: string;            // Optional: Public URL for R2 bucket
  OCR_RESULTS?: KVNamespace;         // Optional: KV namespace for caching
}
```

### Queue Message Structure

```typescript
interface OcrQueueMessage {
  jobId: string;
  gazetteCrawl: GazetteCrawl;        // Crawl record
  gazette: GazetteRegistry;          // Gazette record
  crawlJobId: string;
  queuedAt: string;
}
```

## Features

### 1. KV Caching
- Cache key: `ocr:{base64(pdfUrl)}`
- 24-hour TTL
- Automatic cache-aside pattern for DB fallback

### 2. R2 Storage
- Deterministic key generation: `pdfs/{base64(pdfUrl)}.pdf`
- Automatic deduplication (checks if file exists)
- Graceful degradation (continues with original URL on failure)
- Error logging to database

### 3. Gazette Status Management
- Atomic claiming via conditional updates
- Status flow: `pending` → `ocr_processing` → `ocr_success`
- Handles concurrent processing attempts
- Retry logic for `ocr_failure` status

### 4. Analysis Queue Integration
- Callback-based architecture (decoupled from queue implementation)
- Automatic message construction
- Updates crawl status to `analysis_pending`

## Workflow

1. **Check Status**: Verify gazette status (reuse if `ocr_success`)
2. **Check Cache**: Look for cached OCR result in KV or DB
3. **R2 Upload**: Try to upload PDF to R2 (best effort)
4. **OCR Processing**: Call Mistral API with PDF URL
5. **Store Result**: Save to database with retry logic
6. **Cache Result**: Store in KV cache for fast retrieval
7. **Update Status**: Mark gazette as `ocr_success`
8. **Send to Analysis**: Invoke callback with AnalysisQueueMessage

## Error Handling

- All errors logged to `error_logs` table
- Gazette status updated to `ocr_failure` on error
- Message retried for transient failures
- Telemetry tracking for monitoring

## Comparison with Old Implementation

| Feature | Old (Goodfellow) | New (V2) |
|---------|------------------|----------|
| API Client | Coupled with R2/DB | Pure client |
| R2 Upload | In MistralService | In QueueHandler |
| Caching | Manual in processor | Integrated in handler |
| Analysis Queue | Hardcoded queue.send() | Callback injection |
| Status Management | Complex atomic logic | Simplified with claim pattern |
| Code Organization | 1000+ line processor | Modular components |

## Testing

```typescript
// Mock callback for testing
const mockCallback = async (msg: AnalysisQueueMessage) => {
  console.log('Analysis message:', msg);
};

const handler = new OcrQueueHandler(env);
await handler.batchHandler(batch, mockCallback);
```

## Dependencies

- Mistral OCR API
- Drizzle ORM
- D1 Database
- Optional: R2, KV

