# Pesquisa: Plataformas Agregadoras de Diários Oficiais Municipais no Brasil

**Data**: 04 de outubro de 2025  
**Objetivo**: Identificar plataformas agregadoras que podem facilitar a coleta de diários oficiais municipais para o projeto Querido Diário

---

## Resumo Executivo

Foram identificadas **duas categorias principais** de plataformas agregadoras de diários oficiais municipais no Brasil:

1. **Plataformas comerciais centralizadas** (como ADOO) que agregam diários de múltiplos estados
2. **Associações estaduais de municípios** que operam diários oficiais regionais através da plataforma SIGPub

A pesquisa revelou que o projeto Querido Diário **já utiliza a maioria das fontes disponíveis**, incluindo o SIGPub em diversos estados. A principal descoberta é o **ADOO**, uma plataforma comercial com cobertura massiva que pode complementar áreas problemáticas.

---

## 1. ADOO - Plataforma Comercial Nacional

### Informações Gerais

**Website**: https://www.adoo.com.br/  
**Tipo**: Plataforma comercial privada  
**Cobertura**: Nacional (todos os estados)

### Estatísticas

- **2.501 diários oficiais** monitorados diariamente
- **1.800+ diários** integrados e em tempo real
- **+10.000 usuários** ativos
- **100%** de monitoramento em tempo real

### Tipos de Diários Cobertos

A plataforma ADOO agrega diários de todas as esferas e poderes, incluindo diários da União, estaduais, municipais (capitais e principais cidades), legislativos (Câmara dos Deputados, assembleias legislativas, câmaras municipais), judiciários (TSE, TREs, tribunais de justiça estaduais) e do Ministério Público de todos os estados.

### Modelo de Negócio

A plataforma oferece quatro planos de assinatura. O plano **Gratuito** (R$ 0/mês) permite acesso a todos os diários oficiais, criação de 1 alerta com 15 dias de duração, 1 busca em 1 diário por dia e download de até 5 diários por dia. O plano **Básico** (R$ 24,90/mês) oferece 5 alertas sem tempo de duração, 10 buscas por dia e download de até 10 diários por dia. O plano **Premium** (R$ 29,90/mês) é o recomendado e inclui 10 alertas sem tempo de duração, 20 buscas por dia e download de até 20 diários por dia. O plano **Ilimitado** (sob consulta) oferece alertas, buscas e downloads ilimitados.

### Funcionalidades

A plataforma oferece criação de alertas por termos, busca em múltiplos diários, download de PDFs, envio por e-mail, notificações (push, e-mail, SMS), suporte 24h e API disponível.

### Análise para Querido Diário

**Vantagens**: Cobertura massiva de 2.501 diários oficiais, atualização em tempo real com monitoramento automático, API disponível para integração programática, dados estruturados (sistema já processa e indexa os diários) e cobertura nacional completa de todos os estados e principais municípios.

**Desvantagens**: Serviço pago que requer assinatura (API provavelmente tem custo separado), não é open source (dados proprietários), foco em capitais e grandes cidades (pode não cobrir todos os pequenos municípios) e limitações de uso com planos que têm quotas de busca e download.

**Recomendação**: Entrar em contato com ADOO para explorar possibilidade de **parceria institucional** ou convênio para projeto de transparência/acadêmico antes de considerar contratação comercial.

---

## 2. SIGPub - Sistema Gerenciador de Publicações Legais

### Informações Gerais

**Website**: https://www.diariomunicipal.com.br/  
**Tipo**: Plataforma técnica operada por associações estaduais de municípios  
**Modelo**: Descentralizado por estado

### Estados com SIGPub Identificados

A pesquisa identificou as seguintes associações estaduais operando através do SIGPub:

**Região Norte**:
- **AAM** (Associação Amazonense de Municípios) - https://www.diariomunicipal.com.br/aam/
- **Pará** - Diversos municípios

**Região Nordeste**:
- **AMUPE** (Associação Municipalista de Pernambuco) - https://www.diariomunicipal.com.br/amupe/
- **AMA** (Associação dos Municípios Alagoanos)
- **Bahia** - Múltiplas entidades
- **Sergipe** - Cobertura estadual

**Região Sul**:
- **AMP** (Associação dos Municípios do Paraná) - https://www.diariomunicipal.com.br/amp/
- **FAMURS** (Federação das Associações de Municípios do Rio Grande do Sul) - https://www.diariomunicipal.com.br/famurs/

**Região Sudeste**:
- **Minas Gerais** - Diversos municípios
- **Espírito Santo** - AMUNES (Associação dos Municípios do Espírito Santo)

### Status no Querido Diário

O projeto **já utiliza SIGPub** como uma das fontes principais. O arquivo `sigpub-cities.json` contém **1.723 municípios** configurados, incluindo os 62 municípios do Amazonas adicionados nesta implementação.

---

## 3. DOM/SC - Diário Oficial dos Municípios de Santa Catarina

### Informações Gerais

**Website**: https://www.diariomunicipal.sc.gov.br/  
**Tipo**: Plataforma estadual governamental  
**Cobertura**: Santa Catarina

### Características

Plataforma oficial do governo de Santa Catarina que publica leis, decretos, licitações e demais publicações oficiais de mais de **550 entidades distintas** no estado.

### Status no Querido Diário

O projeto **já possui spider** específico para DOM-SC (`dom-sc-spider.ts`), implementado recentemente e funcional.

---

## 4. Diários Oficiais Estaduais Específicos

### Plataformas Identificadas por Estado

**Piauí**: Diário Oficial dos Municípios - https://www.diarioficialdosmunicipios.org/ (desenvolve a função de dar publicidade aos atos oficiais públicos dos municípios piauienses)

**Roraima**: AMR (Associação dos Municípios de Roraima) - https://amrr.org.br/diario-oficial-2/

**Maceió (AL)**: Sistema próprio com múltiplas entidades (Prefeitura de Maceió, Maceió Investe, Maceió Saúde)

**Belo Horizonte (MG)**: DOM-BH - https://dom-web.pbh.gov.br/ (Diário Oficial do Município de Belo Horizonte)

### Observação

A maioria dessas plataformas específicas provavelmente **já está coberta** pelos spiders existentes no projeto Querido Diário ou são casos isolados de municípios individuais.

---

## 5. Outras Plataformas Comerciais

### e-Diário Oficial

**Website**: https://e-diariooficial.com/  
**Tipo**: Serviço comercial de publicação  
**Foco**: Facilitação de envio de matérias para publicação (não é agregador)

**Análise**: Não é uma plataforma agregadora de consulta, mas sim um serviço para **envio** de publicações. Não é útil para o projeto Querido Diário.

### IM Publicações

**Website**: https://impublicacoes.org/  
**Tipo**: Portal focado em contratações públicas  
**Foco**: PNCP (Portal Nacional de Contratações Públicas)

**Análise**: Focado em licitações e contratos, não em diários oficiais completos. Pode ser complementar mas não substitui diários oficiais.

---

## 6. Análise Comparativa

### Cobertura Atual do Querido Diário

Segundo o relatório de implementação, o projeto atualmente possui:

- **~2.497 municípios** configurados antes desta implementação
- **+65 municípios funcionais** adicionados (MT e AM)
- **+408 municípios configurados** (BA, não funcional)
- **20 tipos diferentes de spiders**

### Cobertura do ADOO

- **2.501 diários oficiais** (inclui estaduais, municipais, legislativos, judiciários, MP)
- Não está claro quantos são **especificamente municipais**
- Provavelmente cobre **capitais e grandes cidades** prioritariamente

### Gap de Cobertura

Considerando que o Brasil possui **5.570 municípios**, ainda existe um gap significativo de cobertura. A questão é determinar se o ADOO cobre municípios que o Querido Diário ainda não alcançou, especialmente pequenos municípios do interior.

---

## 7. Recomendações Estratégicas

### Curto Prazo (Imediato)

1. **Contatar ADOO** para solicitar:
   - Lista completa de municípios cobertos (especificamente municipais, não estaduais)
   - Informações sobre API (documentação, preços, limites)
   - Possibilidade de parceria institucional/acadêmica para projeto de transparência
   - Período de teste gratuito da API

2. **Mapear gap de cobertura**:
   - Cruzar lista de municípios do ADOO com municípios já cobertos pelo Querido Diário
   - Identificar quantos municípios **novos** o ADOO poderia adicionar
   - Priorizar municípios de estados problemáticos (como Bahia)

### Médio Prazo (1-3 meses)

3. **Avaliar custo-benefício**:
   - Comparar custo de assinatura API do ADOO vs. custo de desenvolvimento/manutenção de novos spiders
   - Considerar tempo economizado em manutenção
   - Avaliar qualidade e completude dos dados do ADOO

4. **Implementar estratégia híbrida**:
   - Manter spiders próprios para fontes que já funcionam bem (SIGPub, DOM-SC, etc.)
   - Usar ADOO para estados/municípios problemáticos (BA, pequenos municípios sem plataforma centralizada)
   - Priorizar open source e autonomia sempre que possível

### Longo Prazo (6-12 meses)

5. **Explorar outras associações estaduais**:
   - Contatar associações de municípios de estados ainda não cobertos
   - Verificar se possuem diários oficiais centralizados (mesmo que não via SIGPub)
   - Negociar acesso direto ou parceria

6. **Contribuir para ecossistema open source**:
   - Documentar e compartilhar spiders desenvolvidos
   - Colaborar com outros projetos de transparência
   - Pressionar por padronização de formatos de publicação

---

## 8. Próximos Passos Concretos

### Ação 1: Contato com ADOO
**Responsável**: Equipe Querido Diário  
**Prazo**: 1 semana  
**Objetivo**: Obter informações detalhadas sobre API e possibilidade de parceria

**E-mail sugerido**:
```
Assunto: Parceria Institucional - Projeto Querido Diário (Open Knowledge Brasil)

Prezados,

Somos o projeto Querido Diário, uma iniciativa da Open Knowledge Brasil que visa 
democratizar o acesso a diários oficiais municipais através de tecnologia open source.

Atualmente cobrimos ~2.500 municípios através de scraping direto e gostaríamos de 
explorar uma possível parceria com o ADOO para expandir nossa cobertura, especialmente 
em regiões onde o acesso automatizado é mais difícil.

Gostaríamos de agendar uma conversa para discutir:
1. Cobertura exata de municípios do ADOO
2. Possibilidade de acesso à API para projeto de transparência/acadêmico
3. Formatos de dados disponibilizados
4. Condições especiais para organizações sem fins lucrativos

Aguardamos retorno.

Atenciosamente,
[Nome]
Projeto Querido Diário - Open Knowledge Brasil
```

### Ação 2: Mapear Associações Estaduais Restantes
**Responsável**: Equipe técnica  
**Prazo**: 2 semanas  
**Objetivo**: Identificar associações de municípios em estados ainda não cobertos

**Estados prioritários**:
- Bahia (408 municípios configurados mas não funcionais)
- Acre
- Amapá
- Rondônia
- Tocantins
- Maranhão
- Rio Grande do Norte
- Mato Grosso do Sul

### Ação 3: Análise de ROI (Return on Investment)
**Responsável**: Coordenação do projeto  
**Prazo**: 1 mês  
**Objetivo**: Decidir entre desenvolver spiders próprios vs. usar API comercial

**Métricas a considerar**:
- Custo mensal de API do ADOO
- Horas de desenvolvimento economizadas
- Número de municípios adicionais cobertos
- Qualidade e confiabilidade dos dados
- Sustentabilidade a longo prazo (dependência de fornecedor)

---

## 9. Conclusão

A pesquisa revelou que o projeto Querido Diário **já está utilizando as principais fontes agregadoras disponíveis** no Brasil, especialmente o SIGPub em diversos estados. A principal oportunidade identificada é o **ADOO**, uma plataforma comercial com cobertura massiva que poderia complementar significativamente a cobertura atual, especialmente em estados problemáticos como a Bahia.

No entanto, antes de qualquer decisão de investimento, é fundamental **mapear o gap real de cobertura** entre o que o Querido Diário já possui e o que o ADOO oferece, além de explorar possibilidades de **parceria institucional** que possam reduzir ou eliminar custos.

A estratégia recomendada é **híbrida**: manter a autonomia e o caráter open source do projeto através de spiders próprios onde possível, e complementar com soluções comerciais apenas onde o custo-benefício for claramente vantajoso.

---

## Anexos

### A. Lista de Plataformas Identificadas

| Plataforma | Tipo | Cobertura | Status no QD | Prioridade |
|------------|------|-----------|--------------|------------|
| ADOO | Comercial | Nacional (2.501 diários) | Não utilizado | **ALTA** |
| SIGPub | Associações estaduais | Multi-estadual (1.723 municípios) | **JÁ UTILIZADO** | Manter |
| DOM/SC | Governamental | Santa Catarina (550+ entidades) | **JÁ UTILIZADO** | Manter |
| DOM-PI | Estadual | Piauí | A verificar | Média |
| AMR | Estadual | Roraima | A verificar | Baixa |
| e-Diário Oficial | Comercial | Nacional (envio) | Não aplicável | N/A |
| IM Publicações | Portal | Nacional (licitações) | Não aplicável | N/A |

### B. Contatos Úteis

**ADOO**
- Website: https://www.adoo.com.br/
- Contato: https://www.adoo.com.br/contato (formulário no site)

**SIGPub (VOX Tecnologia)**
- Website: https://www.diariomunicipal.com.br/
- Provedor técnico da plataforma SIGPub

**Open Knowledge Brasil**
- Coordenação do Projeto Querido Diário
- Website: https://ok.org.br/

---

**Documento elaborado por**: Manus AI  
**Data**: 04 de outubro de 2025  
**Versão**: 1.0
