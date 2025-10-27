-- Querido Diário Workers - Cloudflare D1 Schema
-- SQLite-compatible schema for D1 database migration from PostgreSQL

-- Note: D1 uses SQLite, so we need to adapt from PostgreSQL

-- 1. CRAWL_JOBS - Track crawling sessions
CREATE TABLE crawl_jobs (
    id TEXT PRIMARY KEY,  -- Will use crypto.randomUUID() in application
    job_type TEXT NOT NULL CHECK (job_type IN ('scheduled', 'manual', 'cities')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    total_cities INTEGER NOT NULL DEFAULT 0,
    completed_cities INTEGER NOT NULL DEFAULT 0,
    failed_cities INTEGER NOT NULL DEFAULT 0,
    start_date TEXT,  -- ISO 8601 date format
    end_date TEXT,    -- ISO 8601 date format
    platform_filter TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT,
    metadata TEXT DEFAULT '{}'  -- JSON string
);

-- 2. CRAWL_TELEMETRY - Track per-city crawl progress
CREATE TABLE crawl_telemetry (
    id TEXT PRIMARY KEY,
    crawl_job_id TEXT NOT NULL,
    territory_id TEXT NOT NULL,
    spider_id TEXT NOT NULL,
    spider_type TEXT NOT NULL,
    step TEXT NOT NULL CHECK (step IN ('crawl_start', 'crawl_end', 'ocr_start', 'ocr_end', 'analysis_start', 'analysis_end', 'webhook_sent')),
    status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed', 'skipped')),
    gazettes_found INTEGER DEFAULT 0,
    execution_time_ms INTEGER,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    metadata TEXT DEFAULT '{}',
    FOREIGN KEY (crawl_job_id) REFERENCES crawl_jobs(id) ON DELETE CASCADE
);

-- 3. GAZETTE_CRAWLS - Track crawl-specific metadata and relationships
CREATE TABLE gazette_crawls(
    id TEXT PRIMARY KEY,
    job_id TEXT UNIQUE NOT NULL,
    territory_id TEXT NOT NULL,
    spider_id TEXT NOT NULL,
    gazette_id TEXT NOT NULL,
    analysis_result_id TEXT,
    status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'processing', 'success', 'failed', 'analysis_pending')),
    scraped_at TEXT NOT NULL,  -- ISO 8601 timestamp
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (gazette_id) REFERENCES gazette_registry(id) ON DELETE CASCADE,
    FOREIGN KEY (analysis_result_id) REFERENCES analysis_results(id) ON DELETE SET NULL
);

-- 4. GAZETTE_REGISTRY - Gazette metadata (permanent record)
CREATE TABLE gazette_registry (
    id TEXT PRIMARY KEY,
    publication_date TEXT NOT NULL,  -- ISO 8601 date format
    edition_number TEXT,
    pdf_url TEXT NOT NULL UNIQUE,
    pdf_r2_key TEXT,
    is_extra_edition INTEGER NOT NULL DEFAULT 0,  -- SQLite boolean (0/1)
    power TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'uploaded', 'ocr_processing', 'ocr_retrying', 'ocr_failure', 'ocr_success')),
    metadata TEXT DEFAULT '{}'
);

-- 5. OCR_RESULTS - OCR results with extracted text // necessário para caso 1 gazette precise ter mais de 1 entrada no banco de dados, por exemplo se o tamanho do texto for muito grande e precise ser salvo em partes.
CREATE TABLE ocr_results (
    id TEXT PRIMARY KEY,
    document_type TEXT NOT NULL DEFAULT 'gazette_registry' CHECK (document_type IN ('gazette_registry')),
    document_id TEXT NOT NULL,
    extracted_text TEXT NOT NULL,
    text_length INTEGER NOT NULL DEFAULT 0,
    confidence_score REAL,
    language_detected TEXT DEFAULT 'pt',
    processing_method TEXT DEFAULT 'mistral',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    metadata TEXT DEFAULT '{}'
);

-- 6. OCR_JOBS - OCR job tracking (not the text)
CREATE TABLE ocr_jobs (
    id TEXT PRIMARY KEY,
    document_type TEXT NOT NULL DEFAULT 'gazette_registry' CHECK (document_type IN ('gazette_registry')),
    document_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'success', 'failure', 'partial')),
    pages_processed INTEGER,
    processing_time_ms INTEGER,
    text_length INTEGER,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    metadata TEXT DEFAULT '{}'
);

-- 7. ANALYSIS_RESULTS - Full analysis results
CREATE TABLE analysis_results (
    id TEXT PRIMARY KEY,
    job_id TEXT UNIQUE NOT NULL,
    gazette_id TEXT NOT NULL,
    territory_id TEXT NOT NULL,
    publication_date TEXT NOT NULL,  -- ISO 8601 date format
    total_findings INTEGER NOT NULL DEFAULT 0,
    high_confidence_findings INTEGER NOT NULL DEFAULT 0,
    categories TEXT DEFAULT '[]',  -- JSON array as string
    keywords TEXT DEFAULT '[]',    -- JSON array as string
    findings TEXT DEFAULT '[]',    -- JSON array as string
    summary TEXT DEFAULT '{}',     -- JSON object as string
    processing_time_ms INTEGER,
    analyzed_at TEXT NOT NULL,     -- ISO 8601 timestamp
    metadata TEXT DEFAULT '{}',
    FOREIGN KEY (gazette_id) REFERENCES gazette_registry(id) ON DELETE CASCADE
);

-- 8. WEBHOOK_DELIVERIES - Webhook delivery logs
CREATE TABLE webhook_deliveries (
    id TEXT PRIMARY KEY,
    notification_id TEXT UNIQUE NOT NULL,
    subscription_id TEXT NOT NULL,
    analysis_job_id TEXT,
    event_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'retry')),
    status_code INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    response_body TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    delivered_at TEXT,
    next_retry_at TEXT,
    metadata TEXT DEFAULT '{}'
);

-- 9. CONCURSO_FINDINGS - Dedicated concurso data
CREATE TABLE concurso_findings (
    id TEXT PRIMARY KEY,
    analysis_job_id TEXT NOT NULL,
    gazette_id TEXT NOT NULL,
    territory_id TEXT NOT NULL,
    document_type TEXT,
    confidence REAL CHECK (confidence >= 0 AND confidence <= 1),
    orgao TEXT,
    edital_numero TEXT,
    total_vagas INTEGER DEFAULT 0,
    cargos TEXT DEFAULT '[]',      -- JSON array as string
    datas TEXT DEFAULT '{}',       -- JSON object as string
    taxas TEXT DEFAULT '[]',       -- JSON array as string
    banca TEXT DEFAULT '{}',       -- JSON object as string
    extraction_method TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (gazette_id) REFERENCES gazette_registry(id) ON DELETE CASCADE
);

-- 10. ERROR_LOGS - Comprehensive error tracking for dashboard
CREATE TABLE error_logs (
    id TEXT PRIMARY KEY,
    worker_name TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('warning', 'error', 'critical')),
    error_code TEXT,
    error_message TEXT NOT NULL,
    stack_trace TEXT,
    context TEXT DEFAULT '{}',  -- JSON object as string
    job_id TEXT,
    territory_id TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    resolution_notes TEXT
);

-- INDEXES FOR PERFORMANCE
-- Note: SQLite doesn't support all PostgreSQL index types, so we use basic indexes

-- Crawl telemetry queries
CREATE INDEX idx_crawl_telemetry_job_territory ON crawl_telemetry(crawl_job_id, territory_id);
CREATE INDEX idx_crawl_telemetry_timestamp ON crawl_telemetry(timestamp);
CREATE INDEX idx_crawl_telemetry_step_status ON crawl_telemetry(step, status);

-- Gazette crawls lookups
CREATE INDEX idx_gazette_crawls_territory_date ON gazette_crawls(territory_id, scraped_at);
CREATE INDEX idx_gazette_crawls_spider ON gazette_crawls(spider_id, scraped_at);
CREATE INDEX idx_gazette_crawls_job_id ON gazette_crawls(job_id);
CREATE INDEX idx_gazette_crawls_gazette_id ON gazette_crawls(gazette_id);
CREATE INDEX idx_gazette_crawls_analysis_result ON gazette_crawls(analysis_result_id);

-- Gazette registry lookups
CREATE INDEX idx_gazette_registry_publication_date ON gazette_registry(publication_date);
CREATE INDEX idx_gazette_registry_pdf_url ON gazette_registry(pdf_url);
CREATE INDEX idx_gazette_registry_status ON gazette_registry(status, created_at);

-- OCR results tracking
CREATE INDEX idx_ocr_results_document ON ocr_results(document_type, document_id);
CREATE INDEX idx_ocr_results_created_at ON ocr_results(created_at);
-- Note: Full-text search removed as per requirements

-- OCR jobs tracking
CREATE INDEX idx_ocr_jobs_status ON ocr_jobs(status, created_at);
CREATE INDEX idx_ocr_jobs_document ON ocr_jobs(document_type, document_id);
CREATE INDEX idx_ocr_jobs_created_at ON ocr_jobs(created_at);

-- Analysis queries
CREATE INDEX idx_analysis_territory_date ON analysis_results(territory_id, publication_date);
CREATE INDEX idx_analysis_high_confidence ON analysis_results(high_confidence_findings);
CREATE INDEX idx_analysis_job_id ON analysis_results(job_id);
CREATE INDEX idx_analysis_gazette_id ON analysis_results(gazette_id);

-- Webhook tracking
CREATE INDEX idx_webhook_status_retry ON webhook_deliveries(status, next_retry_at);
CREATE INDEX idx_webhook_subscription ON webhook_deliveries(subscription_id, created_at);
CREATE INDEX idx_webhook_notification_id ON webhook_deliveries(notification_id);

-- Concurso searches
CREATE INDEX idx_concurso_territory ON concurso_findings(territory_id, created_at);
CREATE INDEX idx_concurso_vagas ON concurso_findings(total_vagas);
CREATE INDEX idx_concurso_analysis_job ON concurso_findings(analysis_job_id);

-- Error tracking indexes
CREATE INDEX idx_error_logs_severity_time ON error_logs(severity, created_at DESC);
CREATE INDEX idx_error_logs_worker ON error_logs(worker_name, created_at DESC);
CREATE INDEX idx_error_logs_unresolved ON error_logs(created_at DESC) WHERE resolved_at IS NULL;

-- Partial indexes for common queries
CREATE INDEX idx_active_crawl_jobs ON crawl_jobs(created_at) WHERE status IN ('pending', 'running');
CREATE INDEX idx_failed_webhooks ON webhook_deliveries(next_retry_at) WHERE status = 'retry';
