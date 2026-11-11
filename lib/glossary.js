// Slang knowledge base + retrieval.
// Two sources are merged:
//   1. CIBuzzBench (3,001 Chinese internet buzzwords with English meaning/equivalent)
//   2. slang_curated.json (team-curated ZH / EN / FR slang with cross-language equivalents)
// Retrieval is a deterministic lexical matcher: it finds which known slang terms
// appear in the message so the LLM gets grounded definitions in its prompt.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(here, "..", "data");

const CJK = /[㐀-鿿豈-﫿]/;
const isAscii = (s) => /^[\x00-\x7f]+$/.test(s);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function load() {
  const cib = JSON.parse(fs.readFileSync(path.join(DATA, "slang_zh_cibuzzbench.json"), "utf8"));
  const curated = JSON.parse(fs.readFileSync(path.join(DATA, "slang_curated.json"), "utf8"));

  const entries = [];
  curated.forEach((c, i) => {
    entries.push({
      id: `cur-${i}`,
      term: c.term,
      lang: c.lang,
      pinyin: c.pinyin || "",
      meaning_en: c.meaning_en,
      meaning_fr: c.meaning_fr || "",
      equivalent_en: c.eq?.en || "",
      equivalents: c.eq || {},
      register: c.register || "",
      example: c.example || "",
      category: "Curated",
      harmful: /vulgar|rude/.test(c.register || ""),
      split: "curated",
      source: c.source || "Team curated",
      pattern: c.pattern || null,
    });
  });
  const curatedTerms = new Set(entries.map((e) => e.term.toLowerCase()));
  for (const e of cib) {
    // curated entries win when both sources define the same term
    if (curatedTerms.has(e.term.toLowerCase())) continue;
    entries.push({ ...e, equivalents: { en: e.equivalent_en }, pattern: null });
  }

  // Pre-compile one matcher per entry.
  // matcher: a RegExp (ASCII terms, with word boundaries), the string "includes"
  // (Chinese / mixed terms, substring match), or null (never auto-matched).
  for (const e of entries) {
    e.ascii = isAscii(e.term);
    e.needle = e.term.toLowerCase();
    if (e.pattern) {
      e.matcher = new RegExp(`(?<![A-Za-z0-9])${e.pattern}(?![A-Za-z0-9])`, "i");
    } else if (e.ascii) {
      e.matcher = e.term.length >= 2 ? new RegExp(`(?<![A-Za-z0-9])${escapeRe(e.term)}(?![A-Za-z0-9])`, "i") : null;
    } else {
      // single-character Chinese terms (e.g. 寄) match far too much ordinary text
      e.matcher = [...e.term].length >= 2 ? "includes" : null;
    }
  }
  return entries;
}

export const ENTRIES = load();

export function counts() {
  const c = { total: ENTRIES.length, zh: 0, en: 0, fr: 0, cibuzzbench: 0, curated: 0 };
  for (const e of ENTRIES) {
    c[e.lang] = (c[e.lang] || 0) + 1;
    if (e.source === "CIBuzzBench") c.cibuzzbench++;
    else c.curated++;
  }
  return c;
}

/**
 * Find known slang terms inside `text`.
 * @param {string} text
 * @param {{excludeTestSplit?: boolean, limit?: number}} opts
 *   excludeTestSplit: used by the benchmark so CIBuzzBench test answers never leak into the prompt.
 */
export function retrieve(text, { excludeTestSplit = false, limit = 12 } = {}) {
  if (!text) return [];
  const hasCJK = CJK.test(text);
  const lower = text.toLowerCase();
  const hits = [];
  for (const e of ENTRIES) {
    if (excludeTestSplit && e.split === "test") continue;
    // Chinese pinyin abbreviations (yyds, ex, ban...) only make sense in Chinese chats;
    // otherwise English words like "ban" or "ex" would be read as Chinese slang.
    if (e.lang === "zh" && e.ascii && !hasCJK && !e.pattern) continue;
    if (!e.matcher) continue;
    let idx = -1;
    let len = e.term.length;
    if (e.matcher === "includes") {
      idx = lower.indexOf(e.needle);
    } else {
      const m = e.matcher.exec(text);
      if (m) { idx = m.index; len = m[0].length; }
    }
    if (idx >= 0) hits.push({ e, start: idx, end: idx + len });
  }
  // Keep the longest match when terms overlap (e.g. 吃瓜群众 over 吃瓜).
  hits.sort((a, b) => (b.end - b.start) - (a.end - a.start) || (a.e.source === "CIBuzzBench") - (b.e.source === "CIBuzzBench"));
  const kept = [];
  for (const h of hits) {
    if (kept.some((k) => h.start >= k.start && h.end <= k.end)) continue;
    kept.push(h);
    if (kept.length >= limit) break;
  }
  kept.sort((a, b) => a.start - b.start);
  return kept.map((h) => publicEntry(h.e));
}

export function publicEntry(e) {
  const { matcher, needle, ascii, pattern, ...rest } = e;
  return rest;
}

export function search({ q = "", lang = "", page = 1, size = 24, source = "" } = {}) {
  const needle = q.trim().toLowerCase();
  let list = ENTRIES;
  if (lang) list = list.filter((e) => e.lang === lang);
  if (source === "curated") list = list.filter((e) => e.source !== "CIBuzzBench");
  if (source === "cibuzzbench") list = list.filter((e) => e.source === "CIBuzzBench");
  if (needle) {
    const scored = [];
    for (const e of list) {
      const t = e.term.toLowerCase();
      let s = 0;
      if (t === needle) s = 100;
      else if (t.startsWith(needle)) s = 60;
      else if (t.includes(needle)) s = 40;
      else if ((e.equivalent_en || "").toLowerCase().includes(needle)) s = 25;
      else if (Object.values(e.equivalents || {}).some((v) => String(v).toLowerCase().includes(needle))) s = 20;
      else if ((e.meaning_en || "").toLowerCase().includes(needle) || (e.meaning_fr || "").toLowerCase().includes(needle)) s = 10;
      else if ((e.explanation_zh || "").includes(q.trim())) s = 5;
      if (s) scored.push([s, e]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    list = scored.map((x) => x[1]);
  }
  const total = list.length;
  const start = (Math.max(1, page) - 1) * size;
  return { total, page, size, items: list.slice(start, start + size).map(publicEntry) };
}

/** Deterministic sample of CIBuzzBench test entries for the benchmark. */
export function benchmarkSample(n = 20, seed = 42) {
  const pool = ENTRIES.filter((e) => e.source === "CIBuzzBench" && e.split === "test" && !e.harmful);
  let s = seed >>> 0 || 1;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const copy = pool.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, Math.min(n, copy.length)).map((e) => ({
    id: e.id, term: e.term, meaning_en: e.meaning_en, equivalent_en: e.equivalent_en, category: e.category,
  }));
}
