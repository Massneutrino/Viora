"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type FormEvent } from "react";
import { cancelVSpeech, isVoiceCaptureSupported, playVSpeech, startVoiceCapture, VoiceMuteToggle, type VoiceCaptureController, type VoicePurpose, type WaveState } from "@viora/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200";

type ChatRole = "user" | "v";
type LeadType = "employer" | "worker" | "unknown";
type Message = { role: ChatRole; content: string };
type Mode = "voice" | "text";
type EmailState = "idle" | "sending" | "error";
type CaptionPhase = "idle" | "revealing" | "holding" | "exiting";
type CaptionRelease = { runId: number; released: boolean; waiting: boolean };

type ChatResponse = {
  reply: string;
  leadType: LeadType;
  fields: Record<string, unknown>;
  missing: string[];
  readyForEmail: boolean;
  readyToCapture: boolean;
  intent: "callback" | "waitlist" | "none";
  remembered: string | null;
  captured: boolean;
  leadId: string | null;
  degraded: boolean;
};

const GREETING =
  "Hi, I'm V. I'm here to help. You can ask me how Viora works, why we're different from a traditional agency, or I can help you register.";

const CHIPS = [
  "How does Viora work?",
  "Why is it different?",
  "For organisations",
  "For workers",
  "Help me register",
];

function splitLongCaption(sentence: string) {
  const clean = sentence.trim();
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length <= 13) return [clean];

  const clauses = clean
    .split(/,\s+|;\s+|:\s+|\s+-\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (clauses.length > 1 && clauses.every((part) => part.split(/\s+/).length <= 13)) {
    return clauses;
  }

  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 11) {
    chunks.push(words.slice(i, i + 11).join(" "));
  }
  return chunks;
}

function captionSentences(text: string) {
  const normalised = text.replace(/\s+/g, " ").trim();
  if (!normalised) return [];

  const sentences = normalised.match(/[^.!?]+(?:[.!?]+|$)/g) ?? [normalised];
  return sentences.flatMap(splitLongCaption).filter(Boolean);
}

function captionChunks(text: string) {
  const tokens = text.match(/\S+\s*/g) ?? [];
  const chunks: string[] = [];
  for (let i = 0; i < tokens.length; i += 2) {
    chunks.push(tokens.slice(i, i + 2).join(""));
  }
  return chunks.length > 0 ? chunks : [text];
}

function captionStepMs(text: string, mode: Mode) {
  const chunkCount = captionChunks(text).length;
  const desiredDuration = mode === "voice" ? Math.min(4200, Math.max(1200, text.length * 46)) : 760;
  return Math.max(58, Math.min(240, Math.round(desiredDuration / Math.max(1, chunkCount))));
}

function captionHoldMs(text: string, mode: Mode) {
  if (mode === "text") return Math.min(620, Math.max(360, text.length * 10));
  return Math.min(2600, Math.max(950, text.length * 32));
}

function estimatedSpeechMs(text: string) {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.min(22000, Math.max(4200, Math.round((wordCount / 2.35) * 1000 + 2500)));
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/** Imperative handle so the hero orb (in page.tsx) can drive the conversation. */
export type VConversationHandle = {
  /** Tap the orb: start the conversation, focus the email step, or toggle the mic. */
  handleSphereTap: () => void;
};

export const VConversation = forwardRef<
  VConversationHandle,
  {
    /** Drives the hero sphere's WaveState. */
    onStateChange?: (state: WaveState) => void;
    /** Open the quick-form modal fallback. */
    onOpenForm?: () => void;
  }
>(function VConversation({ onStateChange, onOpenForm }, ref) {
  const [started, setStarted] = useState(false);
  const [mode, setMode] = useState<Mode>("voice");
  const [messages, setMessages] = useState<Message[]>([{ role: "v", content: GREETING }]);
  const [captionText, setCaptionText] = useState("");
  const [captionPhase, setCaptionPhase] = useState<CaptionPhase>("idle");
  const [memories, setMemories] = useState<string[]>([]);
  const [input, setInput] = useState("");
  const [askedChips, setAskedChips] = useState<string[]>([]);
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [emailState, setEmailState] = useState<EmailState>("idle");
  const [awaitingEmail, setAwaitingEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [captured, setCaptured] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const speakingRef = useRef(speaking);
  speakingRef.current = speaking;
  const awaitingEmailRef = useRef(awaitingEmail);
  awaitingEmailRef.current = awaitingEmail;
  const capturedRef = useRef(captured);
  capturedRef.current = captured;
  const recognitionRef = useRef<VoiceCaptureController | null>(null);
  const captionTimersRef = useRef<number[]>([]);
  const captionRunRef = useRef(0);
  const captionReleaseRef = useRef<CaptionRelease | null>(null);
  const speechWatchdogRef = useRef<number | null>(null);

  const setWave = useCallback((s: WaveState) => onStateChange?.(s), [onStateChange]);

  // Detect after mount so SSR and first client render match.
  useEffect(() => {
    setSpeechSupported(isVoiceCaptureSupported());
    setTtsSupported("Audio" in window || "speechSynthesis" in window);
  }, []);

  useEffect(() => {
    return () => {
      captionTimersRef.current.forEach((timer) => clearTimeout(timer));
      captionTimersRef.current = [];
      if (speechWatchdogRef.current) clearTimeout(speechWatchdogRef.current);
    };
  }, []);

  const clearCaptionTimers = useCallback(() => {
    captionTimersRef.current.forEach((timer) => clearTimeout(timer));
    captionTimersRef.current = [];
  }, []);

  const clearCaption = useCallback(() => {
    captionRunRef.current += 1;
    captionReleaseRef.current = null;
    clearCaptionTimers();
    setCaptionText("");
    setCaptionPhase("idle");
  }, [clearCaptionTimers]);

  const clearSpeechWatchdog = useCallback(() => {
    if (speechWatchdogRef.current) {
      clearTimeout(speechWatchdogRef.current);
      speechWatchdogRef.current = null;
    }
  }, []);

  const releaseCaption = useCallback(() => {
    const release = captionReleaseRef.current;
    if (!release) {
      clearCaption();
      return;
    }

    release.released = true;
    if (!release.waiting || captionRunRef.current !== release.runId) return;

    clearCaptionTimers();
    setCaptionPhase("exiting");
    const timer = window.setTimeout(() => {
      captionTimersRef.current = captionTimersRef.current.filter((id) => id !== timer);
      if (captionRunRef.current !== release.runId) return;
      captionReleaseRef.current = null;
      setCaptionText("");
      setCaptionPhase("idle");
    }, 320);
    captionTimersRef.current.push(timer);
  }, [clearCaption, clearCaptionTimers]);

  const rollCaption = useCallback((text: string, revealMode: Mode = modeRef.current, opts?: { onDone?: () => void; holdUntilRelease?: boolean }) => {
    clearCaptionTimers();
    const runId = captionRunRef.current + 1;
    captionRunRef.current = runId;
    const onDone = opts?.onDone;
    const holdUntilRelease = opts?.holdUntilRelease ?? false;
    captionReleaseRef.current = holdUntilRelease ? { runId, released: false, waiting: false } : null;

    const segments = captionSentences(text);
    if (segments.length === 0) {
      captionReleaseRef.current = null;
      setCaptionText("");
      setCaptionPhase("idle");
      onDone?.();
      return;
    }

    const schedule = (callback: () => void, delay: number) => {
      const timer = window.setTimeout(() => {
        captionTimersRef.current = captionTimersRef.current.filter((id) => id !== timer);
        callback();
      }, delay);
      captionTimersRef.current.push(timer);
    };

    const finishSequence = () => {
      if (captionRunRef.current !== runId) return;
      const release = captionReleaseRef.current;
      if (holdUntilRelease && release?.runId === runId && !release.released) {
        release.waiting = true;
        setCaptionPhase("holding");
        onDone?.();
        return;
      }
      if (release?.runId === runId) captionReleaseRef.current = null;
      setCaptionText("");
      setCaptionPhase("idle");
      onDone?.();
    };

    if (prefersReducedMotion()) {
      const showReducedSegment = (segmentIndex: number) => {
        if (captionRunRef.current !== runId) return;
        const segment = segments[segmentIndex];
        if (!segment) {
          finishSequence();
          return;
        }

        setCaptionText(segment);
        setCaptionPhase("holding");
        schedule(() => {
          if (segmentIndex + 1 < segments.length) {
            showReducedSegment(segmentIndex + 1);
          } else {
            finishSequence();
          }
        }, captionHoldMs(segment, revealMode));
      };

      showReducedSegment(0);
      return;
    }

    const revealSegment = (segmentIndex: number) => {
      if (captionRunRef.current !== runId) return;
      const segment = segments[segmentIndex];
      if (!segment) {
        finishSequence();
        return;
      }

      const chunks = captionChunks(segment);
      const stepMs = captionStepMs(segment, revealMode);
      let chunkIndex = 0;
      setCaptionText("");
      setCaptionPhase("revealing");

      const tick = () => {
        if (captionRunRef.current !== runId) return;
        chunkIndex += 1;
        setCaptionText(chunks.slice(0, chunkIndex).join(""));

        if (chunkIndex < chunks.length) {
          schedule(tick, stepMs);
          return;
        }

        setCaptionPhase("holding");
        schedule(() => {
          if (captionRunRef.current !== runId) return;
          const isFinalSegment = segmentIndex + 1 >= segments.length;
          const release = captionReleaseRef.current;
          if (isFinalSegment && holdUntilRelease && release?.runId === runId && !release.released) {
            finishSequence();
            return;
          }
          setCaptionPhase("exiting");
          schedule(() => {
            if (captionRunRef.current !== runId) return;
            if (segmentIndex + 1 < segments.length) {
              revealSegment(segmentIndex + 1);
            } else {
              finishSequence();
            }
          }, 230);
        }, captionHoldMs(segment, revealMode));
      };

      schedule(tick, Math.min(95, stepMs));
    };

    revealSegment(0);
  }, [clearCaptionTimers]);

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const startListening = useCallback(() => {
    if (
      modeRef.current !== "voice" ||
      busyRef.current ||
      speakingRef.current ||
      awaitingEmailRef.current ||
      capturedRef.current ||
      recognitionRef.current
    ) {
      return;
    }

    void startVoiceCapture({
      apiUrl: API_URL,
      onStart: () => {
        setListening(true);
        setWave("listening");
      },
      onStop: () => {
        setListening(false);
        recognitionRef.current = null;
      },
      onTranscript: ({ text }) => {
        sendRef.current(text);
      },
      onError: () => {
        setListening(false);
        setWave("rest");
      },
    }).then((controller) => {
      recognitionRef.current = controller;
    });
  }, [setWave]);

  const speak = useCallback(
    (text: string, then?: () => void, purpose: VoicePurpose = "reply") => {
      stopListening();
      if (!ttsSupported) {
        setSpeaking(false);
        rollCaption(text, modeRef.current, { onDone: then });
        return;
      }
      cancelVSpeech();
      setSpeaking(true);
      setWave("speaking");
      let captionStarted = false;
      let speechCompleted = false;
      const startCaption = () => {
        if (captionStarted) return;
        captionStarted = true;
        rollCaption(text, modeRef.current, { holdUntilRelease: true });
      };
      const completeSpeech = () => {
        if (speechCompleted) return;
        speechCompleted = true;
        clearSpeechWatchdog();
        releaseCaption();
        setSpeaking(false);
        then?.();
      };
      startCaption();
      clearSpeechWatchdog();
      speechWatchdogRef.current = window.setTimeout(completeSpeech, estimatedSpeechMs(text));
      void playVSpeech(text, {
        apiUrl: API_URL,
        purpose,
        onStart: startCaption,
        onEnd: completeSpeech,
      });
    },
    [clearSpeechWatchdog, releaseCaption, rollCaption, stopListening, ttsSupported, setWave],
  );

  const runTurn = useCallback(
    async (
      msgs: Message[],
      opts?: {
        contactEmail?: string;
        consent?: boolean;
      },
    ) => {
      setBusy(true);
      setEmailState(opts?.contactEmail ? "sending" : "idle");
      setWave("processing");
      stopListening();
      try {
        const res = await fetch(`${API_URL}/v1/pilot/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: msgs,
            contactEmail: opts?.contactEmail,
            consent: opts?.consent ?? false,
          }),
        });

        if (res.status === 429) {
          const rateData = (await res.json().catch(() => null)) as { retryAfterSeconds?: number } | null;
          const seconds = rateData?.retryAfterSeconds;
          const throttled =
            seconds && seconds > 1
              ? `I'm getting a lot of requests right now — try again in about ${seconds} seconds.`
              : "I'm getting a lot of requests right now — give me a moment and try again.";
          setMessages((prev) => [...prev, { role: "v", content: throttled }]);
          rollCaption(throttled, "text");
          setEmailState(opts?.contactEmail ? "error" : "idle");
          setWave("rest");
          return;
        }

        const data = (await res.json().catch(() => null)) as ChatResponse | null;
        if (!res.ok || !data) throw new Error("bad response");

        const nextMessages = [...msgs, { role: "v" as const, content: data.reply }];
        setMessages(nextMessages);
        setDegraded(Boolean(data.degraded));
        if (data.remembered) setMemories((prev) => [...prev, data.remembered as string]);
        if (data.degraded) onOpenForm?.();

        if (data.captured) {
          setCaptured(true);
          setAwaitingEmail(false);
          setEmailState("idle");
          setWave("confirmed");
          speak(data.reply, () => setWave("confirmed"), "confirmation");
          return;
        }

        if (data.readyForEmail) {
          setAwaitingEmail(true);
          setTimeout(() => document.getElementById("vc-email")?.focus(), 80);
        } else {
          setAwaitingEmail(false);
        }

        const shouldListenAgain = modeRef.current === "voice" && !data.readyForEmail;
        speak(data.reply, () => {
          setWave("rest");
          if (shouldListenAgain) startListening();
        });
      } catch {
        const fallback = "I am unreachable right now - please use the quick form and I will get in touch.";
        setMessages((prev) => [...prev, { role: "v", content: fallback }]);
        rollCaption(fallback, "text");
        setEmailState(opts?.contactEmail ? "error" : "idle");
        setDegraded(true);
        setWave("rest");
        onOpenForm?.();
      } finally {
        setBusy(false);
      }
    },
    [setWave, speak, startListening, stopListening, onOpenForm],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busyRef.current || capturedRef.current) return;
      setInput("");
      setEmailState("idle");
      stopListening();
      const next: Message[] = [...messagesRef.current, { role: "user", content: trimmed }];
      setMessages(next);
      rollCaption("One moment - I'm checking that.", "text");
      void runTurn(next);
    },
    [rollCaption, runTurn, stopListening],
  );

  // Stable ref so speech-recognition callbacks always call the latest send.
  const sendRef = useRef(send);
  sendRef.current = send;

  const start = useCallback(
    (preferVoice: boolean) => {
      const useVoice = preferVoice && speechSupported;
      setMode(useVoice ? "voice" : "text");
      modeRef.current = useVoice ? "voice" : "text";
      setStarted(true);
      setCaptured(false);
      setAwaitingEmail(false);
      setEmailState("idle");
      if (useVoice) {
        speak(GREETING, () => {
          setWave("rest");
          startListening();
        }, "greeting");
      } else {
        speak(GREETING, () => {
          setWave("listening");
          setTimeout(() => document.getElementById("vc-input")?.focus(), 80);
        }, "greeting");
      }
    },
    [speechSupported, speak, startListening, setWave],
  );

  const switchToText = useCallback(() => {
    setMode("text");
    modeRef.current = "text";
    stopListening();
    cancelVSpeech();
    clearSpeechWatchdog();
    clearCaption();
    setSpeaking(false);
    setWave("listening");
    setTimeout(() => document.getElementById("vc-input")?.focus(), 80);
  }, [clearCaption, clearSpeechWatchdog, stopListening, setWave]);

  const switchToVoice = useCallback(() => {
    setMode("voice");
    modeRef.current = "voice";
    setWave("rest");
    startListening();
  }, [startListening, setWave]);

  const endConversation = useCallback(() => {
    stopListening();
    cancelVSpeech();
    clearSpeechWatchdog();
    clearCaption();
    setStarted(false);
    setMode("voice");
    modeRef.current = "voice";
    setMessages([{ role: "v", content: GREETING }]);
    setMemories([]);
    setInput("");
    setAskedChips([]);
    setEmail("");
    setConsent(false);
    setEmailState("idle");
    setAwaitingEmail(false);
    setBusy(false);
    setSpeaking(false);
    setCaptured(false);
    setDegraded(false);
    setWave("rest");
  }, [clearCaption, clearSpeechWatchdog, stopListening, setWave]);

  const toggleMic = useCallback(() => {
    if (speakingRef.current) {
      cancelVSpeech();
      clearSpeechWatchdog();
      setSpeaking(false);
      clearCaption();
      setWave("rest");
      return;
    }
    if (listening) stopListening();
    else startListening();
  }, [clearCaption, clearSpeechWatchdog, listening, startListening, stopListening, setWave]);

  const submitEmail = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = email.trim();
      if (!trimmed || busyRef.current || capturedRef.current) return;
      if (!consent) {
        setEmailState("error");
        return;
      }
      void runTurn(messagesRef.current, { contactEmail: trimmed, consent: true });
    },
    [consent, email, runTurn],
  );

  useImperativeHandle(
    ref,
    () => ({
      handleSphereTap: () => {
        if (!started) {
          start(true);
          return;
        }
        if (awaitingEmailRef.current) {
          document.getElementById("vc-email")?.focus();
          return;
        }
        if (modeRef.current === "voice") toggleMic();
        else document.getElementById("vc-input")?.focus();
      },
    }),
    [started, start, toggleMic],
  );

  if (!started) {
    return (
      <div className="vc-cta">
        <p className="vc-nudge">Tap V to speak</p>
        <p className="vc-cta-sub">Ask V about Viora, or get registered in minutes.</p>
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
  const statusText = captured
    ? "Confirmed"
    : awaitingEmail
      ? "Email needed"
      : busy
        ? "I'm thinking"
        : speaking
          ? "I'm speaking"
          : listening
            ? "Listening"
            : voiceMode
              ? "Tap the orb or mic to talk"
              : "Type to V";

  return (
    <div className="vc">
      <div className="vc-caption" aria-live="polite">
        <p className={captionPhase}>
          {captionText}
          {captionPhase === "revealing" && <span className="vc-caption-caret" aria-hidden="true" />}
        </p>
      </div>

      <div className="vc-voice-status">
        {listening ? (
          <span className="vc-listening">
            <span className="vc-dot" /> {statusText}
          </span>
        ) : (
          <span>{statusText}</span>
        )}
        <VoiceMuteToggle className="vc-mute" size={16} />
      </div>

      {memories.map((m, i) => (
        <div key={`mem-${i}`} className="vc-memory" title="Viora Memory">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
          </svg>
          I will remember: {m}
        </div>
      ))}

      {captured ? (
        <div className="vc-voice-controls centered">
          <button type="button" className="vc-linkbtn muted" onClick={endConversation}>
            Start again
          </button>
        </div>
      ) : awaitingEmail ? (
        <form className="vc-email-capture" onSubmit={submitEmail}>
          <label>
            Email address
            <input
              id="vc-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailState === "error") setEmailState("idle");
              }}
              autoComplete="email"
              placeholder="name@example.com"
              disabled={busy}
              required
            />
          </label>
          <label className="vc-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => {
                setConsent(e.target.checked);
                if (emailState === "error") setEmailState("idle");
              }}
            />
            <span>
              I agree to be contacted about Viora.{" "}
              <a href="/privacy" target="_blank" rel="noreferrer">
                Privacy
              </a>
            </span>
          </label>
          <button type="submit" className="vc-email-submit" disabled={busy || !email.trim()}>
            {emailState === "sending" ? "Sending..." : "Send"}
          </button>
          {emailState === "error" && (
            <p className="submit-note error">Add a valid email and tick consent, then I can register you.</p>
          )}
        </form>
      ) : (
        <>
          <div className="vc-chips" aria-label="Suggested questions">
            {CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                className={askedChips.includes(chip) ? "asked" : undefined}
                onClick={() => {
                  setAskedChips((prev) => (prev.includes(chip) ? prev : [...prev, chip]));
                  send(chip);
                }}
                disabled={busy || speaking}
              >
                {chip}
              </button>
            ))}
          </div>

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
                placeholder="Ask V..."
                disabled={busy}
                aria-label="Message V"
              />
              {speechSupported && (
                <button type="button" className="vc-mic" onClick={switchToVoice} aria-label="Switch to voice">
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
          )}

          {!voiceMode && (
            <div className="vc-text-controls">
              <button type="button" className="vc-linkbtn muted" onClick={endConversation}>
                End
              </button>
            </div>
          )}
        </>
      )}

      {!captured && (
        <div className="vc-foot">
          <button type="button" className={`vc-form-link ${degraded ? "urgent" : ""}`} onClick={() => onOpenForm?.()}>
            Prefer a form?
          </button>
        </div>
      )}
    </div>
  );
});
