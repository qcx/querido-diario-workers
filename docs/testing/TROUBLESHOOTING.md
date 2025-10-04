# Guia de Troubleshooting do Sistema de Testes

**Autor:** Manus AI
**Data:** 04/10/2025

Este documento fornece soluções para problemas comuns que podem ocorrer durante a execução do sistema de testes automatizados do **Querido Diário Workers**.

## 1. Problemas Comuns e Soluções

### 1.1. Testes Falhando em Massa (Baixa Taxa de Sucesso)

**Sintoma:** A taxa de sucesso em uma execução (diária ou semanal) cai drasticamente.

**Causas Possíveis e Soluções:**

1.  **Mudança em uma Plataforma Principal:** Uma plataforma usada por muitas cidades (ex: `instar`, `doem`) pode ter mudado seu layout, URL ou API.
    -   **Diagnóstico:** Verifique o relatório na seção "Platform Breakdown". Se uma plataforma específica tem uma taxa de sucesso de 0% ou muito baixa, ela é a provável culpada.
    -   **Solução:** Investigue a plataforma. Acesse o site manualmente e compare com o código do spider correspondente em `src/spiders/base/`. Atualize o spider para se adaptar às mudanças.

2.  **Problema de Rede ou Bloqueio por IP:** Os servidores das prefeituras podem estar bloqueando o IP da máquina que executa os testes (local ou do GitHub Actions).
    -   **Diagnóstico:** As mensagens de erro geralmente são `Timeout`, `Connection refused`, `403 Forbidden` ou `ECONNRESET`.
    -   **Solução:** Tente executar os testes de uma rede diferente. Se o problema ocorrer no CI/CD, pode ser necessário implementar um proxy ou um serviço de rotação de IP (uma solução mais complexa).

3.  **Dependência Quebrada:** Uma atualização de uma dependência do projeto (ex: `cheerio`, `puppeteer`) pode ter introduzido uma alteração que quebra a compatibilidade.
    -   **Diagnóstico:** Os erros podem ser variados e ocorrer em múltiplos spiders sem um padrão claro. Verifique o histórico de commits e as atualizações de pacotes recentes.
    -   **Solução:** Faça o downgrade da dependência para uma versão anterior que funcionava e investigue a alteração que causou a quebra.

### 1.2. Testes de uma Cidade Específica Falhando Consistentemente

**Sintoma:** Uma ou mais cidades falham repetidamente, enquanto outras da mesma plataforma funcionam.

**Causas Possíveis e Soluções:**

1.  **Configuração Específica da Cidade:** A cidade pode ter uma configuração de URL ou um ID de plataforma ligeiramente diferente.
    -   **Diagnóstico:** Execute o teste localmente com `npm run test:city <city-id>`. Analise as URLs que o spider tenta acessar.
    -   **Solução:** Verifique o arquivo de configuração da plataforma em `src/spiders/configs/` (ex: `doem-cities.json`) e corrija a entrada da cidade com problema.

2.  **Site da Prefeitura Fora do Ar:** O site específico daquela prefeitura pode estar temporariamente ou permanentemente fora do ar.
    -   **Diagnóstico:** Acesse a URL base do spider manualmente em um navegador.
    -   **Solução:** Se o site estiver fora do ar, aguarde e tente novamente mais tarde. Se o problema persistir por vários dias, pode ser necessário marcar a cidade para ser ignorada (`SKIP_CITIES` em `test-config.ts`) e criar uma issue para monitorar.

3.  **Ausência de Diários Recentes:** O spider funciona, mas não encontra diários no período de busca (últimos 7 dias).
    -   **Diagnóstico:** O teste pode falhar se a validação `canFetchGazettes` estiver configurada para exigir pelo menos um diário. Verifique o site da prefeitura para confirmar se houve publicações recentes.
    -   **Solução:** Se a ausência de publicações for normal, o teste não deveria falhar. Ajuste o `MIN_GAZETTES_THRESHOLD` em `test-config.ts` para `0` se necessário, para que testes com zero diários encontrados ainda possam passar.

### 1.3. Testes com Timeout

**Sintoma:** Testes falham com a mensagem `Test timeout`.

**Causas Possíveis e Soluções:**

1.  **Plataforma Lenta:** O site da prefeitura é muito lento para responder.
    -   **Diagnóstico:** Ocorre consistentemente para cidades de uma mesma plataforma.
    -   **Solução:** Aumente o `timeoutPerCity` em `src/testing/test-config.ts`. Para spiders que usam Puppeteer (`adiarios_v2`), pode ser necessário um timeout maior. Considere criar uma entrada específica em `SPIDER_TIMEOUTS`.

2.  **Processamento Pesado no Spider:** O spider está fazendo um processamento muito intensivo que excede o tempo limite.
    -   **Diagnóstico:** Ocorre mesmo em redes rápidas. Perfis de uso de CPU podem mostrar picos.
    -   **Solução:** Otimize o código do spider. Evite loops desnecessários, otimize seletores de DOM e, se possível, reduza o número de requisições.

### 1.4. Falsos Positivos

**Sintoma:** Um teste falha, mas ao ser re-executado manualmente, ele passa.

**Causas Possíveis e Soluções:**

1.  **Instabilidade Temporária da Rede:** Problemas momentâneos de rede podem causar falhas.
    -   **Diagnóstico:** As falhas são esporádicas e não seguem um padrão.
    -   **Solução:** O sistema já implementa um mecanismo de retry. Se o problema for frequente, considere aumentar o `maxRetries` em `test-config.ts`.

2.  **Rate Limiting:** O sistema fez muitas requisições em um curto período e foi temporariamente bloqueado.
    -   **Diagnóstico:** Erros `429 Too Many Requests` ou timeouts que ocorrem após uma série de testes bem-sucedidos na mesma plataforma.
    -   **Solução:** Ajuste o `rateLimitPerDomain` e o `requestDelay` em `test-config.ts` para ser menos agressivo com os servidores.

## 2. Como Ignorar Cidades

Em alguns casos, pode ser necessário ignorar temporariamente uma cidade nos testes automatizados (ex: a prefeitura está migrando de sistema, o site está em manutenção prolongada, etc.).

Para fazer isso, adicione o `id` da cidade ao array `SKIP_CITIES` no arquivo `src/testing/test-config.ts`.

```typescript
// src/testing/test-config.ts

export const SKIP_CITIES: string[] = [
  // Adicione o ID da cidade aqui
  'ba_acajutiba', // Exemplo: Acajutiba está em manutenção
  'sp_sao_paulo', // Exemplo: Spider em refatoração
];
```

Adicione um comentário explicando por que a cidade está sendo ignorada. É uma boa prática revisar esta lista periodicamente e remover as cidades que já foram corrigidas.

