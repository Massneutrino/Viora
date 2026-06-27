import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export type VoiceTtsProvider = "disabled" | "elevenlabs" | "openai";
export type VoiceSttProvider = "disabled" | "openai";

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
  };
  openai: {
    apiKey?: string;
    ttsModel: string;
    ttsVoice: string;
    transcribeModel: string;
  };
};

const DEFAULT_VOICE_STYLE =
  "V is calm, capable, concise, and warmly operational. Use a clear UK delivery. Never sound salesy or overly animated.";

function getEnvValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function readProvider<T extends string>(name: string, fallback: T, allowed: readonly T[]): T {
  const raw = getEnvValue(name);
  if (!raw) return fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  throw new VoiceProviderError(`${name} must be one of: ${allowed.join(", ")}`, 500);
}

function getVoiceConfig(): VoiceConfig {
  return {
    ttsProvider: readProvider("VOICE_TTS_PROVIDER", "disabled", ["disabled", "elevenlabs", "openai"] as const),
    sttProvider: readProvider("VOICE_STT_PROVIDER", "disabled", ["disabled", "openai"] as const),
    cacheDir: getEnvValue("VIORA_VOICE_CACHE_DIR") ?? path.join(tmpdir(), "viora-voice-cache"),
    ttsFormat: "mp3",
    style: getEnvValue("VOICE_TTS_STYLE") ?? DEFAULT_VOICE_STYLE,
    styleVersion: getEnvValue("VOICE_TTS_STYLE_VERSION") ?? "v1",
    elevenlabs: {
      apiKey: getEnvValue("ELEVENLABS_API_KEY"),
      voiceId: getEnvValue("ELEVENLABS_VOICE_ID"),
      modelId: getEnvValue("ELEVENLABS_MODEL_ID") ?? "eleven_flash_v2_5",
      outputFormat: getEnvValue("ELEVENLABS_OUTPUT_FORMAT") ?? "mp3_44100_128",
    },
    openai: {
      apiKey: getEnvValue("OPENAI_API_KEY"),
      ttsModel: getEnvValue("OPENAI_TTS_MODEL") ?? "gpt-4o-mini-tts",
      ttsVoice: getEnvValue("OPENAI_TTS_VOICE") ?? "marin",
      transcribeModel: getEnvValue("OPENAI_TRANSCRIBE_MODEL") ?? "whisper-1",
    },
  };
}

function cacheKeyFor(input: {
  provider: VoiceTtsProvider;
  model: string;
  voiceId: string;
  styleVersion: string;
  format: string;
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
        stability: 0.55,
        similarity_boost: 0.85,
        style: 0.15,
        use_speaker_boost: true,
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

export function getActiveVoiceConfig(): Pick<VoiceConfig, "ttsProvider" | "sttProvider" | "styleVersion"> & {
  ttsModel: string;
  ttsVoiceId: string;
  sttModel: string;
} {
  const config = getVoiceConfig();
  const ttsModel = config.ttsProvider === "elevenlabs" ? config.elevenlabs.modelId : config.openai.ttsModel;
  const ttsVoiceId = config.ttsProvider === "elevenlabs" ? (config.elevenlabs.voiceId ?? "") : config.openai.ttsVoice;
  return {
    ttsProvider: config.ttsProvider,
    sttProvider: config.sttProvider,
    styleVersion: config.styleVersion,
    ttsModel,
    ttsVoiceId,
    sttModel: config.openai.transcribeModel,
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
        throw new VoiceProviderError("Server-side transcription is disabled. Set VOICE_STT_PROVIDER to openai.");
      }
      return {
        text: await transcribeOpenAi(config, input),
        provider: config.sttProvider,
        model: config.openai.transcribeModel,
      };
    },
  };
}
