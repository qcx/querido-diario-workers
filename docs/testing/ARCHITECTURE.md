# Arquitetura do Sistema de Testes Automatizados

**Autor:** Manus AI
**Data:** 04/10/2025

## 1. Visão Geral

O sistema de testes automatizados para o projeto **Querido Diário Workers** foi projetado para ser robusto, extensível e eficiente. Seu objetivo principal é validar continuamente o funcionamento dos mais de 1.200 spiders de coleta de diários oficiais, garantindo a integridade e a confiabilidade dos dados coletados.

A arquitetura é modular e se baseia em componentes desacoplados que podem ser expandidos e mantidos de forma independente. O sistema foi construído em TypeScript e se integra perfeitamente ao ecossistema do projeto existente.

## 2. Componentes Principais

O sistema é composto por cinco camadas principais, cada uma com responsabilidades bem definidas:

1.  **Core (Núcleo):** Orquestra a execução dos testes.
2.  **Validators (Validadores):** Verificam a qualidade e a integridade dos dados.
3.  **Reporters (Relatórios):** Geram saídas em múltiplos formatos.
4.  **CLI (Utilitários):** Fornecem uma interface de linha de comando para interações manuais.
5.  **CI/CD (Integração Contínua):** Automatizam a execução dos testes em resposta a eventos.

![Diagrama de Arquitetura](https://i.imgur.com/example.png)  *Nota: Diagrama de exemplo. Um diagrama real seria gerado e inserido aqui.*

### 2.1. Core (Núcleo)

O núcleo do sistema é responsável por carregar as configurações, selecionar as cidades a serem testadas e gerenciar a execução paralela.

| Componente | Descrição |
| --- | --- |
| `TestRunner` | Classe principal que orquestra todo o fluxo de testes. Carrega a configuração, seleciona as cidades com base no modo de execução (`full`, `sample`, etc.), gerencia um pool de workers para execução paralela e agrega os resultados. |
| `TestConfig` | Define a configuração da suíte de testes, incluindo número de workers, timeouts, modo de execução e outras opções. Permite a criação de presets para diferentes cenários. |
| `SpiderRegistry` | Componente existente no projeto, utilizado para carregar as configurações de todas as cidades e instanciar os spiders correspondentes. |

### 2.2. Validators (Validadores)

Os validadores são responsáveis por aplicar um conjunto de regras para garantir que os dados coletados pelos spiders sejam válidos e confiáveis.

| Componente | Descrição |
| --- | --- |
| `TestValidator` | Orquestrador dos validadores. Executa um spider e passa os resultados para os validadores específicos. |
| `StructureValidator` | Verifica se a estrutura dos dados retornados (array de `Gazette`) está correta, incluindo a presença de campos obrigatórios e a validade dos tipos de dados. |
| `ContentValidator` | Valida o conteúdo dos dados, como a consistência do `territoryId`, a validade das datas e a acessibilidade das URLs dos PDFs (através de requisições `HEAD`). |
| `PerformanceValidator` | Mede e valida métricas de performance, como o tempo de execução do spider e o número de requisições HTTP realizadas. |

### 2.3. Reporters (Relatórios)

O sistema de relatórios gera saídas detalhadas sobre os resultados dos testes em vários formatos, atendendo a diferentes necessidades (análise automatizada, visualização humana, etc.).

| Componente | Descrição |
| --- | --- |
| `JsonReporter` | Gera um relatório JSON detalhado, ideal para processamento automatizado e integração com outras ferramentas. |
| `HtmlReporter` | Cria um dashboard HTML interativo e visualmente rico, com gráficos, tabelas e filtros. |
| `MarkdownReporter` | Produz um relatório em Markdown, legível e fácil de incorporar em documentações ou issues do GitHub. |
| `CsvReporter` | Gera um arquivo CSV simples, útil para análises em planilhas. |
| `ConsoleReporter` | Exibe um resumo dos resultados diretamente no console, com cores e formatação para fácil leitura. |

### 2.4. CLI (Utilitários)

Os scripts de linha de comando permitem que os desenvolvedores executem testes de forma rápida e direcionada durante o desenvolvimento ou a depuração.

| Script | Descrição |
| --- | --- |
| `run-tests.ts` | Script principal para executar suítes de testes completas ou amostrais. |
| `test-city.ts` | Executa o teste para uma única cidade, fornecendo um output detalhado. |
| `test-platform.ts` | Executa os testes para todas as cidades de uma plataforma específica. |

### 2.5. CI/CD (Integração Contínua)

A integração com o GitHub Actions automatiza a execução dos testes, garantindo monitoramento contínuo e detecção rápida de problemas.

| Workflow | Descrição |
| --- | --- |
| `test-sample-daily.yml` | Executa um teste amostral diariamente para um feedback rápido sobre a saúde geral do sistema. Cria uma issue automaticamente em caso de falhas críticas. |
| `test-full-weekly.yml` | Executa um teste completo semanalmente, fornecendo uma visão abrangente do status de todos os spiders. Gera um relatório detalhado e cria uma issue se a taxa de sucesso for baixa. |
| `test-on-demand.yml` | Permite a execução manual de qualquer tipo de teste através da interface do GitHub Actions, com parâmetros customizáveis. |

## 3. Fluxo de Execução

O fluxo de execução de um teste segue as seguintes etapas:

1.  **Inicialização:** O `TestRunner` é instanciado com uma configuração (`TestConfig`).
2.  **Seleção de Cidades:** O `TestRunner` utiliza o `SpiderRegistry` para obter a lista de todas as cidades e as filtra com base no modo de teste (ex: `sample`, `platform`).
3.  **Execução Paralela:** As cidades selecionadas são divididas em lotes e processadas por um pool de workers. Cada worker executa o teste para uma cidade.
4.  **Teste de Cidade:**
    a. Uma instância do spider correspondente é criada.
    b. O `TestValidator` é invocado para executar o spider e validar os resultados.
    c. O spider executa o método `crawl()` para buscar os diários.
    d. Os validadores (`Structure`, `Content`, `Performance`) analisam os resultados e as métricas.
    e. Um objeto `CityTestResult` é retornado com o status, as métricas e os detalhes da validação.
5.  **Agregação:** O `TestRunner` coleta os resultados de todos os workers.
6.  **Geração de Relatórios:** Após a conclusão de todos os testes, o `TestRunner` invoca os `Reporters` configurados para gerar os relatórios (JSON, HTML, etc.) e salvá-los no diretório de saída.
7.  **Análise de Tendências:** O resultado da suíte é salvo em um arquivo de histórico (`history.json`) para permitir a análise de tendências ao longo do tempo.

## 4. Extensibilidade

A arquitetura foi projetada para ser facilmente extensível:

-   **Novos Validadores:** Novos validadores podem ser criados e adicionados ao `TestValidator` para verificar aspectos adicionais dos dados.
-   **Novos Formatos de Relatório:** Novos `Reporters` podem ser implementados para suportar formatos de saída adicionais.
-   **Novos Modos de Teste:** Novos modos de execução podem ser adicionados ao `TestRunner` para cenários de teste específicos.

Essa abordagem modular garante que o sistema de testes possa evoluir junto com o projeto Querido Diário Workers, adaptando-se a novas necessidades e desafios.

