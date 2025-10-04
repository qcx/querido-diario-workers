# Expansão SIGPub Multi-Regional

## Resumo da Implementação

Esta implementação expande significativamente a cobertura do projeto Querido Diário Workers através da plataforma **SIGPub** (Sistema Gerenciador de Publicações Legais) da VOX Tecnologia.

### Resultados

- **4 estados** adicionados ao sistema
- **758 municípios** cobertos por essas configurações
- **4 configurações** criadas (uma por associação estadual)
- **Aumento de cobertura**: de 364 para 368 "cidades" no sistema (mas representando 758 municípios reais)

## Estados Implementados

### 1. Pernambuco - AMUPE
**Associação Municipalista de Pernambuco**

- **ID**: `pe_amupe`
- **URL**: https://www.diariomunicipal.com.br/amupe/
- **Territory ID**: 2600000
- **Municípios Cobertos**: 184
- **Data de Início**: 2009-01-01

### 2. Ceará - APRECE
**Associação dos Municípios do Estado do Ceará**

- **ID**: `ce_aprece`
- **URL**: https://www.diariomunicipal.com.br/aprece/
- **Territory ID**: 2300000
- **Municípios Cobertos**: 184
- **Data de Início**: 2009-01-01

### 3. Paraíba - FAMUP
**Federação das Associações de Municípios da Paraíba**

- **ID**: `pb_famup`
- **URL**: https://www.diariomunicipal.com.br/famup/
- **Territory ID**: 2500000
- **Municípios Cobertos**: 223
- **Data de Início**: 2009-01-01

### 4. Rio Grande do Norte - FEMURN
**Federação dos Municípios do Estado do Rio Grande do Norte**

- **ID**: `rn_femurn`
- **URL**: https://www.diariomunicipal.com.br/femurn/
- **Territory ID**: 2400000
- **Municípios Cobertos**: 167
- **Data de Início**: 2009-01-01

## Estrutura da Plataforma SIGPub

A plataforma SIGPub opera através de **associações estaduais**, onde:

1. Uma única URL serve todos os municípios do estado
2. Os diários são publicados de forma centralizada pela associação
3. Cada PDF pode conter publicações de múltiplos municípios
4. A busca é feita por data, não por município individual

### Vantagens desta Abordagem

- **Alto ROI**: 4 configurações cobrem 758 municípios
- **Manutenção Simplificada**: Menos configurações para gerenciar
- **Estrutura Consistente**: Todas as associações seguem o mesmo padrão
- **Cobertura Ampla**: Estados inteiros cobertos de uma vez

## Arquivos Modificados

### Novos Arquivos

1. **`src/spiders/configs/sigpub-cities.json`**
   - Configurações das 4 associações estaduais

### Arquivos Modificados

1. **`src/spiders/registry.ts`**
   - Adicionado import de `sigpub-cities.json`
   - Adicionado carregamento das configurações SIGPub

2. **`count-cities.ts`**
   - Adicionado tipo `sigpub` à lista de tipos

### Arquivos de Teste

1. **`test-sigpub.ts`**
   - Script de teste para validar as configurações SIGPub

## Como Usar

### Listar Configurações SIGPub

```typescript
import { spiderRegistry } from './src/spiders/registry';

const sigpubConfigs = spiderRegistry.getConfigsByType('sigpub');
console.log(`Total: ${sigpubConfigs.length} configurações`);
```

### Criar um Spider SIGPub

```typescript
const config = spiderRegistry.getConfig('pe_amupe');
const dateRange = {
  start: '2025-10-01',
  end: '2025-10-04'
};

const spider = spiderRegistry.createSpider(config, dateRange);
const gazettes = await spider.crawl();
```

### Executar Testes

```bash
# Contar total de cidades
npm run count-cities

# Testar configurações SIGPub
npx tsx test-sigpub.ts
```

## Estados Adicionais Disponíveis

O SIGPub também está disponível nos seguintes estados (não implementados nesta sessão):

- Amazonas
- Alagoas (4 diários regionais)
- Bahia (2 diários regionais)
- Goiás (2 diários regionais)
- Minas Gerais
- Mato Grosso
- Mato Grosso do Sul
- Pará
- Paraná
- Piauí
- Rio de Janeiro
- Roraima
- Rondônia
- Rio Grande do Sul

**Potencial de Expansão**: Mais de 1.000 municípios adicionais podem ser cobertos implementando esses estados.

## Observações Importantes

### Sobre o Maranhão

O estado do Maranhão **NÃO** utiliza o sistema SIGPub. Ele possui um sistema próprio da FAMEM:
- URL: https://www.diariooficial.famem.org.br/
- Requer implementação separada

### Sobre Territory IDs

Para associações estaduais, usamos o código IBGE do estado com sufixo "0000":
- Pernambuco: 2600000
- Ceará: 2300000
- Paraíba: 2500000
- Rio Grande do Norte: 2400000

### Sobre Datas de Início

Todas as associações SIGPub implementadas começaram suas publicações em **2009-01-01**, que é o padrão da plataforma.

## Próximos Passos

1. **Implementar Estados Adicionais**: Expandir para os outros 14 estados disponíveis no SIGPub
2. **Melhorar o Spider**: Implementar busca por API e extração de metadados
3. **Adicionar Filtros**: Permitir filtrar por município específico dentro da associação
4. **Testes de Integração**: Validar extração real de diários

## Referências

- **SIGPub**: https://www.diariomunicipal.com.br/
- **VOX Tecnologia**: https://www.voxtecnologia.com.br/
- **Repositório**: https://github.com/qcx/querido-diario-workers

---

**Data da Implementação**: 04/10/2025  
**Branch**: `feature/sigpub-multi-regional`  
**Autor**: Sessão de Expansão SIGPub Multi-Regional
