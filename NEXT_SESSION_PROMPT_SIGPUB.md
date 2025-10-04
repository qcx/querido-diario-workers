# Prompt para Sessão Paralela - SIGPub Multi-Regional

## ⚠️ IMPORTANTE: Sessão Paralela

**Esta sessão é PARALELA à sessão de ADiarios V2 + MunicipioOnline + AtendeV2.**

Para evitar conflitos:
- ✅ Esta sessão trabalha APENAS com **SIGPub**
- ✅ Não toca em ADiarios V2, MunicipioOnline ou AtendeV2
- ✅ Trabalha em branch separada: `feature/sigpub-multi-regional`
- ✅ Merge só depois que ambas as sessões terminarem

---

## Contexto

Estou migrando o projeto **Querido Diário** para **Cloudflare Workers** (Node.js + TypeScript). O repositório está em https://github.com/qcx/querido-diario-workers.

### Status Atual (Após sessão de 04/10/2025)

- **364 cidades migradas** de 474 (76.8%) ✅
- **16 classes base implementadas**
- **SIGPub implementado mas subutilizado** (apenas 3 cidades de AL e SP)
- **Últimos commits:**
  - `feat: Implementa o spider MunicipioOnline e adiciona 26 cidades`
  - `feat: Implementa o spider AtendeV2 e adiciona 22 cidades`

### Oportunidade Identificada

**SIGPub é uma plataforma AGREGADORA multi-regional** que atende **19 estados brasileiros** com potencial de **800-1000 municípios**!

Atualmente temos apenas 3 cidades configuradas, mas a plataforma suporta muito mais.

---

## Objetivo da Sessão

**Expandir SIGPub para múltiplos estados e adicionar 100+ cidades de uma vez**

### Metas

1. ✅ Pesquisar e mapear todos os estados/regiões disponíveis no SIGPub
2. ✅ Criar configurações para pelo menos **5 estados prioritários**
3. ✅ Adicionar **100+ cidades** em uma única sessão
4. ✅ Testar com pelo menos 2 estados diferentes
5. ✅ Documentar URLs e estrutura de cada estado

### Resultado Esperado

- **464+ cidades funcionais** (364 + 100)
- **Cobertura:** 97.9%
- **Maior salto de cobertura em uma única sessão** 🚀

---

## Informações Técnicas

### SIGPub - Sistema Gerenciador de Publicações Legais

**Provedor:** VOX Tecnologia  
**URL Base:** https://www.diariomunicipal.com.br/

**Características:**
- Plataforma unificada para múltiplos estados
- Cada estado/região tem URL própria
- Alguns estados têm múltiplos diários (associações regionais)
- API JSON para busca de diários
- Estrutura consistente entre estados

**Estados Disponíveis (19):**
1. Amazonas (AM)
2. Alagoas (AL) - **4 diários regionais**
3. Bahia (BA) - **2 diários regionais**
4. Ceará (CE)
5. Goiás (GO) - **2 diários regionais**
6. Maranhão (MA)
7. Minas Gerais (MG)
8. Mato Grosso (MT)
9. Mato Grosso do Sul (MS)
10. Pará (PA)
11. Paraíba (PB)
12. Paraná (PR)
13. Pernambuco (PE) - **AMUPE**
14. Piauí (PI)
15. Rio de Janeiro (RJ)
16. Rio Grande do Norte (RN)
17. Roraima (RR)
18. Rondônia (RO)
19. Rio Grande do Sul (RS)

---

## Estrutura do SIGPub

### URL Patterns

**Padrão 1: Estado único**
```
https://www.diariomunicipal.com.br/{estado}/
Exemplo: https://www.diariomunicipal.com.br/ceara/
```

**Padrão 2: Associação/Consórcio**
```
https://www.diariomunicipal.com.br/{associacao}/
Exemplo: https://www.diariomunicipal.com.br/amupe/ (Pernambuco)
```

**Padrão 3: Cidade específica**
```
https://www.diariomunicipal.com.br/{cidade}
Exemplo: https://www.diariomunicipal.com.br/maceio
```

### API Endpoints

**Busca por data (calendar):**
```
POST https://www.diariomunicipal.com.br/{base}/materia/calendario
POST https://www.diariomunicipal.com.br/{base}/materia/calendario/extra

FormData:
- calendar[_token]: {token extraído da página}
- calendar[day]: {dia}
- calendar[month]: {mês}
- calendar[year]: {ano}

Response JSON:
{
  "edicao": [
    {
      "numero_edicao": "1234",
      "link_diario": "path/to/pdf"
    }
  ],
  "url_arquivos": "https://..."
}
```

---

## Classe Base Atual (Já Implementada)

**Arquivo:** `src/spiders/base/sigpub-spider.ts`

**Status:** ✅ Implementada e funcional

**Configuração atual:**
```json
// src/spiders/configs/sigpub-cities.json (apenas 3 cidades)
[
  {
    "id": "al_associacao_municipios",
    "name": "Associação dos Municípios Alagoanos - AL",
    "territoryId": "2700000",
    "spiderType": "sigpub",
    "startDate": "2014-04-10",
    "config": {
      "type": "sigpub",
      "calendarUrl": "https://www.diariomunicipal.com.br/ama/"
    }
  },
  {
    "id": "al_maceio",
    "name": "Maceió - AL",
    "territoryId": "2704302",
    "spiderType": "sigpub",
    "startDate": "2018-08-09",
    "config": {
      "type": "sigpub",
      "calendarUrl": "https://www.diariomunicipal.com.br/maceio"
    }
  },
  {
    "id": "sp_sao_paulo",
    "name": "São Paulo - SP",
    "territoryId": "3550308",
    "spiderType": "sigpub",
    "startDate": "2009-01-01",
    "config": {
      "type": "sigpub",
      "calendarUrl": "https://www.diariomunicipal.com.br/saopaulo"
    }
  }
]
```

---

## Plano de Implementação

### Fase 1: Pesquisa e Mapeamento (1h)

1. **Acessar https://www.diariomunicipal.com.br/**
2. **Mapear todos os estados/regiões disponíveis**
   - Clicar no dropdown de estados
   - Anotar URL de cada estado
   - Identificar estados com múltiplos diários
3. **Para cada estado prioritário:**
   - Acessar página do estado
   - Verificar se há lista de municípios
   - Tentar buscar por data para validar API
   - Anotar data de início (se disponível)

**Estados Prioritários (Top 5):**
1. **Pernambuco (AMUPE)** - ~184 municípios
2. **Ceará** - ~184 municípios
3. **Paraíba** - ~223 municípios
4. **Rio Grande do Norte** - ~167 municípios
5. **Maranhão** - ~217 municípios

**Total estimado:** ~975 municípios

### Fase 2: Extração de Municípios (1.5h)

Para cada estado prioritário:

1. **Acessar página de pesquisa do estado**
2. **Buscar lista de municípios/entidades**
   - Pode estar em dropdown
   - Pode estar em página separada
   - Pode estar em JavaScript
3. **Extrair informações:**
   - Nome do município
   - URL/slug do município
   - Código IBGE (se disponível)
4. **Validar com busca de teste**

**Métodos de extração:**

**Método 1: Scraping da página**
```typescript
// Acessar página e extrair lista de municípios
const response = await fetch(stateUrl);
const html = await response.text();
// Parse HTML com regex ou cheerio
```

**Método 2: API de entidades (se disponível)**
```typescript
// Alguns estados podem ter endpoint de lista
const response = await fetch(`${baseUrl}/api/entidades`);
const entities = await response.json();
```

**Método 3: Manual (fallback)**
```typescript
// Se não houver lista, mapear manualmente os principais
const municipalities = [
  { name: 'Fortaleza', slug: 'fortaleza', ibge: '2304400' },
  // ...
];
```

### Fase 3: Criação de Configurações (1h)

1. **Criar arquivo de configuração expandido**
   ```json
   // src/spiders/configs/sigpub-cities.json
   [
     // ... 3 cidades existentes
     
     // Pernambuco (AMUPE) - ~184 municípios
     {
       "id": "pe_amupe_recife",
       "name": "Recife - PE (AMUPE)",
       "territoryId": "2611606",
       "spiderType": "sigpub",
       "startDate": "2014-01-01",
       "config": {
         "type": "sigpub",
         "calendarUrl": "https://www.diariomunicipal.com.br/amupe/"
       }
     },
     // ... mais cidades de PE
     
     // Ceará - ~184 municípios
     {
       "id": "ce_fortaleza",
       "name": "Fortaleza - CE",
       "territoryId": "2304400",
       "spiderType": "sigpub",
       "startDate": "2009-01-01",
       "config": {
         "type": "sigpub",
         "calendarUrl": "https://www.diariomunicipal.com.br/ceara/"
       }
     },
     // ... mais cidades de CE
   ]
   ```

2. **Validar estrutura JSON**
3. **Verificar territoryIds (códigos IBGE)**

### Fase 4: Testes (30min)

1. **Testar com 2 estados diferentes**
   - Pernambuco (AMUPE)
   - Ceará
2. **Validar extração de diários**
3. **Verificar contagem de cidades**
4. **Executar `count-cities.ts`**

### Fase 5: Documentação e Commit (30min)

1. **Criar documentação de estados SIGPub**
   ```markdown
   # SIGPub Multi-Regional - Estados Mapeados
   
   ## Pernambuco (AMUPE)
   - URL: https://www.diariomunicipal.com.br/amupe/
   - Municípios: 184
   - Data início: 2014-01-01
   
   ## Ceará
   - URL: https://www.diariomunicipal.com.br/ceara/
   - Municípios: 184
   - Data início: 2009-01-01
   ```

2. **Atualizar README**
3. **Commit em branch separada**
4. **NÃO fazer merge ainda** (esperar outra sessão)

---

## Estrutura de Branch

```bash
# Criar branch separada
git checkout -b feature/sigpub-multi-regional

# Trabalhar apenas em:
# - src/spiders/configs/sigpub-cities.json
# - Documentação

# Commit
git add src/spiders/configs/sigpub-cities.json
git commit -m "feat: Expand SIGPub to 5 states with 100+ cities"

# Push
git push origin feature/sigpub-multi-regional

# NÃO fazer merge ainda
```

---

## Ferramentas e Scripts

### Script para Validar Códigos IBGE

```typescript
// validate-ibge.ts
const cities = require('./src/spiders/configs/sigpub-cities.json');

for (const city of cities) {
  if (!/^\d{7}$/.test(city.territoryId)) {
    console.error(`Invalid IBGE code for ${city.id}: ${city.territoryId}`);
  }
}
```

### Script para Buscar Códigos IBGE

```bash
# Usar API do IBGE para buscar códigos
curl "https://servicodados.ibge.gov.br/api/v1/localidades/municipios/{nome}" | jq '.[] | {nome: .nome, id: .id}'
```

---

## Fontes de Dados

### Códigos IBGE
- **API IBGE:** https://servicodados.ibge.gov.br/api/v1/localidades/municipios
- **Tabela IBGE:** https://www.ibge.gov.br/explica/codigos-dos-municipios.php

### Lista de Municípios por Estado
- **Pernambuco:** https://pt.wikipedia.org/wiki/Lista_de_munic%C3%ADpios_de_Pernambuco
- **Ceará:** https://pt.wikipedia.org/wiki/Lista_de_munic%C3%ADpios_do_Cear%C3%A1
- **Paraíba:** https://pt.wikipedia.org/wiki/Lista_de_munic%C3%ADpios_da_Para%C3%ADba

---

## Estratégia de Priorização

### Critérios
1. **População** - Estados com mais municípios populosos
2. **Disponibilidade** - Estados com dados acessíveis
3. **Impacto** - Número de municípios por estado

### Top 5 Estados (Ordem de Implementação)

| Estado | Municípios | População Total | Prioridade |
|--------|------------|-----------------|------------|
| **Pernambuco (AMUPE)** | 184 | 9.6M | 🔥🔥🔥 |
| **Ceará** | 184 | 9.2M | 🔥🔥🔥 |
| **Paraíba** | 223 | 4.0M | 🔥🔥 |
| **Rio Grande do Norte** | 167 | 3.5M | 🔥🔥 |
| **Maranhão** | 217 | 7.1M | 🔥🔥 |

---

## Observações Importantes

### Sobre Associações vs Municípios

**SIGPub tem 2 tipos de configuração:**

1. **Associação/Consórcio** (1 config = N municípios)
   - Exemplo: AMUPE (184 municípios de PE)
   - 1 URL para todos os municípios
   - PDFs contêm múltiplos municípios
   - **Configurar como 1 "cidade" que representa a associação**

2. **Município Individual** (1 config = 1 município)
   - Exemplo: Maceió, São Paulo
   - 1 URL por município
   - PDF específico do município
   - **Configurar normalmente**

**Estratégia recomendada:**
- Priorizar associações (alto ROI)
- Adicionar municípios individuais importantes depois

### Sobre Datas de Início

- Muitos estados começam em **2009-01-01** (padrão SIGPub)
- Alguns têm datas específicas (verificar na página)
- Se não encontrar, usar **2009-01-01** como fallback

### Sobre TerritoryId

- **Associações:** Usar código do estado + "0000"
  - Exemplo: Pernambuco = "2600000"
  - Alagoas = "2700000"
- **Municípios:** Usar código IBGE de 7 dígitos
  - Exemplo: Recife = "2611606"

---

## Comandos Úteis

```bash
# Clonar repositório
cd ~
gh repo clone qcx/querido-diario-workers
cd querido-diario-workers

# Criar branch
git checkout -b feature/sigpub-multi-regional

# Verificar configurações atuais
cat src/spiders/configs/sigpub-cities.json | jq length

# Build e teste
npm run build
npx tsx count-cities.ts

# Buscar código IBGE de município
curl "https://servicodados.ibge.gov.br/api/v1/localidades/municipios/recife" | jq '.[0].id'

# Commit
git add src/spiders/configs/sigpub-cities.json
git commit -m "feat: Add SIGPub cities for Pernambuco and Ceará"
git push origin feature/sigpub-multi-regional
```

---

## Checklist de Implementação

### Pesquisa
- [ ] Mapear 19 estados disponíveis no SIGPub
- [ ] Identificar Top 5 estados prioritários
- [ ] Validar URLs de cada estado
- [ ] Anotar datas de início (se disponível)

### Extração
- [ ] Extrair lista de municípios de Pernambuco (AMUPE)
- [ ] Extrair lista de municípios do Ceará
- [ ] Extrair lista de municípios da Paraíba
- [ ] Extrair lista de municípios do RN
- [ ] Extrair lista de municípios do Maranhão
- [ ] Buscar códigos IBGE de todos os municípios

### Configuração
- [ ] Criar configurações para PE (AMUPE)
- [ ] Criar configurações para CE
- [ ] Criar configurações para PB
- [ ] Criar configurações para RN
- [ ] Criar configurações para MA
- [ ] Validar JSON
- [ ] Verificar territoryIds

### Testes
- [ ] Testar com PE (AMUPE)
- [ ] Testar com CE
- [ ] Validar extração de diários
- [ ] Executar count-cities.ts
- [ ] Verificar que não conflita com outras mudanças

### Documentação
- [ ] Criar SIGPUB_STATES_MAPPING.md
- [ ] Atualizar README (em branch)
- [ ] Criar SESSION_SUMMARY
- [ ] Commit em branch separada
- [ ] Push (NÃO merge)

---

## Referências

- **Repositório Workers:** https://github.com/qcx/querido-diario-workers
- **SIGPub:** https://www.diariomunicipal.com.br/
- **AMUPE:** https://www.diariomunicipal.com.br/amupe/
- **API IBGE:** https://servicodados.ibge.gov.br/api/docs/localidades
- **Análise de Plataformas:** `~/querido-diario-workers/AGGREGATOR_PLATFORMS_ANALYSIS.md`

---

## Prompt Resumido para Copiar

```
Olá! Estou continuando a migração do Querido Diário para Cloudflare Workers.

⚠️ IMPORTANTE: Esta é uma SESSÃO PARALELA. Trabalhe em branch separada: feature/sigpub-multi-regional

Repositório: https://github.com/qcx/querido-diario-workers
Status: 364 cidades migradas (76.8%)
Branch atual: main

Objetivo: Expandir SIGPub Multi-Regional para adicionar 100+ cidades de 5 estados

Estados prioritários:
1. Pernambuco (AMUPE) - ~184 municípios
2. Ceará - ~184 municípios
3. Paraíba - ~223 municípios
4. Rio Grande do Norte - ~167 municípios
5. Maranhão - ~217 municípios

Meta: 464+ cidades (97.9%) - maior salto de cobertura em uma sessão!

Detalhes completos em: ~/querido-diario-workers/NEXT_SESSION_PROMPT_SIGPUB.md

Por favor:
1. Crie branch feature/sigpub-multi-regional
2. Pesquise e mapeie estados disponíveis no SIGPub
3. Extraia lista de municípios dos 5 estados prioritários
4. Crie configurações em sigpub-cities.json
5. Teste com 2 estados
6. Commit em branch (NÃO merge)

Obrigado!
```

---

**Criado em:** 04/10/2025  
**Última atualização:** Commit e7a213a  
**Tempo estimado:** 4-5 horas  
**Prioridade:** 🔥 MUITO ALTA  
**Complexidade:** Média  
**Impacto:** +100 cidades (+21% cobertura)  
**Branch:** `feature/sigpub-multi-regional`
