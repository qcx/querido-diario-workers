# 🚀 Goodfellow Quick Start

## What is Goodfellow?

Goodfellow is the unified worker that replaced our previous 4-worker architecture. It maintains the same queue-based processing but in a single codebase for easier development and deployment.

## Local Development

### Start the Worker
\`\`\`bash
bun run dev
\`\`\`

### Test Complete Pipeline
\`\`\`bash
# Test with mock data (fast)
bun run test:local -- --city am_1300144

# Test with real OCR
bun run test:local -- --city am_1300144 --enable-ocr

# Test with real webhook
bun run test:local -- --city am_1300144 --real-webhook
\`\`\`

### Test Single City
\`\`\`bash
bun run test:city am_1300144
\`\`\`

## Deployment

### To Staging
\`\`\`bash
# Set secrets
wrangler secret put MISTRAL_API_KEY --config wrangler-goodfellow.jsonc --env staging
wrangler secret put OPENAI_API_KEY --config wrangler-goodfellow.jsonc --env staging
wrangler secret put DATABASE_URL --config wrangler-goodfellow.jsonc --env staging

# Deploy
bun run deploy:staging
\`\`\`

### To Production
\`\`\`bash
# Set secrets
wrangler secret put MISTRAL_API_KEY --config wrangler-goodfellow.jsonc --env production
wrangler secret put OPENAI_API_KEY --config wrangler-goodfellow.jsonc --env production
wrangler secret put DATABASE_URL --config wrangler-goodfellow.jsonc --env production

# Deploy
bun run deploy
\`\`\`

## API Usage

### Crawl Specific Cities
\`\`\`bash
curl -X POST https://goodfellow-prod.qconcursos.workers.dev/crawl/cities \\
  -H "Content-Type: application/json" \\
  -d '{
    "cities": ["am_1300144", "ba_2927408"],
    "startDate": "2025-10-01",
    "endDate": "2025-10-03"
  }'
\`\`\`

### Crawl Today & Yesterday
\`\`\`bash
curl -X POST https://goodfellow-prod.qconcursos.workers.dev/crawl/today-yesterday \\
  -H "Content-Type: application/json" \\
  -d '{"platform": "sigpub"}'
\`\`\`

### Health Check
\`\`\`bash
curl https://goodfellow-prod.qconcursos.workers.dev/health/queue
\`\`\`

## Key Differences from Old Architecture

| Aspect | Old (Multi-Worker) | New (Goodfellow) |
|--------|-------------------|------------------|
| **Deployment** | 4 separate workers | 1 unified worker |
| **Local Testing** | Difficult (no queues) | Easy (all in one) |
| **Debugging** | Across multiple workers | Single codebase |
| **Queue Pattern** | ✅ Each does ONE job | ✅ Each does ONE job |
| **Reliability** | ✅ Queue retries | ✅ Queue retries |

## Documentation

- [GOODFELLOW_MIGRATION_GUIDE.md](GOODFELLOW_MIGRATION_GUIDE.md) - Migration details
- [ARCHITECTURE.md](ARCHITECTURE.md) - Complete system architecture
- [README.md](README.md) - Project overview

## Need Help?

1. Check the logs in Cloudflare dashboard
2. Review queue depths and DLQs
3. Test locally first with \`bun run dev\`
