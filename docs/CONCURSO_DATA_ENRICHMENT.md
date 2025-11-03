# Sistema de Enriquecimento de Dados de Concursos

## Visão Geral

Este documento descreve o sistema de enriquecimento, validação e normalização dos dados de concursos públicos extraídos das gazetas oficiais. O objetivo é garantir a acurácia e completude dos dados enviados via webhooks.

## Arquitetura

### Pipeline de Enriquecimento

O pipeline de enriquecimento é executado em três etapas principais:

```
Dados Brutos → Validação/Normalização → Enriquecimento Externo → Cálculos → Dados Enriquecidos
```

### Componentes

#### 1. ConcursoEnricher (`src/services/concurso-enricher.ts`)

Responsável pela validação e normalização dos dados brutos.

**Validadores:**

- **DateValidator**: Normaliza datas para formato ISO, valida intervalos, detecta inversões
- **MoneyValidator**: Normaliza valores monetários, valida plausibilidade
- **CNPJValidator**: Valida formato e dígitos verificadores de CNPJ
- **TextNormalizer**: Remove artefatos de OCR, normaliza acentuação, padroniza textos

**Exemplo de uso:**
```typescript
const enriched = ConcursoEnricher.enrichConcursoData(rawData);
```

#### 2. ExternalDataEnricher (`src/services/external-data-enricher.ts`)

Enriquece dados com informações externas.

**Funcionalidades:**

- **TerritoryNormalizer**: Normaliza nomes de cidades, busca território IDs
- **CNPJEnricher**: Valida CNPJ (stub para integração futura com API da Receita)
- **KNOWN_BANCAS**: Base de bancas conhecidas com CNPJs válidos

**Exemplo de uso:**
```typescript
const enriched = await ExternalDataEnricher.enrichConcursoData(data);
```

#### 3. ConcursoCalculator (`src/services/concurso-calculator.ts`)

Realiza cálculos automáticos e inferências.

**Funcionalidades:**

- Cálculo de total de vagas e detecção de discrepâncias
- Cálculo de prazos (dias até fim de inscrição, dias até prova)
- Inferência de status (aberto/fechado/em andamento/finalizado)
- Estatísticas de taxas (média, mínima, máxima)
- Métricas de qualidade de dados (completude, campos validados)
- Validação de consistência (ordem de datas, valores razoáveis)

**Exemplo de uso:**
```typescript
const enriched = ConcursoCalculator.enrichWithCalculations(data);
```

## Padrões de Extração Melhorados

### Novos Campos Extraídos (`src/analyzers/patterns/concurso-patterns.ts`)

1. **Escolaridade**: `ensino fundamental`, `ensino médio`, `superior`, etc.
2. **Jornada de trabalho**: `40h semanais`, `20h`, etc.
3. **Benefícios**: `vale-transporte`, `vale-alimentação`, `plano de saúde`
4. **Reserva de vagas**: `PCD`, `ampla concorrência`, `cotas`
5. **Múltiplos cargos**: Extração de tabelas com cargos, vagas e salários

### Exemplo de Extração de Tabela

```
Cargo: Professor | Vagas: 5 | Salário: R$ 3.500,00
```

É extraído como:
```json
{
  "cargo": "Professor",
  "vagas": 5,
  "salario": 3500.00,
  "salario_formatted": "R$ 3.500,00"
}
```

## Integração no Pipeline de Webhooks

A integração é feita no `webhook-sender.ts`:

```typescript
private async extractConcursoData(analysis: GazetteAnalysis): Promise<any> {
  // 1. Buscar dados do banco
  const rawData = await this.fetchFromDatabase(analysis.jobId);
  
  // 2. Aplicar enriquecimento
  const enrichedData = await this.enrichConcursoData(rawData);
  
  return enrichedData;
}

private async enrichConcursoData(rawData: any): Promise<any> {
  // Etapa 1: Validação e normalização
  let enriched = ConcursoEnricher.enrichConcursoData(rawData);
  
  // Etapa 2: Enriquecimento externo
  enriched = await ExternalDataEnricher.enrichConcursoData(enriched);
  
  // Etapa 3: Cálculos e inferências
  enriched = ConcursoCalculator.enrichWithCalculations(enriched);
  
  return enriched;
}
```

## Formato de Saída do Webhook

### Estrutura dos Dados Enriquecidos

```json
{
  "documentType": "edital_abertura",
  "orgao": "Prefeitura Municipal De São Paulo",
  "editalNumero": "001/2024",
  
  "vagas": {
    "total": 10,
    "porCargo": [
      {
        "cargo": "Professor De Matemática",
        "vagas": 5,
        "salario": 3500.00,
        "salario_formatted": "R$ 3.500,00",
        "escolaridade": "Superior completo",
        "jornada": "40h semanais",
        "requisitos": "Licenciatura em Matemática"
      }
    ]
  },
  
  "datas": {
    "inscricoesInicio": "2024-01-01",
    "inscricoesFim": "2024-01-31",
    "prova": "2024-02-15",
    "inscricoesInicio_enriched": {
      "original": "01/01/2024",
      "normalized": "2024-01-01",
      "valid": true,
      "daysFromNow": -280,
      "isPast": true,
      "isFuture": false
    }
  },
  
  "taxas": [
    {
      "valor": 50.00,
      "valor_formatted": "R$ 50,00"
    }
  ],
  
  "banca": {
    "nome": "Fundação Getulio Vargas",
    "cnpj": "33.641.663/0001-44",
    "cnpj_valid": true,
    "fullName": "Fundação Getulio Vargas",
    "knownBanca": true,
    "abbreviation": "FGV"
  },
  
  "_enrichment": {
    "enrichedFields": ["orgao", "datas", "cargos", "taxas", "banca"],
    "warnings": [],
    "enrichedAt": "2024-11-03T10:30:00.000Z"
  },
  
  "_externalEnrichment": {
    "bancaEnriched": true,
    "enrichedAt": "2024-11-03T10:30:00.000Z"
  },
  
  "_calculations": {
    "vagas": {
      "totalCalculado": 10,
      "totalDeclarado": 10,
      "discrepancia": false,
      "porCargo": 2
    },
    "prazos": {
      "diasAteInscricaoFim": -7,
      "diasAteProva": 10,
      "periodoInscricaoDias": 30,
      "inscricoesAbertas": false,
      "provaFutura": true
    },
    "status": {
      "status": "em_andamento",
      "confidence": 0.8,
      "reason": "Inscriptions closed but exam is in the future"
    },
    "taxas": {
      "media": 50.00,
      "minima": 50.00,
      "maxima": 50.00,
      "variacao": false
    },
    "calculatedAt": "2024-11-03T10:30:00.000Z"
  },
  
  "_dataQuality": {
    "completeness": 0.92,
    "validatedFields": [
      "orgao",
      "editalNumero",
      "vagas.total",
      "datas.inscricoesInicio",
      "datas.inscricoesFim",
      "taxas",
      "banca.nome"
    ],
    "missingFields": [],
    "warnings": [],
    "confidence": 0.92
  }
}
```

## Validações Implementadas

### Validações de Datas

- ✅ Formato brasileiro (DD/MM/YYYY) → ISO (YYYY-MM-DD)
- ✅ Validação de intervalos (início antes do fim)
- ✅ Detecção de inversão dia/mês
- ✅ Identificação de datas passadas/futuras
- ✅ Cálculo de dias restantes

### Validações de Valores Monetários

- ✅ Normalização de formato brasileiro (R$ 1.234,56)
- ✅ Validação contra salário mínimo
- ✅ Detecção de valores suspeitos (muito baixos/altos)
- ✅ Formatação padronizada

### Validações de CNPJ

- ✅ Validação de formato (XX.XXX.XXX/XXXX-XX)
- ✅ Validação de dígitos verificadores
- ✅ Detecção de CNPJs inválidos (todos dígitos iguais)

### Validações de Texto

- ✅ Remoção de artefatos de OCR
- ✅ Normalização de acentuação
- ✅ Padronização de nomes de órgãos
- ✅ Capitalização correta de cargos

### Validações de Consistência

- ✅ Total de vagas declarado vs. calculado
- ✅ Ordem cronológica de datas
- ✅ Valores de salário razoáveis
- ✅ Completude dos dados

## Testes

### Executar Testes

```typescript
import { ConcursoDataValidator } from './testing/validators/concurso-data-validator';

// Executar todos os testes
const report = await ConcursoDataValidator.runAllTests();
ConcursoDataValidator.printReport(report);

// Validar output de webhook
const webhookValidation = ConcursoDataValidator.validateWebhookOutput(concursoData);
ConcursoDataValidator.printReport(webhookValidation);
```

### Categorias de Testes

1. **Testes Unitários**
   - DateValidator (5 testes)
   - MoneyValidator (5 testes)
   - CNPJValidator (4 testes)
   - TextNormalizer (4 testes)
   - ConcursoCalculator (6 testes)

2. **Testes de Integração**
   - Pipeline completo de enriquecimento
   - Tratamento de dados parciais
   - Validação de output de webhook

## Métricas de Qualidade

### Completude (Completeness)

Percentual de campos essenciais preenchidos:

```
completeness = campos_preenchidos_ponderados / total_campos_ponderados
```

Campos essenciais e seus pesos:
- `orgao`: 1.0
- `editalNumero`: 0.8
- `vagas.total`: 1.0
- `datas.inscricoesInicio`: 0.9
- `datas.inscricoesFim`: 1.0
- `taxas`: 0.7
- `banca.nome`: 0.5

### Confiança (Confidence)

Score de confiança nos dados:

```
confidence = completeness - (warnings * 0.05)
```

Reduzido em 5% para cada warning encontrado.

## Roadmap Futuro

### Melhorias Planejadas

1. **Integração com API da Receita Federal**
   - Validação online de CNPJ
   - Busca de razão social automatizada

2. **Base de Dados de Territórios**
   - Implementar busca fuzzy de cidades
   - Correção automática de grafias alternativas

3. **Machine Learning**
   - Detecção automática de padrões de extração
   - Correção inteligente de erros de OCR

4. **Cache de Enriquecimento**
   - Cache de validações de CNPJ (24h TTL)
   - Cache de normalização de territórios

## Exemplos de Uso

### Exemplo 1: Enriquecer Dados Manualmente

```typescript
import { ConcursoEnricher } from './services/concurso-enricher';

const rawData = {
  orgao: 'PREF MUN DE SÃO PAULO',
  vagas: { total: 10 },
  datas: { inscricoesFim: '15/03/2024' },
};

const enriched = ConcursoEnricher.enrichConcursoData(rawData);

console.log(enriched.orgao); // "Prefeitura Municipal De São Paulo"
console.log(enriched.datas.inscricoesFim); // "2024-03-15"
console.log(enriched._dataQuality.completeness); // 0.65
```

### Exemplo 2: Validar CNPJ

```typescript
import { CNPJValidator } from './services/concurso-enricher';

const result = CNPJValidator.normalize('33641663000144');

console.log(result.normalized); // "33.641.663/0001-44"
console.log(result.valid); // true
```

### Exemplo 3: Calcular Status do Concurso

```typescript
import { ConcursoCalculator } from './services/concurso-calculator';

const data = {
  documentType: 'edital_abertura',
  datas: { inscricoesFim: '31/12/2099' }
};

const prazos = ConcursoCalculator.calculatePrazos(data);
const status = ConcursoCalculator.inferStatus(data, prazos);

console.log(status.status); // "aberto"
console.log(status.confidence); // 0.85
console.log(prazos.diasAteInscricaoFim); // 27000+
```

## Suporte

Para dúvidas ou problemas com o sistema de enriquecimento:

1. Verifique os logs de enriquecimento no webhook-sender
2. Execute os testes de validação
3. Consulte este documento para referência
4. Verifique as métricas de qualidade no output do webhook

## Changelog

### v1.0.0 (2024-11-03)

- ✨ Implementação inicial do sistema de enriquecimento
- ✨ Validadores de datas, valores monetários, CNPJ e texto
- ✨ Enriquecimento com dados externos (bancas conhecidas)
- ✨ Calculadora de estatísticas e inferências
- ✨ Integração no pipeline de webhooks
- ✨ Suite completa de testes unitários e de integração
- 📝 Documentação completa

