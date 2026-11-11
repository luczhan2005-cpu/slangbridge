// Translation pipeline:
//   1. retrieve slang definitions from the knowledge base (lib/glossary.js)
//   2. build a grounded prompt (mode + relationship + conversation context + glossary hits)
//   3. ask the LLM for a structured JSON answer (lib/llm.js)
// If no AI provider is configured, fall back to a dictionary-only answer (demo backup).
import { retrieve } from "./glossary.js";
import { generateJSON, providerInfo } from "./llm.js";
import { LANGS, detectLang } from "./lang.js";

export const MODES = {
  same_vibe: "Same Vibe",
  neutral: "Neutral",
  explain: "Explain",
};

export const RELATIONSHIPS = {
  friend: "a close friend (very casual)",
  classmate: "a classmate (casual but not intimate)",
  group: "a group chat of students",
  crush: "a partner or crush (affectionate)",
  professor: "a professor or staff member (formal: never use slang toward them)",
};

const SYSTEM_PROMPT = `You are SlangBridge, a translator built for international university students who text each other on WeChat and WhatsApp in Chinese, English and French.

Ordinary machine translation renders slang literally ("yyds" -> "forever god", "j'ai le seum" -> "I have the seum") or flattens it into stiff textbook language. Your job is to carry over what the sender actually meant AND how they said it: their tone, their register, their irony, their emojis.

Output modes:
- same_vibe: translate slang into the closest natural slang that a ~20-year-old native speaker of the target language would really text. Mirror the register, length, punctuation habits and emojis. If the target language has no slang equivalent, use the most natural casual phrasing instead of inventing slang. Never put explanations inside the translation.
- neutral: translate the meaning into clear, standard, friendly language with no slang, so a learner of the target language understands it. Keep the original intent (including sarcasm) but state it plainly.
- explain: give a clear, natural translation (casual but not heavy on slang), and make slang_items and cultural_notes thorough, as if teaching an exchange student what each expression means and when to use it.

Rules:
- Use the conversation context, when given, to resolve ambiguous slang and sarcasm. Translate only the message, not the context.
- Adapt to the recipient relationship. If the recipient is a professor or staff member, never produce slang even in same_vibe mode; produce a polite version and add a warning that slang would be inappropriate.
- Retrieved glossary entries come from our slang database. Use an entry only when it fits this message; an entry can be a false match (for example the English word "ate" meaning "ate food"). Set from_glossary to true for slang_items you based on a glossary entry.
- Detect sarcasm and irony even when no slang word is present, and say so in tone.
- Flag offensive, vulgar or sensitive expressions in warnings, and translate vulgar slang with an equivalent level of vulgarity only in same_vibe mode.
- alternatives: up to 2 other good translations with a different nuance (empty list if none).
- slang_items: one item per slang term, abbreviation, number code, meme or idiom in the message (empty list if there is none). literal_meaning is what a word-for-word translation would say.
- Write slang_items explanations, tone and cultural_notes in the TARGET language, so the reader can understand them.
- confidence: low if the message is ambiguous or you are unsure of a term's current meaning.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["detected_source_language", "translation", "alternatives", "slang_items", "tone", "cultural_notes", "warnings", "confidence"],
  properties: {
    detected_source_language: { type: "string", enum: ["zh", "en", "fr", "other"] },
    translation: { type: "string" },
    alternatives: { type: "array", items: { type: "string" } },
    slang_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["term", "literal_meaning", "actual_meaning", "target_equivalent", "explanation", "from_glossary"],
        properties: {
          term: { type: "string" },
          literal_meaning: { type: "string" },
          actual_meaning: { type: "string" },
          target_equivalent: { type: "string" },
          explanation: { type: "string" },
          from_glossary: { type: "boolean" },
        },
      },
    },
    tone: { type: "string" },
    cultural_notes: { type: "string" },
    warnings: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
};

function glossaryBlock(hits, target) {
  if (!hits.length) return "(no known slang term was found in our database — rely on your own knowledge)";
  return hits
    .map((h) => {
      const eq = h.equivalents?.[target] || (target === "en" ? h.equivalent_en : "");
      return [
        `- "${h.term}" (${h.lang}${h.pinyin ? `, ${h.pinyin}` : ""})`,
        `  meaning: ${h.meaning_en}`,
        h.equivalent_en ? `  English equivalent: ${h.equivalent_en}` : "",
        eq && target !== "en" ? `  ${LANGS[target]} equivalent: ${eq}` : "",
        h.harmful ? "  note: flagged as offensive/sensitive in the source dataset" : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

export function validateRequest(body) {
  const message = String(body.message || "").trim();
  if (!message) throw badRequest("Message is empty.");
  if (message.length > 2000) throw badRequest("Message is too long (2,000 characters max).");
  const context = String(body.context || "").slice(0, 4000);
  const target = body.target in LANGS ? body.target : null;
  if (!target) throw badRequest("Unknown target language.");
  const source = body.source in LANGS ? body.source : "auto";
  const mode = body.mode in MODES ? body.mode : "same_vibe";
  const relationship = body.relationship in RELATIONSHIPS ? body.relationship : "friend";
  return { message, context, target, source, mode, relationship, useGlossary: body.useGlossary !== false, excludeTestSplit: !!body.excludeTestSplit };
}

function badRequest(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

export async function translate(req) {
  const t0 = Date.now();
  const hits = req.useGlossary ? retrieve(req.message, { excludeTestSplit: req.excludeTestSplit }) : [];
  const info = providerInfo();

  if (info.provider === "none") {
    return { engine: "dictionary-only", provider: "none", model: null, glossary_hits: hits, result: dictionaryOnly(req, hits), latency_ms: Date.now() - t0, usage: null };
  }

  const user = [
    `Source language: ${req.source === "auto" ? "auto-detect" : LANGS[req.source]}`,
    `Target language: ${LANGS[req.target]}`,
    `Mode: ${req.mode}`,
    `Recipient: ${RELATIONSHIPS[req.relationship]}`,
    "",
    "<conversation_context>",
    req.context || "(none)",
    "</conversation_context>",
    "",
    "<retrieved_glossary>",
    glossaryBlock(hits, req.target),
    "</retrieved_glossary>",
    "",
    "<message_to_translate>",
    req.message,
    "</message_to_translate>",
  ].join("\n");

  const { data, usage, model } = await generateJSON({ system: SYSTEM_PROMPT, user, schema: SCHEMA, effort: process.env.CLAUDE_EFFORT || "medium" });
  return { engine: "ai", provider: info.provider, model, glossary_hits: hits, result: data, usage, latency_ms: Date.now() - t0 };
}

// Offline backup: shows what the knowledge base alone can tell the user.
function dictionaryOnly(req, hits) {
  return {
    detected_source_language: req.source === "auto" ? detectLang(req.message) : req.source,
    translation: "",
    alternatives: [],
    slang_items: hits.map((h) => ({
      term: h.term,
      literal_meaning: "",
      actual_meaning: h.meaning_en,
      target_equivalent: h.equivalents?.[req.target] || (req.target === "en" ? h.equivalent_en : ""),
      explanation: h.explanation_zh || h.meaning_fr || "",
      from_glossary: true,
    })),
    tone: "",
    cultural_notes: "",
    warnings: ["Dictionary-only mode: no AI provider is configured, so only slang definitions are shown."],
    confidence: "low",
  };
}
