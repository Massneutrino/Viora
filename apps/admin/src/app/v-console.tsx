"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PixelSphere, PixelRings, type WaveState } from "@viora/ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200";

type Message = { role: "user" | "v"; content: string };

const SUGGESTIONS = [
  "How many unfilled shifts?",
  "What's the fill rate?",
  "Any compliance docs expiring soon?",
];

const STATE_LABEL: Record<WaveState, string> = {
  rest: "Tap to talk to V",
  listening: "Listening… tap to stop",
  processing: "V is thinking…",
  speaking: "V is responding",
  confirmed: "V is responding",
  risk: "Action needed",
};

export function VConsole() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [wave, setWave] = useState<WaveState>("rest");
  const [listening, setListening] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const speak = useCallback((text: string) => {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = "en-GB";
      synth.speak(utter);
    } catch {
      // speech synthesis is best-effort
    }
  }, []);

  const submit = useCallback(
    async (text: string, fromVoice: boolean) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setInput("");
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setBusy(true);
      setWave("processing");
      try {
        const res = await fetch(`${API_URL}/v1/admin/ops/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: trimmed, adminId: "admin" }),
        });
        const data = (await res.json().catch(() => null)) as { answer?: string } | null;
        const answer =
          res.ok && data && typeof data.answer === "string"
            ? data.answer
            : "V could not answer that — check the API connection on :6200.";
        setWave("speaking");
        setMessages((prev) => [...prev, { role: "v", content: answer }]);
        if (fromVoice) speak(answer);
        setTimeout(() => setWave((w) => (w === "speaking" ? "rest" : w)), 1400);
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "v", content: "V is unreachable — is the API running on :6200?" },
        ]);
        setWave("rest");
      } finally {
        setBusy(false);
      }
    },
    [busy, speak],
  );

  // Tap the sphere to talk; auto-stops on silence, hard 30s safety cap.
  const startListening = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) {
      alert("Voice input needs Chrome or Edge. You can type your question instead.");
      return;
    }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-GB";
    recognitionRef.current = rec;
    const cap = setTimeout(() => {
      try {
        rec.stop();
      } catch {
        /* noop */
      }
    }, 30000);
    rec.onstart = () => {
      setListening(true);
      setWave("listening");
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => submit(e.results[0][0].transcript, true);
    rec.onerror = () => {
      setListening(false);
      setWave("rest");
    };
    rec.onend = () => {
      clearTimeout(cap);
      setListening(false);
      recognitionRef.current = null;
      setWave((w) => (w === "listening" ? "rest" : w));
    };
    rec.start();
  }, [submit]);

  const toggleMic = useCallback(() => {
    if (listening) {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* noop */
      }
    } else {
      startListening();
    }
  }, [listening, startListening]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Voice-first hero — tap the sphere to talk, sonar rings radiating behind it */}
      <div
        style={{
          position: "relative",
          height: 196,
          flexShrink: 0,
          overflow: "hidden",
        }}
      >
        <PixelRings state={wave} centerY={92} innerRadius={62} intensity={0.12} />
        <div
          style={{
            position: "relative",
            zIndex: 1,
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 10,
          }}
        >
          <PixelSphere state={wave} size={104} onTap={toggleMic} ariaLabel="Tap to talk to V" />
          <p
            style={{
              fontSize: "0.875rem",
              fontWeight: 600,
              color: wave === "listening" ? "var(--accent)" : "var(--text)",
              transition: "color 0.3s",
            }}
          >
            {STATE_LABEL[wave]}
          </p>
        </div>
      </div>

      {/* Transcript */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "0.5rem",
        }}
      >
        {messages.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <p style={{ color: "var(--muted)", fontSize: "0.8125rem", textAlign: "center", lineHeight: 1.5 }}>
              Ask V about live ops — fill rate, unfilled shifts, compliance and more.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", justifyContent: "center" }}>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s, false)}
                  disabled={busy}
                  style={{
                    fontSize: "0.75rem",
                    color: "var(--muted)",
                    background: "var(--surface-2)",
                    border: "0.5px solid var(--border)",
                    borderRadius: 18,
                    padding: "0.35rem 0.75rem",
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              style={{
                alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "88%",
                background: msg.role === "user" ? "var(--accent)" : "var(--surface-2)",
                color: msg.role === "user" ? "#fff" : "var(--text)",
                fontSize: "0.875rem",
                lineHeight: 1.5,
                padding: "0.6rem 0.8rem",
                borderRadius: 14,
                borderBottomRightRadius: msg.role === "user" ? 5 : 14,
                borderBottomLeftRadius: msg.role === "user" ? 14 : 5,
                whiteSpace: "pre-wrap",
              }}
            >
              {msg.content}
            </div>
          ))
        )}
        {busy && (
          <div style={{ alignSelf: "flex-start", color: "var(--muted)", fontSize: "0.875rem" }}>
            V is thinking…
          </div>
        )}
      </div>

      {/* Granola-style "Ask anything" pill — typing is the secondary path to the sphere */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input, false);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          marginTop: "0.75rem",
          flexShrink: 0,
          padding: "0.4rem 0.4rem 0.4rem 0.85rem",
          borderRadius: 16,
          border: "0.5px solid var(--border)",
          background: "var(--bg)",
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything…"
          disabled={busy}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: "0.875rem",
            border: "none",
            background: "transparent",
            color: "var(--text)",
            outline: "none",
          }}
        />
        <button
          type="submit"
          aria-label="Ask V"
          disabled={busy || !input.trim()}
          style={{
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "none",
            background: "var(--accent)",
            color: "#fff",
            opacity: busy || !input.trim() ? 0.4 : 1,
            transition: "opacity 0.15s",
          }}
        >
          <svg
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </button>
      </form>
    </div>
  );
}
