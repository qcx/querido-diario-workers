# Prompt para Próxima Sessão - Migração Querido Diário

## Contexto

Estou continuando a migração do projeto Querido Diário para Cloudflare Workers (Node.js + TypeScript). O repositório está em https://github.com/qcx/querido-diario-workers.

## Status Atual (Commit 0416ebb)

**280 cidades migradas de 474 (59.1%)** ✅

### Classes Base Implementadas e Funcionando:

1. **DOEM** - 56 cidades ✅
2. **Instar** - 111 cidades ✅
3. **DOSP** - 42 cidades ✅
4. **ADiarios V1** - 34 cidades ✅
5. **DIOF** - 20 cidades ⚠️ (implementado, mas API com problemas)
6. **BarcoDigital** - 7 cidades ✅ (testado)
7. **Siganet** - 10 cidades ✅ (implementado, API offline durante teste)

## Objetivo da Próxima Sessão

Implementar as **7 classes base restantes de baixa complexidade** para adicionar **39 cidades**, chegando a **319 cidades (67.3%)**.

### Classes a Implementar (em ordem de prioridade):

1. **DiarioOficialBR** - 10 cidades (~2h)
2. **Modernizacao** - 7 cidades (~2h)
3. **ADiarios V2** - 5 cidades (~1.5h)
4. **Aplus** - 4 cidades (~2h)
5. **Dioenet** - 4 cidades (~2h)
6. **Sigpub** - 3 cidades (~1.5h) - já tem estrutura básica
7. **AdministracaoPublica** - 3 cidades (~2h)
8. **PTIO** - 3 cidades (~2h)

**Total estimado**: ~15 horas

## Instruções para a Próxima Sessão

### 1. Setup Inicial

```bash
cd ~/querido-diario-workers
git pull origin main
npm install
npm run build
```

### 2. Para Cada Classe Base

**Processo**:

a) **Investigar a classe base no repositório original**:
```bash
cd ~/querido-diario
cat data_collection/gazette/spiders/base/{nome_da_classe}.py
```

b) **Ver exemplos de cidades**:
```bash
grep -r "Base{NomeDaClasse}Spider" data_collection/gazette/spiders/ | head -3
```

c) **Implementar o spider TypeScript**:
- Criar arquivo `src/spiders/base/{nome}-spider.ts`
- Adicionar interface de config em `src/types/spider-config.ts`
- Adicionar ao `SpiderType` union
- Adicionar ao `SpiderPlatformConfig` union
- Exportar em `src/spiders/base/index.ts`

d) **Extrair configurações de todas as cidades**:
```bash
cd ~/querido-diario
# Usar o script extract_new_bases.py como base
# Adicionar a nova classe base ao script
python3 extract_new_bases.py
```

e) **Adicionar ao registry**:
- Importar configs JSON em `src/spiders/registry.ts`
- Adicionar loading no constructor
- Adicionar case no `createSpider()`

f) **Testar**:
```bash
cd ~/querido-diario-workers
npm run build
npx tsx count-cities.ts  # Verificar contagem
# Testar uma cidade de exemplo
```

g) **Commit**:
```bash
git add -A
git commit -m "feat: Implement {NomeDaClasse}Spider with all cities"
git push origin main
```

### 3. Arquivos de Referência

- **Script de extração**: `~/querido-diario/extract_new_bases.py`
- **Repositório original**: `~/querido-diario/`
- **Classes base originais**: `~/querido-diario/data_collection/gazette/spiders/base/`

### 4. Padrão de Implementação

Todos os spiders seguem este padrão:

```typescript
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, {Nome}Config } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

export class {Nome}Spider extends BaseSpider {
  private baseUrl: string;  // ou outros campos necessários

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as {Nome}Config;
    this.baseUrl = platformConfig.baseUrl;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling ${this.baseUrl} for ${this.config.name}...`);
    
    // Implementação específica da plataforma
    
    logger.info(`Successfully crawled ${gazettes.length} gazettes`);
    return gazettes;
  }
}
```

### 5. Observações Importantes

- **Não implementar classes que requerem formulários complexos** (ASP.NET, AJAX com ViewState)
- **Focar em APIs JSON simples e parsing HTML direto**
- **Testar pelo menos 1 cidade de cada classe base** antes de fazer commit
- **Fazer commits incrementais** (uma classe base por commit)
- **Atualizar count-cities.ts** para incluir novas classes

### 6. Meta Final

Após implementar as 7 classes, teremos:

- **319 cidades migradas (67.3%)**
- **13 classes base implementadas**
- **Cobertura de ~70% do projeto original**

### 7. Próximos Passos Após Esta Sessão

Depois de completar as 7 classes de baixa complexidade, restam:

- **Classes médias/altas** (Atende V2, MunicipioOnline, etc.) - ~50 cidades
- **Classes customizadas** (não recomendado migrar) - ~85 cidades

**Recomendação final**: Migrar para Python Serverless (AWS Lambda) para 100% de cobertura.

---

## Prompt Resumido para Copiar

```
Olá Manus,

Estou continuando a migração do Querido Diário para Cloudflare Workers. O repositório é https://github.com/qcx/querido-diario-workers.

Status atual: 280 cidades migradas (59.1%). Último commit: 0416ebb.

Objetivo: Implementar as 7 classes base restantes de baixa complexidade para adicionar 39 cidades:

1. DiarioOficialBR (10 cidades)
2. Modernizacao (7 cidades)
3. ADiarios V2 (5 cidades)
4. Aplus (4 cidades)
5. Dioenet (4 cidades)
6. Sigpub (3 cidades)
7. AdministracaoPublica (3 cidades)
8. PTIO (3 cidades)

Para cada classe:
1. Investigar no repositório original (~/querido-diario)
2. Implementar spider TypeScript
3. Extrair configurações de todas as cidades
4. Adicionar ao registry
5. Testar e fazer commit

Veja detalhes completos em ~/querido-diario-workers/NEXT_SESSION_PROMPT.md

Por favor, implemente todas as 7 classes seguindo o padrão estabelecido. Faça commits incrementais e teste cada uma antes de avançar.

Obrigado!
```

---

**Criado em**: 04/10/2025  
**Última atualização**: Commit 0416ebb  
**Tempo estimado**: 15 horas  
**Prioridade**: Alta
