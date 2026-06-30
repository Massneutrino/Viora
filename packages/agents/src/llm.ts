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

export type LLMTask = "parseIntent" | "clarify" | "confirmIntent" | "explainFit";

export type CreateLLMClientOptions = {
  task?: LLMTask;
};

type StructuredOpts = {
  system: string;
  prompt: string;
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
  maxTokens?: number;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GoogleGenerateContentResult = { response: any };

const LLM_CALL_TIMEOUT_MS = 15_000;
const FAST_LLM_TASKS = new Set<LLMTask>(["clarify", "confirmIntent", "explainFit"]);

function getDefaultModel(provider: string, task?: LLMTask): string {
  if (provider === "google") {
    return task === "parseIntent" ? "gemini-2.5-pro" : "gemini-2.5-flash";
  }
  return task === "parseIntent" ? "claude-opus-4-8" : "claude-sonnet-4-5";
}

function getEnvValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function getLlmConfig(task?: LLMTask): { provider: string; model: string; task?: LLMTask } {
  const provider = getEnvValue("AI_PROVIDER") ?? "anthropic";
  const routedModel =
    task === "parseIntent"
      ? getEnvValue("AI_MODEL_INTENT")
      : task && FAST_LLM_TASKS.has(task)
        ? getEnvValue("AI_MODEL_FAST")
        : undefined;
  return { provider, model: routedModel ?? getEnvValue("AI_MODEL") ?? getDefaultModel(provider, task), task };
}

/** For startup logs — shows which provider/model the API will use. */
export function getActiveLlmConfig(options?: CreateLLMClientOptions): { provider: string; model: string; task?: LLMTask } {
  return getLlmConfig(options?.task);
}

/** Gemini 2.5+ counts thinking tokens against maxOutputTokens — low caps truncate visible text. */
function isGoogleThinkingModel(model: string): boolean {
  return /gemini-2\.5|gemini-3/i.test(model);
}

/** Pro-tier Gemini models reject thinkingBudget 0 and require a positive budget. */
function googleThinkingBudget(model: string): number {
  if (/gemini-2\.5-pro|gemini-3-pro/i.test(model)) return 1024;
  return 0;
}

function googleTextGenerationConfig(model: string, maxTokens: number): Record<string, unknown> {
  const config: Record<string, unknown> = { maxOutputTokens: maxTokens };
  if (isGoogleThinkingModel(model)) {
    config.thinkingConfig = { thinkingBudget: googleThinkingBudget(model) };
    config.maxOutputTokens = Math.max(maxTokens, 1024);
  }
  return config;
}

function googleStructuredGenerationConfig(model: string, maxTokens: number): Record<string, unknown> {
  const config: Record<string, unknown> = { maxOutputTokens: Math.max(maxTokens, 4096) };
  if (isGoogleThinkingModel(model)) {
    config.thinkingConfig = { thinkingBudget: googleThinkingBudget(model) };
  }
  return config;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const status = "status" in err ? (err as { status?: number }).status : undefined;
  if (typeof status === "number") return status;
  const statusCode = "statusCode" in err ? (err as { statusCode?: number }).statusCode : undefined;
  if (typeof statusCode === "number") return statusCode;
  const message = err instanceof Error ? err.message : String(err);
  const match = message.match(/\b(429|503)\b/);
  return match ? Number(match[1]) : undefined;
}

function isRetryableLlmError(err: unknown): boolean {
  const status = getErrorStatus(err);
  return status === 503 || status === 429;
}

async function withTimeout<T>(operation: () => Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("LLM call timed out")), LLM_CALL_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function retryLlmCall<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await withTimeout(operation);
    } catch (err) {
      if (!isRetryableLlmError(err) || attempt === 2) throw err;
      await sleep(750 * (attempt + 1));
    }
  }
  throw new Error("LLM call failed after retries");
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
      const res = await retryLlmCall(() =>
        anthropic.messages.create({
          model,
          max_tokens: maxTokens,
          thinking: { type: "adaptive" },
          system,
          messages: [{ role: "user", content: prompt }],
        }),
      );
      return res.content.find((b) => b.type === "text")?.text ?? "";
    },

    async structured<T>(opts: StructuredOpts): Promise<T> {
      const { system, prompt, toolName, toolDescription, schema, maxTokens = 2048 } = opts;
      const res = await retryLlmCall(() =>
        anthropic.messages.create({
          model,
          max_tokens: maxTokens,
          thinking: { type: "adaptive" },
          system,
          messages: [{ role: "user", content: prompt }],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          tools: [{ name: toolName, description: toolDescription, input_schema: schema as any }],
          tool_choice: { type: "tool", name: toolName },
        }),
      );
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
      const res = await retryLlmCall<GoogleGenerateContentResult>(() =>
        gemini.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: googleTextGenerationConfig(model, maxTokens),
        }),
      );
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
        const res = await retryLlmCall<GoogleGenerateContentResult>(() =>
          gemini.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: googleStructuredGenerationConfig(model, maxTokens),
          }),
        );
        const call = extractGoogleFunctionCall(res.response);
        if (call) return call.args as T;

        const parsed = parseJsonFromGoogleText(extractGoogleText(res.response));
        if (parsed) return parsed as T;

        lastError = new Error(`${toolName}: no function call returned`);

        if (attempt < 2) await sleep(500 * (attempt + 1));
      }

      throw lastError ?? new Error(`${toolName}: no function call returned`);
    },
  };
}

const clientCache = new Map<string, Promise<LLMClient>>();
const resolvedClientCache = new Map<string, LLMClient>();

export function createLLMClient(options?: CreateLLMClientOptions): Promise<LLMClient> {
  const { provider, model, task } = getLlmConfig(options?.task);
  const key = `${provider}:${model}:${task ?? "default"}`;
  const resolvedClient = resolvedClientCache.get(key);
  if (resolvedClient) return Promise.resolve(resolvedClient);

  const cachedInit = clientCache.get(key);
  if (cachedInit) return cachedInit;

  const init = (provider === "google" ? buildGoogleClient(model) : Promise.resolve(buildAnthropicClient(model))).then(
    (client) => {
      resolvedClientCache.set(key, client);
      return client;
    },
  );
  clientCache.set(key, init);
  return init;
}
