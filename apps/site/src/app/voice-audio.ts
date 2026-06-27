const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200";

type VoicePurpose = "greeting" | "reply" | "confirmation" | "admin";

let activeAudio: HTMLAudioElement | null = null;
let activeAudioUrl: string | null = null;

function browserSpeak(text: string, lang = "en-GB", onEnd?: () => void) {
  if (!("speechSynthesis" in window)) {
    onEnd?.();
    return;
  }
  const synth = window.speechSynthesis;
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = lang;
  utter.rate = 1.02;
  utter.onend = () => onEnd?.();
  synth.speak(utter);
}

export async function playVSpeech(text: string, purpose: VoicePurpose, onEnd?: () => void) {
  try {
    const res = await fetch(`${API_URL}/v1/voice/speech`, {
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
      browserSpeak(text, "en-GB", onEnd);
    };
    await audio.play();
  } catch {
    browserSpeak(text, "en-GB", onEnd);
  }
}

export function cancelVSpeech() {
  activeAudio?.pause();
  activeAudio = null;
  if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
  activeAudioUrl = null;
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}
