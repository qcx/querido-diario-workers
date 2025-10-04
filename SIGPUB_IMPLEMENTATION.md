# Implementação do Spider SIGPub - Documentação Completa

## Visão Geral

Esta implementação adiciona suporte para a plataforma **SIGPub** (Sistema Gerenciador de Publicações Legais) da VOX Tecnologia, cobrindo **758 municípios** em **4 estados** brasileiros através de **4 configurações** de associações estaduais.

## Estados Implementados

| Estado | Associação | Municípios | Entity ID | URL |
|--------|-----------|------------|-----------|-----|
| Pernambuco | AMUPE | 184 | 365 | https://www.diariomunicipal.com.br/amupe/ |
| Ceará | APRECE | 184 | 764 | https://www.diariomunicipal.com.br/aprece/ |
| Paraíba | FAMUP | 223 | 334 | https://www.diariomunicipal.com.br/famup/ |
| Rio Grande do Norte | FEMURN | 167 | 296 | https://www.diariomunicipal.com.br/femurn/ |

**Total: 758 municípios cobertos**

## Arquitetura da Solução

### 1. Estrutura de Configuração

**Arquivo**: `src/spiders/configs/sigpub-cities.json`

```json
{
  "id": "pe_amupe",
  "name": "Associação Municipalista de Pernambuco - AMUPE",
  "territoryId": "2600000",
  "spiderType": "sigpub",
  "startDate": "2009-01-01",
  "config": {
    "type": "sigpub",
    "url": "https://www.diariomunicipal.com.br/amupe/",
    "entityId": "365"
  }
}
```

### 2. Tipo de Configuração

**Arquivo**: `src/types/spider-config.ts`

```typescript
export interface SigpubConfig {
  type: 'sigpub';
  url: string;
  entityId: string; // ID da entidade no sistema SIGPub
}
```

### 3. Implementação do Spider

**Arquivo**: `src/spiders/base/sigpub-spider.ts`

O spider implementa **dois métodos de crawling**:

#### Método 1: Browser Rendering (Recomendado)
- Usa **Cloudflare Browser Rendering** com Puppeteer
- Interage com o calendário JavaScript
- Extrai links dinamicamente
- Mais robusto e confiável

#### Método 2: Extração Direta de URLs (Fallback)
- Faz requisição HTTP direta
- Usa regex para extrair URLs dos PDFs
- Mais rápido mas menos confiável
- **Atualmente funcional e em uso**

## Estrutura de URLs do SIGPub

### Padrão de URL dos PDFs

```
https://www-storage.voxtecnologia.com.br?m=sigpub.publicacao&f={entityId}&i={filename}
```

### Componentes do Filename

```
publicado_{id}_{date}_{hash}.pdf
```

- **id**: ID interno da publicação
- **date**: Data no formato YYYY-MM-DD
- **hash**: Hash MD5 para identificação única

### Exemplo Real

```
https://www-storage.voxtecnologia.com.br?m=sigpub.publicacao&f=365&i=publicado_107940_2025-09-30_04a1e435c2e5d1b25b4d70a80b3aaf2d.pdf
```

## Como Funciona

### Fluxo de Crawling

1. **Inicialização**
   - Spider recebe configuração com URL e entityId
   - Define range de datas para busca

2. **Extração de Links**
   - Acessa a página principal da associação
   - Extrai URLs dos PDFs usando regex
   - Filtra por range de datas

3. **Criação de Gazettes**
   - Para cada PDF encontrado:
     - Extrai data do filename
     - Verifica se está no range
     - Cria objeto Gazette

4. **Retorno**
   - Retorna lista de Gazettes encontradas

### Regex de Extração

```typescript
const pdfUrlRegex = /https:\/\/www-storage\.voxtecnologia\.com\.br\/\?m=sigpub\.publicacao&f=\d+&i=publicado_\d+_(\d{4}-\d{2}-\d{2})_[a-f0-9]+\.pdf/g;
```

## Testes Realizados

### Teste de Configuração
```bash
npx tsx test-sigpub.ts
```

**Resultado**: ✅ 4 configurações carregadas corretamente

### Teste de Funcionalidade
```bash
npx tsx test-sigpub-full.ts
```

**Resultados**:
- ✅ AMUPE (PE): 2 diários encontrados (01-04/10/2025)
- ✅ APRECE (CE): 2 diários encontrados
- ✅ FAMUP (PB): 2 diários encontrados
- ✅ FEMURN (RN): 2 diários encontrados
- **Taxa de sucesso**: 100%

## Implementação com Cloudflare Browser Rendering

### Quando Usar

Use Browser Rendering quando:
- A extração direta falhar
- Precisar de mais confiabilidade
- O site mudar a estrutura

### Como Implementar

1. **Configurar Puppeteer no Cloudflare Worker**

```typescript
import puppeteer from '@cloudflare/puppeteer';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const browser = await puppeteer.launch(env.MYBROWSER);
    // ... use browser
  }
}
```

2. **Passar Browser para o Spider**

```typescript
const spider = spiderRegistry.createSpider(config, dateRange, browser);
```

3. **O Spider Detecta e Usa Automaticamente**

```typescript
if (this.browser) {
  return await this.crawlWithBrowser();
}
```

### Código de Exemplo (Comentado no Spider)

```typescript
const page = await this.browser.newPage();

await page.goto(this.sigpubConfig.url, { waitUntil: 'networkidle0' });
await page.waitForSelector('a[href*="voxtecnologia.com.br"]');

const pdfLinks = await page.evaluate(() => {
  const links = [];
  document.querySelectorAll('a[href*="voxtecnologia.com.br"]').forEach(link => {
    const href = link.getAttribute('href');
    if (href && href.includes('.pdf')) {
      links.push({ url: href, text: link.textContent });
    }
  });
  return links;
});
```

## Limitações Conhecidas

### Método de Extração Direta

1. **Apenas Edições Recentes**
   - Extrai apenas os links visíveis na página principal
   - Normalmente últimas 2-3 edições

2. **Sem Metadados Completos**
   - Não extrai número de edição
   - Não identifica edições extraordinárias
   - Poder sempre definido como "executive"

3. **Dependente da Estrutura HTML**
   - Pode quebrar se o site mudar
   - Regex precisa ser atualizada se formato de URL mudar

### Soluções

- **Curto Prazo**: Usar método atual (funcional)
- **Médio Prazo**: Implementar Browser Rendering
- **Longo Prazo**: Investigar API oficial (se existir)

## Expansão Futura

### Estados Adicionais Disponíveis no SIGPub

14 estados podem ser adicionados:
- Amazonas, Alagoas, Bahia, Goiás
- Minas Gerais, Mato Grosso, Mato Grosso do Sul
- Pará, Paraná, Piauí, Rio de Janeiro
- Roraima, Rondônia, Rio Grande do Sul

**Potencial**: +1.000 municípios

### Processo de Adição

1. Acessar `https://www.diariomunicipal.com.br/{sigla}/`
2. Extrair entityId do link de PDF
3. Adicionar configuração em `sigpub-cities.json`
4. Testar com `test-sigpub-full.ts`

## Manutenção

### Monitoramento

Verificar periodicamente:
- Taxa de sucesso do spider
- Número de diários extraídos
- Erros nos logs

### Atualização

Se o site mudar:
1. Atualizar regex de extração
2. Ou implementar Browser Rendering
3. Testar com todos os estados

## Referências

- **SIGPub**: https://www.diariomunicipal.com.br/
- **VOX Tecnologia**: https://www.voxtecnologia.com.br/
- **Cloudflare Browser Rendering**: https://developers.cloudflare.com/browser-rendering/
- **Repositório**: https://github.com/qcx/querido-diario-workers

---

**Data**: 04/10/2025  
**Versão**: 1.0  
**Status**: ✅ Implementado e Testado
