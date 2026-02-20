# 📋 Spider Agent - Plano de Implementação V2

> **Versão**: 2.0  
> **Data**: Dezembro 2025  
> **Decisão**: Cursor + .cursorrules + MCP Browser Tools  
> **Estado inicial**: SP

---

## ✅ Decisões Consolidadas

| Aspecto             | Decisão Final                                      |
| ------------------- | -------------------------------------------------- |
| **Input**           | CSV com múltiplas cidades, processadas em paralelo |
| **Servidor**        | `bun run goodfellow:dev` (host dinâmico)           |
| **Validação**       | Apenas verificar se `/crawl` retorna gazettes      |
| **OCR Result**      | Link aparece nos logs do `/crawl`                  |
| **Estado**          | Começar apenas com SP                              |
| **Plataforma nova** | Se score < 70%, marca como "needs_review"          |

---

## 🏗️ Arquitetura Final

```
┌──────────────────────────────────────────────────────────────────┐
│                         CURSOR IDE                                │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  .cursor/rules/spider-agent.mdc                             │ │
│  │                                                             │ │
│  │  Instruções para o Agent:                                   │ │
│  │  • Ler CSV de input                                         │ │
│  │  • Para cada cidade (em paralelo):                          │ │
│  │    - Navegar até URL                                        │ │
│  │    - Identificar plataforma                                 │ │
│  │    - Criar config ou spider                                 │ │
│  │    - Testar via /crawl                                      │ │
│  │  • Gerar relatório final                                    │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                              │                                    │
│              ┌───────────────┼───────────────┐                   │
│              ▼               ▼               ▼                   │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐        │
│  │ MCP Browser   │  │ File System   │  │ Terminal      │        │
│  │ - navigate    │  │ - read/write  │  │ - bun run     │        │
│  │ - snapshot    │  │ - JSON edit   │  │ - curl        │        │
│  │ - click       │  │ - TS edit     │  │               │        │
│  └───────────────┘  └───────────────┘  └───────────────┘        │
└──────────────────────────────────────────────────────────────────┘
```

---

## 📁 Estrutura de Arquivos

```
querido-diario-workers/
├── .cursor/
│   └── rules/
│       └── spider-agent.mdc              # ⭐ Rules do Agent
│
├── src/spiders/knowledge/
│   ├── platforms.json                     # Base de plataformas conhecidas
│   └── sp-cities-pending.csv              # Cidades SP a processar
│
└── scripts/spider-agent/
    ├── README.md                          # Instruções de uso
    ├── input-example.csv                  # Exemplo de CSV
    └── reports/                           # Relatórios gerados
        └── {timestamp}-report.json
```

---

## 📄 Formato do CSV de Input

```csv
cidade,uf,url
Araraquara,SP,https://www.araraquara.sp.gov.br/diariooficial
Bebedouro,SP,https://www.bebedouro.sp.gov.br/portal/diario-oficial
Campinas,SP,https://diario.campinas.sp.gov.br
```

**Campos obrigatórios:**

- `cidade`: Nome da cidade (usado para gerar ID e buscar no IBGE)
- `uf`: Sigla do estado (usado para determinar qual JSON atualizar)
- `url`: URL da página de diários oficiais

---

## 🔄 Fluxo de Execução (Revisado)

### Passo 0: Preparação

```
┌─────────────────────────────────────────────────────────────────┐
│  INICIAR SERVIDOR                                               │
│                                                                 │
│  Terminal: bun run goodfellow:dev                               │
│                                                                 │
│  Aguardar mensagem: "Server running on http://localhost:XXXXX"  │
│  Capturar a porta dinâmica para uso posterior                   │
└─────────────────────────────────────────────────────────────────┘
```

### Passo 1: Ler CSV e Preparar Batch

```
┌─────────────────────────────────────────────────────────────────┐
│  LER CSV DE INPUT                                               │
│                                                                 │
│  - Validar formato (cidade, uf, url)                            │
│  - Filtrar apenas UF = "SP" (por enquanto)                      │
│  - Criar lista de tarefas                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PARA CADA CIDADE (processar em paralelo quando possível):      │
│                                                                 │
│  1. Buscar territoryId no IBGE                                  │
│  2. Gerar identificadores (id, name, stateCode)                 │
│  3. Verificar se já existe em sp.json                           │
│  4. Se não existe, continuar processamento                      │
└─────────────────────────────────────────────────────────────────┘
```

### Passo 2: Identificar Plataforma

```
┌─────────────────────────────────────────────────────────────────┐
│  NAVEGAR E ANALISAR                                             │
│                                                                 │
│  browser_navigate(url)                                          │
│  browser_snapshot()                                             │
│                                                                 │
│  Extrair:                                                       │
│  - Elementos do DOM (classes, IDs)                              │
│  - Links para PDFs                                              │
│  - Formulários de filtro                                        │
│  - Padrões de paginação                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  COMPARAR COM PLATAFORMAS CONHECIDAS                            │
│                                                                 │
│  Verificar URL patterns:                                        │
│  - imprensaoficialmunicipal.com.br → imprensaoficialmunicipal   │
│  - */portal/diario-oficial → instar                             │
│  - domunicipal.com.br → domunicipal                             │
│  - *diario-oficial-eletronico* → kingdiario                     │
│  - publicacoesmunicipais.com.br/eatos → eatos                   │
│                                                                 │
│  Verificar elementos HTML característicos                       │
│  Calcular score de similaridade                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              ┌───────────────┴───────────────┐
              │                               │
        Score >= 70%                    Score < 70%
              │                               │
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────┐
│  PLATAFORMA CONHECIDA   │     │  NEEDS_REVIEW           │
│                         │     │                         │
│  Adicionar config ao    │     │  Marcar para revisão    │
│  sp.json usando         │     │  humana                 │
│  template existente     │     │                         │
└─────────────────────────┘     └─────────────────────────┘
```

### Passo 3: Criar Configuração (Plataforma Conhecida)

```
┌─────────────────────────────────────────────────────────────────┐
│  GERAR CONFIG JSON                                              │
│                                                                 │
│  Template baseado na plataforma identificada:                   │
│                                                                 │
│  {                                                              │
│    "id": "sp_{cidade_slug}",                                    │
│    "name": "{Cidade} - SP",                                     │
│    "territoryId": "{codigo_ibge}",                              │
│    "stateCode": "SP",                                           │
│    "active": true,                                              │
│    "spiders": [{                                                │
│      "spiderType": "{tipo_identificado}",                       │
│      "priority": 1,                                             │
│      "active": true,                                            │
│      "gazetteScope": "city",                                    │
│      "config": {                                                │
│        "type": "{tipo_identificado}",                           │
│        "baseUrl": "{url_input}",                                │
│        "requiresClientRendering": true                          │
│      }                                                          │
│    }]                                                           │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  ADICIONAR AO sp.json                                           │
│                                                                 │
│  - Ler src/spiders/v2/configs/sp.json                           │
│  - Verificar se ID já existe (evitar duplicatas)                │
│  - Adicionar nova entrada ao array                              │
│  - Salvar arquivo formatado                                     │
└─────────────────────────────────────────────────────────────────┘
```

### Passo 4: Testar Spider

```
┌─────────────────────────────────────────────────────────────────┐
│  EXECUTAR TESTE                                                 │
│                                                                 │
│  curl --location 'http://localhost:{PORT}/crawl' \              │
│  --header 'Content-Type: application/json' \                    │
│  --data '{                                                      │
│      "cities": ["{city_id}"],                                   │
│      "version": "v2",                                           │
│      "startDate": "{data_7_dias_atras}"                         │
│  }'                                                             │
│                                                                 │
│  Aguardar resposta (timeout: 120s)                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  VALIDAR RESULTADO                                              │
│                                                                 │
│  ✅ SUCESSO se:                                                 │
│     - response.success === true                                 │
│     - response.gazettes.length > 0                              │
│     - Cada gazette tem fileUrl válida                           │
│                                                                 │
│  ❌ FALHA se:                                                   │
│     - Timeout                                                   │
│     - success === false                                         │
│     - gazettes vazio                                            │
│     - Erros no log                                              │
│                                                                 │
│  📋 Nos logs, haverá link para OCR result (para debug)          │
└─────────────────────────────────────────────────────────────────┘
```

### Passo 5: Gerar Relatório

```
┌─────────────────────────────────────────────────────────────────┐
│  CONSOLIDAR RESULTADOS                                          │
│                                                                 │
│  {                                                              │
│    "timestamp": "2025-12-23T10:00:00Z",                         │
│    "total": 10,                                                 │
│    "success": 7,                                                │
│    "failed": 1,                                                 │
│    "needs_review": 2,                                           │
│    "results": [                                                 │
│      {                                                          │
│        "cidade": "Araraquara",                                  │
│        "status": "success",                                     │
│        "spiderType": "instar",                                  │
│        "gazettesFound": 5                                       │
│      },                                                         │
│      {                                                          │
│        "cidade": "Exemplo",                                     │
│        "status": "needs_review",                                │
│        "reason": "Plataforma não identificada (score: 45%)"     │
│      }                                                          │
│    ]                                                            │
│  }                                                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🗃️ Base de Plataformas Conhecidas

### Mapeamento URL → SpiderType

| URL Pattern                            | SpiderType                 | Config Template              |
| -------------------------------------- | -------------------------- | ---------------------------- |
| `imprensaoficialmunicipal.com.br/*`    | `imprensaoficialmunicipal` | `{ type, baseUrl }`          |
| `*/portal/diario-oficial`              | `instar`                   | `{ type, url }`              |
| `*/diariooficial` (em gov.br)          | `instar`                   | `{ type, url }`              |
| `domunicipal.com.br/*`                 | `domunicipal`              | `{ type, baseUrl, orgaoId }` |
| `*diario-oficial-eletronico*`          | `kingdiario`               | `{ type, baseUrl }`          |
| `publicacoesmunicipais.com.br/eatos/*` | `eatos`                    | `{ type, baseUrl }`          |
| `doem.org.br/*`                        | `doem`                     | `{ type, stateCityUrlPart }` |

### Elementos HTML Característicos

| SpiderType                 | Elementos Required                        | Elementos Optional                     |
| -------------------------- | ----------------------------------------- | -------------------------------------- |
| `imprensaoficialmunicipal` | `#jornal`, `#from`, `#to`, `#filtrodata`  | `#Pagination`                          |
| `instar`                   | `.dof_publicacao_diario`                  | `.dof_download`, `.sw_qtde_resultados` |
| `kingdiario`               | `form[action*="pesquisar"]`, `.resultado` | `.paginacao`                           |
| `eatos`                    | `.v-calendar`, `.publicacao-item`         | `.pagination`                          |

---

## 📝 Conteúdo do .cursorrules

### Estrutura Proposta

```markdown
---
description: Agent para criação automatizada de spiders de diários oficiais
globs:
  - src/spiders/**
  - scripts/spider-agent/**
alwaysApply: false
---

# Spider Creation Agent

## Contexto

Você é um agent especializado em criar spiders para coleta de diários oficiais
de municípios brasileiros. Seu objetivo é analisar sites, identificar padrões
e criar as configurações necessárias.

## Trigger

Ative este agent quando o usuário mencionar:

- "criar spider"
- "adicionar cidade"
- "processar CSV de cidades"
- "spider agent"

## Conhecimento Base

[Incluir platforms.json inline ou referência]

## Fluxo de Trabalho

[Passos detalhados como documentado acima]

## Arquivos a Modificar

[Lista de arquivos e como modificar cada um]

## Validação

[Como testar e validar o spider criado]

## Tratamento de Erros

[O que fazer quando algo dá errado]
```

---
