// SlangBridge application layer: a small dependency-free Node HTTP server that
// serves the web UI (public/) and the JSON API (/api/*).
//   node server.js            -> http://localhost:3000
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

loadDotEnv();

const { translate, validateRequest } = await import("./lib/translate.js");
const { baselineTranslate } = await import("./lib/baseline.js");
const { judgeMessage, judgeTerm } = await import("./lib/judge.js");
const { counts, search, benchmarkSample } = await import("./lib/glossary.js");
const { providerInfo } = await import("./lib/llm.js");

const here = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(here, "public");
const PORT = Number(process.env.PORT || 3000);
const TEST_CASES = JSON.parse(fs.readFileSync(path.join(here, "data", "test_cases.json"), "utf8"));

// --- simple in-memory rate limit (protects the API key on a public deployment) ---
const WINDOW_MS = 10 * 60 * 1000;
const MAX_CALLS = Number(process.env.RATE_LIMIT_PER_10MIN || 150);
const calls = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const list = (calls.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  calls.set(ip, list);
  return list.length > MAX_CALLS;
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    return serveStatic(url.pathname, res);
  } catch (e) {
    const status = e.status && e.status < 500 ? e.status : 500;
    if (status === 500) console.error(e);
    return json(res, status, { error: e.message || "Server error" });
  }
});

async function api(req, res, url) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString().split(",")[0].trim();
  const route = `${req.method} ${url.pathname}`;

  switch (route) {
    case "GET /api/status": {
      const info = providerInfo();
      return json(res, 200, { provider: info.provider, model: info.model, glossary: counts(), test_cases: TEST_CASES.length, baseline: "MyMemory" });
    }
    case "GET /api/glossary": {
      const p = url.searchParams;
      return json(res, 200, search({ q: p.get("q") || "", lang: p.get("lang") || "", source: p.get("source") || "", page: Number(p.get("page") || 1), size: Math.min(60, Number(p.get("size") || 24)) }));
    }
    case "GET /api/testcases":
      return json(res, 200, TEST_CASES);
    case "GET /api/benchmark-sample": {
      const n = Math.min(100, Math.max(1, Number(url.searchParams.get("n") || 20)));
      return json(res, 200, benchmarkSample(n, Number(url.searchParams.get("seed") || 42)));
    }
  }

  if (req.method !== "POST") return json(res, 404, { error: "Not found" });
  if (rateLimited(ip)) return json(res, 429, { error: "Too many requests — please wait a few minutes." });
  const body = await readBody(req);

  switch (url.pathname) {
    case "/api/translate":
      return json(res, 200, await translate(validateRequest(body)));
    case "/api/baseline": {
      const r = validateRequest(body);
      return json(res, 200, await baselineTranslate(r));
    }
    case "/api/judge": {
      if (body.kind === "term") return json(res, 200, await judgeTerm(body));
      return json(res, 200, await judgeMessage(body));
    }
  }
  return json(res, 404, { error: "Not found" });
}

function serveStatic(pathname, res) {
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname).replace(/^\/+/, "");
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    return res.end("Not found");
  }
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
  fs.createReadStream(file).pipe(res);
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 100_000) {
        const e = new Error("Request too large");
        e.status = 413;
        reject(e);
        req.destroy();
      }
    });
    req.on("end", () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch { const e = new Error("Invalid JSON body"); e.status = 400; reject(e); }
    });
    req.on("error", reject);
  });
}

// Tiny .env loader so `node server.js` works without extra packages.
function loadDotEnv() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

server.listen(PORT, () => {
  const info = providerInfo();
  console.log(`SlangBridge running on http://localhost:${PORT}`);
  console.log(`AI provider: ${info.provider}${info.model ? ` (${info.model})` : " — dictionary-only mode"}`);
});
