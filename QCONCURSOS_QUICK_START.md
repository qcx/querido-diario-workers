# Guia Rápido: Integração Qconcursos

## Visão Geral

Este guia mostra como o **Qconcursos** pode receber notificações automáticas em tempo real quando concursos públicos são detectados em diários oficiais.

## Como Funciona

```
Diário Oficial Publicado
         ↓
    Spider Coleta
         ↓
    Mistral OCR
         ↓
  Análise (Keywords)
         ↓
  Detecta "Concurso Público"
         ↓
  Filtra por Critérios
         ↓
  Envia Webhook → Qconcursos ✅
```

## Passo 1: Criar Endpoint de Recebimento

O Qconcursos precisa criar um endpoint HTTPS para receber as notificações.

**Exemplo em Node.js/Express:**

```javascript
const express = require('express');
const app = express();

app.use(express.json());

app.post('/webhooks/gazettes', async (req, res) => {
  // 1. Verificar autenticação
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token !== process.env.WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // 2. Receber notificação
  const notification = req.body;
  
  console.log('📬 Nova notificação recebida!');
  console.log(`  Evento: ${notification.event}`);
  console.log(`  Município: ${notification.gazette.territoryName}`);
  console.log(`  Data: ${notification.gazette.publicationDate}`);
  console.log(`  Findings: ${notification.findings.length}`);

  // 3. Processar concursos encontrados
  for (const finding of notification.findings) {
    console.log(`  🎓 ${finding.data.keyword}: ${finding.context.substring(0, 100)}...`);
  }

  // 4. Salvar no banco de dados
  await db.concursos.insert({
    notificationId: notification.notificationId,
    territoryId: notification.gazette.territoryId,
    territoryName: notification.gazette.territoryName,
    publicationDate: notification.gazette.publicationDate,
    pdfUrl: notification.gazette.pdfUrl,
    findings: notification.findings,
    receivedAt: new Date()
  });

  // 5. Responder rapidamente (< 5s)
  res.json({
    received: true,
    notificationId: notification.notificationId
  });

  // 6. Processar assincronamente (enviar emails, alertas, etc.)
  processAsync(notification);
});

app.listen(3000, () => {
  console.log('Webhook endpoint listening on port 3000');
});
```

## Passo 2: Configurar Subscription

Enviar configuração da subscription para o time do Querido Diário:

```json
{
  "clientId": "qconcursos",
  "webhookUrl": "https://api.qconcursos.com/webhooks/gazettes",
  "authToken": "seu-token-secreto-aqui",
  "filters": {
    "categories": ["concurso_publico"],
    "keywords": [
      "concurso público",
      "concurso",
      "edital de concurso",
      "seleção pública",
      "processo seletivo"
    ],
    "minConfidence": 0.7,
    "minFindings": 1,
    "territoryIds": [] // vazio = todos os municípios
  }
}
```

**Filtros opcionais:**

- `territoryIds`: Lista de códigos IBGE para filtrar municípios específicos
  - Exemplo: `["3550308", "3304557"]` (São Paulo e Rio de Janeiro)
- `minConfidence`: Confiança mínima (0.0 a 1.0)
  - Recomendado: 0.7 (70%)
- `minFindings`: Número mínimo de findings
  - Recomendado: 1

## Passo 3: Estrutura da Notificação

Quando um concurso é detectado, o Qconcursos receberá:

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
        "position": 8331
      },
      "context": "Ana Zeila da Silva Ferreira aprovada em Concurso Público para provimento de cargos do Quadro de Educação...",
      "position": 8331
    }
  ]
}
```

## Passo 4: Processar Findings

Cada `finding` contém:

- **type**: Tipo do finding (`keyword:concurso_publico`)
- **confidence**: Confiança (0.0 a 1.0)
- **data.keyword**: Palavra-chave detectada
- **context**: Contexto ao redor (até 200 caracteres)
- **position**: Posição no texto

**Exemplo de processamento:**

```javascript
function extractConcursoInfo(finding) {
  const context = finding.context;
  
  // Extrair informações usando regex
  const cargo = context.match(/cargo de ([^,\.]+)/i)?.[1];
  const orgao = context.match(/Quadro de ([^,\.]+)/i)?.[1];
  const candidato = context.match(/([A-Z][a-z]+ [A-Z][a-z]+(?: [A-Z][a-z]+)*)/)?.[1];
  
  return {
    cargo,
    orgao,
    candidato,
    keyword: finding.data.keyword,
    confidence: finding.confidence
  };
}

// Uso
for (const finding of notification.findings) {
  const info = extractConcursoInfo(finding);
  console.log(info);
  // { cargo: 'Professor', orgao: 'Educação', candidato: 'Ana Zeila da Silva Ferreira', ... }
}
```

## Passo 5: Responder ao Webhook

**Importante:** Responder rapidamente (< 5 segundos) para evitar timeout.

**Resposta de sucesso:**
```json
HTTP/1.1 200 OK
Content-Type: application/json

{
  "received": true,
  "notificationId": "notif-1759601912311-abc123"
}
```

**Resposta de erro:**
```json
HTTP/1.1 500 Internal Server Error
Content-Type: application/json

{
  "error": "Database connection failed"
}
```

**Retry automático:**
- Erros 5xx → 3 tentativas automáticas
- Erros 4xx → Sem retry (erro do cliente)

## Passo 6: Segurança

### Verificar Autenticação

```javascript
const token = req.headers.authorization?.replace('Bearer ', '');
if (token !== process.env.WEBHOOK_SECRET) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

### Verificar Subscription ID

```javascript
const subscriptionId = req.headers['x-webhook-subscription-id'];
if (subscriptionId !== 'qconcursos-123') {
  return res.status(403).json({ error: 'Invalid subscription' });
}
```

### Validar Payload

```javascript
const { notificationId, event, gazette, findings } = req.body;

if (!notificationId || !event || !gazette || !findings) {
  return res.status(400).json({ error: 'Invalid payload' });
}
```

## Passo 7: Monitoramento

### Métricas Recomendadas

- Taxa de recebimento (notificações/dia)
- Taxa de processamento bem-sucedido
- Latência do endpoint
- Erros por tipo

### Logs

```javascript
console.log(`[${new Date().toISOString()}] Webhook received`, {
  notificationId: notification.notificationId,
  event: notification.event,
  territoryId: notification.gazette.territoryId,
  findingsCount: notification.findings.length,
  processingTimeMs: Date.now() - startTime
});
```

## Exemplos de Uso

### Exemplo 1: Alertar Usuários

```javascript
async function alertUsers(notification) {
  const { gazette, findings } = notification;
  
  // Buscar usuários interessados neste município
  const users = await db.users.find({
    interestedTerritories: gazette.territoryId
  });
  
  // Enviar email para cada usuário
  for (const user of users) {
    await sendEmail({
      to: user.email,
      subject: `Novo concurso em ${gazette.territoryName}`,
      body: `
        Detectamos ${findings.length} menção(ões) a concurso público no 
        Diário Oficial de ${gazette.territoryName} (${gazette.publicationDate}).
        
        Ver PDF: ${gazette.pdfUrl}
      `
    });
  }
}
```

### Exemplo 2: Criar Alerta no Sistema

```javascript
async function createAlert(notification) {
  const { gazette, findings } = notification;
  
  for (const finding of findings) {
    await db.alerts.insert({
      type: 'concurso',
      territoryId: gazette.territoryId,
      territoryName: gazette.territoryName,
      publicationDate: gazette.publicationDate,
      pdfUrl: gazette.pdfUrl,
      keyword: finding.data.keyword,
      context: finding.context,
      confidence: finding.confidence,
      createdAt: new Date()
    });
  }
}
```

### Exemplo 3: Enriquecer com IA

```javascript
async function enrichWithAI(notification) {
  const { gazette, findings } = notification;
  
  // Baixar PDF completo
  const pdfText = await downloadAndExtractPDF(gazette.pdfUrl);
  
  // Usar LLM para extrair informações estruturadas
  const structured = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{
      role: 'user',
      content: `Extraia informações estruturadas deste edital de concurso:
      
      ${pdfText.substring(0, 4000)}
      
      Retorne JSON com: cargo, vagas, salario, inscricoes_inicio, inscricoes_fim, requisitos`
    }]
  });
  
  return JSON.parse(structured.choices[0].message.content);
}
```

## FAQ

### Quantas notificações vou receber?

Depende dos filtros configurados:
- **Sem filtro de território**: ~100-200 notificações/dia (estimativa)
- **Com filtro de território** (ex: apenas capitais): ~20-50 notificações/dia
- **Com filtro de keywords específicas**: ~10-30 notificações/dia

### Como testar o endpoint?

Use o payload de exemplo acima e envie via curl:

```bash
curl -X POST https://api.qconcursos.com/webhooks/gazettes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer seu-token-secreto" \
  -d @test-payload.json
```

### O que acontece se meu endpoint estiver offline?

- 3 tentativas automáticas com backoff de 5 segundos
- Após 3 falhas, a notificação vai para Dead Letter Queue
- Você pode solicitar reenvio manual

### Posso receber notificações de múltiplas categorias?

Sim! Configure filtros com múltiplas categorias:

```json
{
  "filters": {
    "categories": ["concurso_publico", "licitacao", "contrato"],
    "keywords": ["concurso", "licitação", "pregão", "contrato"]
  }
}
```

### Como filtrar apenas concursos com vagas abertas?

Use keywords mais específicas:

```json
{
  "filters": {
    "keywords": [
      "inscrições abertas",
      "edital de abertura",
      "prazo de inscrição",
      "vagas disponíveis"
    ]
  }
}
```

## Suporte

Para dúvidas ou problemas:
- Email: suporte@querido-diario.org
- Documentação completa: `WEBHOOK_SYSTEM_DOCUMENTATION.md`

## Próximos Passos

1. ✅ Criar endpoint de recebimento
2. ✅ Configurar autenticação
3. ✅ Enviar configuração de subscription
4. ✅ Testar com payload de exemplo
5. ✅ Monitorar primeiras notificações
6. ✅ Ajustar filtros conforme necessário
7. ✅ Integrar com sistema existente

**Pronto para começar! 🚀**
