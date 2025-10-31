# OCR Domain

The **OCR Domain** is responsible for extracting text content from official gazette PDF files using Mistral's OCR API. This domain handles the entire OCR lifecycle, from PDF processing to text extraction and caching, preparing gazettes for downstream analysis.

## 🎯 Domain Responsibilities

### 1. **OCR Request Management**
- **Process gazette PDFs** through Mistral OCR API
- **Manage OCR job lifecycle** from pending to completion
- **Handle concurrent processing** with atomic status updates
- **Implement retry logic** for failed OCR attempts

### 2. **Queue Management**
- **Process queue messages** containing OCR job requests
- **Batch message processing** for improved throughput
- **Handle retry logic** for transient failures
- **Forward results** to analysis queue via callback pattern

### 3. **Storage & Caching**
- **Upload PDFs to R2** for reliable, fast access
- **Cache OCR results** in KV for sub-second retrieval
- **Database persistence** for long-term storage
- **Implement cache-aside pattern** with automatic fallback

### 4. **Text Extraction**
- **Call Mistral OCR API** with optimized parameters
- **Validate extracted text** for completeness
- **Handle multi-page PDFs** with proper text concatenation
- **Track extraction statistics** (pages processed, text length)

## 🏗️ Architecture Overview

```
ocr/
├── index.ts                 # Domain exports
├── queue-handler.ts         # Queue message processing and orchestration
├── mistral-service.ts       # Pure Mistral API client
├── types.ts                 # OCR type definitions
└── README.md               # This file
```

## 🔑 Key Components

### MistralService
- **Pure API client** - no external dependencies on R2, DB, or caching
- **HTTP-based OCR** using Mistral's document intelligence API
- **Error handling** with detailed error messages
- **Configurable timeouts** for large documents

### OcrQueueHandler
- **Orchestration layer** managing the complete OCR workflow
- **Callback-based architecture** for decoupled queue integration
- **Integrated caching** with KV and database fallback
- **R2 upload logic** with graceful degradation
- **Atomic status management** to prevent duplicate processing

## 📋 Core Interfaces

### OcrQueueMessage
```typescript
interface OcrQueueMessage {
  jobId: string;              // Unique OCR job identifier
  gazetteCrawl: GazetteCrawl; // Crawl record with PDF metadata
  gazette: GazetteRegistry;   // Gazette record from database
  crawlJobId: string;         // Associated crawl job ID
  queuedAt: string;           // Timestamp when queued
}
```

### OcrQueueHandlerEnv
```typescript
interface OcrQueueHandlerEnv {
  DB: D1Database;             // Required: D1 database
  MISTRAL_API_KEY: string;    // Required: Mistral API key
  GAZETTE_PDFS?: R2Bucket;    // Optional: R2 bucket for PDF storage
  R2_PUBLIC_URL?: string;     // Optional: Public URL for R2 bucket
  OCR_RESULTS?: KVNamespace;  // Optional: KV namespace for caching
}
```

### AnalysisQueueMessage
```typescript
interface AnalysisQueueMessage {
  jobId: string;              // Analysis job identifier
  gazetteCrawl: GazetteCrawl; // Crawl record
  gazette: GazetteRegistry;   // Gazette record
  ocrResult: OcrResult;       // Extracted text and metadata
  crawlJobId: string;         // Associated crawl job ID
  queuedAt: string;           // Timestamp
}
```

## 🔄 OCR Flow

### 1. **Queue Processing** (`queue-handler.ts`)
```
Queue Message → Check Status → Check Cache → Upload to R2 → Extract Text → Store Result → Send to Analysis
```

- Receives OCR requests from CRAWL_QUEUE or manual dispatch
- Validates gazette status and claims job atomically
- Checks KV cache and database for existing results
- Processes new OCR requests or reuses cached results
- Updates gazette status throughout workflow

### 2. **Text Extraction** (`mistral-service.ts`)
```
PDF URL → Mistral API → Raw Text → Validation → Return Result
```

- Pure API client for Mistral OCR service
- Handles PDF document processing
- Extracts text with high accuracy
- Returns structured OCR result

### 3. **Caching Strategy**
```
KV Cache (24h TTL) → Database Fallback → API Call → Cache Update
```

- **Primary**: KV cache with 24-hour TTL
- **Secondary**: Database lookup for existing OCR results
- **Tertiary**: Fresh API call if no cache hit
- **Update**: Store in both KV and database after extraction

### 4. **R2 Storage**
```
Generate Key → Check Exists → Upload PDF → Return Public URL
```

- Deterministic key generation: `pdfs/{base64(pdfUrl)}.pdf`
- Automatic deduplication (skip if exists)
- Graceful degradation (use original URL on failure)
- Error logging for troubleshooting

## 🎛️ Configuration

### Environment Variables
- **MISTRAL_API_KEY**: Required API key for Mistral service
- **DB**: D1 database for persistence
- **GAZETTE_PDFS**: Optional R2 bucket for PDF storage
- **R2_PUBLIC_URL**: Base URL for R2-stored PDFs
- **OCR_RESULTS**: Optional KV namespace for caching

### Caching Configuration
- **KV TTL**: 24 hours (86400 seconds)
- **Cache Key Format**: `ocr:{base64(pdfUrl)}`
- **Fallback**: Database lookup → API call

### Status Management
- **Atomic claiming**: Prevents duplicate processing
- **Status flow**: `pending` → `ocr_processing` → `ocr_success`
- **Retry handling**: Allows retry for `ocr_failure` status
- **Concurrent safety**: Conditional updates based on current status

## 📊 Monitoring & Tracking

### Job Tracking
- **OCR job creation** with unique identifiers
- **Status tracking** throughout OCR lifecycle
- **Gazette status updates** for pipeline visibility
- **Crawl job association** for end-to-end tracing

### Logging
- **Structured logging** with job context
- **Error tracking** to `error_logs` table
- **Performance metrics** (extraction time, cache hits)
- **Telemetry tracking** for monitoring

### Error Handling
- **Graceful degradation** for optional components (R2, KV)
- **Detailed error messages** with context
- **Database error logging** for troubleshooting
- **Status updates** on failure for retry logic

## 🔧 Usage Examples

### Basic Queue Handler Setup
```typescript
import { OcrQueueHandler } from './v2/ocr';

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

### Manual OCR Processing
```typescript
const handler = new OcrQueueHandler(env);

const message: OcrQueueMessage = {
  jobId: 'ocr-123',
  gazetteCrawl: crawlRecord,
  gazette: gazetteRecord,
  crawlJobId: 'crawl-456',
  queuedAt: new Date().toISOString()
};

await handler.handle(message, async (analysisMsg) => {
  console.log('OCR complete, text length:', analysisMsg.ocrResult.text.length);
  // Forward to analysis
  await env.ANALYSIS_QUEUE.send(analysisMsg);
});
```

### Testing with Mock Callback
```typescript
const mockCallback = async (msg: AnalysisQueueMessage) => {
  console.log('Analysis message:', {
    jobId: msg.jobId,
    textLength: msg.ocrResult.text.length,
    pages: msg.ocrResult.metadata?.pages
  });
};

const handler = new OcrQueueHandler(env);
await handler.batchHandler(batch, mockCallback);
```

## 🚀 Extension Points

### Custom OCR Providers
1. Create new service implementing OCR interface
2. Swap `MistralService` with custom provider
3. Maintain same error handling and caching patterns

### Enhanced Caching
- Implement tiered caching strategies
- Add cache warming for frequently accessed gazettes
- Implement cache invalidation logic

### Custom Analysis Pipeline
- Implement custom callback for analysis queue
- Add preprocessing steps before analysis
- Extend message structure with additional metadata

## 🔄 Comparison with Legacy Implementation

| Feature | Old (Goodfellow) | New (V2) |
|---------|------------------|----------|
| **API Client** | Coupled with R2/DB | Pure client |
| **R2 Upload** | In MistralService | In QueueHandler |
| **Caching** | Manual in processor | Integrated in handler |
| **Analysis Queue** | Hardcoded queue.send() | Callback injection |
| **Status Management** | Complex atomic logic | Simplified claim pattern |
| **Code Organization** | 1000+ line processor | Modular components (~300 lines) |
| **Testing** | Tightly coupled | Easy to mock and test |
| **Reusability** | Single use case | Generic callback pattern |

## ✅ Benefits of V2 Architecture

### 1. **Separation of Concerns**
- Pure API client has single responsibility
- Queue handler orchestrates without tight coupling
- Each component testable in isolation

### 2. **Flexibility**
- Callback pattern allows any downstream processor
- Optional components (R2, KV) degrade gracefully
- Easy to swap OCR providers

### 3. **Reliability**
- Atomic status updates prevent duplicate processing
- Multi-layer caching reduces API calls
- Comprehensive error handling and logging

### 4. **Performance**
- KV cache provides sub-second lookups
- Batch processing for queue efficiency
- R2 storage improves PDF access reliability

### 5. **Maintainability**
- Clear file structure and responsibilities
- Well-documented interfaces and flows
- Easier to debug and extend

## 🔗 Dependencies

- **Database Layer**: `../db/` for persistence and querying
- **Tracking Layer**: `../tracking/` for telemetry
- **Utils**: Error handling, logging, HTTP client
- **External**: Mistral OCR API, Cloudflare R2/KV/D1
- **Queue System**: Cloudflare Queues for message processing

---

This domain serves as the text extraction engine for the Querido Diário project, enabling automated OCR processing of official gazette PDFs from Brazilian municipalities, preparing them for AI-powered analysis and information extraction.
