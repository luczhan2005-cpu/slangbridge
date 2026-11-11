// SlangBridge front-end (vanilla JS, no build step).
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const LANG_NAME = { zh: "中文", en: "English", fr: "Français", other: "?" };

let STATUS = { provider: "none" };

async function api(path, body) {
  const res = await fetch(path, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 1800);
}

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ---------------- tabs ----------------
function showView(name) {
  $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === name));
  $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
  if (name === "glossary" && !glossaryState.loaded) loadGlossary(true);
  store.set("sb-tab", name);
}
$$(".tab").forEach((t) => t.addEventListener("click", () => showView(t.dataset.view)));

// ---------------- status ----------------
async function loadStatus() {
  const pill = $("#status-pill");
  try {
    STATUS = await api("/api/status");
    if (STATUS.provider === "none") {
      pill.textContent = "Dictionary-only mode (no AI key)";
      pill.className = "pill off";
    } else {
      pill.textContent = `AI: ${STATUS.model} · ${STATUS.glossary.total.toLocaleString()} slang terms`;
      pill.className = "pill ok";
    }
  } catch {
    pill.textContent = "Server unreachable";
    pill.className = "pill off";
  }
}

// ---------------- translate ----------------
let mode = "same_vibe";
$$("#mode .seg").forEach((b) => b.addEventListener("click", () => {
  mode = b.dataset.mode;
  $$("#mode .seg").forEach((x) => x.classList.toggle("active", x === b));
}));

$("#swap").addEventListener("click", () => {
  const s = $("#source"), t = $("#target");
  const sv = s.value === "auto" ? guessLang($("#message").value) : s.value;
  s.value = t.value;
  t.value = sv;
});

function guessLang(text) {
  if (/[㐀-鿿]/.test(text)) return "zh";
  if (/[éèêàçù]|\b(je|tu|c'est|pas|trop|wesh|mdr)\b/i.test(text)) return "fr";
  return "en";
}

const EXAMPLES = [
  { message: "今天的讲座真的绝绝子，教授yyds！", source: "zh", target: "en" },
  { message: "我真的会谢，ddl前一晚电脑崩了，直接破防了😭", source: "zh", target: "fr" },
  { message: "No cap, that party was lowkey fire 🔥 we should link up again fr", source: "en", target: "zh" },
  { message: "Wesh, t'es chaud ce soir ? On se fait un grec, c'est moi qui régale", source: "fr", target: "zh" },
  { message: "芭比Q了", context: "A: 我刚面试完\nB: 怎么样？", source: "zh", target: "en" },
];
$$(".chip[data-ex]").forEach((c) => c.addEventListener("click", () => {
  const ex = EXAMPLES[Number(c.dataset.ex)];
  $("#message").value = ex.message;
  $("#context").value = ex.context || "";
  $("#context-box").open = !!ex.context;
  $("#source").value = ex.source;
  $("#target").value = ex.target;
  $("#message").focus();
}));

$("#message").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) $("#go").click();
});

$("#go").addEventListener("click", async () => {
  const body = {
    message: $("#message").value.trim(),
    context: $("#context").value.trim(),
    source: $("#source").value,
    target: $("#target").value,
    relationship: $("#relationship").value,
    mode,
  };
  if (!body.message) return toast("Type or paste a message first");
  const out = $("#result");
  const btn = $("#go");
  btn.disabled = true;
  out.innerHTML = `<div class="empty"><div class="spinner"></div><p>Decoding the slang…</p></div>`;
  const [tr, base] = await Promise.allSettled([
    api("/api/translate", body),
    $("#compare").checked ? api("/api/baseline", body) : Promise.resolve(null),
  ]);
  btn.disabled = false;
  if (tr.status === "rejected") {
    out.innerHTML = `<div class="error"><b>Translation failed.</b> ${esc(tr.reason.message)}</div>`;
    return;
  }
  renderResult(body, tr.value, base.status === "fulfilled" ? base.value : { error: base.reason?.message });
});

function renderResult(req, data, base) {
  const r = data.result;
  const out = $("#result");
  const isAI = data.engine === "ai";
  const shownTranslation = r.translation || "";

  let html = `<div class="chat">
    <div class="bubble them"><div class="bubble-meta">Original · ${esc(LANG_NAME[r.detected_source_language] || "")}</div>${esc(req.message)}</div>
    ${isAI ? `<div class="bubble me"><div class="bubble-meta">${esc(LANG_NAME[req.target])} · ${esc(modeLabel(req.mode))}</div>${esc(shownTranslation)}</div>` : ""}
  </div>`;

  if (isAI) {
    html += `<div class="actions"><span class="tag ${esc(r.confidence)}">confidence: ${esc(r.confidence)}</span><button class="link-btn" id="copy">Copy translation</button></div>`;
    if (r.alternatives?.length) {
      html += `<div class="section-title">Other ways to say it</div><ul class="alts">${r.alternatives.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>`;
    }
  }

  if (base) {
    html += `<div class="compare">
      <div class="lit"><h4>Literal machine translation</h4>${base.error ? `<span class="muted">unavailable (${esc(base.error)})</span>` : esc(base.translation)}</div>
      <div class="ours"><h4>SlangBridge</h4>${isAI ? esc(shownTranslation) : `<span class="muted">needs an AI key</span>`}</div>
    </div>`;
  }

  for (const w of r.warnings || []) html += `<div class="warn">⚠️ ${esc(w)}</div>`;

  if (r.tone) html += `<div class="section-title">Tone</div><div class="note">${esc(r.tone)}</div>`;

  if (r.slang_items?.length) {
    const open = req.mode === "explain" || !isAI;
    html += `<details ${open ? "open" : ""}><summary class="section-title" style="display:list-item">Slang decoded (${r.slang_items.length})</summary><div class="slang-list">`;
    for (const s of r.slang_items) {
      html += `<div class="slang">
        <div class="slang-head"><span class="slang-term">${esc(s.term)}</span>${s.target_equivalent ? `<span class="arrow">→</span><span class="slang-eq">${esc(s.target_equivalent)}</span>` : ""}${s.from_glossary ? ` <span class="tag kb">from database</span>` : ""}</div>
        <div class="slang-body">
          ${s.literal_meaning ? `<div>Literally: <span class="lit-line">${esc(s.literal_meaning)}</span></div>` : ""}
          ${s.actual_meaning ? `<div>Means: ${esc(s.actual_meaning)}</div>` : ""}
          ${s.explanation ? `<div>${esc(s.explanation)}</div>` : ""}
        </div></div>`;
    }
    html += `</div></details>`;
  }

  if (r.cultural_notes) html += `<div class="section-title">Cultural notes</div><div class="note">${esc(r.cultural_notes)}</div>`;

  const meta = [];
  if (isAI) meta.push(`model: ${esc(data.model)}`);
  meta.push(`${data.glossary_hits.length} database match${data.glossary_hits.length === 1 ? "" : "es"}`);
  meta.push(`${(data.latency_ms / 1000).toFixed(1)} s`);
  if (data.usage) meta.push(`${data.usage.input_tokens + data.usage.output_tokens} tokens`);
  html += `<div class="meta">${meta.map((m) => `<span>${m}</span>`).join("")}</div>`;

  out.innerHTML = html;
  $("#copy")?.addEventListener("click", () => {
    navigator.clipboard?.writeText(shownTranslation).then(() => toast("Copied"), () => toast("Copy failed"));
  });
}

const modeLabel = (m) => ({ same_vibe: "Same Vibe", neutral: "Neutral", explain: "Explain" })[m] || m;

// ---------------- glossary ----------------
const glossaryState = { page: 1, loaded: false, total: 0 };
let gTimer;
["#g-q", "#g-lang", "#g-source"].forEach((s) => $(s).addEventListener("input", () => {
  clearTimeout(gTimer);
  gTimer = setTimeout(() => loadGlossary(true), 200);
}));
$("#g-more").addEventListener("click", () => loadGlossary(false));

async function loadGlossary(reset) {
  if (reset) { glossaryState.page = 1; $("#g-list").innerHTML = ""; }
  const p = new URLSearchParams({ q: $("#g-q").value, lang: $("#g-lang").value, source: $("#g-source").value, page: glossaryState.page, size: 24 });
  try {
    const data = await api(`/api/glossary?${p}`);
    glossaryState.loaded = true;
    glossaryState.total = data.total;
    $("#g-count").textContent = `${data.total.toLocaleString()} entries`;
    $("#g-list").insertAdjacentHTML("beforeend", data.items.map(glossaryCard).join(""));
    glossaryState.page++;
    $("#g-more").style.display = $$("#g-list .g-item").length < data.total ? "" : "none";
  } catch (e) {
    $("#g-count").textContent = `Could not load the database: ${e.message}`;
  }
}

function glossaryCard(e) {
  const eqs = Object.entries(e.equivalents || {}).filter(([, v]) => v);
  return `<div class="g-item">
    <div class="slang-head"><span class="slang-term">${esc(e.term)}</span><span class="tag">${esc(LANG_NAME[e.lang] || e.lang)}</span>${e.harmful ? `<span class="tag harm">offensive / sensitive</span>` : ""}</div>
    ${e.pinyin ? `<div class="muted small">${esc(e.pinyin)}</div>` : ""}
    <p>${esc(e.meaning_en)}</p>
    ${eqs.length ? `<div class="g-eqs">${eqs.map(([k, v]) => `<div>${esc(LANG_NAME[k] || k)}: <b>${esc(v)}</b></div>`).join("")}</div>` : ""}
    ${e.explanation_zh ? `<details><summary class="small muted">中文解释</summary><p>${esc(e.explanation_zh)}</p></details>` : ""}
    <div class="g-src">${esc(e.source)}${e.category && e.category !== "Curated" ? ` · ${esc(e.category)}` : ""}</div>
  </div>`;
}

// ---------------- evaluation: shared helpers ----------------
async function pool(items, size, worker) {
  let i = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "–");

function downloadCSV(name, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function needAI() {
  if (STATUS.provider === "none") {
    toast("The evaluation needs an AI provider key on the server");
    return true;
  }
  return false;
}

// ---------------- evaluation 1: team test cases ----------------
let EV = store.get("sb-ev", null);

$("#ev-run").addEventListener("click", async () => {
  if (needAI()) return;
  const btn = $("#ev-run");
  btn.disabled = true;
  try {
    const cases = await api("/api/testcases");
    EV = { at: new Date().toISOString(), rows: cases.map((c) => ({ ...c })) };
    renderEV();
    let done = 0;
    $("#ev-progress").textContent = `0 / ${cases.length}`;
    await pool(EV.rows, 2, async (row) => {
      const req = { message: row.message, context: row.context, source: row.source, target: row.target, relationship: row.relationship, mode: "same_vibe" };
      const [b, a] = await Promise.allSettled([api("/api/baseline", req), api("/api/translate", req)]);
      row.baseline = b.status === "fulfilled" ? b.value.translation : `ERROR: ${b.reason.message}`;
      row.ai = a.status === "fulfilled" ? a.value.result.translation : `ERROR: ${a.reason.message}`;
      row.latency = a.status === "fulfilled" ? a.value.latency_ms : null;
      renderEV();
      const judge = (cand) => api("/api/judge", { kind: "message", message: row.message, context: row.context, relationship: row.relationship, target: row.target, gold_meaning: row.gold_meaning, candidate: cand });
      const [jb, ja] = await Promise.allSettled([judge(row.baseline), judge(row.ai)]);
      row.jb = jb.status === "fulfilled" ? jb.value : { total: null, comment: jb.reason.message };
      row.ja = ja.status === "fulfilled" ? ja.value : { total: null, comment: ja.reason.message };
      done++;
      $("#ev-progress").textContent = `${done} / ${cases.length}`;
      renderEV();
    });
    store.set("sb-ev", EV);
    $("#ev-progress").textContent = `Done · ${new Date(EV.at).toLocaleString()}`;
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
  }
});

function scoreInput(rowIdx, who, key, val) {
  return `<input class="score" type="number" min="0" max="2" step="1" value="${val ?? ""}" data-row="${rowIdx}" data-who="${who}" data-key="${key}" />`;
}

function renderEV() {
  const t = $("#ev-table");
  if (!EV) { t.innerHTML = ""; $("#ev-summary").innerHTML = ""; return; }
  t.innerHTML = `<thead><tr><th>#</th><th>Message</th><th>Baseline MT</th><th class="num">Score /6<br>M · T · N</th><th>SlangBridge</th><th class="num">Score /6<br>M · T · N</th></tr></thead><tbody>${EV.rows.map((r, i) => `
    <tr>
      <td>${esc(r.id)}<div class="cmt">${esc(r.source)}→${esc(r.target)}</div></td>
      <td>${esc(r.message)}${r.context ? `<div class="cmt">context: ${esc(r.context)}</div>` : ""}<div class="cmt">ref: ${esc(r.gold_meaning)}</div></td>
      <td>${r.baseline ? esc(r.baseline) : `<span class="pending">running…</span>`}${r.jb?.comment ? `<div class="cmt">${esc(r.jb.comment)}</div>` : ""}</td>
      <td class="num">${r.jb ? `<b>${fmt(r.jb.total, 0)}</b><br>${scoreInput(i, "jb", "meaning", r.jb.meaning)}${scoreInput(i, "jb", "slang_tone", r.jb.slang_tone)}${scoreInput(i, "jb", "naturalness", r.jb.naturalness)}` : ""}</td>
      <td>${r.ai ? esc(r.ai) : `<span class="pending">running…</span>`}${r.ja?.comment ? `<div class="cmt">${esc(r.ja.comment)}</div>` : ""}</td>
      <td class="num">${r.ja ? `<b>${fmt(r.ja.total, 0)}</b><br>${scoreInput(i, "ja", "meaning", r.ja.meaning)}${scoreInput(i, "ja", "slang_tone", r.ja.slang_tone)}${scoreInput(i, "ja", "naturalness", r.ja.naturalness)}` : ""}</td>
    </tr>`).join("")}</tbody>`;
  renderEVSummary();
  $("#ev-csv").disabled = !EV.rows.some((r) => r.ja);
}

$("#ev-table").addEventListener("change", (e) => {
  const inp = e.target.closest("input.score");
  if (!inp || !EV) return;
  const row = EV.rows[Number(inp.dataset.row)];
  const j = row[inp.dataset.who];
  j[inp.dataset.key] = Math.max(0, Math.min(2, Number(inp.value) || 0));
  j.total = j.meaning + j.slang_tone + j.naturalness;
  j.manual = true;
  store.set("sb-ev", EV);
  renderEV();
});

function renderEVSummary() {
  const done = EV.rows.filter((r) => Number.isFinite(r.jb?.total) && Number.isFinite(r.ja?.total));
  if (!done.length) { $("#ev-summary").innerHTML = ""; return; }
  const b = avg(done.map((r) => r.jb.total));
  const a = avg(done.map((r) => r.ja.total));
  const bTone = avg(done.map((r) => r.jb.slang_tone));
  const aTone = avg(done.map((r) => r.ja.slang_tone));
  const wins = done.filter((r) => r.ja.total > r.jb.total).length;
  const lat = avg(EV.rows.filter((r) => r.latency).map((r) => r.latency / 1000));
  $("#ev-summary").innerHTML = `
    <div class="stat"><div class="v">${fmt(b)}</div><div class="k">Baseline avg score /6</div></div>
    <div class="stat win"><div class="v">${fmt(a)}</div><div class="k">SlangBridge avg score /6</div></div>
    <div class="stat"><div class="v">${fmt(bTone)} → ${fmt(aTone)}</div><div class="k">Slang &amp; tone /2 (baseline → ours)</div></div>
    <div class="stat"><div class="v">${wins} / ${done.length}</div><div class="k">Cases where SlangBridge wins</div></div>
    <div class="stat"><div class="v">${fmt(lat, 1)} s</div><div class="k">Avg AI latency</div></div>`;
}

$("#ev-csv").addEventListener("click", () => {
  const rows = [["id", "source", "target", "relationship", "message", "context", "reference", "baseline", "baseline_meaning", "baseline_tone", "baseline_natural", "baseline_total", "baseline_comment", "slangbridge", "sb_meaning", "sb_tone", "sb_natural", "sb_total", "sb_comment", "latency_ms"]];
  for (const r of EV.rows) rows.push([r.id, r.source, r.target, r.relationship, r.message, r.context, r.gold_meaning, r.baseline, r.jb?.meaning, r.jb?.slang_tone, r.jb?.naturalness, r.jb?.total, r.jb?.comment, r.ai, r.ja?.meaning, r.ja?.slang_tone, r.ja?.naturalness, r.ja?.total, r.ja?.comment, r.latency]);
  downloadCSV(`slangbridge-testcases-${EV.at.slice(0, 10)}.csv`, rows);
});

// ---------------- evaluation 2: CIBuzzBench ----------------
const SYS_LABEL = { baseline: "Baseline MT", ai_noglossary: "AI without glossary", ai_glossary: "AI + glossary" };
let BM = store.get("sb-bm", null);

$("#bm-run").addEventListener("click", async () => {
  const systems = $$(".bm-sys").filter((c) => c.checked).map((c) => c.value);
  if (!systems.length) return toast("Pick at least one system");
  if (needAI()) return;
  const btn = $("#bm-run");
  btn.disabled = true;
  try {
    const n = Number($("#bm-n").value);
    const sample = await api(`/api/benchmark-sample?n=${n}&seed=42`);
    BM = { at: new Date().toISOString(), systems, rows: sample.map((s) => ({ ...s, out: {}, score: {}, cmt: {} })) };
    renderBM();
    let done = 0;
    $("#bm-progress").textContent = `0 / ${sample.length}`;
    await pool(BM.rows, 3, async (row) => {
      await Promise.all(systems.map(async (sys) => {
        try {
          const req = { message: row.term, source: "zh", target: "en", mode: "same_vibe", relationship: "friend" };
          if (sys === "baseline") row.out[sys] = (await api("/api/baseline", req)).translation;
          else row.out[sys] = (await api("/api/translate", { ...req, useGlossary: sys === "ai_glossary", excludeTestSplit: true })).result.translation;
          const j = await api("/api/judge", { kind: "term", term: row.term, meaning_en: row.meaning_en, equivalent_en: row.equivalent_en, candidate: row.out[sys] });
          row.score[sys] = j.score;
          row.cmt[sys] = j.comment;
        } catch (e) {
          row.out[sys] = row.out[sys] || `ERROR: ${e.message}`;
          row.cmt[sys] = e.message;
        }
      }));
      done++;
      $("#bm-progress").textContent = `${done} / ${sample.length}`;
      renderBM();
    });
    store.set("sb-bm", BM);
    $("#bm-progress").textContent = `Done · ${new Date(BM.at).toLocaleString()}`;
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
  }
});

function renderBM() {
  if (!BM) return;
  const sys = BM.systems;
  $("#bm-table").innerHTML = `<thead><tr><th>Term</th><th>Gold</th>${sys.map((s) => `<th>${SYS_LABEL[s]}</th>`).join("")}</tr></thead><tbody>${BM.rows.map((r) => `
    <tr><td><b>${esc(r.term)}</b><div class="cmt">${esc(r.category)}</div></td>
    <td>${esc(r.equivalent_en)}<div class="cmt">${esc(r.meaning_en)}</div></td>
    ${sys.map((s) => `<td>${r.out[s] !== undefined ? esc(r.out[s]) : `<span class="pending">running…</span>`}${r.score[s] !== undefined ? ` <span class="tag ${r.score[s] === 1 ? "high" : r.score[s] === 0.5 ? "medium" : "low"}">${r.score[s]}</span>` : ""}${r.cmt[s] ? `<div class="cmt">${esc(r.cmt[s])}</div>` : ""}</td>`).join("")}
    </tr>`).join("")}</tbody>`;
  $("#bm-summary").innerHTML = sys.map((s) => {
    const scored = BM.rows.filter((r) => typeof r.score[s] === "number");
    const acc = avg(scored.map((r) => r.score[s])) * 100;
    return `<div class="stat ${s === "ai_glossary" ? "win" : ""}"><div class="v">${fmt(acc, 0)}%</div><div class="k">${SYS_LABEL[s]} accuracy (n=${scored.length})</div></div>`;
  }).join("");
  $("#bm-csv").disabled = !BM.rows.some((r) => Object.keys(r.score).length);
}

$("#bm-csv").addEventListener("click", () => {
  const rows = [["id", "term", "category", "gold_equivalent", "gold_meaning", ...BM.systems.flatMap((s) => [`${s}_output`, `${s}_score`, `${s}_comment`])]];
  for (const r of BM.rows) rows.push([r.id, r.term, r.category, r.equivalent_en, r.meaning_en, ...BM.systems.flatMap((s) => [r.out[s], r.score[s], r.cmt[s]])]);
  downloadCSV(`slangbridge-cibuzzbench-${BM.at.slice(0, 10)}.csv`, rows);
});

// ---------------- init ----------------
loadStatus();
renderEV();
renderBM();
showView(store.get("sb-tab", "translate"));
