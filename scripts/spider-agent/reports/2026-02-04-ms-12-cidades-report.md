# Relatório: SpiderTypes MS – 12 cidades

**Data:** 2026-02-04  
**Arquivo de config:** `src/spiders/v2/configs/ms.json`  
**Cidades adicionadas:** 12

## Resumo

| Status                                          | Quantidade |
| ----------------------------------------------- | ---------- |
| used_existing_spider (diariooficialms)          | 7          |
| used_existing_spider (instar)                   | 2          |
| used_existing_spider (imprensaoficialmunicipal) | 3          |
| **Total**                                       | **12**     |

## Cidades implementadas

| #   | Cidade               | id (config)             | territoryId | SpiderType               | URL / Observação                                      |
| --- | -------------------- | ----------------------- | ----------- | ------------------------ | ----------------------------------------------------- |
| 1   | Maracaju             | ms_maracaju             | 5005400     | instar                   | https://www.maracaju.ms.gov.br/portal/diario-oficial  |
| 2   | Paranaíba            | ms_paranaiba            | 5006309     | diariooficialms          | Assomasul, cityName: Paranaíba                        |
| 3   | Amambai              | ms_amambai              | 5000609     | diariooficialms          | Assomasul, cityName: Amambai                          |
| 4   | Rio Brilhante        | ms_rio_brilhante        | 5007208     | imprensaoficialmunicipal | https://imprensaoficialmunicipal.com.br/rio_brilhante |
| 5   | Coxim                | ms_coxim                | 5003306     | diariooficialms          | Assomasul, cityName: Coxim                            |
| 6   | Chapadão do Sul      | ms_chapadao_do_sul      | 5002951     | imprensaoficialmunicipal | https://imprensaoficialchapdosul.com.br (ver nota)    |
| 7   | Caarapó              | ms_caarapo              | 5002407     | diariooficialms          | Assomasul, cityName: Caarapó                          |
| 8   | São Gabriel do Oeste | ms_sao_gabriel_do_oeste | 5007695     | diariooficialms          | Assomasul, cityName: São Gabriel do Oeste             |
| 9   | Ivinhema             | ms_ivinhema             | 5004700     | diariooficialms          | baseUrl: diariooficialms.com.br/ivinhema              |
| 10  | Aparecida do Taboado | ms_aparecida_do_taboado | 5001003     | diariooficialms          | Assomasul, cityName: Aparecida do Taboado             |
| 11  | Costa Rica           | ms_costa_rica           | 5003256     | instar                   | https://www.costarica.ms.gov.br/portal/diario-oficial |
| 12  | Miranda              | ms_miranda              | 5005608     | diariooficialms          | baseUrl: diariooficialms.com.br/miranda               |

## Notas

- **Chapadão do Sul:** Diário em `imprensaoficialchapdosul.com.br`. Config usa spider `imprensaoficialmunicipal` com `baseUrl: "https://imprensaoficialchapdosul.com.br"`. Se a estrutura do site for diferente da DiOE (imprensaoficialmunicipal.com.br), pode ser necessário spider específico.
- **Paranaíba e São Gabriel do Oeste:** Site da prefeitura deu timeout na investigação; config usa plataforma Assomasul (padrão em várias cidades de MS).
- Nenhum novo spider `.ts` foi criado; todos usam tipos existentes: `instar`, `diariooficialms`, `imprensaoficialmunicipal`.

## Como testar

```bash
# Uma cidade (ex.: Rio Brilhante)
npx tsx scripts/test-city.ts ms_rio_brilhante 2025-01-01 2025-01-07

# Ou via goodfellow crawl (requer goodfellow:dev)
curl -s 'http://localhost:{PORT}/crawl' \
  -H 'Content-Type: application/json' \
  -d '{"cities": ["ms_maracaju"], "version": "v2", "startDate": "2025-01-01"}'
```

## Arquivos alterados

- `src/spiders/v2/configs/ms.json` – adicionadas 12 entradas (Maracaju, Paranaíba, Amambai, Rio Brilhante, Coxim, Chapadão do Sul, Caarapó, São Gabriel do Oeste, Ivinhema, Aparecida do Taboado, Costa Rica, Miranda).
