// Minimal JSON-over-HTTPS helper built on node:https (no dependency, works on any Node version).
import https from "node:https";

export function requestJson(url, { method = "GET", headers = {}, body, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const req = https.request(
      url,
      {
        method,
        headers: {
          Accept: "application/json",
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          let json = null;
          try { json = JSON.parse(data); } catch { /* not JSON */ }
          if (res.statusCode >= 400) {
            const err = new Error(json?.error?.message || json?.message || `HTTP ${res.statusCode}`);
            err.status = res.statusCode;
            return reject(err);
          }
          if (json === null) return reject(new Error("Invalid JSON response"));
          resolve(json);
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("Request timed out")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}
