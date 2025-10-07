# Goodfellow

Unified gazette processing pipeline for Brazilian official gazettes using **Cloudflare Workers** and **Queues**.

## Features

- ✅ **Unified Architecture**: Single worker handles all pipeline stages
- ✅ **Queue-Based Processing**: Each execution does ONE job and dies
- ✅ **Serverless**: Runs on Cloudflare Workers (no servers to manage)
- ✅ **Scalable**: Uses Cloudflare Queues for distributed processing
- ✅ **TypeScript**: Fully typed codebase
- ✅ **3,107 Cities**: 3,341 total configs with fallback system (**55.8% national coverage**)
- ✅ **OCR Integration**: Automatic PDF text extraction with Mistral OCR API
- ✅ **AI Analysis**: OpenAI-powered content analysis and categorization
- ✅ **Webhook Notifications**: Real-time alerts for relevant content
- ✅ **Smart Caching**: KV-based deduplication to avoid reprocessing
- ✅ **Fast**: Average 400-500ms per city crawl

## 📊 National Coverage

**3,107 of 5,570 Brazilian municipalities (55.8%)**

**🔄 Fallback System**: 3,341 total configurations providing 234 fallbacks for improved reliability.

### Coverage by State

| UF | Estado | Total | Únicos | Configs | Cobertura | Fallbacks | Progresso |
|----|--------|-------|---------|---------|-----------|-----------|-------|
| **MT** | Mato Grosso | 141 | 142 | 143 | **100.7%** | +1 | `████████████████████` |
| **AC** | Acre | 22 | 22 | 22 | **100.0%** | +0 | `████████████████████` |
| **AM** | Amazonas | 62 | 62 | 62 | **100.0%** | +0 | `████████████████████` |
| **SC** | Santa Catarina | 295 | 295 | 295 | **100.0%** | +0 | `████████████████████` |
| **PE** | Pernambuco | 185 | 182 | 185 | **98.4%** | +3 | `████████████████████` |
| **BA** | Bahia | 417 | 407 | 478 | **97.6%** | +71 | `████████████████████` |
| **RN** | Rio Grande do Norte | 167 | 161 | 164 | **96.4%** | +3 | `███████████████████░` |
| **CE** | Ceará | 184 | 131 | 139 | **71.2%** | +8 | `██████████████░░░░░░` |
| **SP** | São Paulo | 645 | 456 | 589 | **70.7%** | +133 | `██████████████░░░░░░` |
| **MG** | Minas Gerais | 853 | 486 | 492 | **57.0%** | +6 | `███████████░░░░░░░░░` |
| **RS** | Rio Grande do Sul | 497 | 278 | 281 | **55.9%** | +3 | `███████████░░░░░░░░░` |
| **PR** | Paraná | 399 | 197 | 199 | **49.4%** | +2 | `██████████░░░░░░░░░░` |

*Last updated: 2025-10-07*

## Architecture

### Goodfellow Unified Worker

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            GOODFELLOW                                    │
│                       (Unified Worker Pipeline)                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  HTTP Request                                                            │
│       ↓                                                                  │
│  [Goodfellow HTTP Handler]                                              │
│       ↓                                                                  │
│  gazette-crawl-queue → [Goodfellow Crawl Processor] → Dies             │
│                                      ↓                                   │
│                        gazette-ocr-queue → [Goodfellow OCR Processor]   │
│                                                ↓        → Dies           │
│                        querido-diario-analysis-queue                    │
│                                      ↓                                   │
│                        [Goodfellow Analysis Processor] → Dies           │
│                                      ↓                                   │
│                        querido-diario-webhook-queue                     │
│                                      ↓                                   │
│                        [Goodfellow Webhook Processor] → Dies            │
│                                      ↓                                   │
│                              Webhook Delivered                           │
│                                                                          │
│  Key: Each processor execution does ONE job then dies                   │
│       Queue-based architecture preserved for reliability                │
│       Single codebase for easier development and testing                │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Why Goodfellow?

**Before** (Multi-Worker):
- 4 separate worker deployments
- Complex local testing (queues don't work locally)
- Difficult to debug across workers
- More deployment overhead

**After** (Goodfellow):
- 1 unified worker deployment
- Easy local testing (all in one codebase)
- Simple debugging (complete pipeline in one place)
- Same reliability (queue architecture preserved)

## Project Structure

```
goodfellow/
├── src/
│   ├── goodfellow-worker.ts       # Unified worker entry point
│   ├── goodfellow/                # Queue processors
│   │   ├── crawl-processor.ts     # Crawl queue consumer
│   │   ├── ocr-processor.ts       # OCR queue consumer
│   │   ├── analysis-processor.ts  # Analysis queue consumer
│   │   └── webhook-processor.ts   # Webhook queue consumer
│   ├── types/                     # TypeScript interfaces
│   ├── services/                  # Core services
│   │   ├── mistral-ocr.ts         # Mistral OCR integration
│   │   ├── analysis-orchestrator.ts  # AI analysis
│   │   ├── webhook-sender.ts      # Webhook notifications
│   │   └── database/              # PostgreSQL integration
│   ├── spiders/                   # Spider system
│   │   ├── base/                  # 25 spider implementations
│   │   ├── configs/               # 22 platform configs (3,341 cities)
│   │   └── registry.ts            # Spider factory
│   ├── analyzers/                 # AI analysis modules
│   ├── testing/                   # Automated testing system
│   └── utils/                     # Utilities
├── scripts/                       # Management scripts
│   ├── remote-crawl.ts            # Remote execution
│   ├── find-city.ts               # City lookup
│   ├── deploy-goodfellow.ts       # Deployment script
│   ├── disable-old-workers.ts     # Migration helper
│   └── test-local-pipeline.ts     # Local testing
├── wrangler-goodfellow.jsonc      # Unified configuration
├── ARCHITECTURE.md                # Complete system architecture
├── GOODFELLOW_MIGRATION_GUIDE.md  # Migration documentation
└── SINGLE_VS_MULTI_WORKER_ANALYSIS.md  # Architecture comparison
```

## Getting Started

### Prerequisites

- Node.js 18+
- Bun or npm
- Cloudflare account (for deployment)
- Mistral API key (for OCR)
- OpenAI API key (for AI analysis)

### Installation

```bash
bun install
```

### Development

Run Goodfellow locally:

```bash
bun run goodfellow:dev
```

### Deployment

#### Deploy to Staging

```bash
# Set up secrets
wrangler secret put MISTRAL_API_KEY --config wrangler-goodfellow.jsonc --env staging
wrangler secret put OPENAI_API_KEY --config wrangler-goodfellow.jsonc --env staging
wrangler secret put DATABASE_URL --config wrangler-goodfellow.jsonc --env staging

# Deploy
bun run goodfellow:deploy:staging
```

#### Deploy to Production

```bash
# Set up secrets
wrangler secret put MISTRAL_API_KEY --config wrangler-goodfellow.jsonc --env production
wrangler secret put OPENAI_API_KEY --config wrangler-goodfellow.jsonc --env production
wrangler secret put DATABASE_URL --config wrangler-goodfellow.jsonc --env production

# Deploy
bun run goodfellow:deploy:production
```

## API Usage

### Start a Crawl

**POST** `/crawl/cities`

```json
{
  "cities": ["am_1300144", "ba_2927408"],
  "startDate": "2025-10-01",
  "endDate": "2025-10-03"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Crawl initiated for specified cities",
  "crawlJobId": "crawl_abc123",
  "tasksEnqueued": 2,
  "cities": [
    {"id": "am_1300144", "name": "Apuí - AM"},
    {"id": "ba_2927408", "name": "Salvador - BA"}
  ],
  "dateRange": {
    "start": "2025-10-01",
    "end": "2025-10-03"
  }
}
```

### Crawl Today & Yesterday

**POST** `/crawl/today-yesterday`

```json
{
  "platform": "sigpub"
}
```

### List Available Spiders

**GET** `/spiders`

**GET** `/spiders?type=sigpub`

### Health Check

**GET** `/health/queue`

```json
{
  "status": "healthy",
  "timestamp": "2025-10-07T12:00:00.000Z",
  "queues": {
    "crawl": {"configured": true},
    "ocr": {"configured": true},
    "analysis": {"configured": true},
    "webhook": {"configured": true}
  },
  "config": {
    "totalCitiesConfigured": 3341,
    "batchSize": 100,
    "expectedBatches": 34
  }
}
```

## Supported Platforms

| Platform | Cities | Status |
|----------|--------|--------|
| **SIG Pub** | 1,723 | ✅ |
| **Diário BA** | 407 | ✅ |
| **DOM-SC** | 295 | ✅ |
| **Instar** | 111 | ✅ |
| **DOEM** | 56 | ✅ |
| **DOSP** | 42 | ✅ |
| **ADiarios V1** | 34 | ✅ |
| **MunicipioOnline** | 26 | ✅ |
| **Atende V2** | 22 | ✅ |
| **Acre** | 22 | ✅ |
| **DIOF** | 20 | ✅ |
| **Others** | ~100 | ✅ |
| **Total** | **3,341** | **55.8%** |

See [ARCHITECTURE.md](ARCHITECTURE.md) for complete platform details.

## Pipeline Stages

### 1. Crawl
- Spiders scrape gazette websites
- Extracts metadata and PDF URLs
- Sends to OCR queue

### 2. OCR
- Downloads PDFs from source
- Uploads to R2 storage (optional)
- Processes with Mistral OCR API
- Stores text in KV and database
- Sends to analysis queue

### 3. Analysis
- Keyword detection
- Entity extraction
- AI-powered categorization
- Concurso público detection
- Stores results in database
- Sends relevant findings to webhook queue

### 4. Webhook
- Filters by subscriptions
- Matches keywords/categories
- Delivers notifications to endpoints
- Tracks delivery status

## Local Testing

### Test Complete Pipeline

```bash
# Test with mock data (no API calls)
bun run test:local -- --city am_1300144

# Test with real OCR
bun run test:local -- --city am_1300144 --enable-ocr

# Test with real webhooks
bun run test:local -- --city am_1300144 --real-webhook
```

### Test Single City

```bash
bun run test:city am_1300144
```

### Find Cities

```bash
bun run find:city manaus
```

## Migration from Multi-Worker

If migrating from the previous 4-worker architecture, see [GOODFELLOW_MIGRATION_GUIDE.md](GOODFELLOW_MIGRATION_GUIDE.md) for complete instructions.

Quick overview:
1. Deploy Goodfellow alongside existing workers
2. Monitor for 24-48 hours
3. Gradually disable old worker queue consumers
4. Route HTTP traffic to Goodfellow
5. Delete old workers after verification
6. Clean up codebase

## Monitoring

### Key Metrics

- **Queue Depths**: Monitor in Cloudflare dashboard
- **Worker Invocations**: Check analytics for execution patterns
- **Error Rates**: Track in observability logs
- **Database Metrics**: Monitor gazette/OCR/analysis record creation
- **Webhook Deliveries**: Track success rates

### Cloudflare Dashboard

1. Navigate to Workers & Pages → goodfellow
2. Check Metrics tab for invocations and errors
3. Check Logs tab for detailed execution logs
4. Navigate to Queues to monitor queue depths

## Cost Estimation

- **Cloudflare Workers**: Free tier covers most usage (100k requests/day)
- **Cloudflare Queues**: $0.40 per million messages
- **Cloudflare KV**: $0.50 per million reads, $5 per million writes
- **Cloudflare R2**: $0.015 per GB stored
- **Mistral OCR**: ~$0.01 per page
- **OpenAI API**: ~$0.0001 per token

**Example monthly cost** (processing 1,000 gazettes/day):
- Cloudflare: ~$10-20/month
- Mistral OCR: ~$300-600/month (3-5 pages per gazette)
- OpenAI: ~$50-100/month
- **Total**: ~$360-720/month

## Development Roadmap

- [x] Core infrastructure and 20+ spider platforms ✅
- [x] Unified worker architecture ✅
- [x] OCR processing with Mistral ✅
- [x] AI analysis with OpenAI ✅
- [x] Webhook notifications ✅
- [x] Database integration (PostgreSQL) ✅
- [x] **Goodfellow unified worker** ✅ **NEW**
- [ ] Enhanced monitoring and alerting
- [ ] Admin dashboard
- [ ] Expand coverage to remaining municipalities
- [ ] Performance optimizations

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

MIT License

---

**Goodfellow** - Named for its mission to be a good fellow to Brazilian municipalities, helping make official gazette data more accessible and useful.