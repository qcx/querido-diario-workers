# Sistema de Notificação via Webhook

## Visão Geral

O **Sistema de Notificação via Webhook** permite que clientes como **Qconcursos** recebam notificações automáticas em tempo real quando diários oficiais contendo informações relevantes (concursos públicos, licitações, etc.) são processados.

## Arquitetura

```
Analysis Worker → Análise Completa
                       ↓
              Webhook Filter Service
                       ↓
            Verifica Subscriptions (KV)
                       ↓
              Filtra por Categorias/Keywords
                       ↓
              Cria Webhook Notification
                       ↓
              Webhook Queue
                       ↓
              Webhook Worker
                       ↓
              HTTP POST → Cliente
                       ↓
              Delivery Log (KV)
```

## Componentes

### 1. Webhook Subscriptions (KV)

Armazena configurações de assinaturas de clientes.

**Estrutura:**
```typescript
{
  id: "qconcursos-123",
  clientId: "qconcursos",
  webhookUrl: "https://api.qconcursos.com/webhooks/gazettes",
  filters: {
    categories: ["concurso_publico"],
    keywords: ["concurso público", "concurso", "edital"],
    minConfidence: 0.7,
    minFindings: 1,
    territoryIds: ["1721000", "3550308"] // opcional
  },
  auth: {
    type: "bearer",
    token: "secret-token-here"
  },
  retry: {
    maxAttempts: 3,
    backoffMs: 5000
  },
  active: true,
  createdAt: "2025-10-04T18:00:00.000Z"
}
```

### 2. Webhook Filter Service

Filtra análises baseado em critérios da assinatura.

**Métodos principais:**

- `matches(analysis, filters)`: Verifica se análise corresponde aos filtros
- `extractFindings(analysis, filters)`: Extrai findings relevantes
- `createQconcursosFilter()`: Cria filtro específico para Qconcursos
- `createQlicitacaoFilter()`: Cria filtro para licitações
- `createCustomFilter()`: Cria filtro personalizado

**Filtros disponíveis:**

| Filtro | Descrição |
|--------|-----------|
| `categories` | Categorias de interesse (concurso_publico, licitacao, etc.) |
| `keywords` | Palavras-chave específicas |
| `minConfidence` | Confiança mínima (0-1) |
| `minFindings` | Número mínimo de findings |
| `territoryIds` | Filtro por municípios (IBGE codes) |
| `spiderIds` | Filtro por spiders específicos |

### 3. Webhook Sender Service

Processa análises e envia para webhooks correspondentes.

**Fluxo:**
1. Recebe análise completa
2. Busca todas as subscriptions ativas
3. Para cada subscription:
   - Verifica se análise corresponde aos filtros
   - Extrai findings relevantes
   - Cria notificação estruturada
   - Envia para webhook queue

### 4. Webhook Worker

Consome fila de webhooks e entrega notificações.

**Responsabilidades:**
- Enviar HTTP POST para URL do webhook
- Adicionar autenticação (Bearer, Basic, Custom)
- Gerenciar retries (3 tentativas)
- Armazenar logs de entrega
- Mover para DLQ após max retries

**Retry Logic:**
- Status 5xx → Retry
- Status 429 (Rate Limit) → Retry
- Network errors → Retry
- Status 4xx (exceto 429) → No retry
- Status 2xx → Success

### 5. Webhook Notification Payload

Estrutura da notificação enviada ao cliente.

```json
{
  "notificationId": "notif-1759601912311-abc123",
  "subscriptionId": "qconcursos-123",
  "clientId": "qconcursos",
  "event": "concurso.detected",
  "timestamp": "2025-10-04T18:28:32.311Z",
  "gazette": {
    "territoryId": "1721000",
    "territoryName": "Palmas - TO",
    "publicationDate": "2025-10-03",
    "editionNumber": "3809",
    "pdfUrl": "http://diariooficial.palmas.to.gov.br/media/diario/3809-3-10-2025-21-41-36.pdf",
    "spiderId": "to_palmas"
  },
  "analysis": {
    "jobId": "analysis-test-123",
    "totalFindings": 2,
    "highConfidenceFindings": 2,
    "categories": ["concurso_publico"]
  },
  "findings": [
    {
      "type": "keyword:concurso_publico",
      "confidence": 0.9,
      "data": {
        "category": "concurso_publico",
        "keyword": "concurso público",
        "position": 100
      },
      "context": "Ana Zeila da Silva Ferreira aprovada em Concurso Público...",
      "position": 100
    }
  ]
}
```

**Tipos de Eventos:**
- `gazette.analyzed`: Gazette analisada (genérico)
- `concurso.detected`: Concurso público detectado
- `licitacao.detected`: Licitação detectada

## Deployment

### 1. Criar Queues

```bash
# Webhook queue
npm run queue:create:webhook

# DLQ
wrangler queues create querido-diario-webhook-dlq
```

### 2. Criar KV Namespaces

```bash
# Subscriptions
wrangler kv:namespace create "WEBHOOK_SUBSCRIPTIONS"

# Delivery logs
wrangler kv:namespace create "WEBHOOK_DELIVERY_LOGS"
```

Atualizar IDs em `wrangler-webhook.jsonc` e `wrangler-analysis.jsonc`.

### 3. Deploy Workers

```bash
# Deploy analysis worker (com webhook integration)
npm run deploy:analysis

# Deploy webhook worker
npm run deploy:webhook
```

## Uso

### Criar Subscription para Qconcursos

```typescript
import { WebhookSenderService } from './services/webhook-sender';

// Via código
const subscription = await WebhookSenderService.createQconcursosSubscription(
  env.WEBHOOK_SUBSCRIPTIONS,
  'https://api.qconcursos.com/webhooks/gazettes',
  'bearer-token-secret',
  ['1721000', '3550308'] // Palmas e São Paulo (opcional)
);

// Ou via KV direto
await env.WEBHOOK_SUBSCRIPTIONS.put(
  'subscription:qconcursos-123',
  JSON.stringify({
    id: 'qconcursos-123',
    clientId: 'qconcursos',
    webhookUrl: 'https://api.qconcursos.com/webhooks/gazettes',
    filters: {
      categories: ['concurso_publico'],
      keywords: ['concurso público', 'concurso', 'edital de concurso'],
      minConfidence: 0.7,
      minFindings: 1
    },
    auth: {
      type: 'bearer',
      token: 'secret-token'
    },
    active: true,
    createdAt: new Date().toISOString()
  })
);
```

### Receber Notificações (Cliente)

**Endpoint do Cliente:**
```
POST https://api.qconcursos.com/webhooks/gazettes
```

**Headers:**
```
Content-Type: application/json
Authorization: Bearer secret-token
X-Webhook-Attempt: 1
X-Webhook-Subscription-Id: qconcursos-123
User-Agent: Querido-Diario-Webhook/1.0
```

**Body:** Ver estrutura de `WebhookNotification` acima.

**Resposta esperada:**
```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "received": true,
  "notificationId": "notif-1759601912311-abc123"
}
```

### Verificar Delivery Logs

```typescript
// Por message ID
const delivery = await env.WEBHOOK_DELIVERY_LOGS.get('delivery:msg-123');

// Por subscription
const deliveries = await env.WEBHOOK_DELIVERY_LOGS.get('subscription:qconcursos-123:deliveries');
```

## Filtros Pré-configurados

### Qconcursos (Concursos Públicos)

```typescript
{
  categories: ['concurso_publico'],
  keywords: [
    'concurso público',
    'concurso',
    'edital de concurso',
    'seleção pública',
    'processo seletivo',
    'inscrições abertas',
    'vagas',
    'candidatos aprovados'
  ],
  minConfidence: 0.7,
  minFindings: 1
}
```

### Qlicitacao (Licitações)

```typescript
{
  categories: ['licitacao'],
  keywords: [
    'licitação',
    'pregão',
    'tomada de preços',
    'dispensa de licitação',
    'inexigibilidade',
    'edital de licitação'
  ],
  minConfidence: 0.7,
  minFindings: 1
}
```

### Custom

```typescript
{
  categories: ['contrato', 'convenio_parceria'],
  keywords: ['contrato', 'termo de contrato', 'convênio'],
  minConfidence: 0.8,
  minFindings: 2,
  territoryIds: ['3550308'], // Apenas São Paulo
  spiderIds: ['sp_sao_paulo']
}
```

## Performance

### Métricas Típicas

| Métrica | Valor |
|---------|-------|
| Filtragem por análise | 1-5ms |
| Criação de notificação | <1ms |
| Envio para queue | 2-10ms |
| Delivery HTTP | 100-500ms |
| **Total** | **~500ms** |

### Throughput

- **1.000 gazettes/dia**: ~100 notificações (10% match rate)
- **10.000 gazettes/dia**: ~1.000 notificações
- **Capacidade máxima**: 10.000+ notificações/dia

## Custos

### Cloudflare

- **Workers**: Incluído no plano (100k req/dia)
- **Queues**: $0.40 por milhão de operações
- **KV**: $0.50 por milhão de leituras

### Estimativa

- **1.000 gazettes/dia**: ~$0.10/dia
- **10.000 gazettes/dia**: ~$1/dia

## Segurança

### Autenticação

**Bearer Token:**
```typescript
auth: {
  type: 'bearer',
  token: 'secret-token-here'
}
```

**Basic Auth:**
```typescript
auth: {
  type: 'basic',
  username: 'qconcursos',
  password: 'secret-password'
}
```

**Custom Headers:**
```typescript
auth: {
  type: 'custom',
  headers: {
    'X-API-Key': 'api-key-here',
    'X-Client-Id': 'qconcursos'
  }
}
```

### Webhook Verification

Clientes devem:
1. Verificar `X-Webhook-Subscription-Id` header
2. Validar token de autenticação
3. Verificar assinatura (opcional, futuro)

## Troubleshooting

### Webhook não recebido

1. Verificar se subscription está ativa:
```typescript
const sub = await env.WEBHOOK_SUBSCRIPTIONS.get('subscription:qconcursos-123');
```

2. Verificar logs de delivery:
```typescript
const log = await env.WEBHOOK_DELIVERY_LOGS.get('delivery:msg-123');
```

3. Verificar filtros:
```typescript
const matches = WebhookFilterService.matches(analysis, subscription.filters);
```

### Webhook com erro 5xx

- Será automaticamente retentado 3 vezes
- Backoff de 5 segundos entre tentativas
- Após 3 falhas, vai para DLQ

### Webhook com erro 4xx

- Não será retentado (erro do cliente)
- Verificar URL e autenticação
- Verificar formato do payload

## Monitoramento

### Métricas Recomendadas

- Taxa de entrega bem-sucedida
- Tempo médio de delivery
- Taxa de retry
- Taxa de DLQ
- Latência do endpoint do cliente

### Alertas

- Taxa de falha > 10%
- Latência > 5s
- DLQ não vazio

## Roadmap

- [ ] Assinatura HMAC para verificação
- [ ] Webhook replay (reenviar notificações)
- [ ] Dashboard de monitoramento
- [ ] API REST para gerenciar subscriptions
- [ ] Batching de notificações
- [ ] Filtros avançados (regex, custom functions)
- [ ] Rate limiting por cliente
- [ ] Webhooks assíncronos (callback URL)

## Exemplos

### Qconcursos - Endpoint de Recebimento

```typescript
// Express.js example
app.post('/webhooks/gazettes', async (req, res) => {
  // Verify auth
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Process notification
  const notification = req.body;
  
  console.log(`Received ${notification.event} for ${notification.gazette.territoryName}`);
  console.log(`Findings: ${notification.findings.length}`);

  // Store in database
  await db.gazettes.insert({
    notificationId: notification.notificationId,
    territoryId: notification.gazette.territoryId,
    publicationDate: notification.gazette.publicationDate,
    pdfUrl: notification.gazette.pdfUrl,
    findingsCount: notification.findings.length,
    findings: notification.findings,
    receivedAt: new Date()
  });

  // Respond quickly
  res.json({
    received: true,
    notificationId: notification.notificationId
  });

  // Process async (send emails, alerts, etc.)
  processGazetteAsync(notification);
});
```

### Criar Subscription Customizada

```typescript
const customSubscription: WebhookSubscription = {
  id: 'custom-client-123',
  clientId: 'custom-client',
  webhookUrl: 'https://api.example.com/webhooks',
  filters: {
    categories: ['concurso_publico', 'licitacao'],
    keywords: ['concurso', 'licitação', 'pregão'],
    minConfidence: 0.8,
    minFindings: 2,
    territoryIds: ['3550308', '3304557'], // SP e RJ
  },
  auth: {
    type: 'bearer',
    token: 'custom-secret-token'
  },
  retry: {
    maxAttempts: 5,
    backoffMs: 10000
  },
  active: true,
  createdAt: new Date().toISOString()
};

await env.WEBHOOK_SUBSCRIPTIONS.put(
  `subscription:${customSubscription.id}`,
  JSON.stringify(customSubscription)
);
```

## Suporte

Para dúvidas ou problemas:
- Verificar logs do webhook worker
- Verificar delivery logs no KV
- Verificar queue metrics no Cloudflare Dashboard

## Licença

MIT
