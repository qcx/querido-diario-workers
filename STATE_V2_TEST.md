# V2 Spider + OCR Testing Guide

End-to-end testing of v2 spiders using `scripts/v2-test-until-ocr.ts`.

This script triggers a crawl via the local dev server API, then monitors the local D1 database
until gazettes appear with valid OCR results (markdown format + "Diário Oficial" text).

## Prerequisites

1. **Start the local dev server** in a separate terminal:

```bash
bun run goodfellow:dev
```

Note the port it starts on (e.g., `http://localhost:61083`).

2. **Find your local database path:**

```bash
find .wrangler -name "*.sqlite" | grep d1
```

Use the file with the long hash name (not `*.sqlite`).

## CLI Options

```
--cities <ids>        Comma-separated list of v2 city IDs
--api-url <url>       Local dev server URL (e.g., http://localhost:61083)
--db-path <path>      Path to local SQLite database file
--days <n>            Number of past days to check (default: 10)
--timeout <minutes>   Max wait time in minutes (default: 15)
--output <file>       Save results to JSON file
--help                Show all options
```

## Testing by State

### Acre (AC) — 22 cities

```bash
npx tsx scripts/v2-test-until-ocr.ts \
  --cities ac_acrelandia,ac_assis_brasil,ac_brasileia,ac_bujari,ac_capixaba,ac_cruzeiro_do_sul,ac_epitaciolandia,ac_feijo,ac_jordao,ac_mancio_lima,ac_manoel_urbano,ac_marechal_thaumaturgo,ac_placido_de_castro,ac_porto_acre,ac_porto_walter,ac_rio_branco,ac_rodrigues_alves,ac_santa_rosa_do_purus,ac_sena_madureira,ac_senador_guiomard,ac_tarauaca,ac_xapuri \
  --api-url http://localhost:61083 \
  --db-path ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/1f753fa28e955c195ba9b20424ae6f2231a7842894d6a90c607aefb554e7f871.sqlite" \
  --days 5 \
  --timeout 20 \
  --output ac-test-results.json
```

### Alagoas (AL) — 100 cities

```bash
npx tsx scripts/v2-test-until-ocr.ts \
  --cities al_agua_branca,al_anadia,al_arapiraca,al_atalaia,al_barra_de_santo_antonio,al_barra_de_sao_miguel,al_batalha,al_belem,al_belo_monte,al_boca_da_mata,al_branquinha,al_cacimbinhas,al_cajueiro,al_campestre,al_campo_alegre,al_campo_grande,al_canapi,al_capela,al_carneiros,al_cha_preta,al_coite_do_noia,al_colonia_leopoldina,al_coqueiro_seco,al_coruripe,al_craibas,al_delmiro_gouveia,al_dois_riachos,al_estrela_de_alagoas,al_feira_grande,al_feliz_deserto,al_flexeiras,al_girau_do_ponciano,al_ibateguara,al_igaci,al_igreja_nova,al_inhapi,al_jacare_dos_homens,al_jacuipe,al_japaratinga,al_jaramataia,al_jequia_da_praia,al_joaquim_gomes,al_jundia,al_junqueiro,al_lagoa_da_canoa,al_limoeiro_de_anadia,al_maceio,al_major_isidoro,al_mar_vermelho,al_maragogi,al_maravilha,al_marechal_deodoro,al_maribondo,al_mata_grande,al_matriz_de_camaragibe,al_messias,al_minador_do_negrao,al_monteiropolis,al_murici,al_novo_lino,al_olho_dagua_das_flores,al_olho_dagua_do_casado,al_olho_dagua_grande,al_olivenca,al_ouro_branco,al_palestina,al_palmeira_dos_indios,al_pao_de_acucar,al_pariconha,al_passo_de_camaragibe,al_paulo_jacinto,al_penedo,al_piacabucu,al_pilar,al_pindoba,al_piranhas,al_poco_das_trincheiras,al_porto_calvo,al_porto_de_pedras,al_porto_real_do_colegio,al_quebrangulo,al_rio_largo,al_roteiro,al_santa_luzia_do_norte,al_santana_do_ipanema,al_santana_do_mundau,al_sao_jose_da_laje,al_sao_jose_da_tapera,al_sao_luis_do_quitunde,al_sao_miguel_dos_campos,al_sao_miguel_dos_milagres,al_sao_sebastiao,al_satuba,al_senador_rui_palmeira,al_tanque_darca,al_taquarana,al_teotonio_vilela,al_traipu,al_uniao_dos_palmares,al_vicosa \
  --api-url http://localhost:56485 \
  --db-path ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/1f753fa28e955c195ba9b20424ae6f2231a7842894d6a90c607aefb554e7f871.sqlite" \
  --days 5 \
  --timeout 20 \
  --output al-test-results.json
```

## Testing a Subset of Cities

You can test just a few cities at a time:

```bash
npx tsx scripts/v2-test-until-ocr.ts \
  --cities ac_rio_branco,ac_cruzeiro_do_sul \
  --api-url http://localhost:61083 \
  --db-path ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/1f753fa28e955c195ba9b20424ae6f2231a7842894d6a90c607aefb554e7f871.sqlite" \
  --days 5 \
  --timeout 20
```

## Generating City Lists for Other States

To extract all city IDs from a state config file:

```bash
node -e "const d=require('./src/spiders/v2/configs/<STATE>.json'); console.log(d.map(c=>c.id).join(','))"
```

Replace `<STATE>` with the state code (e.g., `al`, `am`, `ba`, `sp`, etc.).

Then paste the output into the `--cities` flag.

## Interpreting Results

The script reports three categories:

- **Successful**: Gazettes found with valid OCR (markdown format, contains "Diário Oficial")
- **Failed**: Gazettes found but OCR missing or invalid
- **No results**: No gazettes found in the date range (may be expected if no publications in that period)

## Troubleshooting

- **"No gazettes found"** after crawl completes: The Acre spider uses `requiresClientRendering: true`. Make sure `wrangler dev` is running with browser support.
- **DB path issues**: Always use the full hash filename, not a glob pattern. Quote the path.
- **Port changed**: `wrangler dev` may pick a different port each time. Check the terminal output and update `--api-url`.
