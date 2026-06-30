export type VoicePurpose = "greeting" | "reply" | "confirmation" | "admin";

export type SpeechCallbacks =
  | (() => void)
  | {
      onStart?: () => void;
      onEnd?: () => void;
    };

export type PlayVSpeechOptions = {
  apiUrl: string;
  purpose?: VoicePurpose;
  lang?: string;
  onStart?: () => void;
  onEnd?: () => void;
};

const VIORA_BRAND_PATTERN = /\bViora\b/gi;
const VIORA_BRAND_ALIAS = "VEE-OR-uh";

let activeAudio: HTMLAudioElement | null = null;
let activeAudioUrl: string | null = null;

// ── Global "mute V" state ────────────────────────────────────────────────────
// One source of truth for whether V speaks aloud, shared by every app via
// @viora/ui and persisted across reloads. When muted, playVSpeech skips all
// audio but still drives onStart/onEnd so callers' UI state machines (caption
// rolling, sphere animation) behave as if V spoke.
const MUTE_STORAGE_KEY = "viora:voice-muted";

let muted: boolean | null = null;
const muteListeners = new Set<(muted: boolean) => void>();

function readMutePreference(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MUTE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function isVoiceMuted(): boolean {
  if (muted === null) muted = readMutePreference();
  return muted;
}

export function setVoiceMuted(value: boolean): void {
  if (isVoiceMuted() === value) return;
  muted = value;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(MUTE_STORAGE_KEY, value ? "1" : "0");
    } catch {
      // ignore storage failures (private mode, etc.)
    }
  }
  // Silence anything currently playing the moment the user mutes.
  if (value) cancelVSpeech();
  for (const listener of muteListeners) listener(value);
}

export function subscribeVoiceMuted(listener: (muted: boolean) => void): () => void {
  muteListeners.add(listener);
  return () => {
    muteListeners.delete(listener);
  };
}

/** Rough spoken-duration estimate (~2.35 words/sec + lead-in), used to pace
 * the muted no-audio path so captions/animations match real speech timing. */
function estimateSpeechMs(text: string): number {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(22000, Math.max(1500, Math.round((wordCount / 2.35) * 1000 + 1200)));
}

function normalizeCallbacks(callbacks?: SpeechCallbacks) {
  return typeof callbacks === "function" ? { onEnd: callbacks } : (callbacks ?? {});
}

function browserSpeechText(text: string) {
  return text.replace(VIORA_BRAND_PATTERN, VIORA_BRAND_ALIAS);
}

function browserSpeak(text: string, lang = "en-GB", callbacks?: SpeechCallbacks) {
  const { onStart, onEnd } = normalizeCallbacks(callbacks);
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    onEnd?.();
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(browserSpeechText(text));
  utter.lang = lang;
  utter.rate = 1.02;
  utter.onstart = () => onStart?.();
  utter.onend = () => onEnd?.();
  synth.speak(utter);
}

export async function playVSpeech(text: string, options: PlayVSpeechOptions) {
  const { apiUrl, purpose = "reply", lang = "en-GB", onStart, onEnd } = options;
  // Muted: no audio, but keep callers' state machines alive by simulating the
  // start→end of speech over an estimated duration.
  if (isVoiceMuted()) {
    cancelVSpeech();
    onStart?.();
    if (typeof window !== "undefined") {
      window.setTimeout(() => onEnd?.(), estimateSpeechMs(text));
    } else {
      onEnd?.();
    }
    return;
  }
  try {
    const res = await fetch(`${apiUrl}/v1/voice/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, purpose }),
    });
    if (!res.ok) throw new Error("voice route unavailable");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    cancelVSpeech();
    activeAudio = audio;
    activeAudioUrl = url;
    audio.onplaying = () => onStart?.();
    audio.onended = () => {
      if (activeAudio === audio) activeAudio = null;
      if (activeAudioUrl === url) activeAudioUrl = null;
      URL.revokeObjectURL(url);
      onEnd?.();
    };
    audio.onerror = () => {
      if (activeAudio === audio) activeAudio = null;
      if (activeAudioUrl === url) activeAudioUrl = null;
      URL.revokeObjectURL(url);
      browserSpeak(text, lang, { onStart, onEnd });
    };
    await audio.play();
  } catch {
    browserSpeak(text, lang, { onStart, onEnd });
  }
}

export function cancelVSpeech() {
  activeAudio?.pause();
  activeAudio = null;
  if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
  activeAudioUrl = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
}
