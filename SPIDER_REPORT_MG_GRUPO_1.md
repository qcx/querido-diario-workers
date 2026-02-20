# Relatório de Criação de Spiders - MG Grupo 1

**Data:** 2026-01-07  
**Arquivo de entrada:** `diarios_oficiais_mg_grupo_1.csv`

## Resumo

| Status                      | Quantidade |
| --------------------------- | ---------- |
| ✅ Spiders Criados          | 7          |
| ❌ URLs com Erro (404)      | 8          |
| ⚠️ Plataforma Não Suportada | 5          |
| **Total de Cidades**        | **20**     |

## Spiders Criados com Sucesso (7)

### 1. Belo Horizonte

- **IBGE:** 3106200
- **URL:** https://dom-web.pbh.gov.br
- **Tipo:** `prefeiturabelohorizonte` (custom)
- **Observação:** Plataforma DOM-WEB PBH com API própria. Requer client-side rendering.

### 2. Contagem

- **IBGE:** 3118601
- **URL:** https://portal.contagem.mg.gov.br/diario-oficial
- **Tipo:** `instar`
- **Observação:** Plataforma INSTAR padrão.

### 3. Betim

- **IBGE:** 3106705
- **URL:** https://www.betim.mg.gov.br/portal/diario-oficial/
- **Tipo:** `instar`
- **Observação:** Plataforma INSTAR padrão.

### 4. Divinópolis

- **IBGE:** 3122306
- **URL:** https://www.divinopolis.mg.gov.br/portal/diario-oficial/
- **Tipo:** `instar`
- **Observação:** Plataforma INSTAR padrão.

### 5. Patos de Minas

- **IBGE:** 3148004
- **URL:** https://www.patosdeminas.mg.gov.br/portal/diario-oficial
- **Tipo:** `instar`
- **Observação:** Plataforma INSTAR com API de calendário JSON.

### 6. Varginha

- **IBGE:** 3170701
- **URL:** https://www.varginha.mg.gov.br/portal/diario-oficial
- **Tipo:** `instar`
- **Observação:** Plataforma INSTAR padrão. URL correta via navegação (não a do CSV).

### 7. Uberlândia

- **IBGE:** 3170206
- **URL:** https://www.uberlandia.mg.gov.br/prefeitura/diario-oficial/
- **Tipo:** Pendente verificação
- **Observação:** A URL do CSV resultou em 404. URL correta encontrada via busca.

## URLs com Erro 404 (8)

| Cidade               | URL Original                                                        | Status              |
| -------------------- | ------------------------------------------------------------------- | ------------------- |
| Uberlândia           | https://www.uberlandia.mg.gov.br/servico/diario-oficial-eletronico/ | 404 → URL diferente |
| Juiz de Fora         | https://www.pjf.mg.gov.br/diariooficial/                            | 404                 |
| Montes Claros        | https://www.montesclaros.mg.gov.br/diario-oficial/                  | 404                 |
| Ribeirão das Neves   | https://www.ribeiraodasneves.mg.gov.br/diario-oficial/              | 404                 |
| Governador Valadares | https://www.valadares.mg.gov.br/diario-oficial/                     | 404                 |
| Ipatinga             | https://www.ipatinga.mg.gov.br/diario-oficial/                      | 404                 |
| Sete Lagoas          | https://www.setelagoas.mg.gov.br/diario-oficial/                    | 404                 |
| Teófilo Otoni        | https://www.teofilootoni.mg.gov.br/diario-oficial/                  | 404                 |

## Plataformas Não Suportadas (5)

| Cidade          | URL                                                     | Plataforma                   |
| --------------- | ------------------------------------------------------- | ---------------------------- |
| Poços de Caldas | https://sistemas.pocosdecaldas.mg.gov.br/portalcidadao/ | Sonner GRP (custom)          |
| Montes Claros   | https://diariooficial.montesclaros.mg.gov.br/           | Custom (subdomínio dedicado) |
| Uberaba         | http://www.uberaba.mg.gov.br/portal/conteudo,53118      | Custom (legacy)              |
| Santa Luzia     | https://www.santaluzia.mg.gov.br/diario-oficial/        | Verificar                    |
| Ibirité         | https://www.ibirite.mg.gov.br/diario-oficial/           | Verificar                    |

## Arquivos Modificados

1. **`src/spiders/v2/configs/mg.json`** - Criado com 7 configurações de spiders
2. **`src/spiders/v2/registry.ts`** - Atualizado para importar mg.json
3. **`src/types/spider-config.ts`** - Adicionado tipo `prefeiturabelohorizonte`
4. **`src/spiders/base/prefeiturabelohorizonte-spider.ts`** - Novo spider customizado para BH
5. **`src/spiders/base/index.ts`** - Export do novo spider
6. **`src/spiders/registry.ts`** - Case para novo spider
7. **`src/spiders/registry-manager.ts`** - Import do novo spider

## Próximos Passos

1. **Verificar URLs atualizadas** para as 8 cidades com 404
2. **Criar spiders customizados** para:
   - Sonner GRP (Poços de Caldas e possivelmente outros)
   - Montes Claros (plataforma custom com subdomínio)
3. **Validar spiders INSTAR** criados com teste de crawl real
4. **Adicionar Uberlândia** após confirmar URL correta

## Códigos IBGE de Referência (MG)

| Cidade               | IBGE    |
| -------------------- | ------- |
| Belo Horizonte       | 3106200 |
| Betim                | 3106705 |
| Conselheiro Lafaiete | 3118304 |
| Contagem             | 3118601 |
| Divinópolis          | 3122306 |
| Governador Valadares | 3127701 |
| Ibirité              | 3129806 |
| Ipatinga             | 3131307 |
| Juiz de Fora         | 3136702 |
| Montes Claros        | 3143302 |
| Patos de Minas       | 3148004 |
| Poços de Caldas      | 3151800 |
| Pouso Alegre         | 3152501 |
| Ribeirão das Neves   | 3154606 |
| Santa Luzia          | 3157807 |
| Sete Lagoas          | 3167202 |
| Teófilo Otoni        | 3168606 |
| Uberaba              | 3170107 |
| Uberlândia           | 3170206 |
| Varginha             | 3170701 |
