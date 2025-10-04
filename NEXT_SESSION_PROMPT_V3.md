# Prompt para Próxima Sessão - Maximizar Migração de Cidades

## Contexto

Estou migrando o projeto **Querido Diário** para **Cloudflare Workers** (Node.js + TypeScript). O repositório está em https://github.com/qcx/querido-diario-workers.

### Status Atual (Commit 6fb32f5)

- **321 cidades migradas** de 474 (67.7%) ✅
- **15 classes base implementadas**
- **Próximo objetivo: 400+ cidades (84%+)**

### Classes Base Implementadas ✅

1. ✅ **Instar** - 111 cidades
2. ✅ **DOEM** - 56 cidades
3. ✅ **DOSP** - 42 cidades
4. ✅ **ADiarios V1** - 34 cidades
5. ✅ **DIOF** - 20 cidades (21 no original)
6. ✅ **DiarioOficialBR** - 10 cidades
7. ✅ **Siganet** - 10 cidades
8. ✅ **BarcoDigital** - 7 cidades (12 no original)
9. ✅ **Modernizacao** - 7 cidades
10. ✅ **ADiarios V2** - 5 cidades (com Browser Rendering)
11. ✅ **Aplus** - 4 cidades
12. ✅ **Dioenet** - 4 cidades
13. ✅ **AdministracaoPublica** - 3 cidades
14. ✅ **PTIO** - 3 cidades
15. ✅ **Sigpub** - 3 cidades (implementado mas não usado)

### Classes Base Pendentes (Por Prioridade)

| Classe | Cidades | Prioridade | Complexidade | Notas |
|--------|---------|------------|--------------|-------|
| **MunicipioOnline** | 26 | 🔥 ALTA | Média | Form-based, yearly windows |
| **AtendeV2** | 22 | 🔥 ALTA | Média | AJAX pagination, atende.net |
| **Dionet** | 5 | Média | Baixa | Similar a outras bases |
| **PortalGov** | 2 | Baixa | Baixa | Poucas cidades |
| **Aratext** | 2 | Baixa | Baixa | Poucas cidades |
| **AdminLte** | 2 | Baixa | Baixa | Poucas cidades |

---

## Objetivo da Próxima Sessão

**Implementar as 2 classes base de maior impacto: MunicipioOnline (26 cidades) + AtendeV2 (22 cidades)**

### Metas

1. ✅ Implementar **MunicipioOnline Spider** (26 cidades)
2. ✅ Implementar **AtendeV2 Spider** (22 cidades)
3. ✅ Testar com pelo menos 1 cidade de cada
4. ✅ Criar configurações JSON para todas as cidades
5. ✅ Atualizar registry e documentação

### Resultado Esperado

- **369 cidades funcionais** (321 + 48)
- **Cobertura:** 77.8%
- **Salto de +10% em uma sessão**

---

## Informações Técnicas

### 1. MunicipioOnline Spider (26 cidades)

**Plataforma:** MunicipioOnline.com.br  
**URL Pattern:** `https://www.municipioonline.com.br/{uf}/prefeitura/{city}/cidadao/diariooficial`

**Características:**
- Form-based submission com ASP.NET ViewState
- Filtro por data com formato DD/MM/YYYY
- Intervalo máximo de 1 ano por request (yearly windows)
- Paginação via POST
- Download direto de PDFs

**Exemplo de cidade:**
- **Maceió - AL**: `url_uf: "al"`, `url_city: "maceio"`
- URL: https://www.municipioonline.com.br/al/prefeitura/maceio/cidadao/diariooficial

**Fluxo:**
1. GET inicial para obter página com form
2. Extrair ViewState e outros campos ASP.NET
3. POST com filtro de data (intervalos de 1 ano)
4. Parse resultados e extrair URLs de PDF
5. Iterar paginação se necessário

**Classe Base Original:**
```python
# ~/querido-diario/data_collection/gazette/spiders/base/municipioonline.py
class BaseMunicipioOnlineSpider(BaseGazetteSpider):
    allowed_domains = ["municipioonline.com.br"]
    
    def start_requests(self):
        url = f"https://www.municipioonline.com.br/{self.url_uf}/prefeitura/{self.url_city}/cidadao/diariooficial"
        yield scrapy.Request(url, callback=self.date_filter_request)
    
    def date_filter_request(self, response):
        # Yearly windows para evitar timeout
        for interval in yearly_window(self.start_date, self.end_date, format="%d/%m/%Y"):
            formdata = {
                "__EVENTTARGET": "ctl00$body$btnBuscaPalavrachave",
                "ctl00$body$txtDtPeriodo": f"{interval.start}-{interval.end}",
            }
            yield scrapy.FormRequest.from_response(response, formdata=formdata)
```

**Cidades que usam MunicipioOnline (26):**
Para encontrar todas: `cd ~/querido-diario/data_collection/gazette/spiders && grep -r "BaseMunicipioOnlineSpider" . --include="*.py" | cut -d: -f1`

---

### 2. AtendeV2 Spider (22 cidades)

**Plataforma:** Atende.net (Layout 2)  
**URL Pattern:** `https://{city_subdomain}.atende.net/diariooficial/edicao/pagina/atende.php`

**Características:**
- AJAX-based com parâmetros GET
- Subdomínio por cidade
- Paginação numérica
- Download direto de PDFs
- Filtro por data integrado

**Exemplo de cidade:**
- **Cidade exemplo**: `city_subdomain: "exemplo"`
- URL: https://exemplo.atende.net/diariooficial/edicao/pagina/atende.php

**Fluxo:**
1. GET com parâmetros para página 1
2. Parse lista de diários (div.nova_listagem div.linha)
3. Extrair data, edição, tipo, URL do PDF
4. Detectar última página
5. Iterar páginas até completar

**Classe Base Original:**
```python
# ~/querido-diario/data_collection/gazette/spiders/base/atende_v2.py
class BaseAtendeV2Spider(BaseGazetteSpider):
    allowed_domains = ["atende.net"]
    
    def start_requests(self):
        self.BASE_URL = f"https://{self.city_subdomain}.atende.net/diariooficial/edicao/pagina/atende.php"
        yield FormRequest(
            url=self.BASE_URL,
            method="GET",
            formdata=self.get_params("pagina", 1),
            cb_kwargs={"page": 1},
        )
    
    def parse(self, response, page):
        for item in response.css("div.nova_listagem div.linha"):
            date_raw = item.css("div.data::text").get()
            edition_type = item.css("div.tipo::text").get()
            edition_number = item.css("div.titulo::text").re_first(r"\d+")
            download_url = item.css("button::attr(data-link)")[-1].get()
            
            is_extra = bool(re.search(
                r"suplementar|retificação|extraordinária|extra",
                edition_type,
                re.IGNORECASE,
            ))
            
            yield Gazette(...)
        
        if page < self.get_last_page(response):
            yield FormRequest(..., cb_kwargs={"page": page + 1})
    
    def get_params(self, filtro, value):
        return {
            "rot": "54015",
            "aca": "101",
            "ajax": "t",
            "processo": "loadPluginDiarioOficial",
            "filtro": filtro,
            "valor": str(value),
        }
```

**Cidades que usam AtendeV2 (22):**
Para encontrar todas: `cd ~/querido-diario/data_collection/gazette/spiders && grep -r "BaseAtendeV2Spider" . --include="*.py" | cut -d: -f1`

---

## Plano de Implementação

### Fase 1: MunicipioOnline Spider (1.5h)

1. **Criar arquivo base** `src/spiders/base/municipio-online-spider.ts`
2. **Implementar lógica:**
   - Fetch inicial da página do form
   - Extrair ViewState e campos ASP.NET com Cheerio
   - Criar yearly windows (função helper)
   - POST com FormData
   - Parse resultados HTML
   - Extrair URLs de PDF
3. **Criar configurações** `src/spiders/configs/municipio-online-cities.json`
4. **Atualizar registry** para incluir novo spider
5. **Testar** com Maceió-AL

### Fase 2: AtendeV2 Spider (1.5h)

1. **Criar arquivo base** `src/spiders/base/atende-v2-spider.ts`
2. **Implementar lógica:**
   - Construir URL com subdomínio
   - Criar parâmetros GET
   - Parse div.nova_listagem
   - Extrair data, edição, tipo
   - Detectar edição extra (regex)
   - Paginação automática
3. **Criar configurações** `src/spiders/configs/atende-v2-cities.json`
4. **Atualizar registry** para incluir novo spider
5. **Testar** com uma cidade

### Fase 3: Extrair Configurações (1h)

1. **Script para extrair configs do repo original:**
   ```bash
   cd ~/querido-diario/data_collection/gazette/spiders
   
   # MunicipioOnline
   grep -r "BaseMunicipioOnlineSpider" . --include="*.py" -A 20 | \
     grep -E "(TERRITORY_ID|url_uf|url_city|start_date)" > /tmp/municipio_configs.txt
   
   # AtendeV2
   grep -r "BaseAtendeV2Spider" . --include="*.py" -A 20 | \
     grep -E "(TERRITORY_ID|city_subdomain|start_date)" > /tmp/atende_configs.txt
   ```

2. **Converter para JSON** seguindo padrão existente
3. **Validar** todas as configurações

### Fase 4: Testes e Validação (30min)

1. Testar ambos os spiders localmente
2. Verificar extração de dados
3. Validar contagem de cidades
4. Executar `count-cities.ts`

### Fase 5: Documentação e Commit (30min)

1. Atualizar README com novas classes
2. Atualizar MIGRATION_PROGRESS.md
3. Commit incremental para cada spider
4. Push para repositório

---

## Estrutura de Arquivos

```
src/spiders/
├── base/
│   ├── municipio-online-spider.ts    # NOVO
│   ├── atende-v2-spider.ts           # NOVO
│   └── ...
├── configs/
│   ├── municipio-online-cities.json  # NOVO (26 cidades)
│   ├── atende-v2-cities.json         # NOVO (22 cidades)
│   └── ...
└── registry.ts                        # ATUALIZAR
```

---

## Tipos TypeScript

### MunicipioOnline Config

```typescript
export interface MunicipioOnlineConfig {
  type: 'municipio_online';
  urlUf: string;        // "al", "ba", etc.
  urlCity: string;      // "maceio", "salvador", etc.
}
```

### AtendeV2 Config

```typescript
export interface AtendeV2Config {
  type: 'atende_v2';
  citySubdomain: string;  // "exemplo", "cidade", etc.
}
```

---

## Helpers Necessários

### Yearly Windows (para MunicipioOnline)

```typescript
// src/utils/date-utils.ts
export function* yearlyWindows(
  startDate: string,
  endDate: string
): Generator<{ start: string; end: string }> {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  let currentStart = new Date(start);
  
  while (currentStart < end) {
    const currentEnd = new Date(currentStart);
    currentEnd.setFullYear(currentEnd.getFullYear() + 1);
    currentEnd.setDate(currentEnd.getDate() - 1);
    
    if (currentEnd > end) {
      currentEnd.setTime(end.getTime());
    }
    
    yield {
      start: formatDateBR(currentStart),
      end: formatDateBR(currentEnd),
    };
    
    currentStart.setFullYear(currentStart.getFullYear() + 1);
  }
}

function formatDateBR(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}
```

---

## Comandos Úteis

```bash
# Clonar repositório
cd ~
gh repo clone qcx/querido-diario-workers
cd querido-diario-workers

# Instalar dependências
npm install

# Build
npm run build

# Extrair configurações do repo original
cd ~/querido-diario/data_collection/gazette/spiders

# Listar cidades MunicipioOnline
grep -r "BaseMunicipioOnlineSpider" . --include="*.py" | cut -d: -f1 | sort

# Listar cidades AtendeV2
grep -r "BaseAtendeV2Spider" . --include="*.py" | cut -d: -f1 | sort

# Ver exemplo de config
cat sp/sp_sao_paulo.py

# Contar cidades após implementação
cd ~/querido-diario-workers
npx tsx count-cities.ts
```

---

## Script de Extração de Configurações

```typescript
// extract-configs.ts
import * as fs from 'fs';
import * as path from 'path';

interface CityConfig {
  id: string;
  name: string;
  territoryId: string;
  spiderType: string;
  startDate: string;
  config: any;
}

// Parse Python spider files and extract configs
// Implementar parser para extrair:
// - TERRITORY_ID
// - url_uf, url_city (MunicipioOnline)
// - city_subdomain (AtendeV2)
// - start_date
// - name
```

---

## Checklist de Implementação

### MunicipioOnline
- [ ] Criar `municipio-online-spider.ts`
- [ ] Implementar `crawl()` method
- [ ] Implementar yearly windows helper
- [ ] Implementar ASP.NET ViewState extraction
- [ ] Implementar form submission
- [ ] Implementar parse de resultados
- [ ] Criar `municipio-online-cities.json` (26 cidades)
- [ ] Atualizar registry
- [ ] Testar com Maceió-AL
- [ ] Commit

### AtendeV2
- [ ] Criar `atende-v2-spider.ts`
- [ ] Implementar `crawl()` method
- [ ] Implementar construção de URL
- [ ] Implementar parâmetros GET
- [ ] Implementar parse de div.nova_listagem
- [ ] Implementar detecção de edição extra
- [ ] Implementar paginação
- [ ] Criar `atende-v2-cities.json` (22 cidades)
- [ ] Atualizar registry
- [ ] Testar com uma cidade
- [ ] Commit

### Documentação
- [ ] Atualizar README
- [ ] Atualizar MIGRATION_PROGRESS.md
- [ ] Atualizar count-cities.ts se necessário
- [ ] Criar SESSION_SUMMARY com resultados
- [ ] Push final

---

## Referências

- **Repositório Workers:** https://github.com/qcx/querido-diario-workers
- **Repositório Original:** https://github.com/okfn-brasil/querido-diario
- **MunicipioOnline Base:** `~/querido-diario/data_collection/gazette/spiders/base/municipioonline.py`
- **AtendeV2 Base:** `~/querido-diario/data_collection/gazette/spiders/base/atende_v2.py`

---

## Prompt Resumido para Copiar

```
Olá! Estou continuando a migração do Querido Diário para Cloudflare Workers.

Repositório: https://github.com/qcx/querido-diario-workers
Status: 321 cidades migradas (67.7%)
Último commit: 6fb32f5

Objetivo: Implementar as 2 classes base de maior impacto:
1. MunicipioOnline Spider (26 cidades)
2. AtendeV2 Spider (22 cidades)

Meta: 369 cidades (77.8%) - salto de +10% em uma sessão!

Detalhes completos em: ~/querido-diario-workers/NEXT_SESSION_PROMPT_V3.md

Por favor:
1. Implemente MunicipioOnline Spider
2. Implemente AtendeV2 Spider
3. Extraia todas as configurações do repo original
4. Teste com pelo menos 1 cidade de cada
5. Faça commits incrementais
6. NÃO faça deploy

Obrigado!
```

---

**Criado em:** 04/10/2025  
**Última atualização:** Commit 6fb32f5  
**Tempo estimado:** 4-5 horas  
**Prioridade:** 🔥 MUITO ALTA  
**Complexidade:** Média-Alta  
**Impacto:** +48 cidades (+10% cobertura)
