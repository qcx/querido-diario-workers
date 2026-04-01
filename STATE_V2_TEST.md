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
