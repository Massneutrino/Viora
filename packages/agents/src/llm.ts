import Anthropic from "@anthropic-ai/sdk";

export interface LLMClient {
  complete(opts: { system: string; prompt: string; maxTokens?: number }): Promise<string>;
  structured<T>(opts: {
    system: string;
    prompt: string;
    toolName: string;
    toolDescription: string;
    schema: Record<string, unknown>;
    maxTokens?: number;
  }): Promise<T>;
}

type StructuredOpts = {
  system: string;
  prompt: string;
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
};

function getLlmConfig(): { provider: string; model: string } {
  const provider = process.env.AI_PROVIDER ?? "anthropic";
  const defaultModel = provider === "google" ? "gemini-2.5-flash-lite" : "claude-opus-4-8";
  return { provider, model: process.env.AI_MODEL ?? defaultModel };
}

/** For startup logs — shows which provider/model the API will use. */
export function getActiveLlmConfig(): { provider: string; model: string } {
  return getLlmConfig();
}

/** Gemini 2.5+ counts thinking tokens against maxOutputTokens — low caps truncate visible text. */
function isGoogleThinkingModel(model: string): boolean {
  return /gemini-2\.5|gemini-3/i.test(model);
}

function googleTextGenerationConfig(model: string, maxTokens: number): Record<string, unknown> {
  const config: Record<string, unknown> = { maxOutputTokens: maxTokens };
  if (isGoogleThinkingModel(model)) {
    config.thinkingConfig = { thinkingBudget: 0 };
    config.maxOutputTokens = Math.max(maxTokens, 1024);
  }
  return config;
}

function googleStructuredGenerationConfig(model: string, maxTokens: number): Record<string, unknown> {
  const config: Record<string, unknown> = { maxOutputTokens: Math.max(maxTokens, 4096) };
  if (isGoogleThinkingModel(model)) {
    config.thinkingConfig = { thinkingBudget: 0 };
  }
  return config;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableGoogleError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = "status" in err ? (err as { status?: number }).status : undefined;
  return status === 503 || status === 429;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractGoogleFunctionCall(response: any): { name: string; args: Record<string, unknown> } | undefined {
  const fromSdk = response.functionCalls?.()?.[0];
  if (fromSdk) return fromSdk;
  const parts = response.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return undefined;
  for (const part of parts) {
    if (part.functionCall) return part.functionCall;
  }
  return undefined;
}

function parseJsonFromGoogleText(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractGoogleText(response: { text: () => string; candidates?: any[] }): string {
  const direct = response.text();
  if (direct) return direct;
  const parts = response.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((part: { text?: string; thought?: boolean }) => part.text && !part.thought)
    .map((part: { text: string }) => part.text)
    .join("");
}

/** Gemini function schemas reject additionalProperties and some JSON Schema keywords. */
function toGoogleSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "additionalProperties") continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = toGoogleSchema(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      out[key] = value.map((item) =>
        item && typeof item === "object" ? toGoogleSchema(item as Record<string, unknown>) : item,
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}

function buildAnthropicClient(model: string): LLMClient {
  const apiKey = process.env.ANTHROPIC_API_KEY!;
  const anthropic = new Anthropic({ apiKey });
  return {
    async complete({ system, prompt, maxTokens = 1024 }) {
      const res = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        system,
        messages: [{ role: "user", content: prompt }],
      });
      return res.content.find((b) => b.type === "text")?.text ?? "";
    },

    async structured<T>(opts: StructuredOpts): Promise<T> {
      const { system, prompt, toolName, toolDescription, schema, maxTokens = 2048 } = opts;
      const res = await anthropic.messages.create({
        model,
        max_tokens: maxTokens,
        thinking: { type: "adaptive" },
        system,
        messages: [{ role: "user", content: prompt }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: [{ name: toolName, description: toolDescription, input_schema: schema as any }],
        tool_choice: { type: "tool", name: toolName },
      });
      const tool = res.content.find((b) => b.type === "tool_use");
      if (!tool || tool.type !== "tool_use") throw new Error(`${toolName}: no tool call returned`);
      return tool.input as T;
    },
  };
}

async function buildGoogleClient(model: string): Promise<LLMClient> {
  // Dynamic import so @google/generative-ai is only loaded when AI_PROVIDER=google
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const googleAI = (await import("@google/generative-ai" as string)) as any;
  const { GoogleGenerativeAI, FunctionCallingMode } = googleAI;
  const apiKey = process.env.GOOGLE_API_KEY!;
  const genAI = new GoogleGenerativeAI(apiKey);

  return {
    async complete({ system, prompt, maxTokens = 1024 }) {
      const gemini = genAI.getGenerativeModel({ model, systemInstruction: system });
      const res = await gemini.generateContent({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: googleTextGenerationConfig(model, maxTokens),
      });
      return extractGoogleText(res.response);
    },

    async structured<T>(opts: StructuredOpts): Promise<T> {
      const { system, prompt, toolName, toolDescription, schema, maxTokens = 2048 } = opts;
      const gemini = genAI.getGenerativeModel({
        model,
        systemInstruction: `${system}\n\nYou MUST call the ${toolName} function. Do not reply with plain text.`,
        tools: [{ functionDeclarations: [{ name: toolName, description: toolDescription, parameters: toGoogleSchema(schema) }] }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.ANY, allowedFunctionNames: [toolName] } },
      });

      let lastError: Error | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await gemini.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: googleStructuredGenerationConfig(model, maxTokens),
          });
          const call = extractGoogleFunctionCall(res.response);
          if (call) return call.args as T;

          const parsed = parseJsonFromGoogleText(extractGoogleText(res.response));
          if (parsed) return parsed as T;

          lastError = new Error(`${toolName}: no function call returned`);
        } catch (err) {
          if (isRetryableGoogleError(err) && attempt < 2) {
            await sleep(750 * (attempt + 1));
            continue;
          }
          throw err;
        }

        if (attempt < 2) await sleep(500 * (attempt + 1));
      }

      throw lastError ?? new Error(`${toolName}: no function call returned`);
    },
  };
}

let _client: LLMClient | null = null;
let _init: Promise<LLMClient> | null = null;
let _clientKey: string | null = null;

export function createLLMClient(): Promise<LLMClient> {
  const { provider, model } = getLlmConfig();
  const key = `${provider}:${model}`;
  if (_client && _clientKey === key) return Promise.resolve(_client);
  _client = null;
  _init = null;
  _clientKey = key;
  _init = (provider === "google" ? buildGoogleClient(model) : Promise.resolve(buildAnthropicClient(model))).then(
    (c) => {
      _client = c;
      return c;
    },
  );
  return _init;
}
