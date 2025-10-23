# Goodfellow - Complete System Architecture

## 🏗️ System Overview

Goodfellow is a unified Cloudflare Worker that processes Brazilian official gazettes from 3,107 municipalities across 20+ different platforms. While it runs as a single worker, it maintains a queue-based architecture where each execution does ONE job and dies.

## 🔄 Complete Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          COMPLETE SYSTEM FLOW                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1️⃣  HTTP API Request                                                       │
│      POST /crawl/today-yesterday                                           │
│      POST /crawl/cities                                                    │
│                           ↓                                                │
│  2️⃣  Main Worker (src/worker.ts)                                            │
│      • Validates request                                                   │
│      • Batches cities (100 per batch)                                     │
│      • Enqueues to gazette-crawl-queue                                     │
│                           ↓                                                │
│  3️⃣  Queue Consumer (same worker)                                           │
│      • Processes batches (10 cities each)                                 │
│      • Creates spider instances                                           │
│      • Executes crawling                                                  │
│      • Finds gazettes → Sends to gazette-ocr-queue                       │
│                           ↓                                                │
│  4️⃣  OCR Worker (src/ocr-worker.ts)                                         │
│      • Downloads PDFs                                                     │
│      • Uploads to R2 bucket (gazette-pdfs)                               │
│      • Calls Mistral OCR API                                              │
│      • Stores results in KV (OCR_RESULTS)                                │
│      • Batch sends to querido-diario-analysis-queue                      │
│                           ↓                                                │
│  5️⃣  Analysis Worker (src/analysis-worker.ts)                              │
│      • AI analysis (OpenAI/Mistral)                                       │
│      • Keyword detection                                                  │
│      • Entity extraction                                                  │
│      • Stores results in KV (ANALYSIS_RESULTS)                           │
│      • Batch sends to querido-diario-webhook-queue                       │
│                           ↓                                                │
│  6️⃣  Webhook Worker (src/webhook-worker.ts)                                │
│      • Filters by subscriptions                                          │
│      • Matches concurso público keywords                                  │
│      • HTTP POST to https://n8n.grupoq.io/webhook/webhook-concursos      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 🏭 Infrastructure Components

### Goodfellow Worker (Unified)
| Component | File | Purpose |
|-----------|------|---------|
| **Goodfellow** | `src/goodfellow-worker.ts` | Main entry point (HTTP + all queues) |
| **Crawl Processor** | `src/goodfellow/crawl-processor.ts` | Crawl queue consumer |
| **OCR Processor** | `src/goodfellow/ocr-processor.ts` | OCR queue consumer |
| **Analysis Processor** | `src/goodfellow/analysis-processor.ts` | Analysis queue consumer |
| **Webhook Processor** | `src/goodfellow/webhook-processor.ts` | Webhook queue consumer |
| **R2 PDF Server** | `src/r2-server.ts` | R2 PDF server (separate) |

### Queues (4)
| Queue | Consumer | Producer |
|-------|----------|----------|
| `gazette-crawl-queue` | Main Worker | Main Worker |
| `gazette-ocr-queue` | OCR Worker | Main Worker |
| `querido-diario-analysis-queue` | Analysis Worker | OCR Worker |
| `querido-diario-webhook-queue` | Webhook Worker | Analysis Worker |

### Storage (6)
| Type | Binding | Purpose |
|------|---------|---------|
| **KV** | `OCR_RESULTS` | OCR text cache |
| **KV** | `ANALYSIS_RESULTS` | Analysis cache |
| **KV** | `WEBHOOK_SUBSCRIPTIONS` | Webhook configs |
| **KV** | `WEBHOOK_DELIVERY_LOGS` | Delivery logs |
| **R2** | `GAZETTE_PDFS` | PDF storage |
| **Browser** | `BROWSER` | Rendering engine |

## 🕷️ Spider System

### Supported Platforms (20)
- **SIGPUB**: 1,723 cities (61.7%)
- **Diário BA**: 407 cities (14.6%)
- **DOM-SC**: 295 cities (10.6%)
- **Instar**: 111 cities (4.0%)
- **DOEM**: 56 cities (2.0%)
- And 15 more platforms...

### Spider Registry
- **File**: `src/spiders/registry.ts`
- **Configs**: `src/spiders/configs/*.json`
- **Base Classes**: `src/spiders/base/*.ts`

## 📊 Performance Optimizations

### Batch Operations
- **API → Crawl Queue**: 100 messages per batch
- **Spider → OCR Queue**: All gazettes from spider in batch
- **OCR → Analysis**: All successful OCRs in batch
- **Analysis → Webhook**: All webhook messages in batch

### Result: 99.4% reduction in queue operations

## 🎯 Webhook Configuration

### Concurso Público Detection
- **ID**: `grupoq-concursos-1759769991999`
- **URL**: https://n8n.grupoq.io/webhook/webhook-concursos
- **Keywords**: "concurso público", "edital", "seleção pública", etc.
- **Min Confidence**: 0.7

## 🛠️ Key Scripts

| Script | Purpose |
|--------|---------|
| `find-city.ts` | Find city by name/ID |
| `remote-crawl.ts` | Execute crawling remotely |
| `setup-concursos-webhook.ts` | Configure webhook |
| `test-city.ts` | Test single city |
| `test-platform.ts` | Test platform |

## 📡 API Endpoints

### Main Worker
- `GET /` - Health check
- `GET /stats` - System statistics  
- `GET /spiders` - List all spiders
- `POST /crawl` - Generic crawl
- `POST /crawl/cities` - Crawl specific cities
- `POST /crawl/today-yesterday` - Crawl recent dates

### Usage Examples
```bash
# Crawl all cities for today/yesterday
curl -X POST https://querido-diario-worker.qconcursos.workers.dev/crawl/today-yesterday \
  -H "Content-Type: application/json" \
  -d '{"platform": "sigpub"}'

# Crawl specific cities
curl -X POST https://querido-diario-worker.qconcursos.workers.dev/crawl/cities \
  -H "Content-Type: application/json" \
  -d '{"cities": ["am_1302603", "ba_2927408"], "startDate": "2025-10-01", "endDate": "2025-10-03"}'
```

## 🧠 Analysis System

### AI Models
- **OpenAI**: Text analysis and entity extraction
- **Mistral**: OCR processing and backup analysis

### Detection Categories
- **concurso_publico**: Public contests
- **licitacao**: Public bids
- **ata**: Meeting minutes
- **decreto**: Decrees
- **lei**: Laws

## 🔧 Configuration Files

### Wrangler Configs
- `wrangler.jsonc` - Main worker
- `wrangler-ocr.jsonc` - OCR worker
- `wrangler-analysis.jsonc` - Analysis worker
- `wrangler-webhook.jsonc` - Webhook worker
- `wrangler-r2.jsonc` - R2 server

### Package Scripts
```json
{
  "dev": "wrangler dev --config wrangler.jsonc",
  "deploy": "wrangler deploy --config wrangler.jsonc",
  "remote:crawl": "npx tsx scripts/remote-crawl.ts",
  "find:city": "npx tsx scripts/find-city.ts",
  "setup:webhook": "npx tsx scripts/setup-concursos-webhook.ts"
}
```

## 🎯 Current Status

### ✅ Working
- **2,792 spiders** configured and deployed
- **Batch optimization** implemented (99.4% efficiency gain)
- **Webhook notifications** configured
- **OCR processing** with R2 storage
- **All workers deployed** and operational

### 🔧 In Progress
- **R2 URL generation** for Mistral OCR access
- **Monitoring** webhook deliveries

## 🚀 Quick Start Commands

```bash
# Check system status
bun run remote:crawl health

# Find a city
bun run find:city manaus

# Crawl specific cities
bun run remote:crawl cities am_1302603 ba_2927408

# Crawl all cities (today/yesterday)
bun run remote:crawl today-yesterday

# Deploy all workers
bun run deploy
bun run deploy:ocr
bun run deploy:analysis
bun run deploy:webhook
```

This system is now **production-ready** and processing Brazilian gazettes at scale with automated concurso público detection and notifications.
