# Deployment Guide - Querido Diário Workers

Este guia explica como fazer o deployment dos workers e configurar as filas no Cloudflare.

## Pré-requisitos

1. **Conta Cloudflare** com Workers habilitado
2. **Wrangler CLI** instalado e autenticado
3. **Node.js 18+** e npm

## Autenticação

```bash
# Login no Cloudflare
wrangler login

# Verificar autenticação
wrangler whoami
```

## Setup Inicial

### 1. Criar as Filas (Queues)

```bash
# Criar fila principal
npm run queue:create

# Criar fila de dead letter (DLQ)
npm run queue:create:dlq
```

Ou manualmente:

```bash
wrangler queues create gazette-crawl-queue
wrangler queues create gazette-crawl-dlq
```

### 2. Verificar Filas Criadas

```bash
wrangler queues list
```

## Deployment

### Opção 1: Deploy Tudo de Uma Vez

```bash
npm run deploy:all
```

### Opção 2: Deploy Individual

```bash
# Deploy dispatcher worker
npm run deploy

# Deploy consumer worker
npm run deploy:consumer
```

### Opção 3: Deploy Manual

```bash
# Dispatcher
wrangler deploy --config wrangler.jsonc

# Consumer
wrangler deploy --config wrangler.consumer.jsonc
```

## Ambientes

### Development

```bash
# Dispatcher
wrangler deploy --config wrangler.jsonc --env development

# Consumer
wrangler deploy --config wrangler.consumer.jsonc --env development
```

### Production

```bash
# Dispatcher
wrangler deploy --config wrangler.jsonc --env production

# Consumer
wrangler deploy --config wrangler.consumer.jsonc --env production
```

## Verificação

### 1. Verificar Workers Deployados

```bash
wrangler deployments list
```

### 2. Testar Dispatcher

```bash
# Obter URL do worker
wrangler deployments list

# Testar health check
curl https://querido-diario-dispatcher.YOUR-SUBDOMAIN.workers.dev/

# Listar spiders disponíveis
curl https://querido-diario-dispatcher.YOUR-SUBDOMAIN.workers.dev/spiders

# Iniciar crawl
curl -X POST https://querido-diario-dispatcher.YOUR-SUBDOMAIN.workers.dev/crawl \
  -H "Content-Type: application/json" \
  -d '{
    "cities": ["ba_acajutiba"],
    "startDate": "2024-09-01",
    "endDate": "2024-09-30"
  }'
```

### 3. Monitorar Logs

```bash
# Logs do dispatcher
wrangler tail --config wrangler.jsonc

# Logs do consumer
wrangler tail --config wrangler.consumer.jsonc
```

### 4. Verificar Fila

```bash
# Ver estatísticas da fila
wrangler queues list

# Consumir mensagens manualmente (debug)
wrangler queues consumer add gazette-crawl-queue querido-diario-consumer
```

## Configurações Avançadas

### Limites e Recursos

**Dispatcher Worker:**
- Timeout: 30s (padrão)
- Memória: 128MB (padrão)
- CPU: 10ms (padrão)

**Consumer Worker:**
- Timeout: 30s (pode precisar aumentar para Unbound)
- Memória: 128MB
- CPU: 50ms (pode precisar aumentar)

### Aumentar Timeout (Unbound Workers)

Para crawls mais longos, você pode usar Unbound Workers:

```jsonc
// wrangler.consumer.jsonc
{
  "limits": {
    "cpu_ms": 30000  // 30 segundos
  }
}
```

> **Nota:** Unbound Workers requer plano pago do Cloudflare Workers.

### Rate Limiting

Adicione rate limiting no dispatcher:

```typescript
// src/index.ts
import { Ratelimit } from "@upstash/ratelimit";

const ratelimit = new Ratelimit({
  redis: c.env.REDIS,
  limiter: Ratelimit.slidingWindow(10, "1 m"),
});
```

### Secrets e Variáveis de Ambiente

```bash
# Adicionar secrets
wrangler secret put API_KEY

# Adicionar variáveis de ambiente
wrangler secret put DATABASE_URL
```

## Troubleshooting

### Erro: "Queue not found"

```bash
# Recriar a fila
wrangler queues create gazette-crawl-queue
```

### Erro: "Worker exceeded CPU time limit"

- Aumente o timeout no `wrangler.toml`
- Considere usar Unbound Workers
- Otimize o código do spider

### Erro: "Too many requests"

- Implemente rate limiting
- Adicione delays entre requisições
- Use batch processing menor

### Consumer não está processando mensagens

```bash
# Verificar binding da fila
wrangler queues consumer list gazette-crawl-queue

# Adicionar consumer manualmente
wrangler queues consumer add gazette-crawl-queue querido-diario-consumer
```

## Monitoramento

### Cloudflare Dashboard

1. Acesse [dash.cloudflare.com](https://dash.cloudflare.com)
2. Workers & Pages > Overview
3. Selecione o worker
4. Veja métricas de:
   - Requests
   - Errors
   - CPU time
   - Duration

### Logs em Tempo Real

```bash
# Dispatcher
wrangler tail

# Consumer
wrangler tail --config wrangler.consumer.toml

# Filtrar por status
wrangler tail --status error
```

### Alertas

Configure alertas no Cloudflare Dashboard:
1. Workers & Pages > Settings > Alerts
2. Adicione alertas para:
   - Error rate > 5%
   - CPU time > 80%
   - Request rate spikes

## Custos

### Workers Free Tier
- 100.000 requests/dia
- 10ms CPU time por request
- Suficiente para testes

### Workers Paid ($5/mês)
- 10 milhões requests/mês inclusos
- 50ms CPU time por request
- Unbound Workers disponível

### Queues
- 1 milhão operações/mês grátis
- $0.40 por milhão de operações adicionais

## Rollback

```bash
# Listar deployments
wrangler deployments list

# Fazer rollback para versão anterior
wrangler rollback [DEPLOYMENT_ID]
```

## CI/CD

### GitHub Actions

Crie `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Cloudflare Workers

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: 18
      - run: npm ci
      - run: npm run build
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: deploy --config wrangler.jsonc
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: deploy --config wrangler.consumer.jsonc
```

## Recursos Adicionais

- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Cloudflare Queues Docs](https://developers.cloudflare.com/queues/)
- [Wrangler CLI Docs](https://developers.cloudflare.com/workers/wrangler/)
- [Hono Framework](https://hono.dev/)
