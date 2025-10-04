# Análise de Plataformas Agregadoras - Diários Oficiais Municipais

**Data:** 04/10/2025  
**Objetivo:** Identificar plataformas agregadoras que podem trazer muitos diários de uma vez

---

## 🎯 Plataformas Já Implementadas

| Plataforma | Cidades | Status | Cobertura |
|------------|---------|--------|-----------|
| **Instar** | 111 | ✅ Implementado | 100% |
| **DOEM** | 56 | ✅ Implementado | 100% |
| **DOSP** | 42 | ✅ Implementado | 100% |
| **DIOF** | 21 | ✅ Implementado | 95% (20/21) |
| **SIGPub** | 3 | ✅ Implementado | 100% |
| **Total** | **233** | - | **99.6%** |

---

## 🔍 Novas Plataformas Agregadoras Identificadas

### 1. DOM/SC - Diário Oficial dos Municípios de Santa Catarina ⭐⭐⭐

**URL:** https://www.diariomunicipal.sc.gov.br/  
**Provedor:** Consórcio CIGA (Consórcio de Inovação na Gestão Pública)  
**Apoio:** FECAM (Federação Catarinense de Municípios)

**Cobertura estimada:**
- **~295 municípios de Santa Catarina** (de 295 total)
- Menciona "mais de 550 entidades" (inclui câmaras, consórcios, etc.)

**Características:**
- Plataforma unificada para todo o estado de SC
- Interface de busca avançada
- Sumários gerais e por entidade
- API não documentada publicamente

**Prioridade:** 🔥 **ALTA** - Pode adicionar ~295 cidades de uma vez

**Implementação:**
- Complexidade: Média
- Requer: Scraping HTML ou engenharia reversa da API
- Tempo estimado: 4-6 horas

---

### 2. AMUPE - Associação Municipalista de Pernambuco ⭐⭐

**URL:** https://www.diariomunicipal.com.br/amupe/  
**Provedor:** VOX Tecnologia (SIGPub)

**Cobertura estimada:**
- **~184 municípios de Pernambuco** (de 184 total)
- Plataforma unificada estadual

**Características:**
- Usa sistema SIGPub (mesma base que já implementamos)
- Interface similar ao SIGPub padrão
- Pode ter API similar

**Prioridade:** 🔥 **ALTA** - Pode adicionar ~184 cidades

**Implementação:**
- Complexidade: Baixa (similar ao SIGPub existente)
- Requer: Adaptar SigpubSpider existente
- Tempo estimado: 2-3 horas

---

### 3. DOM Estaduais (Múltiplos Estados) ⭐⭐⭐

Vários estados têm Diários Oficiais dos Municípios unificados:

#### DOM/ES - Espírito Santo
**URL:** https://ioes.dio.es.gov.br/dom  
**Cobertura:** ~78 municípios

#### DOM/PI - Piauí  
**URL:** https://www.diarioficialdosmunicipios.org/  
**Cobertura:** ~224 municípios

#### DOM/AM - Amazonas
**URL:** https://diariomunicipalaam.org.br/  
**Cobertura:** ~62 municípios

**Total estimado:** ~364 municípios

**Prioridade:** 🔥 **ALTA** - Múltiplos estados

**Implementação:**
- Complexidade: Média-Alta (cada DOM tem estrutura diferente)
- Requer: Análise individual de cada plataforma
- Tempo estimado: 3-4 horas por DOM

---

### 4. SIGPub Regional (Múltiplas Regiões) ⭐⭐

**URL Base:** https://www.diariomunicipal.com.br/

**Estados com SIGPub:**
- Amazonas
- Alagoas (4 diários)
- Bahia (2 diários)
- Ceará
- Goiás (2 diários)
- Maranhão
- Minas Gerais
- Mato Grosso
- Mato Grosso do Sul
- Pará
- Paraíba
- Paraná
- Pernambuco (AMUPE)
- Piauí
- Rio de Janeiro
- Rio Grande do Norte
- Roraima
- Rondônia
- Rio Grande do Sul

**Cobertura estimada:** ~800-1000 municípios

**Prioridade:** 🔥 **MUITO ALTA** - Maior plataforma agregadora

**Implementação:**
- Complexidade: Média (já temos base SigpubSpider)
- Requer: Expandir SigpubSpider para múltiplos estados
- Tempo estimado: 6-8 horas

---

### 5. Outras Plataformas Comerciais

#### Dioenet/GOVBR
**URL:** https://www.govbrdioenet.com.br/  
**Cobertura:** ~50-100 municípios (já implementado 4)

#### e-DOU
**URL:** https://e-dou.com.br/diario-oficial-municipal/  
**Cobertura:** Desconhecida

#### Brasil Publicações Legais
**URL:** https://diariooficial.brasilpublicacoes.com.br/  
**Cobertura:** ~50-100 municípios

---

## 📊 Resumo de Oportunidades

### Top 3 Prioridades

| Plataforma | Cidades Estimadas | Complexidade | ROI | Prioridade |
|------------|-------------------|--------------|-----|------------|
| **SIGPub Multi-Regional** | 800-1000 | Média | 🔥🔥🔥 | 1º |
| **DOM/SC** | ~295 | Média | 🔥🔥🔥 | 2º |
| **AMUPE** | ~184 | Baixa | 🔥🔥 | 3º |
| **DOM/PI** | ~224 | Média | 🔥🔥 | 4º |
| **DOM/ES** | ~78 | Média | 🔥 | 5º |

---

## 🎯 Plano de Ação Recomendado

### Fase 1: Quick Wins (1 semana)

1. ✅ **ADiarios V2** - 5 cidades (já configuradas)
2. 🔲 **AMUPE (SIGPub)** - ~184 cidades
   - Adaptar SigpubSpider existente
   - Tempo: 2-3 horas

### Fase 2: Grandes Agregadores (2-3 semanas)

3. 🔲 **SIGPub Multi-Regional** - 800-1000 cidades
   - Expandir SigpubSpider para todos os estados
   - Mapear URLs de cada estado
   - Tempo: 6-8 horas

4. 🔲 **DOM/SC** - ~295 cidades
   - Implementar spider específico
   - Engenharia reversa da API (se disponível)
   - Tempo: 4-6 horas

### Fase 3: DOMs Estaduais (3-4 semanas)

5. 🔲 **DOM/PI** - ~224 cidades
6. 🔲 **DOM/ES** - ~78 cidades
7. 🔲 **DOM/AM** - ~62 cidades

---

## 📈 Projeção de Cobertura

### Atual
- **316 cidades** (66.7% de 474)

### Após Fase 1
- **500 cidades** (105% de 474) ✅ **META ATINGIDA**

### Após Fase 2
- **1.600+ cidades** (337% de 474) 🚀 **COBERTURA TOTAL DO BRASIL**

### Observação
O projeto original tem 474 cidades, mas o Brasil tem **5.570 municípios**. Com as plataformas agregadoras, podemos ultrapassar MUITO a cobertura do projeto original.

---

## 🔧 Considerações Técnicas

### Desafios

1. **Rate Limiting**
   - Plataformas agregadoras podem ter limites mais rígidos
   - Solução: Delays maiores, distribuir requisições

2. **Estruturas Diferentes**
   - Cada DOM estadual tem estrutura própria
   - Solução: Spiders específicos por plataforma

3. **Autenticação**
   - Algumas plataformas podem requerer cadastro
   - Solução: Verificar se há acesso público ou API

4. **Volume de Dados**
   - Crawling de 1000+ cidades pode ser lento
   - Solução: Paralelização, queues, otimização

### Vantagens

1. **Dados Estruturados**
   - Plataformas agregadoras geralmente têm estrutura consistente
   - Mais fácil de manter

2. **Atualizações Centralizadas**
   - Uma mudança na plataforma afeta todas as cidades
   - Manutenção simplificada

3. **Performance**
   - Menos requisições HTTP (dados agregados)
   - Mais rápido que crawling individual

---

## 🎓 Lições do DOEM

O **DOEM** foi nossa primeira plataforma agregadora implementada:
- **56 cidades** de uma vez
- **Complexidade:** Baixa-Média
- **Tempo:** ~3 horas
- **Manutenção:** Fácil (uma classe para todas)

**Aprendizados:**
1. Plataformas agregadoras têm **ROI altíssimo**
2. Vale a pena investir tempo em engenharia reversa
3. Estrutura consistente facilita muito a implementação
4. Uma mudança beneficia todas as cidades

---

## 📚 Referências

- **DOM/SC:** https://www.diariomunicipal.sc.gov.br/
- **AMUPE:** https://www.diariomunicipal.com.br/amupe/
- **SIGPub:** https://www.diariomunicipal.com.br/
- **DOM/PI:** https://www.diarioficialdosmunicipios.org/
- **DOM/ES:** https://ioes.dio.es.gov.br/dom
- **DOM/AM:** https://diariomunicipalaam.org.br/
- **Querido Diário Original:** https://github.com/okfn-brasil/querido-diario

---

## 💡 Recomendação Final

**Priorizar plataformas agregadoras é a estratégia mais eficiente para maximizar cobertura rapidamente.**

**Ordem recomendada:**
1. ADiarios V2 (5 cidades) - já configurado
2. AMUPE (184 cidades) - baixa complexidade
3. SIGPub Multi-Regional (800-1000 cidades) - alto impacto
4. DOM/SC (295 cidades) - alto impacto
5. Outros DOMs estaduais (364+ cidades)

**Com essa estratégia, podemos atingir 1.600+ cidades em 4-6 semanas.**

---

**Criado em:** 04/10/2025  
**Autor:** Análise baseada em pesquisa de plataformas brasileiras  
**Status:** Proposta para discussão
