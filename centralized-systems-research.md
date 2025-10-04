# Pesquisa: Sistemas Centralizados de Diários Oficiais Municipais

**Data**: 4 de outubro de 2025  
**Status**: EM PROGRESSO

## Sistemas Centralizados Identificados

### ✅ 1. Santa Catarina - DOM/SC
- **URL**: https://diariomunicipal.sc.gov.br/
- **Cobertura**: **550+ entidades** (praticamente todos os 295 municípios)
- **Gerenciamento**: Consórcio CIGA (Consórcio de Inovação na Gestão Pública)
- **Plataforma**: Sistema próprio
- **Status no Sistema**: ❌ NÃO IMPLEMENTADO
- **Potencial**: +295 municípios com UM ÚNICO SPIDER
- **Prioridade**: CRÍTICA

### ✅ 2. Goiás - AGM (Associação Goiana de Municípios)
- **URL**: https://www.diariomunicipal.com.br/agm/
- **Cobertura**: Municípios associados à AGM
- **Gerenciamento**: Associação Goiana de Municípios
- **Plataforma**: SIGPub
- **Status no Sistema**: ⚠️ PARCIALMENTE (SIGPub já implementado, mas AGM pode não estar)
- **Potencial**: Verificar quantos municípios GO estão na AGM vs já no SIGPub
- **Prioridade**: ALTA

### ✅ 3. Bahia - Plataforma SIGPub Estadual
- **URL**: https://www.diariomunicipal.com.br/ (Estado da Bahia)
- **Cobertura**: A verificar
- **Gerenciamento**: Via SIGPub
- **Plataforma**: SIGPub
- **Status no Sistema**: ⚠️ PARCIALMENTE (SIGPub implementado, mas BA tem 0 cobertura)
- **Potencial**: +417 municípios
- **Prioridade**: CRÍTICA

### ✅ 4. Alagoas - Plataforma SIGPub Estadual
- **URL**: https://www.diariomunicipal.com.br/ (Estado de Alagoas)
- **Cobertura**: A verificar
- **Gerenciamento**: Via SIGPub
- **Plataforma**: SIGPub
- **Status no Sistema**: ⚠️ PARCIALMENTE (SIGPub implementado, mas AL tem 0 cobertura)
- **Potencial**: +102 municípios
- **Prioridade**: ALTA

## Estados a Pesquisar

### 🔍 Estados Prioritários (Zero Cobertura)

1. **São Paulo** (645 municípios)
   - Sistema Estadual: DOE.SP.GOV.BR
   - Imprensa Oficial
   - Status: A PESQUISAR

2. **Bahia** (417 municípios)
   - SIGPub disponível
   - Status: VERIFICAR

3. **Santa Catarina** (295 municípios)
   - ✅ DOM/SC IDENTIFICADO
   - Status: IMPLEMENTAR

4. **Goiás** (246 municípios)
   - ✅ AGM IDENTIFICADO
   - Status: VERIFICAR

5. **Maranhão** (217 municípios)
   - Status: A PESQUISAR

6. **Pará** (144 municípios)
   - Status: A PESQUISAR

7. **Tocantins** (139 municípios)
   - Status: A PESQUISAR

8. **Alagoas** (102 municípios)
   - SIGPub disponível
   - Status: VERIFICAR

9. **Rio de Janeiro** (92 municípios)
   - Status: A PESQUISAR

10. **Mato Grosso do Sul** (79 municípios)
    - Status: A PESQUISAR

11. **Espírito Santo** (78 municípios)
    - Status: A PESQUISAR

12. **Sergipe** (75 municípios)
    - Status: A PESQUISAR

13. **Amazonas** (62 municípios)
    - Status: A PESQUISAR

14. **Rondônia** (52 municípios)
    - Status: A PESQUISAR

15. **Acre** (22 municípios)
    - Status: A PESQUISAR

16. **Amapá** (16 municípios)
    - Status: A PESQUISAR

17. **Roraima** (15 municípios)
    - Status: A PESQUISAR

18. **Distrito Federal** (1 município)
    - Status: A PESQUISAR

## Padrões de Pesquisa

### URLs para Verificar por Estado

1. `https://diariomunicipal.{UF}.gov.br/`
2. `https://www.diariomunicipal.com.br/{associacao}/`
3. `https://doe.{UF}.gov.br/` (Diário Oficial Estadual)
4. `https://www.imprensaoficial.{UF}.gov.br/`

### Associações Municipalistas por Estado

- **PE**: AMUPE (✅ Implementado - 182 municípios)
- **GO**: AGM (✅ Identificado)
- **SC**: Consórcio CIGA (✅ Identificado)
- **BA**: A pesquisar
- **SP**: A pesquisar
- **MA**: A pesquisar
- **PA**: A pesquisar
- **TO**: A pesquisar
- **AL**: A pesquisar
- **RJ**: A pesquisar
- **MS**: A pesquisar
- **ES**: A pesquisar
- **SE**: A pesquisar
- **AM**: A pesquisar
- **RO**: A pesquisar
- **AC**: A pesquisar
- **AP**: A pesquisar
- **RR**: A pesquisar

## Impacto Potencial

### Se Todos os Estados Tiverem Sistemas Centralizados

| Estado | Municípios | Spider Atual | Potencial com Centralizado |
|---|---|---|---|
| SC | 295 | 0 | +295 (1 spider) |
| GO | 246 | 0 | +246 (1 spider) |
| BA | 417 | 0 | +417 (1 spider) |
| AL | 102 | 0 | +102 (1 spider) |
| **Total Top 4** | **1.060** | **0** | **+1.060 (4 spiders)** |

### Cenário Otimista

Se 50% dos estados não cobertos tiverem sistemas centralizados:
- **Potencial**: ~1.350 municípios
- **Esforço**: ~9 spiders (um por estado)
- **ROI**: 150 municípios/spider

## Próximos Passos

### Fase 1: Verificação Rápida (1 semana)

Para cada estado sem cobertura, verificar:

1. ✅ Acessar `https://diariomunicipal.{UF}.gov.br/`
2. ✅ Acessar `https://doe.{UF}.gov.br/`
3. ✅ Pesquisar "associação municipalista {estado}"
4. ✅ Verificar se SIGPub tem presença no estado

### Fase 2: Implementação (2-4 semanas)

1. Implementar DOM/SC (Santa Catarina) - PRIORIDADE 1
2. Verificar e implementar AGM (Goiás) - PRIORIDADE 2
3. Implementar outros sistemas centralizados identificados

### Fase 3: Validação

1. Testar cada spider com amostra de municípios
2. Validar cobertura real vs esperada
3. Ajustar configurações conforme necessário

## Conclusão Preliminar

A descoberta de sistemas centralizados como DOM/SC muda completamente a estratégia:

- **Antes**: Precisaríamos implementar dezenas de spiders para cobrir SC
- **Depois**: UM ÚNICO spider cobre 295 municípios

Se outros estados seguirem o mesmo padrão, podemos alcançar cobertura muito mais rápida e eficiente do que o estimado inicialmente.

**Impacto no Roadmap**: Redução significativa do tempo para 100% de cobertura (de 18 meses para possivelmente 6-9 meses).
