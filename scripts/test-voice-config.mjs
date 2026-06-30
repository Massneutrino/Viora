import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createVoiceClient, getActiveVoiceConfig, VoiceProviderError } from "../packages/agents/dist/index.js";

const envKeys = [
  "VOICE_STT_PROVIDER",
  "VOICE_STT_MODEL",
  "OPENAI_TRANSCRIBE_MODEL",
  "AZURE_SPEECH_KEY",
  "AZURE_SPEECH_REGION",
  "AZURE_SPEECH_ENDPOINT",
  "AZURE_SPEECH_LANGUAGE",
  "GOOGLE_API_KEY",
  "AI_MODEL",
  "AI_MODEL_FAST",
];

const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;

function resetEnv() {
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearVoiceEnv() {
  for (const key of envKeys) delete process.env[key];
}

try {
  clearVoiceEnv();
  assert.equal(getActiveVoiceConfig().sttProvider, "disabled");

  process.env.VOICE_STT_PROVIDER = "openai";
  process.env.OPENAI_TRANSCRIBE_MODEL = "whisper-1";
  assert.deepEqual(
    {
      provider: getActiveVoiceConfig().sttProvider,
      model: getActiveVoiceConfig().sttModel,
    },
    { provider: "openai", model: "whisper-1" },
  );

  process.env.VOICE_STT_PROVIDER = "azure";
  assert.deepEqual(
    {
      provider: getActiveVoiceConfig().sttProvider,
      model: getActiveVoiceConfig().sttModel,
    },
    { provider: "azure", model: "azure-speech" },
  );

  process.env.VOICE_STT_PROVIDER = "gemini";
  process.env.VOICE_STT_MODEL = "gemini-2.5-flash";
  assert.deepEqual(
    {
      provider: getActiveVoiceConfig().sttProvider,
      model: getActiveVoiceConfig().sttModel,
    },
    { provider: "gemini", model: "gemini-2.5-flash" },
  );

  delete process.env.VOICE_STT_MODEL;
  process.env.AI_MODEL_FAST = "gemini-fast-test";
  assert.equal(getActiveVoiceConfig().sttModel, "gemini-fast-test");

  delete process.env.AI_MODEL_FAST;
  process.env.AI_MODEL = "gemini-global-test";
  assert.equal(getActiveVoiceConfig().sttModel, "gemini-global-test");

  process.env.VOICE_STT_MODEL = "gemini-2.5-flash";
  process.env.GOOGLE_API_KEY = "test-google-key";
  let sawGeminiRequest = false;
  globalThis.fetch = async (url, init) => {
    const requestUrl = String(url);
    assert.match(requestUrl, /generativelanguage\.googleapis\.com/);
    assert.match(requestUrl, /gemini-2\.5-flash/);
    const body = JSON.parse(String(init?.body));
    const parts = body.contents?.[0]?.parts;
    assert.equal(parts?.[1]?.inlineData?.mimeType, "audio/ogg");
    assert.equal(parts?.[1]?.inlineData?.data, Buffer.from([1, 2, 3]).toString("base64"));
    sawGeminiRequest = true;
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: "{\"text\":\"hello imran\"}" }] } }],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const result = await createVoiceClient().transcribe({
    audio: new Uint8Array([1, 2, 3]),
    mimeType: "audio/ogg;codecs=opus",
  });
  assert.equal(sawGeminiRequest, true);
  assert.deepEqual(result, {
    text: "hello imran",
    provider: "gemini",
    model: "gemini-2.5-flash",
  });

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: "quota exceeded" } }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  await assert.rejects(
    () =>
      createVoiceClient().transcribe({
        audio: new Uint8Array([1]),
        mimeType: "audio/ogg",
      }),
    (err) => err instanceof VoiceProviderError && /Gemini transcription request failed \(429\)/.test(err.message),
  );

  console.log("voice config tests passed");
} finally {
  globalThis.fetch = originalFetch;
  resetEnv();
}
