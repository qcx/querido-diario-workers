# Guia de Uso do Sistema de Testes Automatizados

**Autor:** Manus AI
**Data:** 04/10/2025

Este guia descreve como utilizar o sistema de testes automatizados do projeto **Querido Diário Workers**. Ele aborda a execução de testes localmente, a interpretação dos relatórios e como adicionar novos testes.

## 1. Executando Testes Localmente

O sistema de testes pode ser executado localmente através de scripts `npm`. Antes de começar, certifique-se de que todas as dependências estão instaladas com `npm install`.

### 1.1. Testar uma Única Cidade

Para testar uma cidade específica, use o script `test:city`. Este é o método mais recomendado para depurar um spider.

```bash
npm run test:city <city-id>
```

**Exemplo:**

```bash
npm run test:city ba_acajutiba
```

O script exibirá um output detalhado no console e salvará um relatório JSON no diretório `test-results/`.

### 1.2. Testar uma Plataforma

Para testar todas as cidades que utilizam uma mesma plataforma (tipo de spider), use o script `test:platform`.

```bash
npm run test:platform <platform-name>
```

**Exemplo:**

```bash
npm run test:platform doem
```

Este comando executará os testes para todas as cidades da plataforma `doem` e gerará relatórios completos (console, JSON, HTML) no diretório `test-results/`.

### 1.3. Executar Testes Amostrais (Sample)

Para uma verificação rápida da saúde geral do sistema, execute um teste amostral. Por padrão, ele testa 10% das cidades.

```bash
npm run test:automated:sample
```

Você pode customizar a porcentagem da amostra e o número de workers:

```bash
npm run test:automated:sample -- --sample 20 --workers 15
```

### 1.4. Executar Testes Completos (Full)

Para testar todas as cidades, execute o teste completo. **Atenção:** este processo pode levar várias horas.

```bash
npm run test:automated:full
```

Você pode ajustar o número de workers para otimizar a execução:

```bash
npm run test:automated:full -- --workers 20
```

## 2. Interpretando os Relatórios

O sistema gera relatórios em múltiplos formatos, salvos no diretório `test-results/`. Cada execução cria um conjunto de arquivos com um timestamp.

### 2.1. Relatório HTML (`*.html`)

Este é o formato mais amigável para visualização. Abra o arquivo em um navegador para ver um dashboard interativo com:

-   **Summary:** Métricas gerais da execução (taxa de sucesso, duração, etc.).
-   **Platform Breakdown:** Tabela com o desempenho de cada plataforma.
-   **Test Results:** Lista detalhada de todas as cidades testadas, com filtros por status.
-   **Failures:** Detalhes específicos sobre cada falha, incluindo mensagens de erro e validações que falharam.

### 2.2. Relatório JSON (`*.json`)

Contém todos os dados brutos da execução. É útil para análises programáticas ou para depuração aprofundada. A estrutura segue os tipos definidos em `src/testing/types.ts`.

### 2.3. Relatório Markdown (`*.md`)

Fornece um resumo conciso da execução, ideal para ser colado em issues do GitHub, pull requests ou documentação. Inclui:

-   Resumo estatístico.
-   Tabela de desempenho por plataforma.
-   Lista das principais falhas.
-   Recomendações automatizadas.

### 2.4. Saída do Console

Durante a execução, um relatório é exibido diretamente no console, fornecendo feedback em tempo real. Ele apresenta um resumo similar ao do relatório Markdown.

## 3. Adicionando Novos Testes

O sistema de testes é projetado para ser automático. Quando um novo spider é adicionado ao `src/spiders/registry.ts`, ele é automaticamente incluído na próxima execução de testes (amostral ou completa).

Não é necessário criar arquivos de teste específicos para novos spiders. O `TestRunner` e os `Validators` são genéricos o suficiente para cobrir todos os spiders que seguem a arquitetura base.

## 4. Investigando Falhas

Quando um teste falha, siga estes passos para investigar:

1.  **Analise o Relatório HTML:** Verifique a seção de falhas para entender o erro. A mensagem de erro e as validações que falharam geralmente indicam a causa raiz (ex: `pdf_urls_accessible: false` sugere um problema com os links dos arquivos).

2.  **Execute o Teste Localmente:** Use o script `test:city` para re-executar o teste da cidade que falhou. O output detalhado no console fornecerá mais informações.

    ```bash
    npm run test:city <city-id-que-falhou>
    ```

3.  **Verifique a Plataforma:** Se várias cidades da mesma plataforma estão falhando, o problema pode ser na plataforma em si (ex: o site da prefeitura está fora do ar ou mudou de layout). Use o `test:platform` para confirmar.

4.  **Depure o Spider:** Se o problema for específico de um spider, adicione logs (`console.log`) ao código do spider em `src/spiders/base/` e re-execute o teste local para entender o fluxo de execução e o ponto de falha.

## 5. Configurações Avançadas

As configurações principais do sistema de testes estão no arquivo `src/testing/test-config.ts`. Você pode ajustar:

-   `DEFAULT_TEST_CONFIG`: Valores padrão para workers, timeouts, etc.
-   `TEST_PRESETS`: Configurações específicas para cada modo (`full`, `sample`).
-   `SKIP_CITIES`: Uma lista de IDs de cidades para ignorar nos testes (útil para cidades com problemas conhecidos ou em manutenção).

Modifique este arquivo com cuidado, pois alterações podem impactar a performance e a confiabilidade dos testes.

