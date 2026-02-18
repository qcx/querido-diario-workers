# 🏗️ Proposta de Implementação: Spider Automation Agent

> Baseado nas respostas do arquivo `SPIDER_AUTOMATION_AGENT_DISCUSSION.md`

---

## 📊 Resumo das Decisões

| Aspecto              | Decisão                                 |
| -------------------- | --------------------------------------- |
| **Trigger**          | Manual (CSV como input)                 |
| **Execução**         | Automática, em batch                    |
| **Similaridade**     | HTML, URLs de PDFs, elementos da página |
| **Sem match**        | Notificar humano                        |
| **Teste de sucesso** | OCR result válido                       |
| **Foco**             | Diário municipal (não DOSP)             |
| **Navegação**        | Browser necessário                      |

---

## 🎯 Arquitetura Proposta

### Opção A: Cursor Agent Rules + MCP (Recomendada)

Dado que você mencionou que o Cursor tem funcionalidades de navegação, a forma mais pragmática seria:

```
┌─────────────────────────────────────────────────────────────┐
│                    CURSOR IDE                                │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  .cursorrules (Agent Instructions)                      │ │
│  │  - Como identificar plataformas                         │ │
│  │  - Como criar spiders                                   │ │
│  │  - Como testar                                          │ │
│  └─────────────────────────────────────────────────────────┘ │
│                           │                                  │
│                           ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  MCP Browser Tools                                      │ │
│  │  - browser_navigate                                     │ │
│  │  - browser_snapshot                                     │ │
│  │  - browser_click                                        │ │
│  └─────────────────────────────────────────────────────────┘ │
│                           │                                  │
│                           ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  Script de Orquestração (TypeScript)                    │ │
│  │  - Lê CSV de input                                      │ │
│  │  - Chama endpoint /crawl                                │ │
│  │  - Valida OCR result                                    │ │
│  │  - Gera relatório                                       │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Prós:**

- Já funciona hoje (você já faz "um a um" no Cursor)
- Browser tools do MCP disponíveis
- Não precisa de infra nova
- Pode iterar rapidamente

**Contras:**

- Não é 100% headless/automático
- Depende do Cursor aberto

---

### Opção B: Script TypeScript + Playwright

```
┌─────────────────────────────────────────────────────────────┐
│  scripts/spider-agent.ts                                     │
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
│  │ CSV Parser  │───▶│  Analyzer   │───▶│  Generator  │      │
│  └─────────────┘    └─────────────┘    └─────────────┘      │
│        │                   │                  │              │
│        ▼                   ▼                  ▼              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
│  │ Input:      │    │ Playwright  │    │ Code Gen:   │      │
│  │ - cidade    │    │ Browser     │    │ - spider.ts │      │
│  │ - uf        │    │ - snapshot  │    │ - registry  │      │
│  │ - url       │    │ - navigate  │    │ - types     │      │
│  └─────────────┘    │ - extract   │    │ - json      │      │
│                     └─────────────┘    └─────────────┘      │
│                                               │              │
│                                               ▼              │
│                                        ┌─────────────┐      │
│                                        │  Tester     │      │
│                                        │ - /crawl    │      │
│                                        │ - OCR check │      │
│                                        └─────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

**Prós:**

- Totalmente automático e headless
- Pode rodar em CI/CD
- Reproduzível

**Contras:**

- Precisa de LLM para gerar código (OpenAI API)
- Mais complexo de implementar
- Playwright não roda no Workers (precisa de servidor)

---

### Opção C: n8n + AI Agent

```
n8n Workflow:
┌────────────────────────────────────────────────────────────┐
│                                                            │
│  [CSV File] ──▶ [Split Rows] ──▶ [AI Agent Node]          │
│                                        │                   │
│                                        ▼                   │
│                              ┌─────────────────┐          │
│                              │  Tools:         │          │
│                              │  - Browse URL   │          │
│                              │  - Match Spider │          │
│                              │  - Generate Code│          │
│                              │  - Test Crawl   │          │
│                              └─────────────────┘          │
│                                        │                   │
│                                        ▼                   │
│  [Success Report] ◀── [Merge Results] ◀─┘                 │
│  [Error Report]   ◀──────────────────────                 │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

**Prós:**

- Interface visual para workflows
- Fácil de debugar e modificar
- Integrações prontas

**Contras:**

- Precisa hospedar n8n
- Browser automation no n8n é limitado
- Curva de aprendizado

---

## 💡 Minha Recomendação

### Fase 1: MVP com Cursor + .cursorrules (1-2 dias)

Criar um arquivo `.cursorrules` bem detalhado que ensine o Cursor a:

1. **Identificar plataformas** por URL patterns
2. **Navegar e analisar** sites usando MCP browser
3. **Gerar código** de spider seguindo templates
4. **Atualizar** todos os arquivos necessários
5. **Testar** via endpoint `/crawl`

**Entregáveis:**

- `.cursorrules` com instruções detalhadas
- `scripts/spider-batch-runner.ts` para processar CSV
- Base de conhecimento de plataformas em JSON

### Fase 2: Automação com Script (1 semana)

Se a Fase 1 funcionar bem, migrar a lógica para um script:

1. Usar **Playwright** para navegação
2. Usar **OpenAI/Claude API** para análise e geração de código
3. Rodar em **GitHub Actions** ou similar

---

## 📁 Arquivos a Criar

### 1. `.cursorrules` (ou `.cursor/rules/spider-agent.mdc`)

```markdown
# Spider Creation Agent Rules

## Objetivo

Quando o usuário pedir para criar um spider para uma cidade, siga este fluxo:

## Passo 1: Identificar Plataforma

Navegue até a URL fornecida e verifique se é uma plataforma conhecida:

| URL Pattern                            | Spider Type              | Ação                    |
| -------------------------------------- | ------------------------ | ----------------------- |
| imprensaoficialmunicipal.com.br/\*     | imprensaoficialmunicipal | Apenas adicionar config |
| \*.gov.br/portal/diario-oficial        | instar                   | Apenas adicionar config |
| domunicipal.com.br/\*                  | domunicipal              | Apenas adicionar config |
| _diario-oficial-eletronico_ (KingPage) | kingdiario               | Apenas adicionar config |

## Passo 2: Se não for plataforma conhecida

Analise a estrutura do site:

- Identifique como os PDFs são listados
- Identifique se há paginação ou calendário
- Identifique o padrão de URLs dos PDFs
  ...
```

### 2. `src/spiders/knowledge/platforms.json`

```json
{
  "platforms": [
    {
      "id": "imprensaoficialmunicipal",
      "name": "Imprensa Oficial Municipal",
      "urlPatterns": [
        "imprensaoficialmunicipal.com.br/*",
        "www.imprensaoficialmunicipal.com.br/*"
      ],
      "spiderType": "imprensaoficialmunicipal",
      "configTemplate": {
        "type": "imprensaoficialmunicipal",
        "baseUrl": "{url}"
      },
      "signatures": {
        "htmlElements": ["#jornal", "#from", "#to", "#filtrodata"],
        "pdfPattern": "exibe_do.php?i="
      }
    },
    {
      "id": "instar",
      "name": "Instar/Joomla",
      "urlPatterns": ["*.gov.br/portal/diario-oficial", "*/diariooficial"],
      "spiderType": "instar",
      "configTemplate": {
        "type": "instar",
        "url": "{url}"
      },
      "signatures": {
        "htmlElements": [".dof_publicacao_diario", ".dof_download"],
        "pdfPattern": "/portal/download/"
      }
    }
  ]
}
```

### 3. `scripts/spider-batch-runner.ts`

```typescript
/**
 * Script para processar CSV e criar spiders em batch
 *
 * Uso: bun run scripts/spider-batch-runner.ts --input cities.csv
 *
 * CSV Format:
 * cidade,uf,url
 * Bauru,SP,https://www2.bauru.sp.gov.br/juridico/diariooficial.aspx
 */

import { parse } from "csv-parse/sync";
import { readFileSync, writeFileSync } from "fs";

interface CityInput {
  cidade: string;
  uf: string;
  url: string;
}

interface ProcessResult {
  cidade: string;
  status: "success" | "error" | "needs_review";
  spiderType?: string;
  message: string;
}

async function processCities(csvPath: string): Promise<ProcessResult[]> {
  const csv = readFileSync(csvPath, "utf-8");
  const cities: CityInput[] = parse(csv, { columns: true });

  const results: ProcessResult[] = [];

  for (const city of cities) {
    console.log(`\n🔍 Processando: ${city.cidade} - ${city.uf}`);
    console.log(`   URL: ${city.url}`);

    // TODO: Integrar com Cursor Agent ou chamar diretamente
    // Por enquanto, apenas logamos para o usuário processar manualmente

    results.push({
      cidade: city.cidade,
      status: "needs_review",
      message: `Aguardando processamento manual no Cursor`,
    });
  }

  return results;
}

// Gerar relatório
function generateReport(results: ProcessResult[]): void {
  const success = results.filter((r) => r.status === "success");
  const errors = results.filter((r) => r.status === "error");
  const review = results.filter((r) => r.status === "needs_review");

  console.log("\n📊 RELATÓRIO");
  console.log("=".repeat(50));
  console.log(`✅ Sucesso: ${success.length}`);
  console.log(`❌ Erros: ${errors.length}`);
  console.log(`👀 Revisão manual: ${review.length}`);

  if (errors.length > 0) {
    console.log("\n❌ Cidades com erro:");
    errors.forEach((e) => console.log(`   - ${e.cidade}: ${e.message}`));
  }
}
```

### 4. `scripts/test-spider.ts`

```typescript
/**
 * Testa um spider específico e valida OCR result
 */

async function testSpider(cityId: string, startDate: string): Promise<boolean> {
  const response = await fetch("http://localhost:58765/crawl", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cities: [cityId],
      version: "v2",
      startDate,
    }),
  });

  const result = await response.json();

  // Verificar se houve OCR result válido
  // TODO: Definir critérios de validação

  return result.success && result.gazettes?.length > 0;
}
```

---

## 🚀 Plano de Implementação

### Semana 1: Foundation

| Dia | Tarefa                                                     |
| --- | ---------------------------------------------------------- |
| 1   | Criar `platforms.json` com todas as plataformas conhecidas |
| 2   | Criar `.cursorrules` com instruções para o Agent           |
| 3   | Criar `spider-batch-runner.ts` básico                      |
| 4   | Testar fluxo manual com 3 cidades                          |
| 5   | Iterar e ajustar rules                                     |

### Semana 2: Automação

| Dia | Tarefa                                      |
| --- | ------------------------------------------- |
| 1-2 | Integrar Playwright para análise automática |
| 3-4 | Integrar LLM para geração de código         |
| 5   | Adicionar validação de OCR result           |

### Semana 3: Scale

| Dia | Tarefa                        |
| --- | ----------------------------- |
| 1-2 | Processar batch de 50 cidades |
| 3-4 | Refinar baseado nos erros     |
| 5   | Documentar e criar CI/CD      |

---

## ❓ Perguntas Pendentes

Antes de começar, preciso confirmar:

### 1. Sobre o OCR Result

**Como verificar se um OCR result é "válido"?**

Opções:

- [ ] Apenas verificar se existe (não vazio)
- [ ] Verificar se tem texto legível (mínimo de caracteres)
- [ ] Verificar se contém palavras-chave esperadas
- [ ] Outro: ******\_\_\_******

### 2. Sobre o CSV de Input

**Qual o formato exato do CSV?**

Exemplo que imagino:

```csv
cidade,uf,url
Bauru,SP,https://www2.bauru.sp.gov.br/juridico/diariooficial.aspx
Piracicaba,SP,https://diariooficial.piracicaba.sp.gov.br/
```

Está correto? Precisa de mais campos?

### 3. Sobre o Endpoint de Teste

**O endpoint `/crawl` está disponível localmente?**

Preciso entender:

- Ele retorna o OCR result diretamente?
- Ou preciso consultar outro endpoint depois?
- Qual o tempo médio de resposta?

### 4. Sobre Prioridade

**Por qual opção quer começar?**

- [ ] **Opção A**: Cursor Rules (mais rápido, semi-automático)
- [ ] **Opção B**: Script TypeScript (mais complexo, full automático)
- [ ] **Opção C**: n8n (visual, mas precisa setup)

---

## 📝 Próximo Passo

Responda as perguntas acima e eu:

1. Crio o `.cursorrules` se for Opção A
2. Ou começo o `spider-batch-runner.ts` se for Opção B
3. Ou desenho o workflow n8n se for Opção C

Qual caminho você prefere?
