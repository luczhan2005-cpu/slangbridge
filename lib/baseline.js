// Baseline = what a student gets today from a standard machine-translation service.
// We use the free MyMemory API (no key needed) so anyone can reproduce the comparison.
// https://mymemory.translated.net/doc/spec.php
import { requestJson } from "./http.js";
import { detectLang } from "./lang.js";

const CODES = { zh: "zh-CN", en: "en-GB", fr: "fr-FR" };

export async function baselineTranslate({ message, source = "auto", target }) {
  const src = source === "auto" ? detectLang(message) : source;
  if (src === target) return { translation: message, provider: "MyMemory", source: src, note: "same language" };
  const q = message.slice(0, 480); // MyMemory limit is 500 bytes per request
  const url =
    "https://api.mymemory.translated.net/get?" +
    new URLSearchParams({ q, langpair: `${CODES[src]}|${CODES[target]}` }).toString();
  const res = await requestJson(url, { timeoutMs: 20000 });
  if (res.responseStatus && Number(res.responseStatus) !== 200) {
    throw new Error(`Baseline MT error: ${res.responseDetails || res.responseStatus}`);
  }
  return {
    translation: decodeEntities(res.responseData?.translatedText || ""),
    provider: "MyMemory (machine translation)",
    source: src,
  };
}

function decodeEntities(s) {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}
