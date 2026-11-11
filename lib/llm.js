// AI layer: one function, generateJSON(), behind two interchangeable providers.
//
//  - "claude" (default): Anthropic Claude through the official SDK, with structured
//    outputs (JSON schema) so the app always gets a parseable answer.
//  - "openai-compatible": any OpenAI-style chat endpoint (DeepSeek, Qwen/DashScope,
//    OpenAI...). Useful because the Anthropic API is not reachable from mainland China.
//
// Configure with environment variables (see .env.example).
import { requestJson } from "./http.js";

const env = process.env;

export function providerInfo() {
  const forced = (env.LLM_PROVIDER || "").toLowerCase();
  if ((forced === "claude" || !forced) && (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN)) {
    return { provider: "claude", model: env.CLAUDE_MODEL || "claude-opus-5-5" };
  }
  if ((forced === "openai-compatible" || !forced) && env.OPENAI_COMPAT_API_KEY) {
    return {
      provider: "openai-compatible",
      model: env.OPENAI_COMPAT_MODEL || "deepseek-chat",
      baseURL: (env.OPENAI_COMPAT_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, ""),
    };
  }
  return { provider: "none", model: null };
}

let anthropicClient = null;
async function getAnthropic() {
  if (anthropicClient) return { client: anthropicClient, Anthropic: anthropicClient.constructor };
  if (typeof globalThis.fetch !== "function") {
    throw new Error("The Claude SDK needs Node.js 18 or newer (this server runs Node " + process.version + ").");
  }
  let mod;
  try {
    mod = await import("@anthropic-ai/sdk");
  } catch (e) {
    throw new Error("Claude SDK not available. Run `npm install` and use Node.js 18 or newer.");
  }
  const Anthropic = mod.default;
  anthropicClient = new Anthropic();
  return { client: anthropicClient, Anthropic };
}

/**
 * Ask the model for a JSON object that follows `schema`.
 * @returns {Promise<{data: object, usage: {input_tokens:number, output_tokens:number}, model: string}>}
 */
export async function generateJSON({ system, user, schema, effort = "medium", maxTokens = 16000 }) {
  const info = providerInfo();
  if (info.provider === "claude") return claudeJSON({ info, system, user, schema, effort, maxTokens });
  if (info.provider === "openai-compatible") return openaiCompatJSON({ info, system, user, schema, maxTokens });
  const err = new Error("No AI provider configured (set ANTHROPIC_API_KEY or OPENAI_COMPAT_API_KEY).");
  err.code = "NO_PROVIDER";
  throw err;
}

async function claudeJSON({ info, system, user, schema, effort, maxTokens }) {
  const { client, Anthropic } = await getAnthropic();
  const params = {
    model: info.model,
    max_tokens: maxTokens,
    // the system prompt is identical across requests -> cache it
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
    output_config: { effort, format: { type: "json_schema", schema } },
  };

  let response;
  try {
    // Server-side fallback: if the main model declines (safety classifier false positive,
    // e.g. on vulgar slang), the API re-runs the request on a fallback model.
    response = await client.beta.messages.create({
      ...params,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (e) {
    if (e instanceof Anthropic.BadRequestError) {
      // e.g. a model that does not support fallbacks -> plain request
      try {
        response = await client.messages.create(params);
      } catch (e2) {
        throw friendlyClaudeError(e2, Anthropic);
      }
    } else {
      throw friendlyClaudeError(e, Anthropic);
    }
  }

  if (response.stop_reason === "refusal") {
    throw new Error("The model declined to translate this message.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("The answer was cut off (max_tokens). Try a shorter message.");
  }
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return {
    data: JSON.parse(text),
    usage: { input_tokens: response.usage?.input_tokens ?? 0, output_tokens: response.usage?.output_tokens ?? 0 },
    model: response.model || info.model,
  };
}

function friendlyClaudeError(e, Anthropic) {
  if (e instanceof Anthropic.AuthenticationError) return new Error("Invalid Anthropic API key.");
  if (e instanceof Anthropic.RateLimitError) return new Error("Rate limited by the AI provider — wait a moment and retry.");
  if (e instanceof Anthropic.APIConnectionError) return new Error("Cannot reach the Anthropic API (network blocked?). Consider the openai-compatible provider.");
  if (e instanceof Anthropic.APIError) return new Error(`AI provider error ${e.status}: ${e.message}`);
  return e;
}

async function openaiCompatJSON({ info, system, user, schema, maxTokens }) {
  const sys = `${system}\n\nReturn ONLY a JSON object that matches this JSON schema:\n${JSON.stringify(schema)}`;
  const res = await requestJson(`${info.baseURL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_COMPAT_API_KEY}` },
    body: {
      model: info.model,
      max_tokens: Math.min(maxTokens, 8000),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
    },
    timeoutMs: 120000,
  });
  const text = res.choices?.[0]?.message?.content || "";
  const cleaned = text.replace(/^```(?:json)?\s*|\s*```$/g, "");
  return {
    data: JSON.parse(cleaned),
    usage: { input_tokens: res.usage?.prompt_tokens ?? 0, output_tokens: res.usage?.completion_tokens ?? 0 },
    model: res.model || info.model,
  };
}
