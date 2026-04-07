# Branch `update-spiders-url` — Changes vs `main`

## Overview

This branch introduces the **V2 spider architecture** for the Goodfellow gazette crawling system, starting with a full implementation for the state of **Acre (AC)**. It also adds a comprehensive **official gazette URL dataset** covering all 27 Brazilian states, and enhances the end-to-end testing infrastructure.

**Total: ~24,900 lines added across 35 files.**

---

## 1. V2 Acre Spider (`src/spiders/v2/base/`)

### New: `base-spider.ts` — Abstract Base Class

A new `BaseSpider` abstract class for the V2 spider system that provides:

- **Date range management** with UTC-safe handling and respect for each spider's `startDate`
- **URL resolution** — resolves PDF URLs to their final destination (follows redirects), with an option to skip resolution for session-based URLs
- **Gazette creation** via `createGazette()` which standardizes output with territory ID, date, edition info, and power classification
- **Request counting** for monitoring and rate-limiting awareness

### New: `acre-spider.ts` — Acre State Spider

A dedicated spider for the Diário Oficial do Estado do Acre (DOE/AC) at `https://diario.ac.gov.br/`. Key characteristics:

- **Dual crawling modes:**
  - **HTTP/Fetch mode** — iterates each day in the date range and POSTs `{ data: "YYYYMMDD" }` to fetch listings
  - **Browser/Puppeteer mode** — uses `@cloudflare/puppeteer` for client-side rendering when `requiresClientRendering: true` (needed due to SSL certificate issues with Cloudflare Workers)
- **Centralized state system** — all 22 Acre cities publish in the same state-level gazette; the spider parses results from `.resultados_busca` tables
- Extracts edition numbers, detects extra editions, deduplicates by URL
- Supports pagination (10 results per page)

### V2 Config: `src/spiders/v2/configs/ac.json`

Expanded from a minimal config to full definitions for all **22 cities** in Acre, each mapped to their IBGE territory ID (e.g., `ac_acrelandia` → `1200013`) with the `acre` spider type and `requiresClientRendering: true`.

---

## 2. Official Gazette URL Dataset (`src/cities/dos/`)

**27 new JSON files** — one per Brazilian state — cataloguing official gazette URLs for every municipality. Each file maps city names to their `official_gazette_url`.

| State | File |
|-------|------|
| AC, AL, AM, AP, BA, CE, DF, ES, GO, MA, MG, MS, MT, PA, PB, PE, PI, PR, RJ, RN, RO, RR, RS, SC, SE, SP, TO | `src/cities/dos/<state>.json` |

This dataset serves as a reference for which gazette portal each city uses, enabling future automated spider selection and coverage analysis.

---

## 3. Registry Manager Updates (`src/spiders/registry-manager.ts`)

The `SpiderRegistryManager.createSpider()` method now **prefers V2 spider classes** when available, falling back to V1:

- New private method `tryCreateV2Spider()` checks if a V2 implementation exists for the spider type
- Currently routes `"acre"` type to the new `V2AcreSpider` class
- All other spider types fall through to the existing V1 switch-case
- This pattern makes it straightforward to add more V2 spiders incrementally

---

## 4. V2 Executor Fix (`src/spiders/v2/executor.ts`)

Renamed the import alias from `v1Registry` to `spiderRegistry` (consistent naming). Since `createSpider()` in the registry manager now handles V2 routing internally, the executor no longer needs to distinguish between registries — it delegates to the unified `spiderRegistryManager` which picks the right spider class.

---

## 5. Testing Infrastructure

### Enhanced: `scripts/v2-test-until-ocr.ts`

The end-to-end test script was significantly improved:

- **V2 config resolution** — automatically loads territory configs from `src/spiders/v2/configs/*.json` and maps spider IDs (e.g., `ac_acrelandia`) to IBGE territory IDs (e.g., `1200013`)
- **`resolveCityConfig()` helper** — resolves city IDs against V2 configs, falling back to using the ID as-is for V1 spiders
- **JSON output** — new `--output` flag saves results to a JSON file for automated analysis
- **File write support** added via `writeFileSync` and `readdirSync` imports

### New: `STATE_V2_TEST.md`

Documentation for running the V2 spider + OCR end-to-end tests, including:
- Prerequisites (dev server, database path)
- CLI options reference
- Testing commands by state (Acre example with all 22 cities)
- Result interpretation guide

### Test Results: `ac-test-results.json`

Captured results from a full Acre test run:

| Metric | Value |
|--------|-------|
| Total cities | 22 |
| Successful | **20** (91%) |
| Failed | 0 |
| No results | 2 (`ac_placido_de_castro`, `ac_tarauaca`) |
| Execution time | ~25 min |

The 2 "no results" cities had no gazette publications in the tested date range — not spider failures.

---

## Summary of Changes by Category

| Category | Files | Lines |
|----------|-------|-------|
| V2 Spider Classes | 2 new | ~436 |
| V2 Config (AC) | 1 modified | ~380 |
| DOS URL Dataset | 27 new | ~22,200 |
| Registry/Executor | 2 modified | ~38 |
| Test Script | 1 modified | ~131 |
| Test Docs & Results | 2 new | ~1,276 |
| **Total** | **35** | **~24,885** |
