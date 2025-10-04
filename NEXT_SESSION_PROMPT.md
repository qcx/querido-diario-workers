# Prompt para Próxima Sessão - Implementação ADiarios V2 com Browser Rendering

## Contexto

Estou continuando a migração do projeto **Querido Diário** para **Cloudflare Workers** (Node.js + TypeScript). O repositório está em https://github.com/qcx/querido-diario-workers.

### Status Atual (Commit 18cc556)

- **316 cidades migradas** de 474 (66.7%) ✅
- **14 classes base implementadas**
- **ADiarios V2**: 5 cidades configuradas mas com implementação stub (requer browser automation)

### Classes Base Implementadas

1. ✅ **Instar** - 111 cidades
2. ✅ **DOEM** - 56 cidades
3. ✅ **DOSP** - 42 cidades
4. ✅ **ADiarios V1** - 34 cidades
5. ✅ **DIOF** - 20 cidades
6. ✅ **DiarioOficialBR** - 10 cidades
7. ✅ **Siganet** - 10 cidades
8. ✅ **Modernizacao** - 7 cidades
9. ✅ **BarcoDigital** - 7 cidades
10. ⚠️ **ADiarios V2** - 5 cidades (stub, requer browser)
11. ✅ **Aplus** - 4 cidades
12. ✅ **Dioenet** - 4 cidades
13. ✅ **AdministracaoPublica** - 3 cidades
14. ✅ **PTIO** - 3 cidades

---

## Objetivo da Próxima Sessão

**Implementar ADiarios V2 Spider usando Cloudflare Browser Rendering (Puppeteer)**

### Metas

1. ✅ Configurar Cloudflare Browser Rendering no projeto
2. ✅ Implementar ADiarios V2 Spider com Puppeteer
3. ✅ Testar com pelo menos 1 cidade
4. ✅ Ativar as 5 cidades do ADiarios V2

### Resultado Esperado

- **321 cidades funcionais** (316 + 5)
- **Cobertura:** 67.7%
- **ADiarios V2 totalmente funcional**

---

## Informações Técnicas

### ADiarios V2 - Características

**Plataforma:** ADiarios Layout 2 (jornal.php)  
**Cidades configuradas:**
- rj_armacao_dos_buzios (Armação dos Búzios - RJ)
- rj_casimiro_de_abreu (Casimiro de Abreu - RJ)
- rj_cordeiro (Cordeiro - RJ)
- rj_iguaba_grande (Iguaba Grande - RJ)
- rj_quissama (Quissamã - RJ)

**Desafios:**
- Conteúdo renderizado via JavaScript
- Paginação dinâmica
- Páginas intermediárias para obter URL do PDF

**URL de exemplo:**
```
https://buzios.aexecutivo.com.br/jornal.php?dtini=01/01/2024&dtfim=31/12/2024
```

### Classe Base Original (Python/Scrapy)

Arquivo: `~/querido-diario/data_collection/gazette/spiders/base/adiarios_v2.py`

**Fluxo:**
1. POST para `/jornal.php` com datas
2. Parse paginação (última página)
3. Para cada página:
   - Extrair lista de diários (tabela)
   - Para cada diário: fazer request para `/jornal.php?id={gazette_id}`
   - Na página intermediária: extrair URL do PDF

---

## Cloudflare Browser Rendering

### Documentação

- https://developers.cloudflare.com/browser-rendering/
- https://developers.cloudflare.com/browser-rendering/get-started/

### Setup Básico

1. **Adicionar binding no wrangler.jsonc:**

```jsonc
{
  "name": "querido-diario-workers",
  "main": "src/index.ts",
  "compatibility_date": "2024-01-01",
  "browser": {
    "binding": "BROWSER"
  },
  // ... resto da config
}
```

2. **Instalar tipos:**

```bash
npm install --save-dev @cloudflare/workers-types
```

3. **Usar Puppeteer:**

```typescript
import puppeteer from "@cloudflare/puppeteer";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    
    await page.goto("https://example.com");
    const content = await page.content();
    
    await browser.close();
    
    return new Response(content);
  }
};
```

---

## Plano de Implementação

### Fase 1: Setup (30min)

1. Adicionar Browser Rendering binding no `wrangler.jsonc`
2. Instalar `@cloudflare/puppeteer` e tipos
3. Atualizar tipos do Env para incluir `BROWSER`

### Fase 2: Implementação do Spider (1.5h)

1. Atualizar `src/spiders/base/adiarios-v2-spider.ts`
2. Implementar método `crawl()` com Puppeteer:
   - Navegar para página de busca
   - Extrair número da última página
   - Iterar por todas as páginas
   - Para cada diário: acessar página intermediária e extrair PDF URL
3. Adicionar error handling e timeouts

### Fase 3: Testes (30min)

1. Testar localmente com `wrangler dev`
2. Testar com cidade de exemplo (Armação dos Búzios)
3. Validar extração de dados

### Fase 4: Deploy e Validação (30min)

1. Deploy para Cloudflare
2. Testar todas as 5 cidades
3. Atualizar documentação
4. Commit e push

---

## Estrutura do Spider ADiarios V2

```typescript
import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from './base-spider';
import { Gazette } from '../../types/gazette';
import { SpiderConfig, AdiariosConfig } from '../../types/spider-config';
import { DateRange } from '../../types';
import { logger } from '../../utils/logger';

export class ADiariosV2Spider extends BaseSpider {
  private baseUrl: string;
  private browser: any; // Browser binding from env

  constructor(config: SpiderConfig, dateRange: DateRange, browser: any) {
    super(config, dateRange);
    const platformConfig = config.config as AdiariosConfig;
    this.baseUrl = platformConfig.baseUrl;
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    logger.info(`Crawling ADiarios V2 for ${this.config.name}...`);

    try {
      const browser = await puppeteer.launch(this.browser);
      const page = await browser.newPage();
      
      // Format dates as DD/MM/YYYY
      const startDate = this.formatDateBR(this.dateRange.start);
      const endDate = this.formatDateBR(this.dateRange.end);
      
      // Navigate to search page
      const searchUrl = `${this.baseUrl}/jornal.php?dtini=${startDate}&dtfim=${endDate}`;
      await page.goto(searchUrl, { waitUntil: 'networkidle0' });
      
      // Get last page number
      const lastPage = await this.getLastPageNumber(page);
      
      // Iterate through pages
      for (let pageNum = 1; pageNum <= lastPage; pageNum++) {
        if (pageNum > 1) {
          await page.goto(`${searchUrl}&pagina=${pageNum}`, { waitUntil: 'networkidle0' });
        }
        
        // Extract gazettes from current page
        const pageGazettes = await this.extractGazettesFromPage(page);
        gazettes.push(...pageGazettes);
      }
      
      await browser.close();
      
      logger.info(`Successfully crawled ${gazettes.length} gazettes from ADiarios V2`);
    } catch (error) {
      logger.error(`Error crawling ADiarios V2: ${error}`);
      throw error;
    }

    return gazettes;
  }

  private async getLastPageNumber(page: any): Promise<number> {
    // Extract from pagination: .pagination li a span::text
    const paginationText = await page.$$eval('.pagination li a span', 
      (elements: any[]) => elements.map(el => el.textContent)
    );
    
    const numbers = paginationText
      .map((text: string) => parseInt(text))
      .filter((num: number) => !isNaN(num));
    
    return numbers.length > 0 ? Math.max(...numbers) : 1;
  }

  private async extractGazettesFromPage(page: any): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    
    // Get all table rows (skip header)
    const rows = await page.$$('table tr');
    
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      
      // Extract date
      const dateText = await row.$eval('td[data-title="Publicação"]', 
        (el: any) => el.textContent
      );
      const [day, month, year] = dateText.split('/');
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      
      // Extract edition number
      const editionText = await row.$eval('td[data-title="Número"]', 
        (el: any) => el.textContent
      ).catch(() => '');
      
      const isExtraEdition = /complementar|suplement|extra|especial|anexo/i.test(editionText);
      const editionNumber = editionText.trim();
      
      // Extract gazette ID
      const href = await row.$eval('td a', (el: any) => el.getAttribute('href'));
      const idMatch = href.match(/id=(\d+)/);
      if (!idMatch) continue;
      
      const gazetteId = idMatch[1];
      
      // Navigate to intermediary page to get PDF URL
      const gazetteUrl = `${this.baseUrl}/jornal.php?id=${gazetteId}`;
      const pdfUrl = await this.getPdfUrl(page, gazetteUrl);
      
      if (pdfUrl) {
        gazettes.push({
          date,
          editionNumber,
          fileUrl: pdfUrl,
          territoryId: this.config.territoryId,
          isExtraEdition,
          power: 'executive',
          scrapedAt: new Date().toISOString(),
        });
      }
    }
    
    return gazettes;
  }

  private async getPdfUrl(page: any, gazetteUrl: string): Promise<string | null> {
    await page.goto(gazetteUrl, { waitUntil: 'networkidle0' });
    
    const pdfPath = await page.$eval('div.public_paginas > div.titulo > a', 
      (el: any) => el.getAttribute('href')
    ).catch(() => null);
    
    if (!pdfPath) return null;
    
    return `${this.baseUrl}/${pdfPath}`;
  }

  private formatDateBR(isoDate: string): string {
    const [year, month, day] = isoDate.split('-');
    return `${day}/${month}/${year}`;
  }
}
```

---

## Checklist de Implementação

### Setup
- [ ] Adicionar Browser Rendering binding no `wrangler.jsonc`
- [ ] Instalar `@cloudflare/puppeteer`
- [ ] Instalar `@cloudflare/workers-types`
- [ ] Atualizar tipos do Env

### Implementação
- [ ] Atualizar `ADiariosV2Spider` com Puppeteer
- [ ] Implementar `crawl()` method
- [ ] Implementar `getLastPageNumber()`
- [ ] Implementar `extractGazettesFromPage()`
- [ ] Implementar `getPdfUrl()`
- [ ] Adicionar error handling
- [ ] Adicionar timeouts

### Testes
- [ ] Testar localmente com `wrangler dev`
- [ ] Testar com Armação dos Búzios
- [ ] Validar extração de dados
- [ ] Testar todas as 5 cidades

### Documentação
- [ ] Atualizar README
- [ ] Atualizar count-cities.ts
- [ ] Criar documentação de uso do Browser Rendering
- [ ] Commit e push

---

## Comandos Úteis

```bash
# Clonar repositório
cd ~
gh repo clone qcx/querido-diario-workers
cd querido-diario-workers

# Instalar dependências
npm install
npm install --save-dev @cloudflare/puppeteer @cloudflare/workers-types

# Build
npm run build

# Testar localmente
npx wrangler dev

# Deploy
npx wrangler deploy

# Contar cidades
npx tsx count-cities.ts
```

---

## Referências

- **Cloudflare Browser Rendering:** https://developers.cloudflare.com/browser-rendering/
- **Puppeteer Docs:** https://pptr.dev/
- **Repositório Original:** https://github.com/okfn-brasil/querido-diario
- **Classe Base Original:** `data_collection/gazette/spiders/base/adiarios_v2.py`

---

## Prompt Resumido para Copiar

```
Olá! Estou continuando a migração do Querido Diário para Cloudflare Workers.

Repositório: https://github.com/qcx/querido-diario-workers
Status: 316 cidades migradas (66.7%)
Último commit: 18cc556

Objetivo: Implementar ADiarios V2 Spider usando Cloudflare Browser Rendering (Puppeteer)

ADiarios V2 tem 5 cidades configuradas mas com implementação stub. Preciso:

1. Configurar Cloudflare Browser Rendering no projeto
2. Implementar ADiarios V2 Spider com Puppeteer
3. Testar com as 5 cidades do RJ

Detalhes completos em: ~/NEXT_SESSION_PROMPT.md

Por favor, implemente seguindo o plano detalhado. Faça commits incrementais.

Obrigado!
```

---

**Criado em:** 03/10/2025  
**Última atualização:** Commit 18cc556  
**Tempo estimado:** 2-3 horas  
**Prioridade:** Alta  
**Complexidade:** Média
