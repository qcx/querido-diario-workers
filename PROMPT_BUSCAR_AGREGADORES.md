# Prompt: Buscar Agregadores Não Comerciais de Diários Oficiais

## Contexto

O projeto **Querido Diário** (https://github.com/qcx/querido-diario-workers) coleta diários oficiais municipais de todo o Brasil. Atualmente temos **~2.562 municípios** cobertos através de múltiplas plataformas agregadoras.

## Objetivo

**Pesquisar e mapear TODOS os agregadores não comerciais de diários oficiais municipais no Brasil**, focando em:
- Associações estaduais de municípios
- Portais governamentais estaduais
- Consórcios municipais
- Plataformas públicas regionais

**NÃO incluir**: Plataformas comerciais privadas (como ADOO, e-Diário Oficial, etc.)

---

## Agregadores Já Implementados

### 1. SIGPub (Sistema Gerenciador de Publicações Legais)
**URL Base**: https://www.diariomunicipal.com.br/  
**Tipo**: Plataforma técnica operada por associações estaduais  
**Cobertura Atual**: 1.723 municípios

**Estados já mapeados no SIGPub**:
- **Paraná (AMP)**: https://www.diariomunicipal.com.br/amp/
- **Rio Grande do Sul (FAMURS)**: https://www.diariomunicipal.com.br/famurs/
- **Pernambuco (AMUPE)**: https://www.diariomunicipal.com.br/amupe/
- **Alagoas (AMA)**: Associação dos Municípios Alagoanos
- **Amazonas (AAM)**: https://www.diariomunicipal.com.br/aam/ - 62 municípios
- **Bahia**: Múltiplas entidades
- **Sergipe**: Cobertura estadual
- **Minas Gerais**: Diversos municípios
- **Goiás**: Alguns municípios

### 2. DOM/SC (Diário Oficial dos Municípios de Santa Catarina)
**URL**: https://www.diariomunicipal.sc.gov.br/  
**Tipo**: Plataforma estadual governamental  
**Cobertura**: 550+ entidades em Santa Catarina  
**Status**: ✅ Spider implementado e funcional

### 3. AMM-MT (Associação Mato-grossense de Municípios)
**URL**: https://amm.diariomunicipal.org/  
**Tipo**: Associação estadual  
**Cobertura**: 3 municípios de Mato Grosso  
**Status**: ✅ Spider implementado e funcional

### 4. Diário Oficial BA (Bahia)
**URL**: https://www.diariooficialba.com.br/  
**Tipo**: Portal centralizado estadual  
**Cobertura**: 408 municípios configurados  
**Status**: ⚠️ Spider implementado mas não funcional (proteção anti-bot)

### 5. Outras Plataformas Já Implementadas
- **DOEM** (56 municípios)
- **Instar** (111 municípios)
- **DOSP** (42 municípios)
- **ADiarios V1** (34 municípios)
- **DIOF** (20 municípios)
- **BarcoDigital** (7 municípios)
- **Siganet** (10 municípios)
- **MunicipioOnline** (26 municípios)
- **Atende V2** (22 municípios)
- E outras plataformas menores

---

## Tarefa Específica

### Fase 1: Pesquisa Sistemática por Estado

Para **cada um dos 26 estados + DF**, pesquisar:

1. **Associação de Municípios do Estado**
   - Nome oficial (ex: APPM - Associação Piauiense de Municípios)
   - Website oficial
   - Se possui diário oficial centralizado
   - URL do diário oficial (se existir)
   - Quantos municípios atende

2. **Portal Estadual de Diários Municipais**
   - Se o governo estadual oferece plataforma centralizada
   - URL e tipo de tecnologia
   - Cobertura (quantos municípios)

3. **Consórcios Regionais**
   - Consórcios intermunicipais com diários centralizados
   - Exemplos: CIGA (Consórcio Intermunicipal Grande ABC)

4. **Outras Plataformas Públicas**
   - Qualquer outro agregador não comercial identificado

### Fase 2: Análise Técnica

Para cada agregador encontrado:

1. **Acessibilidade**
   - É público e gratuito?
   - Requer cadastro/login?
   - Possui API documentada?

2. **Tecnologia**
   - Tipo de plataforma (SIGPub, customizada, etc.)
   - Formato dos dados (PDF, HTML, API JSON)
   - Facilidade de scraping

3. **Cobertura Real**
   - Listar municípios cobertos (se possível extrair)
   - Verificar se há sobreposição com o que já temos

### Fase 3: Priorização

Classificar cada agregador por:

1. **Impacto**: Quantos municípios novos adiciona
2. **Facilidade**: Quão fácil é implementar o spider
3. **Confiabilidade**: Plataforma estável e mantida

---

## Estados Prioritários

Focar especialmente nestes estados com menor cobertura atual:

1. **Bahia** (408 municípios - portal problemático, buscar alternativas)
2. **Acre** (22 municípios - baixa cobertura)
3. **Amapá** (16 municípios - baixa cobertura)
4. **Rondônia** (52 municípios - baixa cobertura)
5. **Roraima** (15 municípios - baixa cobertura)
6. **Tocantins** (139 municípios - baixa cobertura)
7. **Maranhão** (217 municípios - cobertura parcial)
8. **Piauí** (224 municípios - cobertura parcial)
9. **Rio Grande do Norte** (167 municípios - cobertura parcial)
10. **Mato Grosso do Sul** (79 municípios - cobertura parcial)

---

## Formato de Entrega

### Para Cada Agregador Encontrado

```markdown
### [Nome do Agregador]

**Estado(s)**: [UF]
**Tipo**: [Associação/Governamental/Consórcio]
**URL**: [link]
**Cobertura**: [X municípios]

**Tecnologia**:
- Plataforma: [SIGPub/Customizada/Outra]
- API: [Sim/Não]
- Formato: [PDF/HTML/JSON]

**Acessibilidade**:
- Público: [Sim/Não]
- Requer login: [Sim/Não]
- Facilidade de scraping: [Fácil/Média/Difícil]

**Municípios cobertos**: [Lista ou link para lista]

**Prioridade**: [Alta/Média/Baixa]
**Razão**: [Por que implementar ou não]

**Observações**: [Qualquer informação relevante]
```

### Resumo Executivo

Ao final, criar tabela consolidada:

| Estado | Agregador | Tipo | Municípios | Prioridade | Já Implementado? |
|--------|-----------|------|------------|------------|------------------|
| BA | APPM | Associação | 200 | Alta | Não |
| ... | ... | ... | ... | ... | ... |

---

## Recursos para Pesquisa

### Sites de Referência

1. **CNM (Confederação Nacional de Municípios)**
   - https://www.cnm.org.br/
   - Lista de associações estaduais filiadas

2. **IBGE - Lista de Municípios**
   - https://servicodados.ibge.gov.br/api/docs/localidades
   - Para verificar total de municípios por estado

3. **Portal da Transparência**
   - Buscar por "diário oficial municípios [estado]"

4. **Google Search Patterns**
   - "associação municípios [estado] diário oficial"
   - "diário oficial eletrônico municípios [estado]"
   - "DOEM [sigla estado]"
   - "portal transparência municípios [estado]"

### Exemplos de Busca

```
"associação municípios piauí diário oficial"
"DOEM PI" OR "diário oficial eletrônico municípios piauí"
"APPM diário oficial"
"portal diários oficiais municípios acre"
```

---

## Critérios de Exclusão

**NÃO incluir**:

1. **Plataformas comerciais privadas**
   - ADOO, e-Diário Oficial, IM Publicações, etc.
   - Qualquer serviço que cobre pelo acesso

2. **Portais de município único**
   - Diários de apenas uma cidade (ex: DOM-SP, DOM-RJ)
   - Exceto se forem capitais ou grandes cidades ainda não cobertas

3. **Agregadores de outros tipos de documentos**
   - Portais focados apenas em licitações (PNCP)
   - Portais de transparência sem diários completos

4. **Plataformas descontinuadas**
   - Sites fora do ar ou sem atualizações há mais de 1 ano

---

## Exemplo de Resultado Esperado

### APPM (Associação Piauiense de Municípios)

**Estado(s)**: PI  
**Tipo**: Associação estadual de municípios  
**URL**: https://www.appm.org.br/diario-oficial/  
**Cobertura**: 180 municípios (de 224 total no PI)

**Tecnologia**:
- Plataforma: SIGPub
- API: Sim (padrão SIGPub)
- Formato: PDF + JSON

**Acessibilidade**:
- Público: Sim
- Requer login: Não
- Facilidade de scraping: Fácil (API JSON)

**Municípios cobertos**: [Link para lista completa]

**Prioridade**: **ALTA**  
**Razão**: 
- 180 municípios novos potenciais
- Plataforma SIGPub já conhecida (fácil implementação)
- Estado com baixa cobertura atual

**Observações**: 
- Usar mesmo spider base do SIGPub existente
- Apenas adicionar configurações ao `sigpub-cities.json`
- Estimativa: 2 horas de trabalho

---

## Entregáveis Finais

1. **AGGREGATORS_RESEARCH_COMPLETE.md**
   - Documento consolidado com todos os agregadores encontrados
   - Organizado por estado
   - Com análise técnica de cada um

2. **PRIORITY_LIST.md**
   - Lista priorizada dos agregadores a implementar
   - Estimativa de esforço para cada um
   - Impacto esperado (quantos municípios novos)

3. **IMPLEMENTATION_ROADMAP.md**
   - Plano de implementação sequencial
   - Agrupamento por tipo de plataforma
   - Cronograma estimado

---

## Métricas de Sucesso

- **Objetivo mínimo**: Encontrar 10+ novos agregadores não comerciais
- **Objetivo desejável**: Cobrir todos os 27 estados (26 + DF)
- **Objetivo ideal**: Identificar caminho para +500 municípios novos

---

## Observações Importantes

1. **Focar em agregadores, não municípios individuais**
   - Um agregador com 50 municípios é melhor que 50 portais individuais

2. **Priorizar plataformas padronizadas**
   - SIGPub, DOEM, e outras plataformas replicadas são mais fáceis

3. **Documentar mesmo se não for viável**
   - Se encontrar um agregador mas for muito difícil, documentar para referência futura

4. **Verificar sobreposição**
   - Checar se os municípios já estão cobertos por outra fonte

---

## Contexto Adicional

### Situação Atual do Projeto

- **Total de municípios no Brasil**: 5.570
- **Cobertura atual**: ~2.562 municípios (46%)
- **Meta**: Chegar a 70%+ (3.900+ municípios)
- **Gap**: ~1.338 municípios para atingir 70%

### Desafios Conhecidos

1. **Bahia**: 408 municípios configurados mas portal com proteção anti-bot
2. **Pequenos municípios**: Muitos não têm diário oficial eletrônico
3. **Portais customizados**: 85 municípios têm portais únicos (difícil escalar)

### Oportunidades

1. **SIGPub**: Plataforma presente em vários estados, fácil de adicionar
2. **Associações estaduais**: Muitas têm diários centralizados
3. **Consórcios**: Grupos regionais podem ter plataformas compartilhadas

---

## Começar Agora

**Primeira ação**: Pesquisar associações de municípios dos 10 estados prioritários listados acima, começando pela Bahia (buscar alternativa ao portal problemático).

**Método sugerido**:
1. Google: "associação municípios [estado] diário oficial"
2. Acessar site da associação
3. Procurar seção de "Diário Oficial" ou "Transparência"
4. Documentar URL, tecnologia e cobertura
5. Repetir para próximo estado

Boa sorte! 🚀
