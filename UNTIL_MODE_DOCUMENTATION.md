# Modo de Teste "Until" - Documentação

## 📋 Visão Geral

O modo **"until"** é um novo modo de teste que coleta diários oficiais (gazettes) de diferentes origens até atingir um número alvo especificado. Diferente dos outros modos que testam um conjunto pré-definido de cidades, o modo "until" **seleciona cidades aleatórias dinamicamente** até que o objetivo seja alcançado.

## 🎯 Objetivo

Coletar um número específico de PDFs de diários oficiais de **diferentes origens** (plataformas), sempre escolhendo cidades aleatórias a cada iteração.

## 🚀 Como Usar

### Comando Básico

```bash
# Usar o target padrão (15 gazettes)
npm run test:automated:until -- --target 15

# Especificar um target customizado
npm run test:automated:until -- --target 20

# Com mais opções
npx tsx scripts/run-tests.ts until --target 30 --days 7 --verbose
```

### Parâmetros Disponíveis

| Parâmetro | Descrição | Padrão | Obrigatório |
|-----------|-----------|--------|-------------|
| `--target` | Número alvo de gazettes a coletar | 15 | Sim |
| `--days` | Número de dias para buscar (retroativo) | 7 | Não |
| `--workers` | Número de workers paralelos | 5 | Não |
| `--verbose` | Ativar logs detalhados | true | Não |

## 🔄 Como Funciona

### Algoritmo

1. **Inicialização**
   - Define o target de gazettes a coletar
   - Obtém lista de todas as cidades disponíveis
   - Inicializa contadores e rastreamento de origens

2. **Loop de Coleta**
   - Seleciona uma cidade **aleatória** não testada
   - Executa o spider da cidade
   - Se encontrar gazettes:
     - Incrementa o contador total
     - Registra a origem (plataforma)
     - Exibe progresso
   - Repete até atingir o target ou esgotar cidades

3. **Finalização**
   - Gera relatórios (JSON, HTML, Markdown)
   - Exibe estatísticas de origens
   - Mostra número de cidades testadas

### Características Especiais

- ✅ **Seleção Aleatória**: Cada cidade é escolhida aleatoriamente
- ✅ **Sem Repetição**: Cada cidade é testada apenas uma vez
- ✅ **Rastreamento de Origens**: Conta gazettes por plataforma
- ✅ **Parada Inteligente**: Para quando atinge o target ou esgota cidades
- ✅ **Limite de Segurança**: Máximo de 1000 iterações para evitar loops infinitos

## 📊 Exemplo de Execução

```bash
$ npm run test:automated:until -- --target 20

🧪 Querido Diário Workers - Automated Testing System

Mode: until
Target Gazettes: 20

[INFO] Starting test execution: test-2025-10-04T15-40-23-356Z-uoaxie
[INFO] Mode: until
[INFO] Target: 20 gazettes from different origins
[INFO] Available cities: 1937

[INFO] Iteration 1: Testing sp_barretos (Barretos - SP)
[INFO] ✓ Found 4 gazettes. Total: 4/20
[INFO] Origins: instar:4

[INFO] Iteration 2: Testing ce_2300101 (Abaiara)
[INFO] ✓ Found 2 gazettes. Total: 6/20
[INFO] Origins: instar:4, sigpub:2

...

[INFO] Iteration 12: Testing ce_2306702 (Jaguaretama)
[INFO] ✓ Found 2 gazettes. Total: 21/20
[INFO] Origins: sigpub:14, instar:7

[INFO] Collection completed: 21 gazettes from 2 different origins
[INFO] Cities tested: 12
[INFO] Success rate: 100.00%

================================================================================
TEST EXECUTION REPORT
================================================================================
📊 Summary Statistics:
   Total Tested: 12
   ✅ Successful: 12 (100.00%)
   📄 Total Gazettes Found: 21
   ⏱️  Avg Execution Time: 1.73s
   Duration: 26.81s

🏢 Platform Breakdown:
   sigpub    : 10 cities, 14 gazettes
   instar    : 2 cities, 7 gazettes
================================================================================
```

## 🎯 Casos de Uso

### 1. **Teste Rápido de Múltiplas Origens**
```bash
# Coletar 10 gazettes rapidamente
npm run test:automated:until -- --target 10
```

### 2. **Validação de Diversidade de Plataformas**
```bash
# Coletar 50 gazettes para verificar distribuição de plataformas
npm run test:automated:until -- --target 50 --verbose
```

### 3. **Coleta de Amostra Representativa**
```bash
# Coletar 100 gazettes de diferentes origens
npm run test:automated:until -- --target 100 --days 14
```

## 📈 Estatísticas e Relatórios

O modo "until" gera os mesmos relatórios que outros modos:

- **JSON**: `test-results/until-{timestamp}.json`
- **HTML**: `test-results/until-{timestamp}.html`
- **Markdown**: `test-results/until-{timestamp}.md`

### Informações Incluídas

- Número total de cidades testadas
- Taxa de sucesso
- Gazettes coletadas por plataforma
- Tempo médio de execução
- Lista de cidades testadas
- Erros e falhas (se houver)

## ⚙️ Configuração

### Preset Padrão

```typescript
until: {
  mode: 'until',
  parallelWorkers: 5,
  timeoutPerCity: 60000,
  searchDays: 7,
  targetGazettes: 15,
  verbose: true,
}
```

### Personalização

Você pode criar configurações customizadas:

```typescript
import { createTestConfig, TestRunner } from './src/testing';

const config = createTestConfig('until', {
  targetGazettes: 50,
  searchDays: 14,
  parallelWorkers: 10,
  verbose: true,
});

const runner = new TestRunner(config);
const result = await runner.run();
```

## 🔍 Diferenças Entre Modos

| Modo | Seleção de Cidades | Critério de Parada | Uso Principal |
|------|-------------------|-------------------|---------------|
| **full** | Todas as cidades | Testa todas | Teste completo |
| **sample** | Amostra aleatória (X%) | Testa X% | Teste rápido |
| **platform** | Por plataforma | Testa todas da plataforma | Validar plataforma |
| **single** | Específica | Testa 1 cidade | Debug |
| **until** | **Aleatória dinâmica** | **Atinge target de gazettes** | **Coleta diversificada** |

## 🛡️ Limitações e Considerações

### Limitações

1. **Máximo de 1000 iterações**: Limite de segurança para evitar loops infinitos
2. **Sem garantia de distribuição uniforme**: A seleção é aleatória, pode favorecer algumas plataformas
3. **Pode exceder o target**: Se a última cidade retornar múltiplas gazettes

### Considerações

- **Performance**: Execução sequencial (uma cidade por vez)
- **Rate Limiting**: Respeita delays configurados entre requisições
- **Cidades sem gazettes**: Contam como testadas mas não contribuem para o target

## 🔧 Troubleshooting

### Erro: "targetGazettes must be specified"

**Solução**: Sempre especifique o parâmetro `--target`

```bash
npm run test:automated:until -- --target 15
```

### Não atinge o target

**Possíveis causas**:
- Muitas cidades sem gazettes no período
- Problemas de rede
- Plataformas fora do ar

**Solução**: Aumentar `--days` ou verificar logs

```bash
npm run test:automated:until -- --target 20 --days 30 --verbose
```

### Execução muito lenta

**Solução**: Reduzir o target ou aumentar workers (não recomendado para "until")

```bash
npm run test:automated:until -- --target 10
```

## 📝 Exemplos Práticos

### Exemplo 1: Coleta Rápida
```bash
# Coletar 5 gazettes rapidamente
npm run test:automated:until -- --target 5
```

### Exemplo 2: Coleta Detalhada
```bash
# Coletar 30 gazettes com logs detalhados
npm run test:automated:until -- --target 30 --verbose
```

### Exemplo 3: Período Estendido
```bash
# Coletar 25 gazettes dos últimos 30 dias
npm run test:automated:until -- --target 25 --days 30
```

## 🎉 Benefícios

1. **Flexibilidade**: Define quantos PDFs você quer coletar
2. **Diversidade**: Coleta de múltiplas origens automaticamente
3. **Eficiência**: Para assim que atinge o objetivo
4. **Aleatoriedade**: Garante amostra não-viesada
5. **Rastreabilidade**: Mostra distribuição por plataforma

---

**Versão**: 1.0.0  
**Data**: 04/10/2025  
**Status**: ✅ Implementado e Testado
