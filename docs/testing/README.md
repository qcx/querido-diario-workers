# Sistema de Testes Automatizados - Querido Diário Workers

**Autor:** Manus AI  
**Data:** 04/10/2025

## 📋 Visão Geral

Este é o sistema completo de testes automatizados para o projeto **Querido Diário Workers**. Ele valida continuamente o funcionamento de mais de **364 spiders** de coleta de diários oficiais de municípios brasileiros, garantindo a integridade e a confiabilidade dos dados coletados.

O sistema foi projetado para ser:

-   ✅ **Robusto:** Valida estrutura, conteúdo e performance dos spiders.
-   🚀 **Eficiente:** Execução paralela com rate limiting para não sobrecarregar servidores.
-   📊 **Detalhado:** Relatórios em múltiplos formatos (JSON, HTML, Markdown, CSV, Console).
-   🔄 **Automatizado:** Integração com GitHub Actions para execução periódica.
-   🔧 **Extensível:** Arquitetura modular que facilita a adição de novos validadores e relatórios.

## 🚀 Início Rápido

### Instalação

```bash
npm install
```

### Testar uma Cidade

```bash
npm run test:city ba_acajutiba
```

### Testar uma Plataforma

```bash
npm run test:platform doem
```

### Executar Teste Amostral (10% das cidades)

```bash
npm run test:automated:sample
```

### Executar Teste Completo (todas as cidades)

```bash
npm run test:automated:full
```

## 📚 Documentação

A documentação completa está organizada nos seguintes documentos:

-   **[TESTING_GUIDE.md](./TESTING_GUIDE.md):** Guia de uso do sistema de testes, incluindo como executar testes localmente e interpretar relatórios.
-   **[ARCHITECTURE.md](./ARCHITECTURE.md):** Arquitetura do sistema, descrevendo os componentes principais e o fluxo de execução.
-   **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md):** Guia de solução de problemas comuns.

## 📊 Estrutura do Projeto

```
src/testing/
├── index.ts                  # Exportações principais
├── test-runner.ts            # Orquestrador de testes
├── test-config.ts            # Configurações e presets
├── types.ts                  # Tipos e interfaces
├── validators/               # Validadores de dados
│   ├── test-validator.ts
│   ├── structure-validator.ts
│   ├── content-validator.ts
│   └── performance-validator.ts
├── reports/                  # Geradores de relatórios
│   ├── json-reporter.ts
│   ├── html-reporter.ts
│   ├── markdown-reporter.ts
│   ├── csv-reporter.ts
│   └── console-reporter.ts
├── monitoring/               # Monitoramento e análise
│   ├── health-checker.ts
│   └── trend-analyzer.ts
└── utils/                    # Utilitários auxiliares
    └── test-helpers.ts

scripts/
├── run-tests.ts              # Script principal de execução
├── test-city.ts              # Testar cidade específica
└── test-platform.ts          # Testar plataforma específica

.github/workflows/
├── test-sample-daily.yml     # Teste amostral diário
├── test-full-weekly.yml      # Teste completo semanal
└── test-on-demand.yml        # Teste sob demanda
```

## 🧪 Modos de Teste

O sistema suporta cinco modos de execução:

| Modo | Descrição | Uso Recomendado |
| --- | --- | --- |
| **Sample** | Testa uma amostra (10% por padrão) das cidades | Verificação rápida diária |
| **Full** | Testa todas as cidades | Verificação completa semanal |
| **Platform** | Testa todas as cidades de uma plataforma | Depuração de problemas de plataforma |
| **Single** | Testa uma ou mais cidades específicas | Depuração de spiders individuais |
| **Regression** | Testa apenas cidades que falharam anteriormente | Validação de correções |

## 📈 Integração com CI/CD

O sistema está integrado ao GitHub Actions com três workflows:

-   **Daily Sample Test:** Executa diariamente às 6h UTC (3h BRT). Cria uma issue automaticamente se a taxa de sucesso for abaixo de 80%.
-   **Weekly Full Test:** Executa semanalmente aos domingos às 2h UTC (23h sábado BRT). Gera um relatório completo e cria uma issue se a taxa de sucesso for abaixo de 90%.
-   **On-Demand Test:** Permite execução manual de qualquer modo de teste através da interface do GitHub Actions.

## 📄 Relatórios

Os relatórios são salvos no diretório `test-results/` e incluem:

-   **JSON:** Dados completos para processamento automatizado.
-   **HTML:** Dashboard interativo com gráficos e filtros.
-   **Markdown:** Resumo legível para documentação e issues.
-   **CSV:** Dados tabulares para análise em planilhas.
-   **Console:** Saída formatada no terminal.

## 🔧 Configuração

As configurações principais estão em `src/testing/test-config.ts`:

-   `DEFAULT_TEST_CONFIG`: Valores padrão (workers, timeouts, etc.).
-   `TEST_PRESETS`: Configurações específicas para cada modo.
-   `SKIP_CITIES`: Lista de cidades a ignorar.
-   `DOMAIN_RATE_LIMITS`: Limites de requisições por domínio.
-   `SPIDER_TIMEOUTS`: Timeouts específicos por tipo de spider.

## 🤝 Contribuindo

Para adicionar novos spiders, basta registrá-los no `src/spiders/registry.ts`. Eles serão automaticamente incluídos nos testes.

Para adicionar novos validadores ou relatórios, consulte o documento [ARCHITECTURE.md](./ARCHITECTURE.md).

## 📞 Suporte

Em caso de dúvidas ou problemas:

1.  Consulte o [TROUBLESHOOTING.md](./TROUBLESHOOTING.md).
2.  Verifique as issues abertas no GitHub.
3.  Crie uma nova issue com o label `testing` se necessário.

---

**Desenvolvido com ❤️ por Manus AI para o projeto Querido Diário**
