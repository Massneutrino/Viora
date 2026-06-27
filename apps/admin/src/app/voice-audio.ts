const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200";

let activeAudio: HTMLAudioElement | null = null;
let activeAudioUrl: string | null = null;

function browserSpeak(text: string) {
  if (!("speechSynthesis" in window)) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "en-GB";
  synth.speak(utter);
}

export async function playVSpeech(text: string) {
  try {
    const res = await fetch(`${API_URL}/v1/voice/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, purpose: "admin" }),
    });
    if (!res.ok) throw new Error("voice route unavailable");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    activeAudio?.pause();
    if (activeAudioUrl) URL.revokeObjectURL(activeAudioUrl);
    activeAudio = audio;
    activeAudioUrl = url;
    audio.onended = () => {
      if (activeAudio === audio) activeAudio = null;
      if (activeAudioUrl === url) activeAudioUrl = null;
      URL.revokeObjectURL(url);
    };
    audio.onerror = () => {
      if (activeAudio === audio) activeAudio = null;
      if (activeAudioUrl === url) activeAudioUrl = null;
      URL.revokeObjectURL(url);
      browserSpeak(text);
    };
    await audio.play();
  } catch {
    browserSpeak(text);
  }
}
