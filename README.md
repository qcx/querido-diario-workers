# Querido Diário Workers

Serverless crawler for Brazilian official gazettes (diários oficiais) using **Cloudflare Workers** and **Queues**.

## Features

- ✅ **Serverless**: Runs on Cloudflare Workers (no servers to manage)
- ✅ **Scalable**: Uses Cloudflare Queues for distributed crawling
- ✅ **TypeScript**: Fully typed codebase
- ✅ **3,146 Cities**: 3,377 total configs with fallback system (**56.5% national coverage**)
- ✅ **Lightweight**: Extracts gazette metadata and PDF URLs (no file downloads)
- ✅ **Fast**: Average 400-500ms per city crawl
- ✅ **OCR Integration**: Automatic PDF text extraction with Mistral OCR API
- ✅ **Smart Caching**: KV-based deduplication to avoid reprocessing

## 📊 National Coverage

**3,146 of 5,570 Brazilian municipalities (56.5%)**

**🔄 Fallback System**: 3,377 total configurations providing 231 fallbacks for improved reliability.

### Coverage by State

| UF | Estado | Total | Únicos | Configs | Cobertura | Fallbacks | Progresso |
|----|--------|-------|---------|---------|-----------|-----------|-----------|
| **MT** | Mato Grosso | 141 | 142 | 143 | **100.7%** | +1 | `████████████████████` |
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
| **SE** | Sergipe | 75 | 28 | 28 | **37.3%** | +0 | `███████░░░░░░░░░░░░░` |
| **GO** | Goiás | 246 | 88 | 88 | **35.8%** | +0 | `███████░░░░░░░░░░░░░` |
| **RJ** | Rio de Janeiro | 92 | 20 | 20 | **21.7%** | +0 | `████░░░░░░░░░░░░░░░░` |
| **PI** | Piauí | 224 | 31 | 31 | **13.8%** | +0 | `███░░░░░░░░░░░░░░░░░` |
| **PB** | Paraíba | 223 | 30 | 31 | **13.5%** | +1 | `███░░░░░░░░░░░░░░░░░` |
| **TO** | Tocantins | 139 | 18 | 18 | **12.9%** | +0 | `███░░░░░░░░░░░░░░░░░` |
| **MA** | Maranhão | 217 | 23 | 23 | **10.6%** | +0 | `██░░░░░░░░░░░░░░░░░░` |
| **MS** | Mato Grosso do Sul | 79 | 8 | 8 | **10.1%** | +0 | `██░░░░░░░░░░░░░░░░░░` |
| **AP** | Amapá | 16 | 1 | 1 | **6.3%** | +0 | `█░░░░░░░░░░░░░░░░░░░` |
| **AL** | Alagoas | 102 | 1 | 1 | **1.0%** | +0 | `░░░░░░░░░░░░░░░░░░░░` |
| **PA** | Pará | 144 | 1 | 1 | **0.7%** | +0 | `░░░░░░░░░░░░░░░░░░░░` |
| **AC** | Acre | 22 | 22 | 22 | **100.0%** | +0 | `████████████████████` |
| **DF** | Distrito Federal | 1 | 0 | 0 | **0.0%** | +0 | `░░░░░░░░░░░░░░░░░░░░` |
| **ES** | Espírito Santo | 78 | 78 | 78 | **100.0%** | +0 | `████████████████████` |
| **RO** | Rondônia | 52 | 0 | 0 | **0.0%** | +0 | `░░░░░░░░░░░░░░░░░░░░` |
| **RR** | Roraima | 15 | 0 | 0 | **0.0%** | +0 | `░░░░░░░░░░░░░░░░░░░░` |

*Sistema de fallback implementado: múltiplas configurações por território garantem maior confiabilidade.*

*Last updated: 2025-10-06 (New: Acre and Espírito Santo - 100% coverage)*

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                      Cloudflare Infrastructure                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  HTTP Request → Dispatcher Worker → Crawl Queue → Consumer Worker    │
│                                          ↓                             │
│                                    Gazettes Found                     │
│                                          ↓                             │
│                                     OCR Queue → OCR Worker            │
│                                                    ↓                   │
│                                              Mistral OCR API          │
│                                                    ↓                   │
│                                              Extracted Text           │
│                                                    ↓                   │
│                                              KV Storage (optional)    │
│                                                                        │
│  1. POST /crawl with city list                                       │
│  2. Enqueue tasks to Cloudflare Queue                                │
│  3. Consumer workers process each city                                │
│  4. Return gazette metadata + PDF URLs                                │
│  5. Automatically send PDFs to OCR queue                              │
│  6. OCR worker processes PDFs with Mistral                            │
│  7. Store extracted text in KV                                        │
│                                                                        │
└──────────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
querido-diario-workers/
├── src/
│   ├── worker.ts                 # Main worker (dispatcher + consumer)
│   ├── ocr-worker.ts             # OCR processing worker
│   ├── analysis-worker.ts        # AI analysis worker
│   ├── webhook-worker.ts         # Notification worker
│   ├── r2-server.ts              # R2 PDF server
│   ├── types/                    # TypeScript interfaces
│   ├── services/                 # Core services
│   │   ├── mistral-ocr.ts        # Mistral OCR integration
│   │   ├── analysis-orchestrator.ts  # AI analysis
│   │   └── webhook-sender.ts     # Webhook notifications
│   ├── spiders/                  # Spider system
│   │   ├── base/                 # 25 spider implementations
│   │   ├── configs/              # 22 platform configs (3,146 cities)
│   │   └── registry.ts           # Spider factory
│   ├── analyzers/                # AI analysis modules
│   ├── testing/                  # Automated testing system
│   └── utils/                    # Utilities
├── scripts/                      # Management scripts
│   ├── remote-crawl.ts           # Remote execution
│   ├── find-city.ts              # City lookup
│   ├── setup-concursos-webhook.ts # Webhook setup
│   ├── test-city.ts              # Single city testing
│   └── test-platform.ts          # Platform testing
├── wrangler*.jsonc               # Worker configurations (5)
├── ARCHITECTURE.md               # Complete system architecture
├── FLOW_REVIEW.md                # This document
└── CITY_ID_STANDARDIZATION_PLAN.md # City naming standards
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm
- Cloudflare account (for deployment)

### Installation

```bash
npm install
```

### Development

Run the unified worker locally:

```bash
npm run dev
```

### Deployment

Deploy the unified worker:

```bash
npm run deploy
```

## API Usage

### Start a Crawl

**POST** `/crawl`

```json
{
  "cities": ["ba_acajutiba", "ba_alagoinhas"],
  "startDate": "2024-01-01",
  "endDate": "2024-12-31"
}
```

**Response:**

```json
{
  "success": true,
  "tasksEnqueued": 2,
  "cities": ["ba_acajutiba", "ba_alagoinhas"]
}
```

### List Available Spiders

**GET** `/spiders`

```json
{
  "total": 50,
  "spiders": [
    {
      "id": "ba_acajutiba",
      "name": "Acajutiba - BA",
      "territoryId": "2900306",
      "type": "doem",
      "startDate": "2013-01-30"
    }
  ]
}
```

### Filter by Type

**GET** `/spiders?type=doem`

## Supported Platforms

| Platform | Cities | Status |
|----------|--------|--------|
| **SIGPub** | 1,573 | ✅ |
| **Instar** | 111 | ✅ |
| **DOEM** | 56 | ✅ |
| **DOSP** | 42 | ✅ |
| **ADiarios V1** | 34 | ✅ |
| **MunicipioOnline** | 26 | ✅ |
| **AtendeV2** | 22 | ✅ |
| **DIOF** | 20 | ✅ |
| **DiarioOficialBR** | 10 | ✅ |
| **Siganet** | 10 | ✅ |
| **Modernizacao** | 7 | ✅ |
| **BarcoDigital** | 7 | ✅ |
| **ADiarios V2** | 5 | ⚠️ Stub |
| **Aplus** | 4 | ✅ |
| **Dioenet** | 4 | ✅ |
| **AdministracaoPublica** | 3 | ✅ |
| **PTIO** | 3 | ✅ |
| **Acre** | 22 | ✅ |
| **Espírito Santo** | 78 | ✅ |
| **Total** | **2,037** | **36.6%** |

### Platform Architecture Models

- **🔌 API-First** (Espírito Santo): JSON API with structured metadata
- **🔍 Keyword Search** (Acre): Centralized HTML with search functionality  
- **📄 Individual Sites** (Most platforms): Per-municipality websites
- **🔄 Fallback System**: Multiple configs per territory for reliability

### Remaining Work

- Other platforms: ~58 cities remaining
- Rondônia state gazette integration
- Advanced fallback mechanisms

## OCR System

### Overview

The OCR system automatically processes PDF documents from gazettes using **Mistral OCR API** (`mistral-ocr-latest`). When gazettes are found by spiders, their PDF URLs are automatically sent to an OCR queue for text extraction.

### Features

- ✅ **Automatic Processing**: PDFs are sent to OCR queue automatically after crawling
- ✅ **Smart Caching**: Checks KV storage before processing to avoid duplicates
- ✅ **Mistral OCR**: Uses state-of-the-art `mistral-ocr-latest` model
- ✅ **Markdown Output**: Extracted text in clean markdown format
- ✅ **Batch Processing**: Processes up to 5 PDFs simultaneously
- ✅ **Error Handling**: Automatic retries and Dead Letter Queue for failures
- ✅ **Metadata Preservation**: Maintains all gazette metadata with extracted text

### Configuration

See [OCR_SYSTEM_DOCUMENTATION.md](OCR_SYSTEM_DOCUMENTATION.md) and [QUICK_START_OCR.md](QUICK_START_OCR.md) for detailed setup instructions.

**Quick setup:**

```bash
# 1. Configure Mistral API key
wrangler secret put MISTRAL_API_KEY --config wrangler-ocr.jsonc

# 2. Deploy OCR worker
npm run deploy:ocr

# 3. (Optional) Create KV namespace for caching
wrangler kv:namespace create "OCR_RESULTS"
```

### Performance

- **Processing Time**: ~700ms for simple PDFs, 2-5s per page for complex documents
- **Throughput**: 300-600 gazettes per hour
- **Limits**: 50MB max file size, 1000 pages max per document

### Cost Estimation

- **Cloudflare**: Free tier covers most usage (100k requests/day)
- **Mistral OCR**: ~$0.01 per page
- **Example**: 1,000 gazettes/day ≈ $10-20/day

## Output Format

Each crawl returns gazette metadata:

```json
{
  "spiderId": "ba_acajutiba",
  "territoryId": "2900306",
  "gazettes": [
    {
      "date": "2024-01-15",
      "editionNumber": "1234",
      "fileUrl": "https://doem.org.br/ba/acajutiba/diarios/...",
      "isExtraEdition": false,
      "power": "executive_legislative",
      "territoryId": "2900306",
      "scrapedAt": "2024-10-03T16:30:00.000Z"
    }
  ],
  "stats": {
    "totalFound": 1,
    "dateRange": {
      "start": "2024-01-01",
      "end": "2024-12-31"
    },
    "requestCount": 12,
    "executionTimeMs": 3450
  }
}
```

## Development Roadmap

- [x] Core infrastructure (types, utils, base classes)
- [x] DOEM spider implementation (56 cities) ✅
- [x] Unified worker (dispatcher + consumer)
- [x] Instar spider (111 cities) ✅
- [x] DOSP spider (42 cities) ✅
- [x] ADiarios V1 spider (34 cities) ✅
- [x] DIOF spider (20 cities) ✅
- [x] BarcoDigital spider (7 cities) ✅
- [x] Siganet spider (10 cities) ✅
- [x] DiarioOficialBR spider (10 cities) ✅
- [x] Modernizacao spider (7 cities) ✅
- [x] Aplus spider (4 cities) ✅
- [x] Dioenet spider (4 cities) ✅
- [x] AdministracaoPublica spider (3 cities) ✅
- [x] PTIO spider (3 cities) ✅
- [x] Acre spider (22 cities) ✅ **NEW**
- [x] Espírito Santo spider (78 cities) ✅ **NEW**
- [ ] ADiarios V2 spider (5 cities) - requires browser automation
- [ ] Remaining platforms (~158 cities)
- [ ] Storage integration (D1/KV/R2)
- [ ] Monitoring and alerting
- [ ] PDF download worker (optional)

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

MIT License
