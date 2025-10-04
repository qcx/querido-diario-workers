# Sistema de Análise Pós-OCR

## Visão Geral

O **Sistema de Análise Pós-OCR** é uma arquitetura extensível baseada em classes que processa automaticamente o texto extraído dos diários oficiais e identifica informações relevantes como concursos públicos, licitações, contratos, nomeações, entidades (pessoas, valores, datas) e muito mais.

## Arquitetura

```
OCR Worker → OCR Result → Analysis Queue → Analysis Worker
                                              ↓
                                    Analysis Orchestrator
                                              ↓
                          ┌──────────────────┼──────────────────┐
                          ↓                  ↓                  ↓
                  KeywordAnalyzer    EntityExtractor    AIAnalyzer
                          ↓                  ↓                  ↓
                      Findings           Findings          Findings
                          ↓                  ↓                  ↓
                          └──────────────────┴──────────────────┘
                                              ↓
                                    GazetteAnalysis
                                              ↓
                                        KV Storage
```

## Componentes

### 1. Base Analyzer (`BaseAnalyzer`)

Classe abstrata que define a interface comum para todos os analisadores.

**Responsabilidades:**
- Gerenciamento de timeout
- Tratamento de erros
- Logging estruturado
- Criação de findings
- Agregação de metadados

**Métodos principais:**
- `analyze(ocrResult)`: Executa a análise
- `performAnalysis(ocrResult)`: Método abstrato para implementação específica
- `createFinding()`: Helper para criar findings
- `getMetadata()`: Retorna metadados do analisador

### 2. Keyword Analyzer (`KeywordAnalyzer`)

Busca por palavras-chave e padrões específicos no texto.

**Categorias padrão:**
- **concurso_publico**: Concursos públicos, seleções
- **licitacao**: Licitações, pregões, tomadas de preço
- **contrato**: Contratos, termos contratuais
- **nomeacao_exoneracao**: Nomeações, exonerações, designações
- **legislacao**: Decretos, leis, portarias
- **orcamento_financas**: Orçamento, empenhos, créditos
- **convenio_parceria**: Convênios, termos de cooperação

**Configuração:**
```typescript
{
  enabled: true,
  priority: 1,
  timeout: 10000,
  patterns: [
    {
      category: 'concurso_publico',
      keywords: ['concurso público', 'concurso', 'edital de concurso'],
      caseSensitive: false,
      wholeWord: false,
      weight: 0.9
    }
  ]
}
```

**Output:**
```json
{
  "type": "keyword:concurso_publico",
  "confidence": 0.9,
  "data": {
    "category": "concurso_publico",
    "keyword": "concurso público",
    "position": 107,
    "weight": 0.9
  },
  "context": "...A Prefeitura Municipal torna público que estarão abertas..."
}
```

### 3. Entity Extractor (`EntityExtractor`)

Extrai entidades estruturadas usando regex e validação.

**Tipos de entidades:**
- **CPF**: Valida dígitos verificadores
- **CNPJ**: Valida dígitos verificadores
- **money**: Valores monetários em BRL
- **date**: Datas no formato DD/MM/YYYY
- **law_reference**: Referências a leis
- **decree_reference**: Referências a decretos
- **person**: Nomes de pessoas (heurística)
- **organization**: Nomes de organizações
- **location**: Estados brasileiros

**Output:**
```json
{
  "type": "entity:money",
  "confidence": 0.9,
  "data": {
    "value": 120,
    "formatted": "R$ 120,00",
    "currency": "BRL",
    "position": 382
  },
  "context": "...Valor da inscrição: R$ 120,00..."
}
```

### 4. AI Analyzer (`AIAnalyzer`)

Usa LLMs (OpenAI API) para análise semântica avançada.

**Prompts padrão:**

1. **content_classification**: Classifica o conteúdo em categorias
2. **key_information_extraction**: Extrai informações-chave
3. **urgency_assessment**: Avalia urgência e importância

**Configuração:**
```typescript
{
  enabled: true,
  priority: 3,
  timeout: 30000,
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4.1-mini',
  prompts: [
    {
      name: 'content_classification',
      prompt: 'Analyze and classify this gazette...',
      maxTokens: 500,
      temperature: 0.2
    }
  ]
}
```

**Output:**
```json
{
  "type": "ai:content_classification",
  "confidence": 0.8,
  "data": {
    "promptName": "content_classification",
    "categories": ["concurso_publico", "licitacao"],
    "summary": "Official gazette containing job openings and bidding notices"
  }
}
```

### 5. Analysis Orchestrator (`AnalysisOrchestrator`)

Gerencia múltiplos analisadores e agrega resultados.

**Responsabilidades:**
- Inicializa analisadores baseado em configuração
- Executa analisadores em ordem de prioridade
- Agrega findings de todos os analisadores
- Cria sumário consolidado
- Gerencia erros individuais

**Output completo:**
```json
{
  "jobId": "analysis-xyz-123",
  "ocrJobId": "ocr-abc-456",
  "territoryId": "3550308",
  "publicationDate": "2025-10-04",
  "analyzedAt": "2025-10-04T17:42:11.203Z",
  "extractedText": "...",
  "textLength": 1045,
  "analyses": [
    {
      "analyzerId": "keyword-analyzer",
      "analyzerType": "keyword",
      "status": "success",
      "findings": [...],
      "processingTimeMs": 5,
      "metadata": {...}
    }
  ],
  "summary": {
    "totalFindings": 31,
    "findingsByType": {
      "entity:person": 9,
      "keyword:concurso_publico": 4,
      "entity:money": 4
    },
    "highConfidenceFindings": 25,
    "categories": ["concurso_publico", "licitacao", "contrato"],
    "keywords": ["concurso", "licitação", "contrato"]
  },
  "metadata": {
    "spiderId": "sp_sao_paulo",
    "editionNumber": "1234",
    "power": "executive"
  }
}
```

### 6. Analysis Worker (`analysis-worker.ts`)

Worker Cloudflare que consome a fila de análise.

**Fluxo:**
1. Recebe mensagem da fila com OCR result
2. Verifica se já foi analisado (KV cache)
3. Cria orchestrator com configuração
4. Executa análise
5. Armazena resultados em KV
6. Cria índices para consulta

## Deployment

### 1. Criar Queue

```bash
npm run queue:create:analysis
```

### 2. Criar KV Namespace

```bash
wrangler kv:namespace create "ANALYSIS_RESULTS"
```

Atualizar `wrangler-analysis.jsonc` com o ID do namespace.

### 3. Configurar Secrets

```bash
# OpenAI API Key (opcional, para AI Analyzer)
wrangler secret put OPENAI_API_KEY --config wrangler-analysis.jsonc
```

### 4. Deploy

```bash
npm run deploy:analysis
```

## Uso

### Análise Automática

O sistema funciona automaticamente:

1. Spider coleta gazettes
2. Consumer envia para OCR queue
3. OCR worker processa PDF
4. **OCR worker envia resultado para Analysis queue** ✨
5. Analysis worker processa automaticamente
6. Resultados armazenados em KV

### Análise Manual (Teste)

```typescript
import { AnalysisOrchestrator } from './src/services/analysis-orchestrator';

const config = {
  analyzers: {
    keyword: { enabled: true },
    entity: { enabled: true },
    ai: { enabled: false }
  }
};

const orchestrator = new AnalysisOrchestrator(config);
const analysis = await orchestrator.analyze(ocrResult);

console.log(analysis.summary);
```

### Consultar Resultados

```typescript
// Por OCR job ID
const analysis = await env.ANALYSIS_RESULTS.get('analysis:ocr-job-123');

// Por território e data
const jobId = await env.ANALYSIS_RESULTS.get('index:3550308:2025-10-04');
const analysis = await env.ANALYSIS_RESULTS.get(`analysis:${jobId}`);
```

## Extensibilidade

### Criar Novo Analisador

```typescript
import { BaseAnalyzer } from './base-analyzer';
import { OcrResult, Finding } from '../types';

export class CustomAnalyzer extends BaseAnalyzer {
  constructor(config) {
    super('custom-analyzer', 'custom', config);
  }

  protected async performAnalysis(ocrResult: OcrResult): Promise<Finding[]> {
    const findings: Finding[] = [];
    
    // Sua lógica aqui
    const text = ocrResult.extractedText;
    
    // Exemplo: buscar URLs
    const urlRegex = /https?:\/\/[^\s]+/g;
    let match;
    while ((match = urlRegex.exec(text)) !== null) {
      findings.push(
        this.createFinding(
          'custom:url',
          { url: match[0] },
          0.95
        )
      );
    }
    
    return findings;
  }
}
```

### Adicionar ao Orchestrator

```typescript
// Em analysis-orchestrator.ts
import { CustomAnalyzer } from '../analyzers/custom-analyzer';

// No método initializeAnalyzers()
if (this.config.analyzers.custom?.enabled) {
  this.analyzers.push(new CustomAnalyzer(this.config.analyzers.custom));
}
```

### Adicionar Padrão de Keyword

```typescript
const analyzer = new KeywordAnalyzer();

analyzer.addPattern({
  category: 'meio_ambiente',
  keywords: [
    'licença ambiental',
    'impacto ambiental',
    'desmatamento',
    'preservação'
  ],
  caseSensitive: false,
  wholeWord: false,
  weight: 0.8
});
```

### Adicionar Prompt de AI

```typescript
const analyzer = new AIAnalyzer({
  apiKey: process.env.OPENAI_API_KEY,
  enabled: true
});

analyzer.addPrompt({
  name: 'environmental_impact',
  prompt: `Analyze this text for environmental impact mentions.
  Return JSON with: { hasImpact: boolean, severity: "low"|"medium"|"high", details: string }`,
  maxTokens: 300,
  temperature: 0.1
});
```

## Performance

### Métricas Típicas

| Analisador | Tempo Médio | Findings Típicos |
|------------|-------------|------------------|
| Keyword    | 5-10ms      | 10-20            |
| Entity     | 2-5ms       | 15-30            |
| AI         | 2-5s        | 3-10             |
| **Total**  | **2-5s**    | **30-60**        |

### Otimizações

1. **Ordem de Prioridade**: Analisadores rápidos primeiro
2. **Timeout Individual**: Evita que um analisador lento bloqueie outros
3. **Cache de Resultados**: KV evita reprocessamento
4. **Batch Processing**: Processa múltiplas mensagens simultaneamente

## Custos

### Cloudflare

- **Workers**: Incluído no plano gratuito (100k req/dia)
- **Queues**: $0.40 por milhão de operações
- **KV**: $0.50 por milhão de leituras

### OpenAI (AI Analyzer)

- **gpt-4.1-mini**: ~$0.15 por 1M tokens input
- **Custo típico**: $0.001-0.003 por gazette

### Estimativa Total

- **1.000 gazettes/dia**: ~$1-3/dia
- **10.000 gazettes/dia**: ~$10-30/dia

## Troubleshooting

### Analyzer Timeout

```
Error: Analysis timeout
```

**Solução**: Aumentar timeout na configuração

```typescript
{
  timeout: 60000 // 60 segundos
}
```

### AI Analyzer Falha

```
Error: AI API error: 429 - Rate limit exceeded
```

**Solução**: Implementar retry com backoff ou desabilitar temporariamente

### Muitos Findings

Se um analisador retorna muitos findings (>100), considere:
- Aumentar threshold de confiança
- Filtrar findings de baixa relevância
- Limitar número de findings por tipo

## Exemplos de Uso

### Buscar Concursos

```typescript
const analysis = await getAnalysis(jobId);
const concursos = analysis.analyses
  .flatMap(a => a.findings)
  .filter(f => f.type.includes('concurso'));

console.log(`Encontrados ${concursos.length} concursos`);
```

### Extrair Valores Monetários

```typescript
const valores = analysis.analyses
  .flatMap(a => a.findings)
  .filter(f => f.type === 'entity:money')
  .map(f => f.data.value);

const total = valores.reduce((sum, v) => sum + v, 0);
console.log(`Valor total: R$ ${total.toLocaleString('pt-BR')}`);
```

### Identificar Gazettes Urgentes

```typescript
const urgentes = analysis.summary.categories.some(c => 
  ['concurso_publico', 'licitacao'].includes(c)
) && analysis.summary.highConfidenceFindings > 10;

if (urgentes) {
  console.log('⚠️  Gazette urgente detectada!');
}
```

## Roadmap

- [ ] Suporte a mais entidades (endereços, telefones)
- [ ] Classificador de categorias com ML
- [ ] Extração de tabelas
- [ ] Análise de imagens (quando presentes)
- [ ] Dashboard de visualização
- [ ] Alertas automáticos por categoria
- [ ] API REST para consulta de análises

## Contribuindo

Para adicionar novos analisadores ou melhorar os existentes, siga o padrão:

1. Estender `BaseAnalyzer`
2. Implementar `performAnalysis()`
3. Adicionar testes
4. Documentar findings produzidos
5. Atualizar este documento

## Licença

MIT
