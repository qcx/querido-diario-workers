// src/crawler.js
import axios from "axios";
import fs from "fs";
import path from "path";
import * as cheerio from "cheerio";
import { fileURLToPath } from "url";
import municipios from "../municipios_ibge.json" with { type: "json" };

/* =========================
   ESM paths
========================= */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

/* =========================
   Paths
========================= */
const LINKS_PATH            = path.resolve(__dirname, "./links.txt");
const SPIDERS_DIR           = path.resolve(__dirname, "./spiders/configs");
const EXPORTS_PATH          = path.resolve(__dirname, "./export.json");
const GAZETTE_CRAWLS_PATH   = path.resolve(__dirname, "./gazette_crawls_export.json"); // <= NOVO

/* =========================
   UF helpers
========================= */
const UF_LIST = "(ac|al|ap|am|ba|ce|df|es|go|ma|mt|ms|mg|pa|pb|pr|pe|pi|rj|rn|rs|ro|rr|sc|sp|se|to)";
const UF_RE_ANY = new RegExp(`\\b(${UF_LIST})\\b`, "i");
const STATE_TO_UF = new Map(Object.entries({
  "acre":"AC","alagoas":"AL","amapá":"AP","amapa":"AP","amazonas":"AM","bahia":"BA","ceará":"CE","ceara":"CE",
  "distrito federal":"DF","espírito santo":"ES","espirito santo":"ES","goiás":"GO","goias":"GO","maranhão":"MA","maranhao":"MA",
  "mato grosso":"MT","mato grosso do sul":"MS","minas gerais":"MG","pará":"PA","para":"PA","paraíba":"PB","paraiba":"PB",
  "paraná":"PR","parana":"PR","pernambuco":"PE","piauí":"PI","piaui":"PI","rio de janeiro":"RJ","rio grande do norte":"RN",
  "rio grande do sul":"RS","rondônia":"RO","rondonia":"RO","roraima":"RR","santa catarina":"SC","são paulo":"SP","sao paulo":"SP",
  "sergipe":"SE","tocantins":"TO"
}));

/* =========================
   text utils
========================= */
const SHORT_CITY_STRICT = new Set(["itu","ipu","luz","eua","pau","iba"]);
const STOPWORDS = new Set(["de","da","do","das","dos"]);

function normalize(s) {
  if (!s) return "";
  s = s.toLowerCase();
  s = s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  s = s.replace(/[’'`´^~"]/g, "");
  s = s.replace(/[.,;:!?()[\]{}_/\\|<>]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
function aliasKey(name) {
  let n = normalize(name)
    .replace(/\bd[o’']\s+/g, "do ")
    .replace(/\bmunicipio de\b/g, "")
    .trim();
  const toks = n.split(" ").filter(t => t && !STOPWORDS.has(t));
  return toks.join(" ");
}
function pct(a,b){ return b ? (100*a/b).toFixed(2) : "0.00"; }
function stripTextFrag(u) { return u.replace(/#:~:text=.*$/i, ""); }
function toFold(s) { return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }
function escapeRegex(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/* =========================
   links loader (robusto)
========================= */
function sanitizeUrl(s) {
  if (!s) return null;
  s = s.trim().replace(/^['"`]+|['"`;,]+$/g, "");
  if (!s) return null;
  s = stripTextFrag(s);
  try {
    const u = new URL(s);
    u.hash = "";
    u.search = "";
    return u.toString();
  } catch { return null; }
}
function loadLinks(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").trim();
  try {
    const asJson = JSON.parse(raw);
    if (Array.isArray(asJson)) return asJson.map(sanitizeUrl).filter(Boolean);
  } catch {}
  return raw.split(/\r?\n/).map(sanitizeUrl).filter(Boolean);
}

/* =========================
   IBGE indexes
========================= */
const IBGE_BY_NAME_UF = new Map(); // alias|UF -> row
const IBGE_BY_ALIAS   = new Map(); // alias -> [rows]
const IBGE_NAME_SET   = new Set();
const IBGE_BY_TID     = new Map(); // territoryId -> row
let IBGE_MAX_TOKENS   = 1;

function buildIbgeIndexes() {
  for (const m of municipios) {
    const uf = (m.uf || "").toUpperCase();
    const a  = aliasKey(m.name);
    IBGE_BY_NAME_UF.set(`${a}|${uf}`, m);
    if (!IBGE_BY_ALIAS.has(a)) IBGE_BY_ALIAS.set(a, []);
    IBGE_BY_ALIAS.get(a).push(m);
    IBGE_NAME_SET.add(a);
    const tc = a.split(" ").length;
    if (tc > IBGE_MAX_TOKENS) IBGE_MAX_TOKENS = tc;

    const tid = (m.territoryId || m.codigo || m.codigo_ibge || "").toString().trim();
    if (tid) IBGE_BY_TID.set(tid, m);
  }
}

/* =========================
   candidates + scoring
========================= */
function candidate(ibge, source, score, detail = {}) {
  return {
    name: ibge.name,
    uf: ibge.uf,
    ufName: ibge.ufName,
    microrregiaoNome: ibge.microrregiaoNome,
    regiaoNome: ibge.regiaoNome,
    source, score, ...detail
  };
}
function pickBest(cands) {
  if (!cands.length) return null;
  return cands.sort((a,b)=> (b.score-a.score) || (b.name.length-a.name.length))[0];
}

/* =========================
   1) slug forte
========================= */
function fromSlug(url) {
  const rx = new RegExp(`-([a-z-]+)-(${UF_LIST})(?:[^a-z]|$)`, "ig");
  const cands = [];
  let m;
  while ((m = rx.exec(url))) {
    const city = m[1].replace(/-/g, " ").trim();
    const uf   = m[2].toUpperCase();
    const a    = aliasKey(city);
    if (SHORT_CITY_STRICT.has(a)) continue;
    const ibge = IBGE_BY_NAME_UF.get(`${a}|${uf}`);
    if (ibge) cands.push(candidate(ibge, "slug_strong", 100, {frag: m[0]}));
  }
  return cands;
}

/* =========================
   2) n-gram em título/corpo
========================= */
function ngramMatch(text, preferUF = null, sourceLabel = "ngram") {
  const body = normalize(text);
  if (!body) return [];
  const tokens = body.split(" ").filter(Boolean);
  const maxN = Math.min(IBGE_MAX_TOKENS, 6);
  const out = [];

  for (let i=0;i<tokens.length;i++){
    for (let n=maxN;n>=1;n--){
      if (i+n>tokens.length) continue;
      const gram = tokens.slice(i,i+n).join(" ");
      if (!IBGE_NAME_SET.has(gram)) continue;
      if (SHORT_CITY_STRICT.has(gram) && sourceLabel === "body") continue;
      const cands = IBGE_BY_ALIAS.get(gram) || [];
      if (cands.length === 1) {
        out.push(candidate(cands[0], sourceLabel, 82, {span:[i,i+n]}));
      } else if (cands.length > 1) {
        if (preferUF) {
          const c = cands.find(x => x.uf.toUpperCase() === preferUF);
          if (c) out.push(candidate(c, sourceLabel, 79, {span:[i,i+n], note:"uf_hint"}));
          else out.push(candidate(cands[0], sourceLabel, 72, {span:[i,i+n], note:"multi_name"}));
        } else {
          out.push(candidate(cands[0], sourceLabel, 72, {span:[i,i+n], note:"multi_name"}));
        }
      }
    }
  }
  return out;
}

/* =========================
   3) janela em torno da UF
========================= */
function nearUFWindows(text) {
  const raw = normalize(text);
  const toks = raw.split(" ").filter(Boolean);
  const out = [];
  for (let i=0;i<toks.length;i++){
    const m = toks[i].match(UF_RE_ANY);
    if (!m) continue;
    const uf = m[1].toUpperCase();
    for (let w=1; w<=6; w++){
      const start = Math.max(0, i-w);
      const gram  = toks.slice(start, i).join(" ");
      if (!gram) continue;
      if (!IBGE_NAME_SET.has(gram)) continue;
      const cands = (IBGE_BY_ALIAS.get(gram) || []).filter(r => r.uf.toUpperCase() === uf);
      if (cands.length) out.push(candidate(cands[0], "near_uf_before", 77, {uf, window:w}));
    }
    for (let w=1; w<=6 && i+w<=toks.length; w++){
      const gram = toks.slice(i+1, i+1+w).join(" ");
      if (!gram) continue;
      if (!IBGE_NAME_SET.has(gram)) continue;
      const cands = (IBGE_BY_ALIAS.get(gram) || []).filter(r => r.uf.toUpperCase() === uf);
      if (cands.length) out.push(candidate(cands[0], "near_uf_after", 74, {uf, window:w}));
    }
  }
  return out;
}

/* =========================
   4) meta + JSON-LD
========================= */
function fromMetaAndLD($) {
  const cands = [];

  const metas = [];
  const ogt = $('meta[property="og:title"]').attr("content");
  const twt = $('meta[name="twitter:title"]').attr("content");
  const kw  = $('meta[name="keywords"]').attr("content");
  const sec = $('meta[property="article:section"]').attr("content");
  const tags = $('meta[property="article:tag"]').map((i,el)=>$(el).attr("content")).get();
  if (ogt) metas.push(ogt);
  if (twt) metas.push(twt);
  if (kw)  metas.push(kw);
  if (sec) metas.push(sec);
  if (tags?.length) metas.push(tags.join(" | "));
  const metaText = metas.join(" | ");
  const metaUF = (metaText.match(UF_RE_ANY)?.[1] || "").toUpperCase() || null;
  cands.push(...ngramMatch(metaText, metaUF, "meta_hints"));

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).contents().text();
      if (!raw) return;
      const json = JSON.parse(raw);
      const items = Array.isArray(json) ? json : [json];
      for (const it of items) {
        if (!it) continue;
        const blob = JSON.stringify(it);
        const uf = (blob.match(UF_RE_ANY)?.[1] || "").toUpperCase() || null;
        cands.push(...ngramMatch(blob, uf, "jsonld"));
      }
    } catch {}
  });

  return cands;
}

function walkJsonFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    if (!fs.existsSync(cur)) continue;
    const stat = fs.statSync(cur);
    if (stat.isDirectory()) {
      for (const f of fs.readdirSync(cur)) {
        stack.push(path.join(cur, f));
      }
    } else if (stat.isFile() && cur.toLowerCase().endsWith(".json")) {
      out.push(cur);
    }
  }
  return out;
}

/* =========================
   5) título TitleCase
========================= */
function titleCaseHeuristic(title, preferUF = null) {
  const out = [];
  const rx = /(?:^|[^\p{L}])([A-ZÁÂÃÀÉÊÍÓÔÕÚÇ][\p{L}'’\-]+(?:\s+[A-ZÁÂÃÀÉÊÍÓÔÕÚÇ][\p{L}'’\-]+){0,4})/gmu;
  let m;
  while ((m = rx.exec(title))) {
    const frag = m[1].trim();
    const a = aliasKey(frag);
    if (!a) continue;
    if (!IBGE_NAME_SET.has(a)) continue;
    const cands = IBGE_BY_ALIAS.get(a) || [];
    if (cands.length === 1) out.push(candidate(cands[0], "titlecase", 76, {frag}));
    else if (preferUF) {
      const pick = cands.find(x => x.uf.toUpperCase() === preferUF);
      if (pick) out.push(candidate(pick, "titlecase", 76, {frag}));
    }
  }
  return out;
}

/* =========================
   6) estado por extenso
========================= */
function detectStateNameUF(text) {
  const body = normalize(text);
  for (const [k,uf] of STATE_TO_UF.entries()) {
    if (body.includes(k)) return uf;
  }
  return null;
}

/* =========================
   HTTP com retry/backoff
========================= */
async function fetchHtml(url) {
  const u = stripTextFrag(url);
  const headers = {
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36",
    "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8"
  };
  const timeouts = [12000, 20000, 25000];
  let lastErr;
  for (let i=0;i<timeouts.length;i++){
    try {
      const res = await axios.get(u, { timeout: timeouts[i], headers });
      return res.data;
    } catch (e) {
      lastErr = e;
      await new Promise(r=>setTimeout(r, 300*(i+1)));
    }
  }
  throw lastErr;
}

/* =========================================================
   🔥 Matching forte (UF → cidade, word-boundary, anti-instituição)
========================================================= */
const INSTITUTION_RX = /\b(etec|fatec|usp|unesp|unifesp|uf\w+|instituto|universidade|faculdade|fundação|câmara municipal|câmara de|assembleia|secretaria)\b/i;

function cityRegexVariants(name) {
  const base = toFold(name.toLowerCase());
  const parts = base.split(/\s+/).filter(Boolean);
  const pattern = parts.map(p => escapeRegex(p)).join("[\\s-]+");
  return new RegExp(`\\b${pattern}\\b`, "i");
}
function extractUFPreferential(text, url) {
  const hay = `${text || ""} ${url || ""}`;
  const rx = /(?:\s[-,]\s|\(|,\s)(AC|AL|AM|AP|BA|CE|DF|ES|GO|MA|MG|MS|MT|PA|PB|PE|PI|PR|RJ|RN|RO|RR|RS|SC|SE|SP|TO)(?:\)|\b)/i;
  const m = hay.match(rx);
  if (m) return m[1].toUpperCase();
  const slugUF = /[-_/](ac|al|am|ap|ba|ce|df|es|go|ma|mg|ms|mt|pa|pb|pe|pi|pr|rj|rn|ro|rr|rs|sc|se|sp|to)(?:[-_/]|$)/i.exec(hay);
  return slugUF ? slugUF[1].toUpperCase() : null;
}

function resolveMunicipalityFromTextStrong({ html, url }) {
  const $ = cheerio.load(html);
  const h1 = ($("h1").first().text() || "").trim();
  const title = ( $("meta[property='og:title']").attr("content") || $("title").text() || "" ).trim();
  const article = ($(".noticia, article").text() || $("article").text() || "").trim();
  const body = (article || $("main").text() || $("body").text() || "").slice(0, 20000);
  const hayTitle = `${h1}\n${title}`;

  const uf =
    extractUFPreferential(hayTitle, url) ||
    extractState(hayTitle) ||
    extractUFPreferential(body, url) ||
    detectStateNameUF(hayTitle) ||
    detectStateNameUF(body);

  function extractState(txt) {
    const ufNamed = detectStateNameUF(txt);
    return ufNamed || null;
  }

  const candidates = uf ? municipios.filter(m => (m.uf || "").toUpperCase() === uf) : municipios;

  const prefRx = /prefeitura\s+de\s+([a-zÀ-ÿ\s’'´`-]+)/i;
  const prefM = hayTitle.match(prefRx);
  if (prefM) {
    const raw = prefM[1].trim();
    for (const cand of candidates) {
      if (cityRegexVariants(cand.name).test(raw)) {
        return { name: cand.name, uf: cand.uf, source: "title_prefeitura" };
      }
    }
  }

  if (uf) {
    for (const cand of candidates) {
      const rx = new RegExp(`${cityRegexVariants(cand.name).source}\\s*[-,]\\s*${uf}\\b`, "i");
      if (rx.test(hayTitle)) return { name: cand.name, uf: cand.uf, source: "title_cityUF" };
    }
  }

  if (!INSTITUTION_RX.test(hayTitle)) {
    for (const cand of candidates) {
      if (cityRegexVariants(cand.name).test(hayTitle)) {
        return { name: cand.name, uf: cand.uf, source: "title_exact" };
      }
    }
  }

  if (uf) {
    const brief = body.slice(0, 10000);
    for (const cand of candidates) {
      const rx = new RegExp(`${cityRegexVariants(cand.name).source}\\s*[-,]\\s*${uf}\\b`, "i");
      if (!INSTITUTION_RX.test(brief) && rx.test(brief)) {
        return { name: cand.name, uf: cand.uf, source: "body_cityUF" };
      }
    }
  }

  {
    const brief = body.slice(0, 8000);
    for (const cand of candidates) {
      const rx = cityRegexVariants(cand.name);
      if (rx.test(brief) && !INSTITUTION_RX.test(brief)) {
        return { name: cand.name, uf: cand.uf, source: "body_exact" };
      }
    }
  }

  if (uf) return { name: null, uf, source: "onlyUF" };
  return null;
}

/* =========================
   Resolver cidade/UF no LINK
========================= */
async function resolveCityUF(url) {
  const slugC = fromSlug(url);
  if (slugC.length) return { best: { ...pickBest(slugC), confidence: "high", why: "slug_strong" }, debug: { stage: "slug" } };

  let html;
  try { html = await fetchHtml(url); }
  catch (e) {
    return { best: null, debug: { stage: "fetch_error", error: (e && e.message) || String(e) } };
  }

  const strong = resolveMunicipalityFromTextStrong({ html, url });
  if (strong && strong.name) {
    const ibge = IBGE_BY_NAME_UF.get(`${aliasKey(strong.name)}|${(strong.uf || "").toUpperCase()}`);
    if (ibge) {
      const pick = candidate(ibge, strong.source, 95);
      return { best: { ...pick, confidence: "high", why: strong.source }, debug: { stage: "strong" } };
    }
  }

  const $ = cheerio.load(html);
  const title = $("h1").text() || $("title").text() || "";
  const body  = $(".content, article, .noticia, .conteudo, body").text() || $("body").text() || "";
  const all   = `${title}\n${body}`;

  const metaC = fromMetaAndLD($);
  if (metaC.length) return { best: { ...pickBest(metaC), confidence: "high", why: "meta/jsonld" }, debug: { stage: "meta/jsonld" } };

  const titleUF = (title.match(UF_RE_ANY)?.[1] || "").toUpperCase() || detectStateNameUF(title) || null;
  const titleC  = ngramMatch(title, titleUF, "title_strong");
  if (titleC.length) return { best: { ...pickBest(titleC), confidence: "high", why: "title_strong" }, debug: { stage: "title_strong" } };

  const tcaseC = titleCaseHeuristic(title, titleUF);
  if (tcaseC.length) return { best: { ...pickBest(tcaseC), confidence: "medium", why: "titlecase" }, debug: { stage: "titlecase" } };

  const ufHint = (all.match(UF_RE_ANY)?.[1] || "").toUpperCase() || detectStateNameUF(all) || null;
  const nearC = nearUFWindows(all);
  if (nearC.length) {
    const filtered = ufHint ? nearC.filter(c => c.uf.toUpperCase() === ufHint) : nearC;
    const pick = pickBest(filtered.length ? filtered : nearC);
    return { best: { ...pick, confidence: "medium", why: "near_uf_window" }, debug: { stage: "near_uf_window", ufHint } };
  }

  const bodyUF = ufHint;
  const bodyC  = ngramMatch(all, bodyUF, "body");
  if (bodyC.length) return { best: { ...pickBest(bodyC), confidence: "low", why: "body_ngram" }, debug: { stage: "body_ngram", ufHint: bodyUF } };

  if (bodyUF) {
    const tokens = normalize(all).split(" ").filter(Boolean);
    const seen = new Set();
    const hits = [];
    for (let i=0;i<tokens.length;i++){
      for (let n=6;n>=1;n--){
        if (i+n>tokens.length) continue;
        const gram = tokens.slice(i,i+n).join(" ");
        if (!IBGE_NAME_SET.has(gram) || seen.has(gram)) continue;
        seen.add(gram);
        const cands = (IBGE_BY_ALIAS.get(gram) || []).filter(r => r.uf.toUpperCase() === bodyUF);
        if (cands.length) hits.push(candidate(cands[0], "last_resort", 56, {span:[i,i+n]}));
      }
    }
    if (hits.length) return { best: { ...pickBest(hits), confidence: "low", why: "last_resort" }, debug: { stage: "last_resort", ufHint: bodyUF } };
  }

  return { best: null, debug: { stage: "unresolved" } };
}

/* =========================
   🔧 Spiders loader/index
========================= */
function parseCityUFFromName(name) {
  const m = (name || "").match(/\s*-\s*([A-Z]{2})\s*$/);
  if (!m) return { cityFromName: name?.trim() || "", ufFromName: null };
  const uf = m[1].toUpperCase();
  const city = name.replace(/\s*-\s*[A-Z]{2}\s*$/, "").trim();
  return { cityFromName: city, ufFromName: uf };
}

function normalizeSpiderEntry(raw) {
  const isContainer = !!raw?.primary;

  const tid = String(
    (raw?.territoryId ?? raw?.primary?.territoryId ?? "")
  ).trim();

  let stateCode =
    (raw?.stateCode ?? raw?.primary?.stateCode ?? "").toString().trim().toUpperCase();

  let name =
    (raw?.name ?? raw?.primary?.name ?? "").toString().trim();

  const ibgeRow = tid ? IBGE_BY_TID.get(tid) : null;

  let uf = stateCode || null;
  if (!uf && name) {
    const { ufFromName } = parseCityUFFromName(name);
    if (ufFromName) uf = ufFromName;
  }
  if (!uf && ibgeRow) uf = (ibgeRow.uf || "").toUpperCase();

  let city = name || "";
  if (city) {
    city = parseCityUFFromName(city).cityFromName || city;
  } else if (ibgeRow) {
    city = ibgeRow.name;
  }

  return { tid, uf, city };
}

function loadSpiders() {
  const byAliasUF = new Map(); // `${alias}|${UF}` -> territoryId
  const byTidMeta = new Map(); // territoryId -> { name, uf, originFile }
  let filesLoaded = 0;
  let municipalitiesLoaded = 0;

  if (!fs.existsSync(SPIDERS_DIR)) {
    return {
      byAliasUF,
      byTidMeta,
      stats: { filesLoaded, municipalitiesLoaded, coveredUFs: [], sampleKeys: [] }
    };
  }

  const files = walkJsonFiles(SPIDERS_DIR);
  filesLoaded = files.length;

  const pushNormalized = (norm, originFile) => {
    const { tid, uf, city } = norm;
    if (!tid || !uf || !city) return;

    const alias = aliasKey(city);
    const key = `${alias}|${uf}`;
    if (!byAliasUF.has(key)) byAliasUF.set(key, tid);
    if (!byTidMeta.has(tid)) byTidMeta.set(tid, { name: city, uf, originFile });
    municipalitiesLoaded++;
  };

  const pushAny = (obj, originFile) => {
    const norm = normalizeSpiderEntry(obj);
    pushNormalized(norm, originFile);
    if (Array.isArray(obj?.fallbacks)) {
      for (const f of obj.fallbacks) {
        const normF = normalizeSpiderEntry(f);
        pushNormalized(normF, originFile);
      }
    }
  };

  for (const f of files) {
    try {
      const j = JSON.parse(fs.readFileSync(f, "utf8"));
      if (Array.isArray(j)) {
        j.forEach((m) => pushAny(m, f));
      } else if (j && typeof j === "object") {
        if (Array.isArray(j.municipalities)) {
          j.municipalities.forEach((m) => pushAny(m, f));
        } else if (Array.isArray(j.territories)) {
          j.territories.forEach((m) => pushAny(m, f));
        } else {
          pushAny(j, f);
        }
      }
    } catch { /* ignora arquivo inválido */ }
  }

  const coveredUFsSet = new Set();
  for (const [, meta] of byTidMeta) coveredUFsSet.add(meta.uf);
  const coveredUFs = Array.from(coveredUFsSet).sort();
  const sampleKeys = Array.from(byAliasUF.keys()).slice(0, 30);

  return {
    byAliasUF,
    byTidMeta,
    stats: { filesLoaded, municipalitiesLoaded, coveredUFs, sampleKeys }
  };
}

/* =========================
   Exports loader
========================= */
function loadExportsMap() {
  const map = new Map(); // territory_id -> results[]
  const p = EXPORTS_PATH;
  if (!p) return map;

  let data;
  try { data = JSON.parse(fs.readFileSync(p, "utf8")); }
  catch { return map; }

  const batches = Array.isArray(data) ? data : [data];
  for (const batch of batches) {
    const arr = batch?.results || [];
    for (const r of arr) {
      const tid = String(r.territory_id || "").trim();
      if (!tid) continue;
      if (!map.has(tid)) map.set(tid, []);
      map.get(tid).push(r);
    }
  }
  return map;
}

/* =========================
   Gazette Crawls loader (NOVO)
   Retorna:
   - map: territory_id -> array de rows
   - latest: territory_id -> row mais recente (pelo scraped_at ou created_at)
========================= */
function loadGazetteCrawls() {
  const map = new Map();   // territory_id -> rows[]
  const latest = new Map(); // territory_id -> lastRow
  if (!fs.existsSync(GAZETTE_CRAWLS_PATH)) {
    return { map, latest };
  }

  let rows;
  try {
    rows = JSON.parse(fs.readFileSync(GAZETTE_CRAWLS_PATH, "utf8"));
  } catch {
    return { map, latest };
  }
  if (!Array.isArray(rows)) rows = [];

  // indexa e encontra o mais recente por territory_id
  const byTid = new Map();
  for (const r of rows) {
    const tid = String(r?.territory_id || "").trim();
    if (!tid) continue;
    if (!byTid.has(tid)) byTid.set(tid, []);
    byTid.get(tid).push(r);
  }

  for (const [tid, arr] of byTid.entries()) {
    // ordena por scraped_at (ou created_at) asc
    arr.sort((a,b) => {
      const ta = Date.parse(a.scraped_at || a.created_at || 0) || 0;
      const tb = Date.parse(b.scraped_at || b.created_at || 0) || 0;
      return ta - tb;
    });
    map.set(tid, arr);
    latest.set(tid, arr[arr.length - 1]);
  }

  return { map, latest };
}

/* =========================
   Helpers
========================= */
function inc(map, key, delta=1){ map[key] = (map[key] || 0) + delta; }
function incNested(obj, k1, k2, delta = 1) {
  if (!obj[k1]) obj[k1] = {};
  obj[k1][k2] = (obj[k1][k2] || 0) + delta;
}
function uniqueBy(list, keyFn) {
  const seen = new Set();
  const out = [];
  for (const it of list) {
    const k = keyFn(it);
    if (!seen.has(k)) { seen.add(k); out.push(it); }
  }
  return out;
}

/* =========================
   MAIN
========================= */
async function main() {
  console.log("🚀 Inicializando…");
  buildIbgeIndexes();

  const links = loadLinks(LINKS_PATH);
  const spiders = loadSpiders();          // { byAliasUF, byTidMeta, stats }
  const exportsMap = loadExportsMap();    // territoryId -> results[]
  const gazetteCrawls = loadGazetteCrawls(); // { map, latest }  <= NOVO

  console.log("🕷️ Spiders:", spiders.stats);

  // 1) Resolver cidade/UF para todos os links do LINK
  const resolved = [];
  const unresolved = [];
  for (const url of links) {
    const r = await resolveCityUF(url);
    if (r.best) {
      const { name, uf, source, score, confidence, why } = r.best;
      const ak = aliasKey(name);
      resolved.push({ url, name, uf, alias: ak, key: `${ak}|${uf}`, why, confidence, score });
    } else {
      unresolved.push({ url, reason: "municipality_not_found", debug: r.debug });
    }
  }

  // Diagnóstico de spiders solicitadas vs disponíveis
  (function dumpSpiderDiagnostics(spiders, resolvedRows) {
    const requestedKeys = Array.from(new Set(resolvedRows.map(r => r.key))).sort();
    const foundKeys = [];
    const missingKeys = [];
    for (const k of requestedKeys) {
      if (spiders.byAliasUF.has(k)) foundKeys.push(k);
      else missingKeys.push(k);
    }
    const requestedUFs = Array.from(new Set(resolvedRows.map(r => r.uf))).sort();
    const availableUFs = spiders.stats.coveredUFs;

    const diag = {
      spiders_stats: spiders.stats,
      requested: {
        total_unique_municipalities_from_link: requestedKeys.length,
        requested_ufs: requestedUFs
      },
      coverage: {
        present_in_spiders: foundKeys.length,
        missing_in_spiders: missingKeys.length,
        percent_present: ((foundKeys.length / (requestedKeys.length || 1)) * 100).toFixed(2)
      },
      ufs: {
        available_in_spiders: availableUFs,
        requested_in_link: requestedUFs
      },
      samples: {
        example_missing_keys: missingKeys.slice(0, 50),
        example_available_keys: spiders.stats.sampleKeys
      }
    };

    fs.writeFileSync(
      path.resolve(__dirname, "./spiders_diagnostics.json"),
      JSON.stringify(diag, null, 2)
    );
  })(spiders, resolved);

  /* === ANÁLISE 1: Identificação (link → IBGE) === */
  const A1_total = links.length;
  const A1_ident = resolved.length;
  const A1_unres = unresolved.length;

  const A1_city_counts = {};
  for (const r of resolved) inc(A1_city_counts, `${r.name}/${r.uf}`);
  const A1_state_counts = {};
  for (const r of resolved) inc(A1_state_counts, r.uf);

  const analysis1 = {
    totals: { links_total: A1_total, identified: A1_ident, unidentified: A1_unres },
    rates: { identified_percent: pct(A1_ident, A1_total) },
    by_city: A1_city_counts,
    by_state: A1_state_counts,
    identified_list: resolved.map(r => ({
      url: r.url, city: r.name, uf: r.uf, why: r.why, confidence: r.confidence, score: r.score
    })),
    unidentified_list: unresolved
  };

  /* === ANÁLISE 2: Spiders (IBGE -> Spiders) === */
  const withSpider = [];
  const withoutSpider = [];
  for (const r of resolved) {
    const has = spiders.byAliasUF.has(r.key);
    if (has) {
      withSpider.push({ ...r, territoryId: spiders.byAliasUF.get(r.key) });
    } else {
      withoutSpider.push(r);
    }
  }

  const A2_city_with = {};
  const A2_state_with = {};
  for (const r of withSpider) { inc(A2_city_with, `${r.name}/${r.uf}`); inc(A2_state_with, r.uf); }

  const A2_city_without = {};
  const A2_state_without = {};
  for (const r of withoutSpider) { inc(A2_city_without, `${r.name}/${r.uf}`); inc(A2_state_without, r.uf); }

  const analysis2 = {
    base: { identified_links: resolved.length },
    totals: { with_spider: withSpider.length, without_spider: withoutSpider.length },
    rates: { with_spider_percent: pct(withSpider.length, resolved.length) },
    by_city: { with_spider: A2_city_with, without_spider: A2_city_without },
    by_state:{ with_spider: A2_state_with, without_spider: A2_state_without },
    lists: {
      with_spider: withSpider.map(r => ({ url: r.url, city: r.name, uf: r.uf, territoryId: r.territoryId })),
      without_spider: withoutSpider.map(r => ({ url: r.url, city: r.name, uf: r.uf }))
    }
  };

  /* === ANÁLISE 3: Exports (Spiders -> Exports) === */
  const withSpiderUnique = uniqueBy(withSpider, r => r.key);
  const exportsRows = withSpiderUnique.map(m => {
    const rows = exportsMap.get(m.territoryId) || [];
    return { city: m.name, uf: m.uf, territoryId: m.territoryId, exports_count: rows.length };
  });

  const withExports = exportsRows.filter(x => x.exports_count > 0);
  const withoutExports = exportsRows.filter(x => x.exports_count === 0);

  const A3_city_with = {};
  const A3_state_with = {};
  for (const r of withExports) { inc(A3_city_with, `${r.city}/${r.uf}`); inc(A3_state_with, r.uf); }

  const A3_city_without = {};
  const A3_state_without = {};
  for (const r of withoutExports) { inc(A3_city_without, `${r.city}/${r.uf}`); inc(A3_state_without, r.uf); }

  const analysis3 = {
    base: { municipalities_with_spider_in_resolved: withSpiderUnique.length },
    totals: {
      municipalities_with_exports: withExports.length,
      municipalities_without_exports: withoutExports.length,
      total_export_rows: withExports.reduce((a,b)=>a+b.exports_count,0)
    },
    rates: { municipalities_with_exports_percent: pct(withExports.length, withSpiderUnique.length || 1) },
    by_city: { with_exports: A3_city_with, without_exports: A3_city_without },
    by_state:{ with_exports: A3_state_with, without_exports: A3_state_without },
    lists: { with_exports: withExports, without_exports: withoutExports }
  };

  /* === ANÁLISE 4: Gazette Crawls (Spiders -> Gazette Crawls) === */
  // Base: municípios resolvidos QUE TÊM spider (withSpiderUnique)
  const crawlsRows = withSpiderUnique.map(m => {
    const rows = gazetteCrawls.map.get(m.territoryId) || [];
    // status mais recente (se houver)
    const last = gazetteCrawls.latest.get(m.territoryId) || null;
    const latest_status = last?.status || null;
    const latest_scraped_at = last?.scraped_at || last?.created_at || null;
    return {
      city: m.name, uf: m.uf, territoryId: m.territoryId,
      crawls_count: rows.length,
      latest_status,
      latest_scraped_at
    };
  });

  const withCrawls = crawlsRows.filter(x => x.crawls_count > 0);
  const withoutCrawls = crawlsRows.filter(x => x.crawls_count === 0);

  // contagens por UF e por status mais recente
  const A4_state_with = {};
  const A4_state_without = {};
  const A4_state_latest_status = {}; // { UF: { success: n, failed: n, ... } }

  for (const r of withCrawls) {
    inc(A4_state_with, r.uf);
    const st = r.latest_status || "unknown";
    incNested(A4_state_latest_status, r.uf, st, 1);
  }
  for (const r of withoutCrawls) {
    inc(A4_state_without, r.uf);
  }

  const analysis4 = {
    base: { municipalities_with_spider_in_resolved: withSpiderUnique.length },
    totals: {
      municipalities_with_crawls: withCrawls.length,
      municipalities_without_crawls: withoutCrawls.length,
      total_crawl_rows: withCrawls.reduce((a,b)=> a + b.crawls_count, 0)
    },
    rates: {
      municipalities_with_crawls_percent: pct(withCrawls.length, withSpiderUnique.length || 1)
    },
    by_state: {
      with_crawls: A4_state_with,
      without_crawls: A4_state_without,
      latest_status_counts: A4_state_latest_status
    },
    lists: {
      with_crawls: withCrawls,
      without_crawls: withoutCrawls
    }
  };

  /* === Saídas (join + análises) === */
  const joined = resolved.map(r => {
    const territoryId = spiders.byAliasUF.get(r.key) || null;
    const exportsCount = territoryId ? (exportsMap.get(territoryId)?.length || 0) : 0;
    const crawlCount = territoryId ? ((gazetteCrawls.map.get(territoryId) || []).length) : 0;
    const latest = territoryId ? (gazetteCrawls.latest.get(territoryId) || null) : null;
    return {
      url: r.url, city: r.name, uf: r.uf, territoryId,
      exportsCount,
      crawlCount,
      latestCrawlStatus: latest?.status || null,
      latestCrawlAt: latest?.scraped_at || latest?.created_at || null,
      why: r.why, confidence: r.confidence, score: r.score
    };
  });

  const summary = {
    totals: {
      links_total: links.length,
      municipal_resolved: resolved.length,
      spider_mapped: withSpider.length,
      exports_covered_municipalities: analysis3.totals.municipalities_with_exports,
      crawls_covered_municipalities: analysis4.totals.municipalities_with_crawls
    },
    rates: {
      municipal_match_percent: pct(resolved.length, links.length),
      spider_coverage_percent: pct(withSpider.length, resolved.length || 1),
      exports_coverage_percent: analysis3.rates.municipalities_with_exports_percent,
      crawls_coverage_percent: analysis4.rates.municipalities_with_crawls_percent
    }
  };

  fs.writeFileSync(path.resolve(__dirname, "./crawling/link_join_resolvidos.json"), JSON.stringify(joined, null, 2));
  fs.writeFileSync(path.resolve(__dirname, "./crawling/link_join_unmatched.json"), JSON.stringify(unresolved, null, 2));
  fs.writeFileSync(path.resolve(__dirname, "./crawling/link_join_summary.json"), JSON.stringify(summary, null, 2));

  fs.writeFileSync(path.resolve(__dirname, "./crawling/analysis_1_identification.json"), JSON.stringify(analysis1, null, 2));
  fs.writeFileSync(path.resolve(__dirname, "./crawling/analysis_2_spiders.json"), JSON.stringify(analysis2, null, 2));
  fs.writeFileSync(path.resolve(__dirname, "./crawling/analysis_3_exports_cross.json"), JSON.stringify(analysis3, null, 2));
  fs.writeFileSync(path.resolve(__dirname, "./crawling/analysis_4_gazette_crawls.json"), JSON.stringify(analysis4, null, 2)); // <= NOVO

  console.log("✅ Export concluído!");
  console.log({
    A1: { identified_percent: analysis1.rates.identified_percent, totals: analysis1.totals },
    A2: { with_spider_percent: analysis2.rates.with_spider_percent, totals: analysis2.totals },
    A3: { with_exports_percent: analysis3.rates.municipalities_with_exports_percent, totals: analysis3.totals },
    A4: { with_crawls_percent: analysis4.rates.municipalities_with_crawls_percent, totals: analysis4.totals } // <= NOVO
  });
}

main();
