# Plano de Ação: Continuidade do Projeto Querido Diário

**Data**: 04 de outubro de 2025  
**Contexto**: Implementação dos spiders BA, MT e AM concluída parcialmente. ADOO descartado como opção.

---

## Situação Atual

### ✅ Implementações Bem-Sucedidas

**AMM-MT (Mato Grosso)**
- 3 municípios implementados e testados
- 100% funcional
- Pronto para produção

**AAM (Amazonas)**
- 62 municípios adicionados ao SIGPub
- 100% funcional
- Pronto para produção

**Total funcional**: **65 municípios novos**

### ⚠️ Implementação Problemática

**Diário Oficial BA (Bahia)**
- 408 municípios configurados
- Spider implementado mas **não funcional**
- Site possui proteção anti-bot ou JavaScript complexo
- Requer abordagem técnica diferente

---

## Problema Principal: Diário Oficial BA

### Diagnóstico Técnico

O site https://www.diariooficialba.com.br/ apresenta as seguintes barreiras:

1. **Formulário não responde a requisições HTTP convencionais** (GET/POST)
2. **Possível proteção anti-bot** (Cloudflare, reCAPTCHA, ou similar)
3. **JavaScript pesado** que processa a busca no client-side
4. **Sem API pública** documentada

### Tentativas Realizadas (Todas Falharam)

- ✗ HTTP GET com query strings
- ✗ HTTP POST com form data
- ✗ Browser automation básico (Playwright)
- ✗ Submissão de formulário via JavaScript

---

## Opções de Solução para Diário BA

### Opção 1: Browser Automation Avançado com Stealth Mode ⭐ RECOMENDADO

**Descrição**: Usar Playwright/Puppeteer com plugins de stealth para simular comportamento humano e evitar detecção de bots.

**Tecnologias**:
- `playwright-extra` com `playwright-extra-plugin-stealth`
- Ou `puppeteer-extra` com `puppeteer-extra-plugin-stealth`
- Rotação de User-Agents
- Delays aleatórios entre ações
- Simulação de movimentos de mouse

**Vantagens**:
- ✅ Maior chance de sucesso
- ✅ Mantém autonomia do projeto
- ✅ Open source
- ✅ Controle total sobre o processo

**Desvantagens**:
- ❌ Mais lento que HTTP direto
- ❌ Consome mais recursos (CPU/memória)
- ❌ Requer manutenção se o site mudar

**Esforço estimado**: 2-3 dias de desenvolvimento + testes

**Código exemplo**:
```typescript
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

// Simular comportamento humano
await page.goto('https://www.diariooficialba.com.br/', {
  waitUntil: 'networkidle'
});

// Aguardar carregamento completo
await page.waitForTimeout(2000 + Math.random() * 1000);

// Selecionar município com delay
await page.selectOption('select[name="cidade"]', 'SALVADOR');
await page.waitForTimeout(500 + Math.random() * 500);

// Selecionar órgão
await page.selectOption('select[name="orgao"]', 'PREFEITURA');
await page.waitForTimeout(500 + Math.random() * 500);

// Clicar no botão de busca
await page.click('button[type="submit"]');
await page.waitForNavigation({ waitUntil: 'networkidle' });

// Extrair resultados
const results = await page.evaluate(() => {
  // Lógica de extração
});
```

---

### Opção 2: Engenharia Reversa da API Interna

**Descrição**: Analisar o tráfego de rede do site para identificar chamadas de API internas e replicá-las.

**Processo**:
1. Abrir DevTools (Network tab)
2. Realizar busca manual no site
3. Identificar requisições XHR/Fetch
4. Extrair headers, cookies, tokens necessários
5. Replicar requisições em código

**Vantagens**:
- ✅ Mais rápido que browser automation
- ✅ Menos recursos computacionais
- ✅ Mais escalável

**Desvantagens**:
- ❌ Pode não funcionar se houver tokens dinâmicos
- ❌ Requer análise técnica profunda
- ❌ Pode quebrar com atualizações do site

**Esforço estimado**: 1-2 dias de análise + implementação

---

### Opção 3: Buscar Fontes Alternativas para Municípios BA

**Descrição**: Em vez de usar o Diário Oficial BA centralizado, buscar portais individuais dos municípios ou outras plataformas.

**Estratégias**:

**A) Verificar se municípios BA têm portais próprios**
- Salvador, Feira de Santana, Vitória da Conquista podem ter sistemas próprios
- Implementar spiders específicos para grandes cidades

**B) Verificar se há outros agregadores estaduais**
- DOEM-BA (Diário Oficial Eletrônico dos Municípios da Bahia)
- Associações regionais de municípios
- Consórcios municipais

**C) Usar SIGPub para municípios BA que já estão lá**
- Verificar quantos municípios BA já estão no SIGPub
- Focar apenas nos que faltam

**Vantagens**:
- ✅ Evita problema do Diário Oficial BA
- ✅ Pode ter melhor cobertura
- ✅ Fontes mais confiáveis

**Desvantagens**:
- ❌ Trabalho fragmentado
- ❌ Múltiplos spiders para manter
- ❌ Pode não cobrir todos os 408 municípios

**Esforço estimado**: 3-5 dias de pesquisa + implementação

---

### Opção 4: Contato Direto com Administradores do Site

**Descrição**: Entrar em contato com a Rede Geral (empresa que opera o Diário Oficial BA) para solicitar acesso via API ou convênio.

**Processo**:
1. Identificar contato da Rede Geral
2. Explicar o projeto Querido Diário (transparência, open source)
3. Solicitar API oficial ou documentação de acesso
4. Negociar convênio institucional

**Vantagens**:
- ✅ Solução oficial e sustentável
- ✅ Sem risco de bloqueio
- ✅ Possível acesso a dados estruturados

**Desvantagens**:
- ❌ Pode demorar (burocracia)
- ❌ Pode não ter API disponível
- ❌ Pode ter custo

**Esforço estimado**: 1-2 semanas (tempo de resposta)

---

## Recomendação Estratégica

### Curto Prazo (1-2 semanas)

**1. Colocar em produção o que já funciona**
- ✅ Deploy dos spiders AMM-MT (3 municípios)
- ✅ Deploy do SIGPub com AM (62 municípios)
- ✅ Documentar sucesso parcial da implementação

**2. Investigar fontes alternativas para BA**
- 🔍 Pesquisar se existe DOEM-BA ou similar
- 🔍 Verificar quantos municípios BA já estão no SIGPub
- 🔍 Identificar portais próprios de grandes cidades (Salvador, Feira de Santana)

**3. Tentar Opção 2 (Engenharia Reversa)**
- 🔧 Alocar 1-2 dias para análise do tráfego de rede
- 🔧 Tentar identificar API interna
- 🔧 Se funcionar, implementar spider com requisições diretas

### Médio Prazo (2-4 semanas)

**4. Se Opção 2 falhar, implementar Opção 1 (Stealth Mode)**
- 🤖 Configurar Playwright com stealth plugins
- 🤖 Implementar spider com browser automation
- 🤖 Testar em amostra de municípios
- 🤖 Otimizar performance (paralelização, cache)

**5. Paralelamente, tentar Opção 4 (Contato Oficial)**
- 📧 Enviar e-mail para Rede Geral
- 📧 Explicar projeto e solicitar parceria
- 📧 Aguardar resposta (não bloquear outras ações)

### Longo Prazo (1-3 meses)

**6. Expandir cobertura BA com fontes múltiplas**
- 📊 Combinar Diário Oficial BA + portais municipais + SIGPub
- 📊 Priorizar grandes cidades (maior impacto)
- 📊 Documentar municípios ainda não cobertos

**7. Monitorar e manter**
- 🔄 Verificar se spiders continuam funcionando
- 🔄 Atualizar quando sites mudarem
- 🔄 Expandir para outros estados

---

## Próximos Passos Imediatos

### Passo 1: Pesquisar Fontes Alternativas BA (Hoje/Amanhã)

**Ações**:
1. Buscar "DOEM Bahia" ou "Diário Oficial Eletrônico Municípios Bahia"
2. Verificar site da APPM (Associação de Municípios da Bahia) ou UPB (União dos Municípios da Bahia)
3. Listar municípios BA que já estão no SIGPub
4. Identificar portais de Salvador, Feira de Santana, Vitória da Conquista

**Resultado esperado**: Lista de fontes alternativas para municípios BA

---

### Passo 2: Engenharia Reversa do Diário BA (2-3 dias)

**Ações**:
1. Abrir https://www.diariooficialba.com.br/ com DevTools
2. Realizar busca manual e capturar tráfego de rede
3. Identificar requisições XHR/Fetch relevantes
4. Extrair headers, cookies, payloads
5. Testar replicação em código Python/TypeScript
6. Se funcionar, implementar spider

**Resultado esperado**: Spider funcional com requisições HTTP diretas OU confirmação de que não é possível

---

### Passo 3: Se Passo 2 Falhar, Implementar Stealth Mode (3-4 dias)

**Ações**:
1. Instalar `playwright-extra` e `playwright-extra-plugin-stealth`
2. Criar spider com browser automation
3. Implementar delays aleatórios e comportamento humano
4. Testar com 5-10 municípios
5. Otimizar performance
6. Documentar limitações (velocidade, recursos)

**Resultado esperado**: Spider funcional com browser automation

---

## Métricas de Sucesso

### Mínimo Viável
- ✅ 65 municípios novos em produção (AM + MT) - **JÁ ALCANÇADO**
- ✅ Documentação completa da implementação - **JÁ ALCANÇADO**
- 🎯 Identificar pelo menos 1 fonte alternativa para BA

### Objetivo Desejável
- 🎯 Spider Diário BA funcional (qualquer método)
- 🎯 Pelo menos 50 municípios BA em produção
- 🎯 Total de 115+ municípios novos

### Objetivo Ideal
- 🎯 Spider Diário BA funcional e otimizado
- 🎯 300+ municípios BA em produção
- 🎯 Total de 365+ municípios novos

---

## Recursos Necessários

### Técnicos
- Desenvolvedor com experiência em web scraping
- Conhecimento de Playwright/Puppeteer
- Capacidade de análise de tráfego de rede
- Servidor com recursos para browser automation (se necessário)

### Tempo
- **Curto prazo**: 1-2 semanas
- **Médio prazo**: 2-4 semanas
- **Longo prazo**: 1-3 meses

### Ferramentas
- Playwright ou Puppeteer
- Plugins de stealth
- DevTools para análise
- Ambiente de testes

---

## Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| Diário BA continua bloqueando | Alta | Alto | Usar fontes alternativas (portais municipais) |
| Browser automation muito lento | Média | Médio | Otimizar com paralelização e cache |
| Site muda estrutura | Baixa | Alto | Monitoramento contínuo e testes automatizados |
| Não encontrar fontes alternativas BA | Média | Alto | Focar em grandes cidades primeiro |
| Custo computacional alto | Média | Médio | Usar servidores escaláveis ou limitar frequência |

---

## Conclusão

A implementação foi **parcialmente bem-sucedida** com 65 municípios novos funcionais (AM e MT). O desafio principal é o Diário Oficial BA, que requer uma abordagem técnica mais sofisticada.

**Recomendação principal**: 

1. **Colocar em produção o que já funciona** (AM e MT)
2. **Pesquisar fontes alternativas** para BA (DOEM, portais municipais)
3. **Tentar engenharia reversa** do Diário BA (2-3 dias)
4. **Se falhar, implementar stealth mode** com Playwright (3-4 dias)

Com essa estratégia, podemos ter uma cobertura significativa de BA em 2-4 semanas, mesmo que não seja através do portal centralizado.

---

**Próxima ação**: Você gostaria que eu comece a pesquisar fontes alternativas para municípios da Bahia ou prefere que eu tente a engenharia reversa do Diário Oficial BA primeiro?
