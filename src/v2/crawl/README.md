# Crawl Domain

The **Crawl Domain** is responsible for orchestrating and executing the web crawling operations to collect official gazettes from Brazilian municipalities and states. This domain handles the entire lifecycle of crawl jobs, from request dispatch to gazette extraction.

## 🎯 Domain Responsibilities

### 1. **Crawl Request Management**
- **Dispatch crawl jobs** for specific cities or all municipalities
- **Validate crawl requests** and apply filters (scope, date range)
- **Create and track crawl jobs** in the database
- **Handle batch processing** of crawl tasks

### 2. **Queue Management**
- **Enqueue crawl tasks** to the CRAWL_QUEUE for asynchronous processing
- **Process queue messages** containing crawl instructions
- **Handle retry logic** for failed crawl attempts
- **Batch message processing** for improved performance

### 3. **Spider Orchestration**
- **Manage spider registry** with 30+ different spider types
- **Create spider instances** based on configuration
- **Execute crawling operations** through specialized spiders
- **Handle platform-specific configurations** for different gazette systems

### 4. **Data Extraction**
- **Extract gazette metadata** (date, edition, URL, power type)
- **Validate gazette data** against date ranges and filters
- **Transform raw data** into standardized gazette format
- **Track crawling statistics** (execution time, request count, gazettes found)

## 🏗️ Architecture Overview

```
crawl/
├── index.ts                 # Domain exports
├── request-handler.ts       # HTTP request handling and job dispatch
├── queue-handler.ts         # Queue message processing
├── spiders/                 # Spider implementations
│   ├── base/               # Base spider classes and implementations
│   ├── configs/            # Spider configuration files (JSON)
│   ├── types.ts           # Spider type definitions
│   ├── registry.ts        # Spider registry and factory
│   └── index.ts           # Spider exports
└── services/              # Additional services (currently empty)
```

## 🕷️ Spider System

### Spider Types
The domain supports **30+ spider types** for different gazette platforms:

| Platform | Type | Description |
|----------|------|-------------|
| DOEM | `doem` | Diário Oficial Eletrônico Municipal |
| ADiários | `adiarios_v1`, `adiarios_v2` | ADiários platform versions |
| Instar | `instar` | Instar platform |
| DOSP | `dosp` | Diário Oficial do Estado de São Paulo |
| DIOF | `diof` | Diário Oficial platform |
| SigPub | `sigpub` | SigPub platform |
| Modernização | `modernizacao` | Modernização platform |
| State Gazettes | `rondonia`, `acre`, `espirito_santo` | Centralized state gazettes |
| And 20+ more... | | Various municipal platforms |

### Spider Configuration
Each spider is configured with:
- **Territory ID**: IBGE code for the municipality/state
- **Spider Type**: Platform identifier
- **Gazette Scope**: City-level or state-level
- **Platform Config**: Platform-specific settings (URLs, tokens, etc.)
- **Date Range**: Available crawling period

### Spider Registry
- **Centralized registry** managing all spider configurations
- **Factory pattern** for creating spider instances
- **Configuration loading** from JSON files
- **Type-safe spider creation** based on spider type

## 📋 Core Interfaces

### CrawlQueueMessage
```typescript
interface CrawlQueueMessage {
  spiderId: string;           // Spider identifier
  territoryId: string;        // IBGE territory code
  spiderType: SpiderType;     // Platform type
  gazetteScope?: SpiderScope; // City or state level
  config: SpiderPlatformConfig; // Platform-specific config
  dateRange: DateRange;       // Crawling date range
  retryCount?: number;        // Retry attempts
  metadata?: {
    crawlJobId?: string;      // Associated job ID
    [key: string]: any;
  };
}
```

### Gazette
```typescript
interface Gazette {
  date: string;               // Publication date (ISO)
  editionNumber?: string;     // Edition identifier
  fileUrl: string;           // PDF/document URL
  isExtraEdition: boolean;   // Extra edition flag
  power: 'executive' | 'legislative' | 'executive_legislative';
  territoryId: string;       // IBGE territory code
  scrapedAt: string;         // Extraction timestamp
  sourceText?: string;       // Additional metadata
}
```

## 🔄 Crawl Flow

### 1. **Request Dispatch** (`request-handler.ts`)
```
POST /crawl → Validate Request → Create Crawl Job → Enqueue Tasks → Return Response
```

- Receives crawl requests via HTTP
- Validates cities and date ranges
- Creates crawl job record in database
- Enqueues individual spider tasks
- Returns job status and statistics

### 2. **Queue Processing** (`queue-handler.ts`)
```
Queue Message → Create Spider → Execute Crawl → Extract Gazettes → Track Progress
```

- Processes messages from CRAWL_QUEUE
- Creates appropriate spider instance
- Executes crawling operation
- Calls gazette callback for each found gazette
- Updates job progress in database

### 3. **Spider Execution** (`spiders/`)
```
Spider.crawl() → Fetch Pages → Parse Content → Extract Gazettes → Return Results
```

- Platform-specific crawling logic
- HTML parsing and data extraction
- Date filtering and validation
- Error handling and retry logic

## 🎛️ Configuration

### Request Parameters
- **cities**: Array of city IDs or "all" for all municipalities
- **startDate/endDate**: Date range (defaults to last 30 days)
- **scopeFilter**: Filter by "city" or "state" scope

### Environment Dependencies
- **CRAWL_QUEUE**: Cloudflare Queue for task processing
- **Database**: D1 database for job tracking
- **BROWSER**: Browser service for JavaScript-heavy sites

## 📊 Monitoring & Tracking

### Job Tracking
- **Crawl job creation** with metadata
- **Progress tracking** per spider execution
- **Statistics collection** (gazettes found, execution time)
- **Error tracking** and failure handling

### Logging
- **Structured logging** with spider context
- **Request/response tracking**
- **Performance metrics**
- **Error reporting**

## 🔧 Usage Examples

### Dispatch Crawl for Specific Cities
```typescript
const response = await fetch('/crawl', {
  method: 'POST',
  body: JSON.stringify({
    cities: ['ba_salvador', 'sp_sao_paulo'],
    startDate: '2024-01-01',
    endDate: '2024-01-31',
    scopeFilter: 'city'
  })
});
```

### Process Queue Message
```typescript
const handler = new CrawlQueueHandler(env);
await handler.handle(message, async (gazette, crawlJobId) => {
  // Process found gazette
  await processGazette(gazette, crawlJobId);
});
```

## 🚀 Extension Points

### Adding New Spider Types
1. Create spider class extending `BaseSpider`
2. Add configuration interface
3. Register in `SpiderRegistry`
4. Add city configurations in JSON files

### Custom Processing
- Implement gazette callback for custom processing
- Add middleware for request/response handling
- Extend spider base classes for common functionality

## 🔗 Dependencies

- **Database Layer**: `../db/` for job tracking
- **Utils**: Date handling, HTTP client, HTML parsing
- **Logger**: Structured logging system
- **Queue System**: Cloudflare Queues for task processing

---

This domain serves as the core crawling engine for the Querido Diário project, enabling automated collection of official gazettes from hundreds of Brazilian municipalities through a unified, extensible spider system.
