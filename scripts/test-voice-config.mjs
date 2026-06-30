import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { tmpdir } from "node:os";
import path from "node:path";
import { createVoiceClient, getActiveVoiceConfig, VoiceProviderError } from "../packages/agents/dist/index.js";

const envKeys = [
  "VOICE_TTS_PROVIDER",
  "VOICE_TTS_STYLE",
  "VOICE_TTS_STYLE_VERSION",
  "VIORA_VOICE_CACHE_DIR",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_VOICE_ID",
  "ELEVENLABS_MODEL_ID",
  "ELEVENLABS_OUTPUT_FORMAT",
  "ELEVENLABS_STABILITY",
  "ELEVENLABS_SIMILARITY_BOOST",
  "ELEVENLABS_STYLE",
  "ELEVENLABS_SPEED",
  "ELEVENLABS_SPEAKER_BOOST",
  "ELEVENLABS_PRONUNCIATION_DICTIONARY_ID",
  "ELEVENLABS_PRONUNCIATION_DICTIONARY_VERSION_ID",
  "OPENAI_API_KEY",
  "OPENAI_TTS_MODEL",
  "OPENAI_TTS_VOICE",
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

function setCacheDir(label) {
  process.env.VIORA_VOICE_CACHE_DIR = path.join(
    tmpdir(),
    `viora-voice-test-${process.pid}-${Date.now()}-${label}`,
  );
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

  clearVoiceEnv();
  setCacheDir("openai");
  process.env.VOICE_TTS_PROVIDER = "openai";
  process.env.OPENAI_API_KEY = "test-openai-key";
  process.env.OPENAI_TTS_MODEL = "tts-test-model";
  process.env.OPENAI_TTS_VOICE = "voice-test";
  process.env.VOICE_TTS_STYLE = "Base V voice style.";
  let openAiSpeechRequestCount = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.openai.com/v1/audio/speech");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.input, "Welcome to Viora.");
    assert.equal(body.model, "tts-test-model");
    assert.equal(body.voice, "voice-test");
    assert.match(body.instructions, /Base V voice style\./);
    assert.match(body.instructions, /Pronounce the brand name Viora as VEE-OR-uh/);
    assert.match(body.instructions, /\/ˈviː\.ɔː\.rə\//);
    openAiSpeechRequestCount += 1;
    return new Response(new Uint8Array([4, 5, 6]), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
    });
  };
  const openAiGreetingResult = await createVoiceClient().speak({ text: "Welcome to Viora.", purpose: "greeting" });
  const openAiReplyResult = await createVoiceClient().speak({ text: "Welcome to Viora.", purpose: "reply" });
  assert.equal(openAiSpeechRequestCount, 2);
  assert.notEqual(openAiGreetingResult.cacheKey, openAiReplyResult.cacheKey);

  clearVoiceEnv();
  setCacheDir("elevenlabs-default");
  process.env.VOICE_TTS_PROVIDER = "elevenlabs";
  process.env.ELEVENLABS_API_KEY = "test-eleven-key";
  process.env.ELEVENLABS_VOICE_ID = "test-voice-id";
  let sawElevenLabsDefaultRequest = false;
  globalThis.fetch = async (url, init) => {
    const requestUrl = String(url);
    assert.match(requestUrl, /elevenlabs\.io\/v1\/text-to-speech\/test-voice-id\/stream/);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.text, "Veora helps schools find cover.");
    assert.equal(body.model_id, "eleven_flash_v2_5");
    assert.equal(body.pronunciation_dictionary_locators, undefined);
    sawElevenLabsDefaultRequest = true;
    return new Response(new Uint8Array([7, 8, 9]), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
    });
  };
  const elevenLabsDefaultResult = await createVoiceClient().speak({
    text: "Viora helps schools find cover.",
    purpose: "reply",
  });
  assert.equal(sawElevenLabsDefaultRequest, true);

  clearVoiceEnv();
  setCacheDir("elevenlabs-dictionary");
  process.env.VOICE_TTS_PROVIDER = "elevenlabs";
  process.env.ELEVENLABS_API_KEY = "test-eleven-key";
  process.env.ELEVENLABS_VOICE_ID = "test-voice-id";
  process.env.ELEVENLABS_PRONUNCIATION_DICTIONARY_ID = "dict-test";
  process.env.ELEVENLABS_PRONUNCIATION_DICTIONARY_VERSION_ID = "version-test";
  let sawElevenLabsDictionaryRequest = false;
  globalThis.fetch = async (url, init) => {
    const requestUrl = String(url);
    assert.match(requestUrl, /elevenlabs\.io\/v1\/text-to-speech\/test-voice-id\/stream/);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.text, "Viora helps schools find cover.");
    assert.deepEqual(body.pronunciation_dictionary_locators, [
      { pronunciation_dictionary_id: "dict-test", version_id: "version-test" },
    ]);
    sawElevenLabsDictionaryRequest = true;
    return new Response(new Uint8Array([10, 11, 12]), {
      status: 200,
      headers: { "Content-Type": "audio/mpeg" },
    });
  };
  const elevenLabsDictionaryResult = await createVoiceClient().speak({
    text: "Viora helps schools find cover.",
    purpose: "reply",
  });
  assert.equal(sawElevenLabsDictionaryRequest, true);
  assert.notEqual(elevenLabsDictionaryResult.cacheKey, elevenLabsDefaultResult.cacheKey);

  console.log("voice config tests passed");
} finally {
  globalThis.fetch = originalFetch;
  resetEnv();
}
