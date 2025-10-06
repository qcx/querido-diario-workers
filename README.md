# Querido Diário Workers

Serverless crawler for Brazilian official gazettes (diários oficiais) using **Cloudflare Workers** and **Queues**.

This is a TypeScript/Node.js port of the [querido-diario](https://github.com/okfn-brasil/querido-diario) project, redesigned for serverless architecture.

## Features

- ✅ **Serverless**: Runs on Cloudflare Workers (no servers to manage)
- ✅ **Scalable**: Uses Cloudflare Queues for distributed crawling
- ✅ **TypeScript**: Fully typed codebase
- ✅ **1,937 Cities**: 17 platform types implemented (**28.2% national coverage**)
- ✅ **Lightweight**: Extracts gazette metadata and PDF URLs (no file downloads)
- ✅ **Fast**: Average 400-500ms per city crawl
- ✅ **OCR Integration**: Automatic PDF text extraction with Mistral OCR API
- ✅ **Smart Caching**: KV-based deduplication to avoid reprocessing

## 📊 National Coverage

**1,573 of 5,570 Brazilian municipalities (28.24%)**

### Coverage by State

| UF | Total | Covered | Coverage | Progress |
|----|-------|---------|----------|----------|
| **MT** | 141 | 139 | **98.6%** | `███████████████████░` |
| **PE** | 185 | 182 | **98.4%** | `███████████████████░` |
| **RN** | 167 | 160 | **95.8%** | `███████████████████░` |
| **CE** | 184 | 127 | **69.0%** | `█████████████░░░░░░░` |
| **MG** | 853 | 474 | **55.6%** | `███████████░░░░░░░░░` |
| **RS** | 497 | 262 | **52.7%** | `██████████░░░░░░░░░░` |
| **PR** | 399 | 176 | **44.1%** | `████████░░░░░░░░░░░░` |
| **PI** | 224 | 31 | **13.8%** | `██░░░░░░░░░░░░░░░░░░` |
| **PB** | 223 | 22 | **9.9%** | `█░░░░░░░░░░░░░░░░░░░` |
| Other states | 2,897 | 0 | 0.0% | `░░░░░░░░░░░░░░░░░░░░` |

*Last updated: 2025-10-04*

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
│   │   ├── base/                 # 23 spider implementations
│   │   ├── configs/              # 20 platform configs (2,792 cities)
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

### Current

- **DOEM** (Diário Oficial Eletrônico dos Municípios): **56 cities** ✅
  - 52 cities in Bahia (BA)
  - 1 city in Pernambuco (PE)
  - 2 cities in Paraná (PR)
  - 1 city in Sergipe (SE)

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
| **Total** | **1,937** | **28.2%** |

### Planned

- Other platforms: ~158 cities remaining

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

## Acknowledgments

Based on the original [Querido Diário](https://github.com/okfn-brasil/querido-diario) project by [Open Knowledge Brasil](https://ok.org.br/).

## Related Projects

- [querido-diario](https://github.com/okfn-brasil/querido-diario) - Original Python/Scrapy implementation
- [Querido Diário Website](https://queridodiario.ok.org.br/) - Official project website
