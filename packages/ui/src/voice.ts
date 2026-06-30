export type VoiceTranscriptResult = {
  text: string;
  provider: string;
  model: string;
  fallbackUsed: boolean;
};

export type VoiceCaptureController = {
  stop: () => void;
};

type VoiceCaptureOptions = {
  apiUrl: string;
  language?: string;
  maxMs?: number;
  silenceMs?: number;
  onStart?: () => void;
  onStop?: () => void;
  onTranscript: (result: VoiceTranscriptResult) => void;
  onError?: (message: string) => void;
};

type VoiceStatus = {
  sttProvider?: string;
};

type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  start: () => void;
  stop: () => void;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  onresult:
    | ((event: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void)
    | null;
};

function getSpeechRecognition(): (new () => BrowserSpeechRecognition) | null {
  if (typeof window === "undefined") return null;
  const win = window as typeof window & {
    SpeechRecognition?: new () => BrowserSpeechRecognition;
    webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
  };
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export function isVoiceCaptureSupported(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
      typeof MediaRecorder !== "undefined" &&
      (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus") ||
        MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ||
        MediaRecorder.isTypeSupported("audio/webm")),
  ) || getSpeechRecognition() !== null;
}

function preferredMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) return "audio/ogg;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) return "audio/webm;codecs=opus";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  return "audio/webm";
}

function fallbackSpeechRecognition(options: VoiceCaptureOptions): VoiceCaptureController | null {
  const Recognition = getSpeechRecognition();
  if (!Recognition) return null;

  const recognition = new Recognition();
  recognition.lang = options.language ?? "en-GB";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => options.onStart?.();
  recognition.onend = () => options.onStop?.();
  recognition.onerror = () => {
    options.onError?.("Voice input is unavailable. Please try again or type instead.");
    options.onStop?.();
  };
  recognition.onresult = (event) => {
    const text = event.results[0]?.[0]?.transcript?.trim() ?? "";
    if (text) {
      options.onTranscript({
        text,
        provider: "browser",
        model: "SpeechRecognition",
        fallbackUsed: true,
      });
    }
  };
  recognition.start();
  return { stop: () => recognition.stop() };
}

async function transcribeBlob(
  apiUrl: string,
  blob: Blob,
  language: string,
): Promise<VoiceTranscriptResult> {
  const res = await fetch(`${apiUrl}/v1/voice/transcribe`, {
    method: "POST",
    headers: {
      "Content-Type": blob.type || "audio/webm",
      "X-Viora-Language": language,
      "X-Viora-Filename": `viora-voice.${blob.type.includes("wav") ? "wav" : "webm"}`,
    },
    body: blob,
  });
  const data = (await res.json().catch(() => null)) as
    | { text?: unknown; provider?: unknown; model?: unknown; error?: unknown }
    | null;
  if (!res.ok) {
    throw new Error(typeof data?.error === "string" ? data.error : "Server transcription failed.");
  }
  const text = typeof data?.text === "string" ? data.text.trim() : "";
  if (!text) throw new Error("No speech was recognized.");
  return {
    text,
    provider: typeof data?.provider === "string" ? data.provider : "server",
    model: typeof data?.model === "string" ? data.model : "unknown",
    fallbackUsed: false,
  };
}

async function shouldUseBrowserFallback(apiUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${apiUrl}/v1/voice/status`, { method: "GET" });
    const status = (await res.json().catch(() => null)) as VoiceStatus | null;
    return !res.ok || status?.sttProvider === "disabled";
  } catch {
    return true;
  }
}

export async function startVoiceCapture(options: VoiceCaptureOptions): Promise<VoiceCaptureController | null> {
  const language = options.language ?? "en-GB";
  const maxMs = options.maxMs ?? 30_000;
  const silenceMs = options.silenceMs ?? 1_700;

  if (await shouldUseBrowserFallback(options.apiUrl)) {
    const fallback = fallbackSpeechRecognition(options);
    if (!fallback) options.onError?.("Server transcription is unavailable and browser voice input is not supported.");
    return fallback;
  }

  if (typeof navigator.mediaDevices?.getUserMedia !== "function" || typeof MediaRecorder === "undefined") {
    const fallback = fallbackSpeechRecognition(options);
    if (!fallback) options.onError?.("Voice input is not supported in this browser.");
    return fallback;
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    const fallback = fallbackSpeechRecognition(options);
    if (!fallback) options.onError?.("Microphone permission was not granted.");
    return fallback;
  }

  const chunks: BlobPart[] = [];
  const mimeType = preferredMimeType();
  const recorder = new MediaRecorder(stream, { mimeType });
  let stopped = false;
  let fallbackStarted = false;
  let audioContext: AudioContext | null = null;
  let animationId: number | null = null;
  let silenceStartedAt: number | null = null;
  let activeStop: () => void = () => undefined;
  const controller: VoiceCaptureController = { stop: () => activeStop() };

  const cleanup = () => {
    if (animationId !== null) cancelAnimationFrame(animationId);
    stream.getTracks().forEach((track) => track.stop());
    void audioContext?.close().catch(() => undefined);
    options.onStop?.();
  };

  const startFallback = () => {
    if (fallbackStarted) return;
    fallbackStarted = true;
    const fallback = fallbackSpeechRecognition(options);
    if (fallback) activeStop = fallback.stop;
    if (!fallback) options.onError?.("Voice transcription is unavailable. Please type instead.");
  };

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = () => {
    cleanup();
    const blob = new Blob(chunks, { type: mimeType });
    void transcribeBlob(options.apiUrl, blob, language)
      .then(options.onTranscript)
      .catch(() => startFallback());
  };
  recorder.onerror = () => {
    cleanup();
    startFallback();
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (recorder.state !== "inactive") recorder.stop();
  };
  activeStop = stop;

  const monitorSilence = () => {
    try {
      audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(stream);
      const samples = new Uint8Array(analyser.fftSize);
      source.connect(analyser);
      const tick = () => {
        analyser.getByteTimeDomainData(samples);
        const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value - 128)), 0);
        const now = Date.now();
        if (peak < 5) {
          silenceStartedAt ??= now;
          if (now - silenceStartedAt > silenceMs && chunks.length > 0) stop();
        } else {
          silenceStartedAt = null;
        }
        if (!stopped) animationId = requestAnimationFrame(tick);
      };
      animationId = requestAnimationFrame(tick);
    } catch {
      // Silence detection is a convenience; the hard cap and tap-to-stop still work.
    }
  };

  recorder.start(250);
  options.onStart?.();
  monitorSilence();
  window.setTimeout(stop, maxMs);
  return controller;
}
