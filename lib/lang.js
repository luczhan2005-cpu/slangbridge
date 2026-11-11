export const LANGS = { zh: "Chinese (Mandarin, simplified)", en: "English", fr: "French" };

const CJK = /[㐀-鿿]/g;
const FR_HINTS = /\b(je|j'|tu|t'|il|elle|on|nous|vous|les|des|est|c'est|pas|trop|grave|wesh|mdr|ptdr|askip|chelou|ouf|ça|ce|mon|ma|mes|avec|pour|qui|que)\b|[éèêàùçœ]/gi;
const EN_HINTS = /\b(the|you|is|are|that|this|and|i'm|it's|was|we|bro|lol|fr|no|cap|so|what|just)\b/gi;

/** Very small heuristic detector — only used for the literal baseline and the offline mode. */
export function detectLang(text = "") {
  const cjk = (text.match(CJK) || []).length;
  if (cjk >= 1 && cjk >= text.replace(/\s/g, "").length * 0.2) return "zh";
  const fr = (text.match(FR_HINTS) || []).length;
  const en = (text.match(EN_HINTS) || []).length;
  return fr > en ? "fr" : "en";
}
