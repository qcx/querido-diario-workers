# Prompt para Nova Sessão: Implementar Spiders GO e SC

## Contexto

Você está trabalhando no projeto **Querido Diário Workers**, um sistema de coleta automatizada de diários oficiais municipais do Brasil usando Cloudflare Workers. O projeto atualmente cobre **1.892 municípios (34% do Brasil)** através de 15 plataformas diferentes.

Recentemente, identificamos **sistemas centralizados** que podem expandir significativamente a cobertura com mínimo esforço:

1. **DOM/SC** (Santa Catarina): Sistema centralizado que cobre **295 municípios** (100% de SC)
2. **AGM** (Goiás): Associação Goiana de Municípios usando SIGPub, cobrindo **100-200 municípios** de GO

## Objetivo da Sessão

Implementar **dois novos spiders** para cobrir Goiás e Santa Catarina, adicionando aproximadamente **400-500 municípios** ao sistema (ganho de ~9% de cobertura nacional).

## Tarefas

### 1. Implementar Spider para DOM/SC (Santa Catarina) - PRIORIDADE CRÍTICA

#### Informações do Sistema

- **URL**: https://diariomunicipal.sc.gov.br/
- **Cobertura**: 550+ entidades (295 municípios + câmaras, autarquias, etc.)
- **Gerenciamento**: Consórcio CIGA (Consórcio de Inovação na Gestão Pública)
- **Tipo**: Sistema próprio (não é SIGPub)

#### Funcionalidades do Site

- Busca por município/entidade
- Filtro por categoria (Leis, Decretos, Licitações, Concursos, etc.)
- Filtro por período (data inicial e final)
- PDFs assinados digitalmente
- Estrutura de URLs: `https://diariomunicipal.sc.gov.br/?r=site/index&q=...`

#### Requisitos Técnicos

1. **Criar novo spider**: `src/spiders/dom-sc-spider.ts`
   - Herdar de `BaseSpider`
   - Implementar método `crawl()`
   - Suportar busca por município e período

2. **Criar configurações**: `src/spiders/configs/dom-sc-cities.json`
   - Listar todos os 295 municípios de SC
   - Incluir código IBGE (territoryId)
   - Incluir ID da entidade no DOM/SC

3. **Registrar spider**: Adicionar ao `src/spiders/registry.ts`

4. **Testar**: Validar com amostra de 10-20 municípios

#### Estrutura de Dados Esperada

```json
{
  "id": "sc_4205407",
  "name": "Florianópolis",
  "stateCode": "SC",
  "territoryId": "4205407",
  "spiderType": "dom-sc",
  "config": {
    "url": "https://diariomunicipal.sc.gov.br/",
    "entityId": "92"
  }
}
```

#### Exemplo de Gazette Extraída

```typescript
{
  fileUrl: "https://diariomunicipal.sc.gov.br/...",
  territory_id: "4205407",
  date: "2025-10-04",
  edition_number: "3809",
  is_extra_edition: false,
  power: "executive",
  source_text: "DOM/SC - Diário Oficial dos Municípios de Santa Catarina"
}
```

---

### 2. Configurar AGM (Goiás) no Spider SIGPub Existente

#### Informações do Sistema

- **URL**: https://www.diariomunicipal.com.br/agm/
- **Cobertura**: Municípios associados à AGM (estimar 100-200)
- **Gerenciamento**: Associação Goiana de Municípios
- **Tipo**: SIGPub (plataforma já implementada!)

#### Requisitos Técnicos

1. **Verificar spider SIGPub**: `src/spiders/base/sigpub-spider.ts`
   - Confirmar que suporta diferentes URLs base
   - Verificar se AGM usa mesma estrutura

2. **Adicionar configurações AGM**: Atualizar `src/spiders/configs/sigpub-cities.json`
   - Adicionar municípios GO que usam AGM
   - URL base: `https://www.diariomunicipal.com.br/agm/`

3. **Pesquisar lista de municípios**: 
   - Acessar https://www.diariomunicipal.com.br/agm/pesquisar
   - Extrair lista completa de municípios disponíveis no dropdown
   - Mapear para códigos IBGE

4. **Testar**: Validar com amostra de municípios GO

#### Estrutura de Dados Esperada

```json
{
  "id": "go_5208707",
  "name": "Goiânia",
  "stateCode": "GO",
  "territoryId": "5208707",
  "spiderType": "sigpub",
  "config": {
    "url": "https://www.diariomunicipal.com.br/agm/",
    "entityId": "XXX"
  }
}
```

---

### 3. Atualizar Documentação

1. **README.md**: Adicionar DOM/SC e AGM à lista de plataformas
2. **Criar guia**: `DOM-SC-IMPLEMENTATION.md` com detalhes técnicos
3. **Atualizar estatísticas**: Cobertura passa de 34% para ~43%

---

### 4. Testar Sistema Completo

1. **Teste unitário**: Cada spider individualmente
2. **Teste de integração**: Fluxo completo (spider → OCR → analysis → webhook)
3. **Teste de amostra**: 
   - SC: 20 municípios aleatórios
   - GO: 10 municípios aleatórios
4. **Validar PDFs**: Confirmar que URLs são válidas e acessíveis

---

### 5. Deploy e Monitoramento

1. **Deploy**: Fazer deploy dos novos spiders
2. **Executar teste full**: Rodar teste em todos os municípios SC e GO
3. **Monitorar**: Verificar taxa de sucesso e erros
4. **Ajustar**: Corrigir problemas identificados

---

## Estrutura do Projeto

```
querido-diario-workers/
├── src/
│   ├── spiders/
│   │   ├── base/
│   │   │   ├── base-spider.ts
│   │   │   └── sigpub-spider.ts (já existe)
│   │   ├── configs/
│   │   │   ├── sigpub-cities.json (atualizar com GO)
│   │   │   └── dom-sc-cities.json (criar novo)
│   │   ├── dom-sc-spider.ts (criar novo)
│   │   └── registry.ts (atualizar)
│   ├── types/
│   │   └── spider-config.ts
│   └── consumer.ts
├── test-dom-sc.ts (criar teste)
├── test-agm-go.ts (criar teste)
└── README.md (atualizar)
```

---

## Arquivos de Referência Importantes

### 1. Análise de Cobertura
- `FINAL-COVERAGE-EXPANSION-STRATEGY.md` - Estratégia geral
- `CENTRALIZED-SYSTEMS-FINAL-REPORT.md` - Descoberta dos sistemas centralizados
- `centralized-systems-check.log` - Verificação de URLs

### 2. Código Existente
- `src/spiders/base/base-spider.ts` - Classe base para todos os spiders
- `src/spiders/base/sigpub-spider.ts` - Spider SIGPub (referência para AGM)
- `src/spiders/configs/sigpub-cities.json` - Exemplo de configuração

### 3. Sistema de Testes
- `src/testing/test-runner.ts` - Sistema de testes automatizados
- `scripts/run-tests.ts` - Script para executar testes
- `TEST_SYSTEM_FIX_SUMMARY.md` - Documentação do sistema de testes

---

## Critérios de Sucesso

### Mínimo Viável
- ✅ Spider DOM/SC implementado e funcional
- ✅ AGM configurado no SIGPub
- ✅ Pelo menos 200 municípios novos cobertos
- ✅ Taxa de sucesso >80% nos testes

### Ideal
- ✅ Todos os 295 municípios SC cobertos
- ✅ 100+ municípios GO cobertos via AGM
- ✅ Taxa de sucesso >95% nos testes
- ✅ Documentação completa
- ✅ Integração com sistema OCR e análise funcionando

---

## Comandos Úteis

```bash
# Clonar repositório
gh repo clone qcx/querido-diario-workers
cd querido-diario-workers

# Instalar dependências
npm install

# Executar testes
npm run test:automated:sample

# Testar spider específico
npx tsx scripts/test-city.ts sc_4205407

# Build
npm run build

# Contar cidades
npx tsx count-cities.ts
```

---

## Observações Importantes

1. **SIGPub já está implementado**: Para GO/AGM, é principalmente questão de adicionar configurações, não criar spider novo.

2. **DOM/SC é prioridade**: Santa Catarina adiciona 5% de cobertura nacional com um único spider - maior ROI.

3. **Validação é crítica**: Garantir que os PDFs são acessíveis e que as datas/edições estão corretas.

4. **Integração com OCR**: Os novos spiders devem funcionar com o sistema OCR → Analysis → Webhook já implementado.

5. **Códigos IBGE**: Usar sempre o padrão `{uf}_{codigo_ibge}` para IDs de cidades.

6. **startDate opcional**: O campo `startDate` é opcional no `SpiderConfig` (bug já corrigido).

---

## Entregáveis Esperados

1. ✅ `src/spiders/dom-sc-spider.ts` - Novo spider para SC
2. ✅ `src/spiders/configs/dom-sc-cities.json` - Configurações SC (295 municípios)
3. ✅ `src/spiders/configs/sigpub-cities.json` - Atualizado com municípios GO/AGM
4. ✅ `src/spiders/registry.ts` - Atualizado com DOM/SC
5. ✅ `test-dom-sc.ts` - Teste do spider DOM/SC
6. ✅ `test-agm-go.ts` - Teste do AGM
7. ✅ `DOM-SC-IMPLEMENTATION.md` - Documentação técnica
8. ✅ `README.md` - Atualizado com novas plataformas
9. ✅ Relatório de testes mostrando taxa de sucesso
10. ✅ Commit e push para `origin/main`

---

## Contexto Adicional

### Sistema OCR e Análise
O projeto já possui:
- Sistema de OCR com Mistral API (`src/services/mistral-ocr.ts`)
- Sistema de análise com KeywordAnalyzer, EntityExtractor, AIAnalyzer
- Sistema de webhooks para notificações (ex: Qconcursos)

Os novos spiders devem se integrar automaticamente com esse fluxo.

### Cloudflare Workers
O projeto usa:
- Cloudflare Workers para execução
- Cloudflare Queues para processamento assíncrono
- Cloudflare KV para armazenamento
- Wrangler para deploy

### Credenciais Disponíveis
- `MISTRAL_API_KEY`: Configurada para OCR
- `CLOUDFLARE_API_TOKEN`: Disponível para deploy

---

## Perguntas Frequentes

**Q: O SIGPub já está implementado, por que não está cobrindo GO?**  
A: O SIGPub está implementado, mas apenas com configurações de 9 estados (MG, RS, PE, PR, RN, MT, CE, PI, PB). GO não tem municípios configurados ainda, mesmo que a AGM use SIGPub.

**Q: Como obter a lista de municípios do DOM/SC?**  
A: Acessar https://diariomunicipal.sc.gov.br/ e extrair do dropdown de municípios, ou usar a API se disponível. Alternativamente, usar lista do IBGE e mapear.

**Q: Como obter o entityId de cada município?**  
A: Inspecionar requisições do site ao buscar por município específico. O entityId geralmente aparece na URL ou no payload da requisição.

**Q: E se o DOM/SC tiver rate limiting?**  
A: Implementar delays entre requisições e usar o sistema de retry já existente no BaseSpider.

**Q: Como testar sem fazer deploy?**  
A: Usar os scripts de teste locais (`test-dom-sc.ts`) que simulam o ambiente do worker.

---

## Recursos Externos

- [DOM/SC](https://diariomunicipal.sc.gov.br/)
- [AGM Goiás](https://www.diariomunicipal.com.br/agm/)
- [Consórcio CIGA](https://consorciociga.gov.br/)
- [Lista de municípios SC - IBGE](https://www.ibge.gov.br/explica/codigos-dos-municipios.php)
- [Lista de municípios GO - IBGE](https://www.ibge.gov.br/explica/codigos-dos-municipios.php)

---

## Início Sugerido

1. Clonar o repositório
2. Analisar estrutura do DOM/SC (inspecionar site, ver requisições)
3. Criar spider DOM/SC baseado no BaseSpider
4. Extrair lista de municípios SC
5. Criar arquivo de configuração
6. Testar com 5 municípios
7. Ajustar e expandir
8. Repetir processo para AGM/GO
9. Executar teste completo
10. Deploy e monitoramento

---

**Boa sorte! Execute de forma ininterrupta até o final. 🚀**
