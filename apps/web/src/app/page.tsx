"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { AppShell, PixelSphere, type WaveState, type NavItem, type PreviewMode } from "@viora/ui"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200"
const ORG_ID = "demo-org"

type Message = { role: "employer" | "v"; text: string; ts: string }

// ── Icons (thin line, inherit colour via currentColor) ──────────────────────────

function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /></>,
    bookings: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    workers: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5" /><path d="M16 6.6a3 3 0 0 1 0 5.4M21 20c0-2.4-1.3-4-3.4-4.6" /></>,
    finance: <><path d="M4 20V11M10 20V5M16 20v-6M21 20H3" /></>,
  }
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ flex: 1, background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "12px 14px" }}>
      <p style={{ color: accent ? "var(--accent)" : "var(--text)", fontSize: 19, fontWeight: 600, margin: 0 }}>{value}</p>
      <p style={{ color: "var(--muted)", fontSize: 10, margin: "3px 0 0", textTransform: "uppercase", letterSpacing: "0.07em" }}>{label}</p>
    </div>
  )
}

function Bubble({ msg }: { msg: Message }) {
  const isV = msg.role === "v"
  return (
    <div style={{ display: "flex", flexDirection: isV ? "row" : "row-reverse", gap: 8, alignItems: "flex-end" }}>
      {isV && <div style={{ marginBottom: 2 }}><PixelSphere state="rest" size={26} /></div>}
      <div style={{
        maxWidth: "72%",
        background: isV ? "var(--surface)" : "var(--accent)",
        border: isV ? "0.5px solid var(--border)" : "none",
        borderRadius: isV ? "4px 14px 14px 14px" : "14px 4px 14px 14px",
        padding: "9px 13px",
      }}>
        <p style={{ color: isV ? "var(--text)" : "#fff", fontSize: 13, margin: 0, lineHeight: 1.55 }}>{msg.text}</p>
        <p style={{ color: isV ? "var(--faint)" : "rgba(255,255,255,0.7)", fontSize: 10, margin: "4px 0 0", textAlign: isV ? "left" : "right" }}>{msg.ts}</p>
      </div>
    </div>
  )
}

export default function EmployerApp() {
  const [waveState, setWaveState] = useState<WaveState>("rest")
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [convId, setConvId] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [activeNav, setActiveNav] = useState("home")
  const [preview, setPreview] = useState<PreviewMode>("auto")

  const endRef = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<any>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }) }, [messages])

  const now = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })

  const submit = useCallback(async (text: string) => {
    const msg = text.trim()
    if (!msg || loading) return
    setMessages(prev => [...prev, { role: "employer", text: msg, ts: now() }])
    setInput("")
    setLoading(true)
    setWaveState("processing")
    try {
      const res = await fetch(`${API_URL}/v1/intake/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organisationId: ORG_ID, rawInput: msg, channel: "web", conversationId: convId }),
      })
      const data = await res.json()
      if (data.conversationId) setConvId(data.conversationId)
      const reply = data.message ?? data.error ?? "Something went wrong."
      setWaveState("speaking")
      setMessages(prev => [...prev, { role: "v", text: reply, ts: now() }])
      const confirmed = /confirm|booked|booking confirmed/i.test(reply)
      setTimeout(() => setWaveState(confirmed ? "confirmed" : "rest"), 1400)
      if (confirmed) setTimeout(() => setWaveState("rest"), 3600)
    } catch {
      setMessages(prev => [...prev, { role: "v", text: "Connection issue — please try again.", ts: now() }])
      setWaveState("rest")
    } finally {
      setLoading(false)
    }
  }, [convId, loading])

  // Tap the sphere to talk; auto-stops on silence, hard 30s safety cap.
  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
    if (!SR) { alert("Voice input requires Chrome or Edge. You can type instead."); return }
    const rec = new SR()
    rec.continuous = false
    rec.interimResults = false
    rec.lang = "en-GB"
    recognitionRef.current = rec
    const cap = setTimeout(() => { try { rec.stop() } catch {} }, 30000)
    rec.onstart = () => { setIsListening(true); setWaveState("listening") }
    rec.onresult = (e: any) => submit(e.results[0][0].transcript)
    rec.onerror = () => { setIsListening(false); setWaveState("rest") }
    rec.onend = () => {
      clearTimeout(cap)
      setIsListening(false)
      recognitionRef.current = null
      setWaveState(s => (s === "listening" ? "rest" : s))
    }
    rec.start()
  }, [submit])

  const toggleMic = useCallback(() => {
    if (isListening) { try { recognitionRef.current?.stop() } catch {} }
    else startListening()
  }, [isListening, startListening])

  const stateLabel: Record<WaveState, string> = {
    rest: "Tell V what you need",
    listening: "Listening… tap to stop",
    processing: "V is working on it…",
    speaking: "V is responding",
    confirmed: "Booking confirmed",
    risk: "Action needed",
  }

  const navItems: NavItem[] = [
    { id: "home", label: "Home", icon: <Icon name="home" /> },
    { id: "bookings", label: "Bookings", icon: <Icon name="bookings" /> },
    { id: "workers", label: "Workers", icon: <Icon name="workers" /> },
    { id: "finance", label: "Finance", icon: <Icon name="finance" /> },
  ]

  const footer = (
    <div style={{ padding: "12px 16px 16px", display: "flex", gap: 10, alignItems: "center" }}>
      {messages.length > 0 && (
        <button onClick={() => { setMessages([]); setConvId(undefined); setWaveState("rest") }} style={{ background: "transparent", border: "0.5px solid var(--border)", color: "var(--muted)", borderRadius: 10, padding: "9px 11px", fontSize: 12, flexShrink: 0 }}>New</button>
      )}
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: "var(--bg)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "0 6px 0 14px" }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(input) } }}
          placeholder={isListening ? "Listening…" : "or type to V…"}
          disabled={loading || isListening}
          style={{ flex: 1, background: "transparent", border: "none", padding: "11px 0", color: "var(--text)", fontSize: 13, outline: "none", fontFamily: "inherit" }}
        />
        <button onClick={() => submit(input)} disabled={!input.trim() || loading} aria-label="Send" style={{
          width: 30, height: 30, borderRadius: "50%", border: "none", flexShrink: 0,
          background: input.trim() ? "var(--accent)" : "var(--surface-2)",
          color: input.trim() ? "#fff" : "var(--faint)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      </div>
    </div>
  )

  return (
    <AppShell
      navItems={navItems}
      activeNav={activeNav}
      onNavChange={setActiveNav}
      sphereState={waveState}
      onSphereTap={toggleMic}
      statusLabel={stateLabel[waveState]}
      statusSublabel={waveState === "rest" ? "Tap the sphere to speak · or type below" : undefined}
      preview={preview}
      onPreviewChange={setPreview}
      footer={footer}
    >
      {messages.length === 0 ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, padding: "0 20px" }}>
          <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 14, padding: "14px 16px", width: "100%", maxWidth: 440 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ color: "var(--muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.07em" }}>Last booking</span>
              <span style={{ color: "var(--success)", fontSize: 11 }}>✓ Confirmed 7:53am</span>
            </div>
            <p style={{ color: "var(--text)", fontSize: 15, fontWeight: 600, margin: "0 0 2px" }}>KS2 Supply — Year 5</p>
            <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>Greenfield Primary · 8:15–3:30 · £150/day · Saved £45 vs agency</p>
          </div>
          <div style={{ display: "flex", gap: 10, width: "100%", maxWidth: 440 }}>
            <StatCard label="Fill rate" value="94%" accent />
            <StatCard label="Active" value="3" />
            <StatCard label="Open" value="1" />
            <StatCard label="Term spend" value="£12.4k" />
          </div>
        </div>
      ) : (
        <div style={{ padding: "4px 20px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
          {messages.map((m, i) => <Bubble key={i} msg={m} />)}
          {loading && (
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <PixelSphere state="processing" size={26} />
              <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: "4px 14px 14px 14px", padding: "9px 13px" }}>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>V is thinking…</span>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      )}
    </AppShell>
  )
}
