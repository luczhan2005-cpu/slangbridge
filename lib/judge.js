// LLM-as-judge used by the Evaluation page. Scores ONE candidate at a time against a
// human-written reference, with fixed scoring anchors, so the baseline and our system
// are graded the same way. Scores can be overridden by hand in the UI.
import { generateJSON } from "./llm.js";
import { LANGS } from "./lang.js";

const MESSAGE_SYSTEM = `You grade translations of informal student chat messages. You are strict, consistent and you never reward length.

Scoring anchors (integers only):
meaning (0-2): 2 = the intended meaning is fully preserved, including sarcasm/irony; 1 = partly right or one key nuance lost; 0 = wrong, literal nonsense, or missing.
slang_tone (0-2): 2 = register and tone match the original (slang rendered as natural equivalent slang or casual speech, or correctly softened when the recipient is formal); 1 = understandable but flat, stiff or slightly off in register; 0 = literal rendering of slang, wrong tone, or untranslated slang.
naturalness (0-2): 2 = reads like something a native speaker would text; 1 = understandable but awkward; 0 = unnatural or ungrammatical.
Write the comment in English, one sentence.`;

const MESSAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["meaning", "slang_tone", "naturalness", "comment"],
  properties: {
    meaning: { type: "string", enum: ["0", "1", "2"] },
    slang_tone: { type: "string", enum: ["0", "1", "2"] },
    naturalness: { type: "string", enum: ["0", "1", "2"] },
    comment: { type: "string" },
  },
};

export async function judgeMessage({ message, context, relationship, target, gold_meaning, candidate }) {
  const user = [
    `Target language: ${LANGS[target] || target}`,
    `Recipient: ${relationship || "friend"}`,
    context ? `Conversation context:\n${context}` : "",
    `Original message:\n${message}`,
    `Reference meaning (written by the team):\n${gold_meaning}`,
    `Candidate translation to grade:\n${candidate || "(empty)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const { data, usage } = await generateJSON({ system: MESSAGE_SYSTEM, user, schema: MESSAGE_SCHEMA, effort: "low", maxTokens: 4000 });
  const meaning = Number(data.meaning), slang_tone = Number(data.slang_tone), naturalness = Number(data.naturalness);
  return { meaning, slang_tone, naturalness, total: meaning + slang_tone + naturalness, comment: data.comment, usage };
}

const TERM_SYSTEM = `You check whether an English rendering of a Chinese internet slang term conveys the same meaning as the reference.
score: 1 = same meaning (wording may differ); 0.5 = related but misses the key nuance or is too literal to be useful; 0 = wrong or a literal translation that loses the slang meaning.
Write the comment in English, one short sentence.`;

const TERM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["score", "comment"],
  properties: {
    score: { type: "string", enum: ["0", "0.5", "1"] },
    comment: { type: "string" },
  },
};

export async function judgeTerm({ term, meaning_en, equivalent_en, candidate }) {
  const user = `Chinese term: ${term}\nReference meaning: ${meaning_en}\nReference English equivalent: ${equivalent_en}\nCandidate rendering: ${candidate || "(empty)"}`;
  const { data, usage } = await generateJSON({ system: TERM_SYSTEM, user, schema: TERM_SCHEMA, effort: "low", maxTokens: 2000 });
  return { score: Number(data.score), comment: data.comment, usage };
}
