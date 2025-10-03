# Querido Diário Workers

Serverless crawler for Brazilian official gazettes (diários oficiais) using **Cloudflare Workers** and **Queues**.

This is a TypeScript/Node.js port of the [querido-diario](https://github.com/okfn-brasil/querido-diario) project, redesigned for serverless architecture.

## Features

- ✅ **Serverless**: Runs on Cloudflare Workers (no servers to manage)
- ✅ **Scalable**: Uses Cloudflare Queues for distributed crawling
- ✅ **TypeScript**: Fully typed codebase
- ✅ **50+ Cities**: Initial support for 50 DOEM platform cities
- ✅ **Lightweight**: Extracts gazette metadata and PDF URLs (no file downloads)

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   Cloudflare Infrastructure                  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  HTTP Request → Dispatcher Worker → Queue → Consumer Worker │
│                                                               │
│  1. POST /crawl with city list                              │
│  2. Enqueue tasks to Cloudflare Queue                       │
│  3. Consumer workers process each city                       │
│  4. Return gazette metadata + PDF URLs                       │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Project Structure

```
querido-diario-workers/
├── src/
│   ├── index.ts                  # Dispatcher worker
│   ├── consumer.ts               # Queue consumer worker
│   ├── types/                    # TypeScript interfaces
│   ├── spiders/
│   │   ├── base/                 # Base spider classes
│   │   │   ├── base-spider.ts
│   │   │   └── doem-spider.ts
│   │   ├── configs/              # Spider configurations
│   │   │   └── doem-cities.json
│   │   └── registry.ts           # Spider factory
│   └── utils/                    # Utilities (HTTP, parsing, dates, logging)
├── wrangler.jsonc                # Dispatcher configuration
├── wrangler.consumer.jsonc       # Consumer configuration
├── package.json
├── tsconfig.json
└── README.md
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

Run the dispatcher worker locally:

```bash
npm run dev
```

Run the consumer worker locally:

```bash
npm run dev:consumer
```

### Deployment

Deploy the dispatcher worker:

```bash
npm run deploy
```

Deploy the consumer worker:

```bash
npm run deploy:consumer
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

- **DOEM** (Diário Oficial Eletrônico dos Municípios): 50 cities

### Planned

- ADiarios V1: ~70 cities
- ADiarios V2: ~12 cities
- Other platforms: ~300+ cities

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
- [x] DOEM spider implementation
- [x] Dispatcher worker
- [x] Consumer worker
- [x] 50 DOEM cities configuration
- [ ] ADiarios V1 spider
- [ ] ADiarios V2 spider
- [ ] Error handling and retry logic
- [ ] Monitoring and alerting
- [ ] Storage integration (D1/KV/R2)
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
