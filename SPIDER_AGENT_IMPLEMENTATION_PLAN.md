# 📋 Plano de Implementação: Spider Agent (Opção A - Cursor Rules)

> **Decisão**: Usar Cursor + .cursorrules + MCP Browser Tools
>
> **Data**: Dezembro 2025

---

## 🎯 Objetivo Final

Criar um sistema onde o Cursor, guiado por rules bem definidas, consiga:

1. Receber uma cidade + UF + URL via csv (cada uma das cidades do csv deverá ser tratada em paralelo)
2. Navegar até o site e analisar sua estrutura
3. Identificar se é uma plataforma conhecida ou nova
4. Criar/reutilizar o spider apropriado
5. Testar e validar com OCR result
6. Reportar sucesso ou erro

---

## 📁 Arquivos a Serem Criados

```
querido-diario-workers/
├── .cursor/
│   └── rules/
│       └── spider-agent.mdc          # Rules principais do Agent
├── src/
│   └── spiders/
│       └── knowledge/
│           ├── platforms.json         # Base de plataformas conhecidas
│           ├── signatures.json        # Assinaturas HTML por plataforma
│           └── templates/             # Templates de código
│               ├── spider-template.ts.hbs
│               └── config-template.json.hbs
└── scripts/
    └── spider-agent/
        ├── README.md                  # Como usar o agent
        └── cities-input.csv           # Exemplo de input
```

---

## 📝 Detalhamento dos Arquivos

### 1. `.cursor/rules/spider-agent.mdc`

Este é o coração do sistema. Deve conter:

#### Seção 1: Contexto e Objetivo

```
Descrição do que o agent faz
Quando deve ser ativado (trigger words)
Escopo de atuação
```

#### Seção 2: Base de Conhecimento

```
Referência ao platforms.json
Lista de spiderTypes existentes
Mapeamento URL pattern → spiderType
```

#### Seção 3: Fluxo de Identificação

```
Passo 1: Receber input (cidade, uf, url)
Passo 2: Buscar territoryId no IBGE
Passo 3: Navegar até a URL com browser_navigate
Passo 4: Capturar snapshot com browser_snapshot
Passo 5: Analisar DOM e comparar com signatures
Passo 6: Decidir: plataforma conhecida ou nova?
```

#### Seção 4: Fluxo de Criação (Plataforma Conhecida)

```
Se match com plataforma existente:
  - Gerar config JSON
  - Adicionar ao arquivo de estado (ex: sp.json)
  - Pular criação de código
```

#### Seção 5: Fluxo de Criação (Plataforma Nova)

```
Se não houver match:
  - Analisar estrutura do site
  - Identificar padrões de listagem de PDFs
  - Identificar mecanismo de navegação/paginação
  - Criar novo spider baseado em template
  - Atualizar registry, types, exports
  - Adicionar config ao JSON de estado
```

#### Seção 6: Fluxo de Teste

```
Executar /crawl com a nova cidade
Verificar se retorna gazettes
Validar OCR result
Reportar resultado
```

#### Seção 7: Tratamento de Erros

```
Se falhar em qualquer etapa:
  - Logar erro detalhado
  - Marcar como "needs_review"
  - Continuar com próxima cidade
```

---

### 2. `src/spiders/knowledge/platforms.json`

Estrutura proposta:

```json
{
  "version": "1.0",
  "lastUpdated": "2024-12-22",
  "platforms": [
    {
      "id": "identificador-unico",
      "name": "Nome Amigável",
      "spiderType": "tipo-no-registry",
      "urlPatterns": ["pattern1", "pattern2"],
      "domainPatterns": ["*.dominio.com.br"],
      "requiresBrowser": true|false,
      "configTemplate": { ... },
      "signatures": { ... }
    }
  ]
}
```

#### Plataformas a Mapear

Com base no codebase atual, identificar e documentar:

| #   | Plataforma                 | SpiderType                   | URL Patterns                                 | Prioridade |
| --- | -------------------------- | ---------------------------- | -------------------------------------------- | ---------- |
| 1   | Imprensa Oficial Municipal | `imprensaoficialmunicipal`   | `imprensaoficialmunicipal.com.br/*`          | Alta       |
| 2   | Instar/Joomla              | `instar`                     | `*/portal/diario-oficial`, `*/diariooficial` | Alta       |
| 3   | DOMunicipal                | `domunicipal`                | `domunicipal.com.br/*`                       | Alta       |
| 4   | KingDiario                 | `kingdiario`                 | `*diario-oficial-eletronico*`                | Alta       |
| 5   | DOEM                       | `doem`                       | `doem.org.br/*`                              | Média      |
| 6   | ADiarios V1/V2             | `adiarios_v1`, `adiarios_v2` | `adiarios.com.br/*`                          | Média      |
| 7   | EATOS                      | `eatos`                      | `publicacoesmunicipais.com.br/eatos/*`       | Média      |
| 8   | Barco Digital              | `barco_digital`              | `barcodigital.inf.br/*`                      | Média      |
| 9   | Siganet                    | `siganet`                    | Identificar                                  | Baixa      |
| 10  | Sigpub                     | `sigpub`                     | Identificar                                  | Baixa      |

**Tarefa**: Analisar todos os spiders em `src/spiders/base/` e extrair os URL patterns de cada um.

---

### 3. `src/spiders/knowledge/signatures.json`

Assinaturas HTML para identificação de plataformas:

```json
{
  "imprensaoficialmunicipal": {
    "requiredElements": ["#jornal", "#from", "#to", "#filtrodata"],
    "optionalElements": ["#Pagination"],
    "pdfLinkPatterns": ["exibe_do.php?i="],
    "textPatterns": ["Diário Oficial", "Original Eletrônico"]
  },
  "instar": {
    "requiredElements": [".dof_publicacao_diario"],
    "optionalElements": [".dof_download", ".sw_qtde_resultados"],
    "pdfLinkPatterns": ["/portal/download/"],
    "textPatterns": ["Edição nº"]
  }
}
```

**Uso**: Quando o agent captura um snapshot, ele compara os elementos presentes com essas assinaturas para determinar a plataforma.

---

## 🔄 Fluxo Detalhado de Execução

### Fase 1: Input e Preparação

```
┌─────────────────────────────────────────────────┐
│  INPUT                                          │
│  - Cidade: "Exemplo"                            │
│  - UF: "SP"                                     │
│  - URL: "https://exemplo.sp.gov.br/diario"      │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  BUSCAR TERRITORY ID                            │
│  - Consultar API IBGE ou base local             │
│  - Validar que cidade existe no estado          │
│  - Obter código de 7 dígitos                    │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  GERAR IDENTIFICADORES                          │
│  - id: "sp_exemplo"                             │
│  - name: "Exemplo - SP"                         │
│  - territoryId: "3512345"                       │
│  - stateCode: "SP"                              │
└─────────────────────────────────────────────────┘
```

### Fase 2: Análise do Site

```
┌─────────────────────────────────────────────────┐
│  NAVEGAR ATÉ O SITE                             │
│  browser_navigate(url)                          │
│  Aguardar carregamento completo                 │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  CAPTURAR SNAPSHOT                              │
│  browser_snapshot()                             │
│  Extrair: elementos, links, textos              │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  MATCH COM PLATAFORMA                           │
│  Para cada plataforma em platforms.json:        │
│    - Verificar URL patterns                     │
│    - Verificar elementos HTML                   │
│    - Calcular score de similaridade             │
│  Ordenar por score                              │
└─────────────────────────────────────────────────┘
                      │
                      ▼
           ┌─────────┴─────────┐
           │                   │
     Score >= 70%        Score < 70%
           │                   │
           ▼                   ▼
   ┌───────────────┐   ┌───────────────┐
   │ PLATAFORMA    │   │ PLATAFORMA    │
   │ CONHECIDA     │   │ NOVA          │
   └───────────────┘   └───────────────┘
```

### Fase 3A: Plataforma Conhecida

```
┌─────────────────────────────────────────────────┐
│  GERAR CONFIGURAÇÃO                             │
│  Usar configTemplate da plataforma              │
│  Substituir placeholders:                       │
│    - {url} → URL do input                       │
│    - {cidade} → nome da cidade                  │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  ATUALIZAR JSON DE ESTADO                       │
│  Ler: src/spiders/v2/configs/{uf}.json          │
│  Adicionar nova entrada                         │
│  Salvar arquivo                                 │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  TESTAR SPIDER                                  │
│  (Ver Fase 4)                                   │
└─────────────────────────────────────────────────┘
```

### Fase 3B: Plataforma Nova

```
┌─────────────────────────────────────────────────┐
│  ANALISAR ESTRUTURA DO SITE                     │
│  - Identificar listagem de PDFs                 │
│  - Identificar paginação/calendário             │
│  - Identificar filtros de data                  │
│  - Identificar padrão de URLs                   │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  DECISÃO: CRIAR OU ESCALAR?                     │
│  Se estrutura muito complexa:                   │
│    → Marcar como "needs_review"                 │
│    → Parar aqui                                 │
│  Se estrutura mapeável:                         │
│    → Continuar                                  │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  CRIAR NOVO SPIDER                              │
│  1. Gerar código em:                            │
│     src/spiders/base/prefeitura{cidade}.ts      │
│  2. Atualizar:                                  │
│     src/spiders/base/index.ts (export)          │
│  3. Atualizar:                                  │
│     src/types/spider-config.ts (type + config)  │
│  4. Atualizar:                                  │
│     src/spiders/registry.ts (case + import)     │
│  5. Atualizar:                                  │
│     src/spiders/registry-manager.ts (case)      │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  ATUALIZAR JSON DE ESTADO                       │
│  (Mesmo que Fase 3A)                            │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  TESTAR SPIDER                                  │
│  (Ver Fase 4)                                   │
└─────────────────────────────────────────────────┘
```

### Fase 4: Teste e Validação

```
┌─────────────────────────────────────────────────┐
│  EXECUTAR CRAWL                                 │
│  POST http://localhost:58765/crawl              │
│  {                                              │
│    "cities": ["{city_id}"],                     │
│    "version": "v2",                             │
│    "startDate": "{data_recente}"                │
│  }                                              │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  AGUARDAR RESPOSTA                              │
│  Timeout: 60 segundos (ajustável)               │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  VALIDAR RESULTADO                              │
│  Verificar:                                     │
│    - response.success === true                  │
│    - response.gazettes.length > 0               │
│    - Cada gazette tem fileUrl válida            │
│    - (Opcional) OCR result não vazio            │
└─────────────────────────────────────────────────┘
                      │
                      ▼
           ┌─────────┴─────────┐
           │                   │
       Sucesso              Falha
           │                   │
           ▼                   ▼
   ┌───────────────┐   ┌───────────────┐
   │ REPORTAR      │   │ REPORTAR      │
   │ SUCCESS       │   │ ERROR         │
   │ ✅            │   │ ❌            │
   └───────────────┘   └───────────────┘
```

---

## 📊 Critérios de Match (Scoring)

Como determinar se um site pertence a uma plataforma conhecida:

### Peso dos Critérios

| Critério       | Peso | Descrição                                 |
| -------------- | ---- | ----------------------------------------- |
| URL Pattern    | 30%  | Domínio/path match com padrões conhecidos |
| Elementos HTML | 40%  | Presença de classes/IDs específicos       |
| PDF Pattern    | 20%  | Padrão de URLs de download                |
| Text Pattern   | 10%  | Textos característicos na página          |

### Cálculo de Score

```
Score = (url_match * 0.30) +
        (html_match * 0.40) +
        (pdf_match * 0.20) +
        (text_match * 0.10)

Cada match individual é 0 ou 1 (ou proporcional se parcial)
```

### Thresholds

| Score  | Decisão                            |
| ------ | ---------------------------------- |
| >= 80% | Alta confiança, usar plataforma    |
| 70-79% | Média confiança, usar mas validar  |
| 50-69% | Baixa confiança, criar novo spider |
| < 50%  | Sem match, criar novo spider       |

---

## 🗂️ Arquivos a Atualizar (para novo spider)

Quando criar um novo spiderType, atualizar na seguinte ordem:

### 1. `src/types/spider-config.ts`

```typescript
// Adicionar ao union SpiderType
export type SpiderType =
  | ...existentes...
  | 'prefeituraexemplo';  // NOVO

// Adicionar interface de config
export interface PrefeituraExemploConfig {
  type: 'prefeituraexemplo';
  baseUrl: string;
}

// Adicionar ao union SpiderPlatformConfig
export type SpiderPlatformConfig =
  | ...existentes...
  | PrefeituraExemploConfig;  // NOVO
```

### 2. `src/spiders/base/prefeituraexemplo-spider.ts`

Criar arquivo com a implementação do spider.

### 3. `src/spiders/base/index.ts`

```typescript
export * from "./prefeituraexemplo-spider"; // NOVO
```

### 4. `src/spiders/registry.ts`

```typescript
// Adicionar import
import { PrefeituraExemploSpider } from './base/prefeituraexemplo-spider';

// Adicionar case no switch
case 'prefeituraexemplo':
  return new PrefeituraExemploSpider(config, dateRange);
```

### 5. `src/spiders/registry-manager.ts`

```typescript
// Adicionar import
import { PrefeituraExemploSpider } from './base/prefeituraexemplo-spider';

// Adicionar case no switch
case 'prefeituraexemplo':
  return new PrefeituraExemploSpider(config, dateRange);
```

### 6. `src/spiders/v2/configs/{uf}.json`

```json
{
  "id": "sp_exemplo",
  "name": "Exemplo - SP",
  "territoryId": "3512345",
  "stateCode": "SP",
  "active": true,
  "spiders": [
    {
      "spiderType": "prefeituraexemplo",
      "priority": 1,
      "active": true,
      "gazetteScope": "city",
      "config": {
        "type": "prefeituraexemplo",
        "baseUrl": "https://exemplo.sp.gov.br/diario"
      }
    }
  ]
}
```

---

## ✅ Checklist de Implementação

### Fase 1: Preparação (Dia 1)

- [ ] Analisar todos os spiders existentes em `src/spiders/base/`
- [ ] Identificar URL patterns de cada plataforma
- [ ] Identificar assinaturas HTML de cada plataforma
- [ ] Criar estrutura inicial de `platforms.json`
- [ ] Criar estrutura inicial de `signatures.json`

### Fase 2: Rules do Agent (Dia 2)

- [ ] Criar `.cursor/rules/spider-agent.mdc`
- [ ] Definir triggers e contexto
- [ ] Documentar fluxo de identificação
- [ ] Documentar fluxo de criação
- [ ] Documentar fluxo de teste

### Fase 3: Templates (Dia 3)

- [ ] Criar template de spider TypeScript
- [ ] Criar template de config JSON
- [ ] Documentar placeholders e substituições
- [ ] Testar templates manualmente

### Fase 4: Validação (Dia 4-5)

- [ ] Testar agent com 3 cidades conhecidas (devem usar plataforma existente)
- [ ] Testar agent com 2 cidades novas (devem criar novo spider)
- [ ] Ajustar rules baseado nos resultados
- [ ] Documentar edge cases encontrados

---

## ❓ Decisões Pendentes

Antes de começar a implementação, precisamos definir:

### 1. Sobre o endpoint `/crawl`

- [ ] Qual host/porta usar? (localhost:58765?) -> cada vez que rodar o projeto terá um host diferente
- [ ] O servidor precisa estar rodando antes? -> sim
- [ ] Como iniciar o servidor automaticamente? -> `bun run goodfellow:dev`

### 2. Sobre validação de OCR

- [ ] Apenas verificar se crawl retorna gazettes? -> não precisamos abrir o ocr result e verificar se tem um diario oficial válido
- [ ] Ou precisamos verificar OCR result separadamente? -> vide resposta acima
- [ ] Qual endpoint retorna OCR result? -> nos logs do `/crawl` terá um link com o ocr result

### 3. Sobre múltiplos estados

- [x] Começar apenas com SP?

---

## 🎬 Próximo Passo

Criar um novo arquivo PLAN_V2.md para ajustar com as decisões pendentes
