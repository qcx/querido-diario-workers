# Prompt para Nova Sessão: Sistema de Testes Automatizados

**Objetivo**: Implementar um sistema completo de testes automatizados que valide todas as cidades implementadas no projeto Querido Diário Workers, permitindo execução periódica para garantir que os spiders continuam funcionando.

---

## Contexto

O projeto Querido Diário Workers possui atualmente **mais de 1.200 cidades** implementadas através de diferentes spiders e plataformas. É essencial ter um sistema de testes que:

1. Valide periodicamente se todos os spiders continuam funcionando
2. Detecte mudanças nas plataformas que quebrem os spiders
3. Gere relatórios detalhados sobre o status de cada cidade
4. Permita execução tanto local quanto em CI/CD
5. Seja eficiente e não sobrecarregue os servidores das prefeituras

---

## Tarefas

### 1. Analisar Estrutura Atual

- [ ] Examinar o código existente em `src/spiders/`
- [ ] Entender como os spiders são registrados em `src/spiders/registry.ts`
- [ ] Analisar os arquivos de configuração em `src/spiders/configs/`
- [ ] Verificar testes existentes (ex: `test-*.ts`)

### 2. Criar Sistema de Testes Base

Implementar em `src/testing/`:

#### 2.1. `test-runner.ts`
Sistema principal que:
- Carrega todas as configurações de cidades
- Executa testes em paralelo (com rate limiting)
- Coleta resultados e métricas
- Gera relatórios em múltiplos formatos

#### 2.2. `test-validator.ts`
Validadores que verificam:
- Spider consegue acessar a URL
- Spider consegue buscar diários (últimos 7 dias)
- Diários retornados têm estrutura válida
- Metadados estão presentes (data, município, etc.)
- PDFs são acessíveis (verificação de URL)

#### 2.3. `test-config.ts`
Configurações do sistema de testes:
- Número de workers paralelos
- Timeout por cidade
- Período de busca (últimos N dias)
- Rate limiting por domínio
- Lista de cidades a ignorar (se necessário)

### 3. Implementar Estratégias de Teste

#### 3.1. Teste Completo (Full Test)
- Testa TODAS as cidades
- Execução: semanal ou sob demanda
- Duração estimada: 2-4 horas
- Gera relatório completo

#### 3.2. Teste Amostral (Sample Test)
- Testa amostra representativa (10-20% das cidades)
- Execução: diária
- Duração estimada: 15-30 minutos
- Gera relatório resumido

#### 3.3. Teste por Plataforma (Platform Test)
- Testa todas as cidades de uma plataforma específica
- Útil após detectar problemas em uma plataforma
- Execução: sob demanda

#### 3.4. Teste de Regressão (Regression Test)
- Testa apenas cidades que falharam anteriormente
- Execução: após correções
- Valida se problemas foram resolvidos

### 4. Sistema de Relatórios

Implementar em `src/testing/reports/`:

#### 4.1. Relatório JSON
Estrutura detalhada para processamento automatizado:
```json
{
  "timestamp": "2025-10-04T12:00:00Z",
  "testType": "full",
  "summary": {
    "total": 1200,
    "passed": 1150,
    "failed": 30,
    "skipped": 20,
    "successRate": 95.83
  },
  "results": [
    {
      "cityId": "sp_sao_paulo",
      "status": "passed",
      "duration": 2.5,
      "gazettesFound": 5,
      "errors": []
    }
  ],
  "failuresByPlatform": {
    "doem": 5,
    "instar": 10
  }
}
```

#### 4.2. Relatório HTML
Dashboard visual com:
- Gráficos de taxa de sucesso
- Lista de falhas por plataforma
- Histórico de testes
- Detalhes de cada cidade testada

#### 4.3. Relatório Markdown
Formato legível para documentação:
- Resumo executivo
- Tabelas por estado/plataforma
- Lista de cidades com problemas
- Recomendações de ação

#### 4.4. Relatório CSV
Para análise em planilhas:
- Uma linha por cidade testada
- Colunas: ID, nome, plataforma, status, diários encontrados, tempo, erro

### 5. Integração com CI/CD

Criar workflows para GitHub Actions:

#### 5.1. `.github/workflows/test-sample-daily.yml`
- Executa teste amostral diariamente
- Notifica em caso de falhas críticas
- Salva relatórios como artefatos

#### 5.2. `.github/workflows/test-full-weekly.yml`
- Executa teste completo semanalmente (domingo)
- Gera relatório completo
- Cria issue automaticamente se taxa de sucesso < 90%

#### 5.3. `.github/workflows/test-on-demand.yml`
- Permite execução manual via workflow_dispatch
- Aceita parâmetros: tipo de teste, plataforma, lista de cidades

### 6. Sistema de Monitoramento

Implementar em `src/testing/monitoring/`:

#### 6.1. `health-checker.ts`
- Verifica saúde das plataformas
- Detecta se sites estão fora do ar
- Evita falsos positivos

#### 6.2. `trend-analyzer.ts`
- Analisa histórico de testes
- Identifica degradação gradual
- Detecta padrões de falhas

#### 6.3. `alerting.ts`
- Sistema de notificações
- Integração com Slack/Discord/Email
- Alertas configuráveis por severidade

### 7. Utilitários e Scripts

Criar scripts CLI em `scripts/`:

#### 7.1. `test-city.ts`
```bash
npm run test:city sp_sao_paulo
```
Testa uma cidade específica com output detalhado

#### 7.2. `test-platform.ts`
```bash
npm run test:platform doem
```
Testa todas as cidades de uma plataforma

#### 7.3. `test-state.ts`
```bash
npm run test:state SP
```
Testa todas as cidades de um estado

#### 7.4. `generate-report.ts`
```bash
npm run report:generate --format html --input results.json
```
Gera relatório a partir de resultados salvos

### 8. Documentação

Criar em `docs/testing/`:

#### 8.1. `TESTING_GUIDE.md`
- Como executar testes localmente
- Como interpretar relatórios
- Como adicionar novos testes

#### 8.2. `TROUBLESHOOTING.md`
- Problemas comuns e soluções
- Como investigar falhas
- Quando ignorar falsos positivos

#### 8.3. `ARCHITECTURE.md`
- Arquitetura do sistema de testes
- Fluxo de execução
- Extensibilidade

---

## Requisitos Técnicos

### Dependências Necessárias

```json
{
  "dependencies": {
    "p-limit": "^5.0.0",
    "p-retry": "^6.0.0",
    "cli-progress": "^3.12.0",
    "chalk": "^5.3.0"
  },
  "devDependencies": {
    "@types/cli-progress": "^3.11.5"
  }
}
```

### Estrutura de Diretórios

```
src/
├── testing/
│   ├── test-runner.ts
│   ├── test-validator.ts
│   ├── test-config.ts
│   ├── reports/
│   │   ├── json-reporter.ts
│   │   ├── html-reporter.ts
│   │   ├── markdown-reporter.ts
│   │   └── csv-reporter.ts
│   ├── monitoring/
│   │   ├── health-checker.ts
│   │   ├── trend-analyzer.ts
│   │   └── alerting.ts
│   └── utils/
│       ├── rate-limiter.ts
│       ├── retry-handler.ts
│       └── logger.ts
scripts/
├── test-city.ts
├── test-platform.ts
├── test-state.ts
└── generate-report.ts
.github/
└── workflows/
    ├── test-sample-daily.yml
    ├── test-full-weekly.yml
    └── test-on-demand.yml
docs/
└── testing/
    ├── TESTING_GUIDE.md
    ├── TROUBLESHOOTING.md
    └── ARCHITECTURE.md
```

---

## Critérios de Sucesso

Um teste é considerado **bem-sucedido** quando:

1. ✅ Spider consegue acessar a URL da plataforma
2. ✅ Spider consegue buscar diários dos últimos 7 dias
3. ✅ Pelo menos 1 diário é encontrado (se houver publicações no período)
4. ✅ Diários retornados têm estrutura válida
5. ✅ URLs dos PDFs são acessíveis (status 200)

Um teste é considerado **falho** quando:

1. ❌ Timeout ao acessar a plataforma
2. ❌ Erro ao executar o spider
3. ❌ Estrutura de dados inválida
4. ❌ URLs de PDFs inacessíveis (404, 500, etc.)

Um teste é **ignorado** quando:

1. ⚠️ Plataforma está temporariamente fora do ar (verificado pelo health-checker)
2. ⚠️ Cidade está marcada como "skip" na configuração
3. ⚠️ Rate limit atingido (será retentado)

---

## Exemplo de Execução

### Teste Local

```bash
# Instalar dependências
npm install

# Teste completo (todas as cidades)
npm run test:full

# Teste amostral (20% das cidades)
npm run test:sample

# Teste de uma plataforma específica
npm run test:platform doem

# Teste de um estado específico
npm run test:state SP

# Teste de uma cidade específica
npm run test:city sp_sao_paulo

# Gerar relatório HTML a partir de resultados
npm run report:html
```

### Saída Esperada

```
🧪 Querido Diário Workers - Sistema de Testes
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📋 Tipo de Teste: Amostral (20%)
🏙️  Cidades Selecionadas: 240 de 1200

⏳ Executando testes...
████████████████████████████████████████ 100% | 240/240 | ETA: 0s

✅ Resultados:
   • Sucesso: 230 (95.83%)
   • Falhas: 8 (3.33%)
   • Ignorados: 2 (0.83%)

⚠️  Falhas por Plataforma:
   • doem: 3 cidades
   • instar: 5 cidades

📊 Relatórios Gerados:
   • JSON: ./test-results/2025-10-04_12-00-00.json
   • HTML: ./test-results/2025-10-04_12-00-00.html
   • Markdown: ./test-results/2025-10-04_12-00-00.md

🔗 Abrir relatório: file://./test-results/2025-10-04_12-00-00.html
```

---

## Considerações Importantes

### Rate Limiting

- Implementar rate limiting por domínio (ex: máximo 5 requisições/segundo)
- Respeitar robots.txt das plataformas
- Adicionar delays entre requisições (500ms-1s)
- Usar retry com backoff exponencial

### Performance

- Executar testes em paralelo (máximo 10-20 workers)
- Usar cache para evitar requisições duplicadas
- Timeout razoável por cidade (30-60 segundos)
- Permitir interrupção e retomada de testes longos

### Confiabilidade

- Implementar retry automático (3 tentativas)
- Distinguir falhas reais de problemas temporários
- Validar saúde da plataforma antes de marcar como falha
- Manter histórico de testes para análise de tendências

### Manutenibilidade

- Código modular e extensível
- Testes unitários para o sistema de testes
- Documentação clara e exemplos
- Logs detalhados para debugging

---

## Próximos Passos Após Implementação

1. **Executar teste completo inicial** para estabelecer baseline
2. **Configurar CI/CD** para execução automática
3. **Monitorar resultados** durante 1-2 semanas
4. **Ajustar thresholds** baseado em dados reais
5. **Criar dashboard público** para visualização de status
6. **Integrar com sistema de alertas** para notificações

---

## Referências

- **Repositório**: https://github.com/qcx/querido-diario-workers
- **Branch atual**: `main`
- **Total de cidades**: ~1.200
- **Plataformas suportadas**: DOEM, Instar, DOSP, ADiarios, SIGPub, MunicipioOnline, AtendeV2, etc.

---

**Data de Criação**: 04/10/2025  
**Autor**: Sistema de Planejamento  
**Estimativa de Tempo**: 8-12 horas para implementação completa  
**Prioridade**: Alta (essencial para manutenção do projeto)
