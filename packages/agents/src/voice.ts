import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type VoiceTtsProvider = "disabled" | "elevenlabs" | "openai";
export type VoiceSttProvider = "disabled" | "openai" | "azure" | "gemini";

export type VoicePurpose = "greeting" | "reply" | "confirmation" | "admin";

export interface VoiceSpeechInput {
  text: string;
  purpose?: VoicePurpose;
}

export interface VoiceSpeechResult {
  audio: Uint8Array;
  contentType: string;
  provider: VoiceTtsProvider;
  model: string;
  voiceId: string;
  cacheKey: string;
  cached: boolean;
}

export interface VoiceTranscribeInput {
  audio: Uint8Array;
  mimeType: string;
  filename?: string;
  language?: string;
}

export interface VoiceTranscribeResult {
  text: string;
  provider: VoiceSttProvider;
  model: string;
  confidence?: number;
}

export interface VoiceClient {
  speak(input: VoiceSpeechInput): Promise<VoiceSpeechResult>;
  transcribe(input: VoiceTranscribeInput): Promise<VoiceTranscribeResult>;
}

export class VoiceProviderError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 503,
  ) {
    super(message);
  }
}

type VoiceConfig = {
  ttsProvider: VoiceTtsProvider;
  sttProvider: VoiceSttProvider;
  cacheDir: string;
  ttsFormat: "mp3";
  style: string;
  styleVersion: string;
  elevenlabs: {
    apiKey?: string;
    voiceId?: string;
    modelId: string;
    outputFormat: string;
    settings: ElevenLabsVoiceSettings;
  };
  openai: {
    apiKey?: string;
    ttsModel: string;
    ttsVoice: string;
    transcribeModel: string;
  };
  azure: {
    speechKey?: string;
    region?: string;
    endpoint?: string;
    language: string;
  };
  gemini: {
    apiKey?: string;
    transcribeModel: string;
  };
};

type ElevenLabsVoiceSettings = {
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
  useSpeakerBoost: boolean;
};

const DEFAULT_VOICE_STYLE =
  "V sounds like a sharp British staffing coordinator in her late 20s: calm, capable, concise, and quietly confident. Use modern neutral UK delivery, natural pauses, subtle downward inflection on firm statements, and extra clarity for dates, shifts, DBS, compliance, bookings, and next steps. Never sound salesy, theatrical, childish, maternal, overly cheerful, or like a generic assistant.";

function getEnvValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function readNumberEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = getEnvValue(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new VoiceProviderError(`${name} must be a number between ${min} and ${max}.`, 500);
  }
  return value;
}

function readBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = getEnvValue(name)?.toLowerCase();
  if (!raw) return fallback;
  if (["true", "1", "yes", "on"].includes(raw)) return true;
  if (["false", "0", "no", "off"].includes(raw)) return false;
  throw new VoiceProviderError(`${name} must be true or false.`, 500);
}

function readProvider<T extends string>(name: string, fallback: T, allowed: readonly T[]): T {
  const raw = getEnvValue(name);
  if (!raw) return fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  throw new VoiceProviderError(`${name} must be one of: ${allowed.join(", ")}`, 500);
}

function getVoiceConfig(): VoiceConfig {
  const geminiTranscribeModel =
    getEnvValue("VOICE_STT_MODEL") ?? getEnvValue("AI_MODEL_FAST") ?? getEnvValue("AI_MODEL") ?? "gemini-2.5-flash";

  return {
    ttsProvider: readProvider("VOICE_TTS_PROVIDER", "disabled", ["disabled", "elevenlabs", "openai"] as const),
    sttProvider: readProvider("VOICE_STT_PROVIDER", "disabled", ["disabled", "openai", "azure", "gemini"] as const),
    cacheDir: getEnvValue("VIORA_VOICE_CACHE_DIR") ?? path.join(tmpdir(), "viora-voice-cache"),
    ttsFormat: "mp3",
    style: getEnvValue("VOICE_TTS_STYLE") ?? DEFAULT_VOICE_STYLE,
    styleVersion: getEnvValue("VOICE_TTS_STYLE_VERSION") ?? "v1",
    elevenlabs: {
      apiKey: getEnvValue("ELEVENLABS_API_KEY"),
      voiceId: getEnvValue("ELEVENLABS_VOICE_ID"),
      modelId: getEnvValue("ELEVENLABS_MODEL_ID") ?? "eleven_flash_v2_5",
      outputFormat: getEnvValue("ELEVENLABS_OUTPUT_FORMAT") ?? "mp3_44100_128",
      settings: {
        stability: readNumberEnv("ELEVENLABS_STABILITY", 0.46, 0, 1),
        similarityBoost: readNumberEnv("ELEVENLABS_SIMILARITY_BOOST", 0.75, 0, 1),
        style: readNumberEnv("ELEVENLABS_STYLE", 0.06, 0, 1),
        speed: readNumberEnv("ELEVENLABS_SPEED", 0.97, 0.7, 1.2),
        useSpeakerBoost: readBooleanEnv("ELEVENLABS_SPEAKER_BOOST", false),
      },
    },
    openai: {
      apiKey: getEnvValue("OPENAI_API_KEY"),
      ttsModel: getEnvValue("OPENAI_TTS_MODEL") ?? "gpt-4o-mini-tts",
      ttsVoice: getEnvValue("OPENAI_TTS_VOICE") ?? "marin",
      transcribeModel: getEnvValue("OPENAI_TRANSCRIBE_MODEL") ?? "whisper-1",
    },
    azure: {
      speechKey: getEnvValue("AZURE_SPEECH_KEY"),
      region: getEnvValue("AZURE_SPEECH_REGION"),
      endpoint: getEnvValue("AZURE_SPEECH_ENDPOINT"),
      language: getEnvValue("AZURE_SPEECH_LANGUAGE") ?? "en-GB",
    },
    gemini: {
      apiKey: getEnvValue("GOOGLE_API_KEY"),
      transcribeModel: geminiTranscribeModel,
    },
  };
}

function cacheKeyFor(input: {
  provider: VoiceTtsProvider;
  model: string;
  voiceId: string;
  styleVersion: string;
  format: string;
  voiceSettings?: ElevenLabsVoiceSettings;
  text: string;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        provider: input.provider,
        model: input.model,
        voiceId: input.voiceId,
        styleVersion: input.styleVersion,
        format: input.format,
        voiceSettings: input.voiceSettings,
        text: input.text,
      }),
    )
    .digest("hex");
}

async function fetchAudio(url: string, init: RequestInit): Promise<Uint8Array> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new VoiceProviderError(`Voice provider request failed (${res.status}): ${body.slice(0, 180)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function generateElevenLabsSpeech(config: VoiceConfig, text: string): Promise<Uint8Array> {
  if (!config.elevenlabs.apiKey || !config.elevenlabs.voiceId) {
    throw new VoiceProviderError("ElevenLabs TTS is not configured. Set ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID.");
  }
  const url = new URL(`https://api.elevenlabs.io/v1/text-to-speech/${config.elevenlabs.voiceId}/stream`);
  url.searchParams.set("output_format", config.elevenlabs.outputFormat);
  return fetchAudio(url.toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "xi-api-key": config.elevenlabs.apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: config.elevenlabs.modelId,
      voice_settings: {
        stability: config.elevenlabs.settings.stability,
        similarity_boost: config.elevenlabs.settings.similarityBoost,
        style: config.elevenlabs.settings.style,
        speed: config.elevenlabs.settings.speed,
        use_speaker_boost: config.elevenlabs.settings.useSpeakerBoost,
      },
    }),
  });
}

async function generateOpenAiSpeech(config: VoiceConfig, text: string): Promise<Uint8Array> {
  if (!config.openai.apiKey) {
    throw new VoiceProviderError("OpenAI TTS is not configured. Set OPENAI_API_KEY.");
  }
  return fetchAudio("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openai.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.openai.ttsModel,
      voice: config.openai.ttsVoice,
      input: text,
      instructions: config.style,
      response_format: config.ttsFormat,
    }),
  });
}

async function transcribeOpenAi(config: VoiceConfig, input: VoiceTranscribeInput): Promise<string> {
  if (!config.openai.apiKey) {
    throw new VoiceProviderError("OpenAI transcription is not configured. Set OPENAI_API_KEY.");
  }

  const form = new FormData();
  const filename = input.filename ?? `viora-voice.${input.mimeType.includes("wav") ? "wav" : "webm"}`;
  form.set("file", new Blob([input.audio], { type: input.mimeType }), filename);
  form.set("model", config.openai.transcribeModel);
  if (input.language) form.set("language", input.language);

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.openai.apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new VoiceProviderError(`Transcription provider request failed (${res.status}): ${body.slice(0, 180)}`);
  }
  const parsed = (await res.json()) as { text?: unknown };
  return typeof parsed.text === "string" ? parsed.text : "";
}

async function transcribeAzure(config: VoiceConfig, input: VoiceTranscribeInput): Promise<string> {
  if (!config.azure.speechKey) {
    throw new VoiceProviderError("Azure Speech transcription is not configured. Set AZURE_SPEECH_KEY.");
  }
  if (!config.azure.endpoint && !config.azure.region) {
    throw new VoiceProviderError("Azure Speech transcription requires AZURE_SPEECH_REGION or AZURE_SPEECH_ENDPOINT.");
  }

  const baseUrl =
    config.azure.endpoint ??
    `https://${config.azure.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`;
  const url = new URL(baseUrl);
  url.searchParams.set("language", input.language ?? config.azure.language);
  url.searchParams.set("format", "simple");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": config.azure.speechKey,
      "Content-Type": input.mimeType,
      Accept: "application/json",
    },
    body: input.audio,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new VoiceProviderError(`Azure Speech request failed (${res.status}): ${body.slice(0, 180)}`);
  }
  const parsed = (await res.json()) as { DisplayText?: unknown; RecognitionStatus?: unknown };
  if (parsed.RecognitionStatus && parsed.RecognitionStatus !== "Success") return "";
  return typeof parsed.DisplayText === "string" ? parsed.DisplayText : "";
}

function normalizedAudioMimeType(mimeType: string): string {
  return mimeType.split(";")[0]?.trim() || "audio/webm";
}

function extractGeminiText(parsed: unknown): string {
  if (!parsed || typeof parsed !== "object") return "";
  const candidates = (parsed as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return "";
  return candidates
    .flatMap((candidate) => {
      const parts = (candidate as { content?: { parts?: unknown } }).content?.parts;
      return Array.isArray(parts) ? parts : [];
    })
    .map((part) => (typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : ""))
    .join("")
    .trim();
}

function parseGeminiTranscript(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = (fenced?.[1] ?? trimmed).trim();
  try {
    const parsed = JSON.parse(candidate) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const value = (parsed as { text?: unknown; transcript?: unknown }).text ?? (parsed as { transcript?: unknown }).transcript;
      return typeof value === "string" ? value.trim() : "";
    }
    if (typeof parsed === "string") return parsed.trim();
  } catch {
    // Plain text fallback below.
  }
  return candidate.replace(/^["']|["']$/g, "").trim();
}

async function transcribeGemini(config: VoiceConfig, input: VoiceTranscribeInput): Promise<string> {
  if (!config.gemini.apiKey) {
    throw new VoiceProviderError("Gemini transcription is not configured. Set GOOGLE_API_KEY.");
  }

  const url = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.gemini.transcribeModel)}:generateContent`,
  );
  url.searchParams.set("key", config.gemini.apiKey);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text:
                "Transcribe the spoken words in this audio for a staffing assistant. " +
                "Return JSON only in the exact shape {\"text\":\"...\"}. " +
                "Use the same language and spelling the speaker used. " +
                "Do not infer missing words, do not add punctuation unless clearly spoken, " +
                "and return an empty text value if there is no clear speech.",
            },
            {
              inlineData: {
                mimeType: normalizedAudioMimeType(input.mimeType),
                data: Buffer.from(input.audio).toString("base64"),
              },
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        maxOutputTokens: 512,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new VoiceProviderError(`Gemini transcription request failed (${res.status}): ${body.slice(0, 180)}`);
  }
  const parsed = (await res.json()) as unknown;
  return parseGeminiTranscript(extractGeminiText(parsed));
}

export function getActiveVoiceConfig(): Pick<VoiceConfig, "ttsProvider" | "sttProvider" | "styleVersion"> & {
  ttsModel: string;
  ttsVoiceId: string;
  sttModel: string;
} {
  const config = getVoiceConfig();
  const ttsModel = config.ttsProvider === "elevenlabs" ? config.elevenlabs.modelId : config.openai.ttsModel;
  const ttsVoiceId = config.ttsProvider === "elevenlabs" ? (config.elevenlabs.voiceId ?? "") : config.openai.ttsVoice;
  const sttModel =
    config.sttProvider === "azure"
      ? "azure-speech"
      : config.sttProvider === "gemini"
        ? config.gemini.transcribeModel
        : config.openai.transcribeModel;
  return {
    ttsProvider: config.ttsProvider,
    sttProvider: config.sttProvider,
    styleVersion: config.styleVersion,
    ttsModel,
    ttsVoiceId,
    sttModel,
  };
}

export function createVoiceClient(): VoiceClient {
  return {
    async speak(input: VoiceSpeechInput): Promise<VoiceSpeechResult> {
      const config = getVoiceConfig();
      if (config.ttsProvider === "disabled") {
        throw new VoiceProviderError("Server-side TTS is disabled. Set VOICE_TTS_PROVIDER to elevenlabs or openai.");
      }

      const model = config.ttsProvider === "elevenlabs" ? config.elevenlabs.modelId : config.openai.ttsModel;
      const voiceId = config.ttsProvider === "elevenlabs" ? (config.elevenlabs.voiceId ?? "") : config.openai.ttsVoice;
      const cacheKey = cacheKeyFor({
        provider: config.ttsProvider,
        model,
        voiceId,
        styleVersion: config.styleVersion,
        format: config.ttsFormat,
        voiceSettings: config.ttsProvider === "elevenlabs" ? config.elevenlabs.settings : undefined,
        text: input.text,
      });
      const cachePath = path.join(config.cacheDir, `${cacheKey}.${config.ttsFormat}`);

      try {
        return {
          audio: await readFile(cachePath),
          contentType: "audio/mpeg",
          provider: config.ttsProvider,
          model,
          voiceId,
          cacheKey,
          cached: true,
        };
      } catch {
        // Cache miss: generate and persist below.
      }

      const audio =
        config.ttsProvider === "elevenlabs"
          ? await generateElevenLabsSpeech(config, input.text)
          : await generateOpenAiSpeech(config, input.text);
      await mkdir(config.cacheDir, { recursive: true });
      await writeFile(cachePath, audio);
      return {
        audio,
        contentType: "audio/mpeg",
        provider: config.ttsProvider,
        model,
        voiceId,
        cacheKey,
        cached: false,
      };
    },

    async transcribe(input: VoiceTranscribeInput): Promise<VoiceTranscribeResult> {
      const config = getVoiceConfig();
      if (config.sttProvider === "disabled") {
        throw new VoiceProviderError(
          "Server-side transcription is disabled. Set VOICE_STT_PROVIDER to openai, azure, or gemini.",
        );
      }
      const text =
        config.sttProvider === "azure"
          ? await transcribeAzure(config, input)
          : config.sttProvider === "gemini"
            ? await transcribeGemini(config, input)
            : await transcribeOpenAi(config, input);
      return {
        text,
        provider: config.sttProvider,
        model:
          config.sttProvider === "azure"
            ? "azure-speech"
            : config.sttProvider === "gemini"
              ? config.gemini.transcribeModel
              : config.openai.transcribeModel,
      };
    },
  };
}
