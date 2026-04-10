# Sistema de Spiders V2

Sistema de configuração e execução de spiders por **território** (município), com suporte a múltiplos spiders por cidade e estratégias de fallback.

## Visão Geral

O V2 organiza spiders por **território** (município com código IBGE), ao invés de por plataforma como o V1. Cada território pode ter múltiplos spiders com prioridades, permitindo fallback automático quando uma fonte falha.

```
V2 Config (JSON por estado)
     │
     ▼
SpiderRegistryV2          Mapeia territoryId → spiders disponíveis
     │
     ▼
TerritoryExecutor         Executa spiders com a strategy escolhida
     │
     ▼
spiderRegistry (V1)       Cria instâncias dos spiders (base classes)
     │
     ▼
Gazettes                  Resultados deduplicados por fileUrl|date
```

O V2 **reutiliza as implementações de spiders do V1** — a diferença está na organização (por território, não por plataforma) e na execução (strategies de fallback/paralelo).

## Estrutura de Arquivos

```
v2/
├── configs/              # 27 JSONs, um por estado
│   ├── ac.json
│   ├── al.json
│   ├── am.json
│   ├── ap.json
│   ├── ba.json
│   ├── ce.json
│   ├── df.json
│   ├── es.json
│   ├── go.json
│   ├── ma.json
│   ├── mg.json
│   ├── ms.json
│   ├── mt.json
│   ├── pa.json
│   ├── pb.json
│   ├── pe.json
│   ├── pi.json
│   ├── pr.json
│   ├── rj.json
│   ├── rn.json
│   ├── ro.json
│   ├── rr.json
│   ├── rs.json
│   ├── sc.json
│   ├── se.json
│   ├── sp.json
│   └── to.json
├── base/                 # Spiders base V2-específicos
│   ├── base-spider.ts
│   ├── acre-spider.ts
│   ├── agape-spider.ts
│   ├── kalana-spider.ts
│   ├── sigpub-spider.ts
│   └── sigpub-ac.ts
├── registry.ts           # SpiderRegistryV2 — importa todos os configs
├── executor.ts           # TerritoryExecutor — strategies de execução
├── types.ts              # TerritoryConfigV2, SpiderDefinitionV2, ExecutionStrategy
└── README.md             # Este arquivo
```

## Formato de Configuração

Cada arquivo de estado (`configs/<uf>.json`) contém um array de territórios:

```json
[
  {
    "id": "ac_acrelandia",
    "name": "Acrelândia - AC",
    "territoryId": "1200013",
    "stateCode": "AC",
    "active": true,
    "spiders": [
      {
        "spiderType": "acre",
        "priority": 1,
        "active": true,
        "gazetteScope": "state",
        "aliases": ["ACRELÂNDIA"],
        "config": {
          "url": "http://www.diario.ac.gov.br",
          "territoryId": "1200013",
          "cityName": "Acrelândia"
        }
      },
      {
        "spiderType": "sigpub",
        "priority": 2,
        "active": true,
        "config": {
          "url": "https://www.sigpub.com.br",
          "territoryId": "1200013",
          "cityName": "Acrelândia"
        }
      }
    ]
  }
]
```

### Campos do território

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | string | Identificador único (`uf_nome_cidade`) |
| `name` | string | Nome legível (`Cidade - UF`) |
| `territoryId` | string | Código IBGE do município |
| `stateCode` | string | UF do estado |
| `active` | boolean | Se o território está ativo |
| `spiders` | array | Lista de spiders disponíveis |

### Campos do spider

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `spiderType` | string | Tipo da plataforma (`sigpub`, `doem`, `acre`, etc.) |
| `priority` | number | Prioridade de execução (menor = mais prioritário) |
| `active` | boolean | Se o spider está ativo |
| `gazetteScope` | string? | `"city"` (padrão) ou `"state"` |
| `aliases` | string[]? | Nomes alternativos para filtro em diários estaduais |
| `startDate` | string? | Data mais antiga disponível (ISO) |
| `config` | object | Configuração específica da plataforma |

## Estratégias de Execução

O `TerritoryExecutor` suporta duas estratégias:

### `priority-fallback` (padrão recomendado)

Executa spiders em ordem de prioridade. Para no primeiro que retornar gazetas:

1. Tenta spider com `priority: 1`
2. Se encontrou gazetas → para (sucesso)
3. Se não encontrou ou falhou → tenta `priority: 2`
4. Repete até encontrar ou esgotar spiders

Ideal para: cidades com uma fonte principal confiável e fallbacks.

### `all-parallel`

Executa todos os spiders simultaneamente via `Promise.allSettled` e combina os resultados.

Ideal para: cidades onde cada spider pode trazer gazetas diferentes (escopo complementar).

Em ambas as estratégias, o executor **deduplica** gazetas pelo par `fileUrl|date`.

## Como Testar

### Testar uma cidade

```bash
bun run test:city <city-id>

# Exemplos:
bun run test:city ba_acajutiba
bun run test:city am_1300144
bun run test:city rj_itatiaia 2025-02-20 2025-02-25   # com datas
```

O que faz:
- Cria o spider para a cidade
- Executa o crawl
- Valida os resultados (URLs, datas, metadados)
- Gera relatório no console + JSON em `./test-results/`
- Exit code 0 = 100% de sucesso

### Testar uma plataforma inteira

```bash
bun run test:platform <plataforma>

# Exemplos:
bun run test:platform doem
bun run test:platform sigpub
bun run test:platform instar
```

O que faz:
- Testa todas as cidades configuradas para aquela plataforma
- Gera relatórios em `./test-results/platform-<nome>-<timestamp>.json` e `.html`
- Exit code 0 = taxa de sucesso >= 90%

### Suite automatizada

```bash
# Amostra (padrão) — rápido
bun run test:automated

# Amostra com configuração
bun run test:automated:sample

# Suite completa — todas as cidades
bun run test:automated:full

# Executa até atingir N cidades testadas
bun run test:automated:until
```

Flags opcionais:
- `--workers <n>` — paralelismo
- `--days <n>` — dias de range
- `--sample <n>` — tamanho da amostra
- `--target <n>` — target para modo `until`
- `--verbose` — logs detalhados

Gera relatórios em JSON, HTML e Markdown com análise de tendências.

### Pipeline local completo (crawl → OCR → analysis → webhook)

```bash
bun run test:local -- --city <id>

# Exemplos:
bun run test:local -- --city am_1300144
bun run test:local -- --city am_1300144,sp_3550308   # múltiplas cidades
bun run test:local -- --city am_1300144 --enable-ocr  # com OCR real (Mistral)
bun run test:local -- --city am_1300144 --real-webhook # com webhook real
```

Flags:
- `--city <ids>` — cidades (separadas por vírgula)
- `--enable-ocr` — usa Mistral OCR real (requer `MISTRAL_API_KEY`)
- `--disable-analysis` — pula análise
- `--disable-webhook` — pula webhook
- `--real-webhook` — entrega webhook real (não mock)
- `--start-date`, `--end-date` — datas específicas
- `--port <n>` — porta do servidor local (padrão: 3001)

Sobe um servidor Hono local e simula todo o pipeline sem usar filas do Cloudflare.

### Teste V2 end-to-end com OCR

```bash
bun run test:v2-ocr -- --cities <ids>

# Exemplos:
bun run test:v2-ocr -- --cities ac_rio_branco
bun run test:v2-ocr -- --cities ac_rio_branco --days 5
```

Flags:
- `--cities <ids>` — cidades (separadas por vírgula)
- `--days <n>` — janela de dias para trás (padrão: 10)
- `--api-url <url>` — URL da API
- `--db-path <path>` — caminho do SQLite D1 local
- `--timeout <min>` — timeout em minutos
- `--output <path>` — salvar resultado em JSON

Faz POST para `/crawl` com `version: 'v2'`, depois fica polling o D1 local para validar que `gazette_registry` e `ocr_results` foram preenchidos corretamente.

## Como Adicionar uma Cidade

1. Identifique o **estado** e o **código IBGE** do município
2. Identifique qual **plataforma** publica o diário (ex: sigpub, doem, instar)
3. Edite o JSON do estado em `configs/<uf>.json`
4. Adicione um objeto de território com os spiders configurados:

```json
{
  "id": "rj_niteroi",
  "name": "Niterói - RJ",
  "territoryId": "3303302",
  "stateCode": "RJ",
  "active": true,
  "spiders": [
    {
      "spiderType": "sigpub",
      "priority": 1,
      "active": true,
      "config": {
        "url": "https://www.sigpub.com.br",
        "territoryId": "3303302",
        "cityName": "Niterói"
      }
    }
  ]
}
```

5. Atualize `registry.ts` se for um estado novo (adicione o import)
6. Teste:

```bash
bun run test:city rj_niteroi
```

## Como Adicionar um Estado Novo

1. Crie `configs/<uf>.json` com o array de territórios
2. Em `registry.ts`, adicione o import:

```typescript
import ufConfigs from './configs/uf.json';
```

3. Adicione ao `STATE_CONFIGS`:

```typescript
const STATE_CONFIGS = {
  // ... estados existentes
  'UF': ufConfigs,
} as const;
```

4. Teste com uma cidade do estado:

```bash
bun run test:city uf_nome_cidade
```

## Operações Remotas

Para interagir com o worker em produção:

```bash
# Crawl hoje/ontem
bun run remote:crawl today-yesterday
bun run remote:crawl today-yesterday --platform=sigpub

# Crawl cidades específicas
bun run remote:crawl cities am_1302603 ba_2927408

# Verificar status
bun run remote:crawl stats
bun run remote:crawl health
```

O script faz requests HTTP direto para `https://goodfellow-prod.qconcursos.workers.dev`.

## V1 vs V2

| Aspecto | V1 | V2 |
|---------|----|----|
| Organização | Por plataforma (`sigpub-cities.json`) | Por território (`sp.json`, `ba.json`) |
| Configs | 26 arquivos por tipo de spider | 27 arquivos por estado |
| Multi-spider | Não suporta | Sim, com prioridade e fallback |
| Estratégias | Execução única | `priority-fallback` e `all-parallel` |
| Implementações | ~410 classes em `base/` | Reutiliza V1 via `spiderRegistry.createSpider()` |
| Deduplicação | Não | Sim, por `fileUrl\|date` |

Ambos os sistemas coexistem. O V2 registry chama o V1 `spiderRegistry.createSpider()` para criar as instâncias reais dos spiders.
