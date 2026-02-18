# 🤖 Discussão: Agent para Automação de Criação de Spiders

## 📋 Resumo da Proposta

Você quer criar um **Agent** que, dado:

- **Nome da cidade**
- **Estado (UF)**
- **URL do diário oficial**

Seja capaz de:

1. **Identificar qual `spiderType` existente é mais similar** ao site fornecido
2. **Criar um novo `spiderType`** (se necessário) baseado no match
3. **Adicionar a configuração** no JSON do estado (ex: `sp.json`)

---

## 🔍 O que eu entendi do codebase

### Estrutura atual

```
src/spiders/
├── base/                    # 50+ implementações de spiders
│   ├── base-spider.ts       # Classe abstrata base
│   ├── instar-spider.ts     # Plataforma Instar (usada por muitos municípios)
│   ├── dosp-spider.ts       # Diário Oficial SP (via API)
│   ├── imprensaoficialmunicipal-spider.ts  # Plataforma IOM
│   ├── kingdiario-spider.ts # Plataforma KingDiario
│   ├── prefeitura*.ts       # Spiders customizados por prefeitura
│   └── ...
├── v2/
│   └── configs/
│       └── sp.json          # Configurações dos municípios de SP
└── registry.ts              # Registro e factory de spiders
```

### Tipos de Spiders (identificados até agora)

| Categoria                 | Exemplos                                                   | Características                                |
| ------------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| **Plataformas Genéricas** | `instar`, `doem`, `imprensaoficialmunicipal`, `kingdiario` | Mesma estrutura usada por múltiplos municípios |
| **APIs Estaduais**        | `dosp`, `diof`, `dom_sc`                                   | Acesso via API para diários estaduais          |
| **Customizados**          | `prefeituraguarulhos`, `prefeiturapiracicaba`              | Implementação específica para um site          |

---

## ❓ Perguntas Exploratórias

### 1. Sobre o Input do Agent

**Q1.1:** A URL fornecida será sempre a página principal onde listam os diários, ou pode ser qualquer página do site?

**Q1.2:** O Agent deve funcionar 100% automatizado ou haverá etapas de aprovação humana? Por exemplo:

- [ ] Automático: analisa e já cria o spider
- [ ] Semi-automático: sugere matches e aguarda aprovação
- [ ] Híbrido: automatiza o que for seguro, pergunta o que for incerto

**Q1.3:** Qual o **território ID (IBGE)** da cidade? O agent deve consultar alguma API para obter isso ou será fornecido junto com o input?

---

### 2. Sobre a Identificação de Similaridade

**Q2.1:** Quais critérios você considera importantes para determinar se um site é "similar" a um spider existente?

Exemplos que pensei:

- [ ] Domínio/subdomain (ex: `*.imprensaoficialmunicipal.com.br`)
- [ ] Estrutura HTML (classes CSS, IDs, estrutura DOM)
- [ ] Padrão de URL para download de PDFs
- [ ] Tecnologia detectada (ASP.NET, WordPress, Vue.js, etc)
- [ ] Presença de elementos específicos (formulários, calendários, paginação)

**Q2.2:** Se nenhum spider existente tiver >70% de similaridade, o que fazer?

- [ ] Criar spider totalmente novo
- [ ] Notificar humano para análise manual
- [ ] Usar um spider genérico como fallback

---

### 3. Sobre a Criação do Spider

**Q3.1:** Quando um novo `spiderType` precisa ser criado, o Agent deve:

- [ ] Apenas gerar o código e salvar em arquivo
- [ ] Também atualizar o `registry.ts` automaticamente
- [ ] Também atualizar `src/types/spider-config.ts` (SpiderType union + interface)
- [ ] Também atualizar `src/spiders/base/index.ts` (exports)

**Q3.2:** Como o Agent deve testar se o spider criado funciona?

- [ ] Executar um crawl de teste com data range pequeno
- [ ] Apenas verificar sintaxe TypeScript (tsc)
- [ ] Simular requests e validar parsing do HTML
- [ ] Nenhum teste automático (deixar para humano)

---

### 4. Sobre a Configuração no JSON

**Q4.1:** Olhando o `sp.json`, vejo que muitos municípios têm **2 spiders** (DOSP como priority 1 + outro como priority 2). Qual a lógica?

Minha hipótese:

- DOSP = diário estadual (publicações no DO de SP)
- Segundo spider = diário municipal próprio

Está correto? O Agent deve seguir esse padrão automaticamente para SP?

**Q4.2:** Quais campos devem ser calculados automaticamente vs fornecidos como input?

| Campo         | Automático? | Como calcular?                       |
| ------------- | ----------- | ------------------------------------ |
| `id`          | ✅          | `{uf}_{nome_cidade_slug}`            |
| `name`        | ✅          | `{Cidade} - {UF}`                    |
| `territoryId` | ❓          | API IBGE ou input?                   |
| `stateCode`   | ✅          | Extrair do input UF                  |
| `active`      | ❓          | Sempre `true` ou `false` até testar? |

---

### 5. Sobre Plataformas Conhecidas

**Q5.1:** Existem plataformas que você já sabe que são reutilizáveis? Por exemplo:

Detectei estes patterns que parecem ser plataformas:

1. `imprensaoficialmunicipal.com.br` → spider `imprensaoficialmunicipal`
2. `*.sp.gov.br/portal/diario-oficial` → spider `instar`
3. `domunicipal.com.br` → spider `domunicipal`
4. `diario-oficial-eletronico` em KingPage → spider `kingdiario`

**Você tem uma lista completa de plataformas conhecidas e seus URLs patterns?**

---

### 6. Sobre o Fluxo do Agent

**Q6.1:** Qual ferramenta/framework você imagina para o Agent?

- [ ] Script TypeScript puro (sem AI)
- [ ] LangChain / LangGraph
- [ ] Vercel AI SDK
- [ ] OpenAI Assistants
- [ ] Outro: **\*\***\_\_\_**\*\***

**Q6.2:** O Agent precisa navegar nas páginas? Se sim:

- [ ] Puppeteer/Playwright local
- [ ] Cloudflare Browser Rendering
- [ ] Apenas fetch estático

**Q6.3:** O Agent deve ter capacidade de:

- [ ] Analisar código JS do site
- [ ] Testar formulários de filtro
- [ ] Identificar se precisa de login/autenticação
- [ ] Detectar CAPTCHAs ou proteções

---

## 🎯 Próximos Passos Sugeridos

Após responder as perguntas acima, sugiro:

1. **Definir o escopo do MVP**: Quais casos o agent deve resolver na primeira versão?
2. **Criar uma base de conhecimento**: Mapear todas as plataformas conhecidas e seus patterns
3. **Prototipar o matcher**: Começar pela identificação de similaridade
4. **Definir o output format**: Template para código do spider
5. **Iterar**: Testar com casos reais e refinar

---

## 📝 Suas Respostas

_Por favor, responda as perguntas acima editando esta seção ou me enviando no chat!_

### R1: Input do Agent

> ...

### R2: Identificação de Similaridade

> ...

### R3: Criação do Spider

> ...

### R4: Configuração no JSON

> ...

### R5: Plataformas Conhecidas

> ...

### R6: Fluxo do Agent

> ...

---

## 💡 Ideias Adicionais

Se quiser discutir algo que não cobri acima, adicione aqui:

> ...
