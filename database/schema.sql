-- Querido Diário Workers - PostgreSQL Schema
-- This file contains the complete database schema for the Supabase PostgreSQL integration

-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create enum types
CREATE TYPE job_type AS ENUM ('scheduled', 'manual', 'cities');
CREATE TYPE job_status AS ENUM ('pending', 'running', 'completed', 'failed');
CREATE TYPE telemetry_step AS ENUM ('crawl_start', 'crawl_end', 'ocr_start', 'ocr_end', 'analysis_start', 'analysis_end', 'webhook_sent');
CREATE TYPE step_status AS ENUM ('started', 'completed', 'failed', 'skipped');
CREATE TYPE ocr_status AS ENUM ('pending', 'processing', 'success', 'failure', 'partial');
CREATE TYPE webhook_status AS ENUM ('pending', 'sent', 'failed', 'retry');

-- 1. CRAWL_JOBS - Track crawling sessions
CREATE TABLE crawl_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_type job_type NOT NULL,
    status job_status NOT NULL DEFAULT 'pending',
    total_cities INTEGER NOT NULL DEFAULT 0,
    completed_cities INTEGER NOT NULL DEFAULT 0,
    failed_cities INTEGER NOT NULL DEFAULT 0,
    start_date DATE,
    end_date DATE,
    platform_filter TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 2. CRAWL_TELEMETRY - Track per-city crawl progress
CREATE TABLE crawl_telemetry (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    crawl_job_id UUID REFERENCES crawl_jobs(id) ON DELETE CASCADE,
    territory_id TEXT NOT NULL,
    spider_id TEXT NOT NULL,
    spider_type TEXT NOT NULL,
    step telemetry_step NOT NULL,
    status step_status NOT NULL,
    gazettes_found INTEGER DEFAULT 0,
    execution_time_ms INTEGER,
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 3. GAZETTE_REGISTRY - Gazette metadata (permanent record)
CREATE TABLE gazette_registry (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id TEXT UNIQUE NOT NULL,
    territory_id TEXT NOT NULL,
    publication_date DATE NOT NULL,
    edition_number TEXT,
    spider_id TEXT NOT NULL,
    pdf_url TEXT NOT NULL,
    pdf_r2_key TEXT,
    is_extra_edition BOOLEAN NOT NULL DEFAULT false,
    power TEXT,
    scraped_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 4. OCR_RESULTS - OCR results with extracted text
CREATE TABLE ocr_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id TEXT UNIQUE NOT NULL,
    gazette_id UUID REFERENCES gazette_registry(id) ON DELETE CASCADE,
    extracted_text TEXT NOT NULL,
    text_length INTEGER NOT NULL DEFAULT 0,
    confidence_score FLOAT,
    language_detected TEXT DEFAULT 'pt',
    processing_method TEXT DEFAULT 'mistral',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 5. OCR_METADATA - OCR job tracking (not the text)
CREATE TABLE ocr_metadata (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id TEXT UNIQUE NOT NULL,
    gazette_id UUID REFERENCES gazette_registry(id) ON DELETE CASCADE,
    status ocr_status NOT NULL DEFAULT 'pending',
    pages_processed INTEGER,
    processing_time_ms INTEGER,
    text_length INTEGER,
    error_code TEXT,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 6. ANALYSIS_RESULTS - Full analysis results
CREATE TABLE analysis_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id TEXT UNIQUE NOT NULL,
    ocr_job_id TEXT NOT NULL,
    gazette_id UUID REFERENCES gazette_registry(id) ON DELETE CASCADE,
    territory_id TEXT NOT NULL,
    publication_date DATE NOT NULL,
    total_findings INTEGER NOT NULL DEFAULT 0,
    high_confidence_findings INTEGER NOT NULL DEFAULT 0,
    categories TEXT[] DEFAULT ARRAY[]::TEXT[],
    keywords TEXT[] DEFAULT ARRAY[]::TEXT[],
    findings JSONB DEFAULT '[]'::jsonb,
    summary JSONB DEFAULT '{}'::jsonb,
    processing_time_ms INTEGER,
    analyzed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 7. WEBHOOK_DELIVERIES - Webhook delivery logs
CREATE TABLE webhook_deliveries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    notification_id TEXT UNIQUE NOT NULL,
    subscription_id TEXT NOT NULL,
    analysis_job_id TEXT,
    event_type TEXT NOT NULL,
    status webhook_status NOT NULL DEFAULT 'pending',
    status_code INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    response_body TEXT,
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMP WITH TIME ZONE,
    next_retry_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 8. CONCURSO_FINDINGS - Dedicated concurso data
CREATE TABLE concurso_findings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    analysis_job_id TEXT NOT NULL,
    gazette_id UUID REFERENCES gazette_registry(id) ON DELETE CASCADE,
    territory_id TEXT NOT NULL,
    document_type TEXT,
    confidence FLOAT CHECK (confidence >= 0 AND confidence <= 1),
    orgao TEXT,
    edital_numero TEXT,
    total_vagas INTEGER DEFAULT 0,
    cargos JSONB DEFAULT '[]'::jsonb,
    datas JSONB DEFAULT '{}'::jsonb,
    taxas JSONB DEFAULT '[]'::jsonb,
    banca JSONB DEFAULT '{}'::jsonb,
    extraction_method TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 9. ERROR_LOGS - Comprehensive error tracking for dashboard
CREATE TABLE error_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    worker_name TEXT NOT NULL,
    operation_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('warning', 'error', 'critical')),
    error_code TEXT,
    error_message TEXT NOT NULL,
    stack_trace TEXT,
    context JSONB DEFAULT '{}'::jsonb,
    job_id TEXT,
    territory_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMP WITH TIME ZONE,
    resolution_notes TEXT
);

-- INDEXES FOR PERFORMANCE

-- Crawl telemetry queries
CREATE INDEX idx_crawl_telemetry_job_territory ON crawl_telemetry(crawl_job_id, territory_id);
CREATE INDEX idx_crawl_telemetry_timestamp ON crawl_telemetry(timestamp);
CREATE INDEX idx_crawl_telemetry_step_status ON crawl_telemetry(step, status);

-- Gazette lookups
CREATE INDEX idx_gazette_territory_date ON gazette_registry(territory_id, publication_date);
CREATE INDEX idx_gazette_spider_date ON gazette_registry(spider_id, publication_date);
CREATE INDEX idx_gazette_job_id ON gazette_registry(job_id);

-- OCR results tracking
CREATE INDEX idx_ocr_results_job_id ON ocr_results(job_id);
CREATE INDEX idx_ocr_results_gazette_id ON ocr_results(gazette_id);
CREATE INDEX idx_ocr_results_text_search ON ocr_results USING GIN(to_tsvector('portuguese', extracted_text));

-- OCR status tracking
CREATE INDEX idx_ocr_status ON ocr_metadata(status, created_at);
CREATE INDEX idx_ocr_gazette ON ocr_metadata(gazette_id);
CREATE INDEX idx_ocr_job_id ON ocr_metadata(job_id);

-- Analysis queries
CREATE INDEX idx_analysis_territory_date ON analysis_results(territory_id, publication_date);
CREATE INDEX idx_analysis_categories ON analysis_results USING GIN(categories);
CREATE INDEX idx_analysis_high_confidence ON analysis_results(high_confidence_findings) WHERE high_confidence_findings > 0;
CREATE INDEX idx_analysis_job_id ON analysis_results(job_id);
CREATE INDEX idx_analysis_ocr_job_id ON analysis_results(ocr_job_id);

-- Webhook tracking
CREATE INDEX idx_webhook_status_retry ON webhook_deliveries(status, next_retry_at) WHERE status IN ('pending', 'retry');
CREATE INDEX idx_webhook_subscription ON webhook_deliveries(subscription_id, created_at);
CREATE INDEX idx_webhook_notification_id ON webhook_deliveries(notification_id);

-- Concurso searches
CREATE INDEX idx_concurso_territory ON concurso_findings(territory_id, created_at);
CREATE INDEX idx_concurso_vagas ON concurso_findings(total_vagas) WHERE total_vagas > 0;
CREATE INDEX idx_concurso_analysis_job ON concurso_findings(analysis_job_id);

-- Error tracking indexes
CREATE INDEX idx_error_logs_severity_time ON error_logs(severity, created_at DESC);
CREATE INDEX idx_error_logs_worker ON error_logs(worker_name, created_at DESC);
CREATE INDEX idx_error_logs_unresolved ON error_logs(created_at DESC) WHERE resolved_at IS NULL;
CREATE INDEX idx_error_logs_context ON error_logs USING GIN(context);

-- Full-text search indexes for better search capabilities
CREATE INDEX idx_gazette_metadata_gin ON gazette_registry USING GIN(metadata);
CREATE INDEX idx_analysis_summary_gin ON analysis_results USING GIN(summary);
CREATE INDEX idx_concurso_cargos_gin ON concurso_findings USING GIN(cargos);

-- Partial indexes for common queries
CREATE INDEX idx_active_crawl_jobs ON crawl_jobs(created_at) WHERE status IN ('pending', 'running');
CREATE INDEX idx_failed_webhooks ON webhook_deliveries(next_retry_at) WHERE status = 'retry';

-- Comments for documentation
COMMENT ON TABLE crawl_jobs IS 'Tracks overall crawling sessions and their progress';
COMMENT ON TABLE crawl_telemetry IS 'Detailed telemetry for each step of the crawling process per city';
COMMENT ON TABLE gazette_registry IS 'Permanent registry of all discovered gazettes';
COMMENT ON TABLE ocr_metadata IS 'Metadata about OCR processing jobs (actual text stored in KV)';
COMMENT ON TABLE analysis_results IS 'Full analysis results with findings and summaries';
COMMENT ON TABLE webhook_deliveries IS 'Log of all webhook delivery attempts and their results';
COMMENT ON TABLE concurso_findings IS 'Extracted concurso público data for specialized queries';
COMMENT ON TABLE error_logs IS 'Comprehensive error tracking for pipeline monitoring and debugging';

-- DASHBOARD VIEWS

-- Pipeline health overview for dashboard
CREATE VIEW pipeline_health AS
SELECT 
    cj.id as job_id,
    cj.status,
    cj.total_cities,
    cj.completed_cities,
    cj.failed_cities,
    COUNT(DISTINCT el.id) as error_count,
    MAX(el.created_at) as last_error_at,
    COUNT(DISTINCT gr.id) as gazettes_found,
    COUNT(DISTINCT ocr.id) as ocr_completed,
    COUNT(DISTINCT ar.id) as analyses_completed
FROM crawl_jobs cj
LEFT JOIN error_logs el ON el.job_id = cj.id::text
LEFT JOIN gazette_registry gr ON gr.job_id LIKE CONCAT(cj.id::text, '%')
LEFT JOIN ocr_results ocr ON ocr.job_id LIKE CONCAT(cj.id::text, '%')
LEFT JOIN analysis_results ar ON ar.job_id LIKE CONCAT(cj.id::text, '%')
GROUP BY cj.id, cj.status, cj.total_cities, cj.completed_cities, cj.failed_cities;
