"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { WaveState } from "@viora/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200";

type ChatRole = "user" | "v";
type Message = { role: ChatRole; content: string };
type Mode = "voice" | "text";

type ChatResponse = {
  reply: string;
  leadType: "employer" | "worker" | "unknown";
  fields: Record<string, unknown>;
  missing: string[];
  readyToCapture: boolean;
  intent: "callback" | "waitlist" | "none";
  remembered: string | null;
  captured: boolean;
  leadId: string | null;
  degraded: boolean;
};

const GREETING = "Hi — I'm V. Are you looking to fill shifts, or looking for work?";
const CHIPS = ["I need to fill shifts", "I'm looking for work", "How does V work?"];

/* eslint-disable @typescript-eslint/no-explicit-any */
function getSpeechRecognition(): any | null {
  if (typeof window === "undefined") return null;
  return (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Imperative handle so the hero orb (in page.tsx) can drive the conversation. */
export type VConversationHandle = {
  /** Tap the orb: start the conversation, or toggle the mic once it's running. */
  handleSphereTap: () => void;
};

export const VConversation = forwardRef<
  VConversationHandle,
  {
    /** A canned opening line (e.g. from an audience card) to send as the first visitor message. */
    seed?: string | null;
    /** Drives the hero sphere's WaveState. */
    onStateChange?: (state: WaveState) => void;
    /** Open the quick-form modal fallback. */
    onOpenForm?: () => void;
  }
>(function VConversation({ seed, onStateChange, onOpenForm }, ref) {
  const [started, setStarted] = useState(false);
  const [mode, setMode] = useState<Mode>("voice");
  const [messages, setMessages] = useState<Message[]>([{ role: "v", content: GREETING }]);
  const [memories, setMemories] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(false);
  const [awaitingConsent, setAwaitingConsent] = useState(false);
  const [captured, setCaptured] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [listening, setListening] = useState(false);

  const [speechSupported, setSpeechSupported] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const recognitionRef = useRef<unknown>(null);

  const setWave = useCallback((s: WaveState) => onStateChange?.(s), [onStateChange]);

  // Detect after mount so SSR and first client render match (avoids hydration mismatch).
  useEffect(() => {
    setSpeechSupported(getSpeechRecognition() !== null);
    setTtsSupported("speechSynthesis" in window);
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }, []);

  const stopListening = useCallback(() => {
    (recognitionRef.current as { stop?: () => void } | null)?.stop?.();
  }, []);

  const startListening = useCallback(() => {
    const Recognition = getSpeechRecognition();
    if (!Recognition || modeRef.current !== "voice") return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition: any = new Recognition();
    recognition.lang = "en-GB";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      setListening(true);
      setWave("listening");
    };
    recognition.onerror = () => {
      setListening(false);
      setWave("rest");
    };
    recognition.onend = () => setListening(false);
    recognition.onresult = (event: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => {
      const transcript = event.results[0]?.[0]?.transcript ?? "";
      if (transcript) sendRef.current(transcript);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      /* already started */
    }
  }, [setWave]);

  const speak = useCallback(
    (text: string, then?: () => void) => {
      if (!ttsSupported || modeRef.current !== "voice") {
        then?.();
        return;
      }
      const synth = window.speechSynthesis;
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.02;
      utter.onend = () => then?.();
      setWave("speaking");
      synth.speak(utter);
    },
    [ttsSupported, setWave],
  );

  const runTurn = useCallback(
    async (msgs: Message[], withConsent: boolean) => {
      setBusy(true);
      setWave("processing");
      try {
        const res = await fetch(`${API_URL}/v1/pilot/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: msgs, consent: withConsent }),
        });
        const data = (await res.json().catch(() => null)) as ChatResponse | null;
        if (!res.ok || !data) throw new Error("bad response");

        setMessages((prev) => [...prev, { role: "v", content: data.reply }]);
        setDegraded(Boolean(data.degraded));
        if (data.remembered) setMemories((prev) => [...prev, data.remembered as string]);
        if (data.degraded) onOpenForm?.();

        if (data.captured) {
          setCaptured(true);
          setAwaitingConsent(false);
          stopListening();
          setWave("confirmed");
          speak(data.reply);
        } else {
          setAwaitingConsent(data.readyToCapture && !withConsent);
          // Voice: V speaks, then listens again for a hands-free exchange.
          speak(data.reply, () => {
            setWave("rest");
            if (modeRef.current === "voice" && !data.readyToCapture) startListening();
          });
          if (modeRef.current !== "voice") setWave("rest");
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "v", content: "V is unreachable right now — please use the quick form." },
        ]);
        setDegraded(true);
        setWave("rest");
        onOpenForm?.();
      } finally {
        setBusy(false);
        scrollToBottom();
      }
    },
    [setWave, speak, startListening, stopListening, scrollToBottom, onOpenForm],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy || captured) return;
      setInput("");
      const next: Message[] = [...messagesRef.current, { role: "user", content: trimmed }];
      setMessages(next);
      scrollToBottom();
      void runTurn(next, consent);
    },
    [busy, captured, consent, runTurn, scrollToBottom],
  );

  // Stable ref so the speech-recognition callback always calls the latest send.
  const sendRef = useRef(send);
  sendRef.current = send;

  const start = useCallback(
    (preferVoice: boolean) => {
      const useVoice = preferVoice && speechSupported;
      setMode(useVoice ? "voice" : "text");
      modeRef.current = useVoice ? "voice" : "text";
      setStarted(true);
      if (useVoice) {
        // The CTA click is the user gesture that authorises mic + audio.
        speak(GREETING, () => startListening());
      } else {
        setWave("listening");
        setTimeout(() => document.getElementById("vc-input")?.focus(), 50);
      }
    },
    [speechSupported, speak, startListening, setWave],
  );

  const switchToText = useCallback(() => {
    setMode("text");
    modeRef.current = "text";
    stopListening();
    if (ttsSupported) window.speechSynthesis.cancel();
    setTimeout(() => document.getElementById("vc-input")?.focus(), 50);
  }, [stopListening, ttsSupported]);

  const endConversation = useCallback(() => {
    stopListening();
    if (ttsSupported && typeof window !== "undefined") window.speechSynthesis.cancel();
    setStarted(false);
    setMessages([{ role: "v", content: GREETING }]);
    setMemories([]);
    setInput("");
    setAwaitingConsent(false);
    setCaptured(false);
    setDegraded(false);
    setWave("rest");
  }, [stopListening, ttsSupported, setWave]);

  const onConsentChange = useCallback(
    (checked: boolean) => {
      setConsent(checked);
      if (checked && awaitingConsent && !busy && !captured) {
        void runTurn(messagesRef.current, true);
      }
    },
    [awaitingConsent, busy, captured, runTurn],
  );

  const toggleMic = useCallback(() => {
    if (listening) stopListening();
    else startListening();
  }, [listening, startListening, stopListening]);

  // The hero orb is the call-to-action: tapping it starts the conversation,
  // then toggles the mic in voice mode (mirrors the product apps' onSphereTap).
  useImperativeHandle(
    ref,
    () => ({
      handleSphereTap: () => {
        if (!started) start(true);
        else if (modeRef.current === "voice") toggleMic();
        else document.getElementById("vc-input")?.focus();
      },
    }),
    [started, start, toggleMic],
  );

  // Seed from an audience card: start (text) and send it as the first visitor message.
  const seededRef = useRef<string | null>(null);
  useEffect(() => {
    if (seed && seed !== seededRef.current) {
      seededRef.current = seed;
      if (!started) {
        setMode("text");
        modeRef.current = "text";
        setStarted(true);
      }
      send(seed);
    }
  }, [seed, started, send]);

  // Resting state — the orb is the call-to-action; this is just a nudge + fallbacks.
  if (!started) {
    return (
      <div className="vc-cta">
        <p className="vc-nudge">Tap V to speak</p>
        <p className="vc-cta-sub">Find cover or find work — V gets you set up in minutes.</p>
        <p className="vc-cta-alt">
          Prefer to type, or not now?{" "}
          <button type="button" className="vc-linkbtn" onClick={() => start(false)}>
            Type to V
          </button>{" "}
          or{" "}
          <button type="button" className="vc-linkbtn" onClick={() => onOpenForm?.()}>
            use a quick form
          </button>
          .
        </p>
      </div>
    );
  }

  const voiceMode = mode === "voice";

  return (
    <div className="vc">
      <div className="vc-thread" ref={scrollRef}>
        {messages.map((msg, i) => (
          <div key={i} className={`vc-bubble ${msg.role}`}>
            {msg.content}
          </div>
        ))}
        {memories.map((m, i) => (
          <div key={`mem-${i}`} className="vc-memory" title="Viora Memory">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
            </svg>
            V will remember: {m}
          </div>
        ))}
        {busy && <div className="vc-typing">V is thinking…</div>}
      </div>

      {captured ? (
        <p className="vc-confirmed">You&apos;re all set — V has logged your details. We&apos;ll be in touch.</p>
      ) : (
        <>
          {voiceMode && (
            <div className="vc-voice-status">
              {listening ? (
                <span className="vc-listening">
                  <span className="vc-dot" /> Listening…
                </span>
              ) : busy ? (
                <span>One sec…</span>
              ) : (
                <span>Tap the mic and talk to V</span>
              )}
            </div>
          )}

          <label className={`vc-consent ${awaitingConsent ? "prompt" : ""}`}>
            <input type="checkbox" checked={consent} onChange={(e) => onConsentChange(e.target.checked)} />
            <span>
              I agree to be contacted about Viora.{" "}
              <a href="/privacy" target="_blank" rel="noreferrer">
                Privacy
              </a>
              {awaitingConsent ? " — tick to confirm and I'll register you." : ""}
            </span>
          </label>

          {voiceMode ? (
            <div className="vc-voice-controls">
              <button type="button" className="vc-linkbtn" onClick={switchToText}>
                Type instead
              </button>
              <button
                type="button"
                className={`vc-mic-big ${listening ? "on" : ""}`}
                onClick={toggleMic}
                disabled={busy}
                aria-label={listening ? "Stop listening" : "Talk to V"}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M6 11a6 6 0 0 0 12 0M12 17v3" />
                </svg>
              </button>
              <button type="button" className="vc-linkbtn muted" onClick={endConversation}>
                End
              </button>
            </div>
          ) : (
            <>
              {messages.length === 1 && (
                <div className="vc-chips">
                  {CHIPS.map((chip) => (
                    <button key={chip} type="button" onClick={() => send(chip)} disabled={busy}>
                      {chip}
                    </button>
                  ))}
                </div>
              )}
              <form
                className="vc-input"
                onSubmit={(e) => {
                  e.preventDefault();
                  send(input);
                }}
              >
                <input
                  id="vc-input"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onFocus={() => !busy && setWave("listening")}
                  onBlur={() => !busy && setWave("rest")}
                  placeholder="Tell V…"
                  disabled={busy}
                  aria-label="Message V"
                />
                {speechSupported && (
                  <button type="button" className="vc-mic" onClick={() => start(true)} aria-label="Switch to voice">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <rect x="9" y="3" width="6" height="11" rx="3" />
                      <path d="M6 11a6 6 0 0 0 12 0M12 17v3" />
                    </svg>
                  </button>
                )}
                <button type="submit" disabled={busy || !input.trim()}>
                  Send
                </button>
              </form>
            </>
          )}

          <div className="vc-foot">
            <button type="button" className={`vc-form-link ${degraded ? "urgent" : ""}`} onClick={() => onOpenForm?.()}>
              Prefer a form?
            </button>
          </div>
        </>
      )}
    </div>
  );
});
