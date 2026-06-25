"use client"

import { useState, useEffect, useRef, useCallback, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import {
  AppShell, PixelSphere, SectionCard, SettingRow, EditableField, ChipsField, AccountRow, Avatar,
  type WaveState, type NavItem, type PreviewMode,
} from "@viora/ui"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200"
const DEFAULT_ORG_ID = "demo-org"
const API_FALLBACK_MESSAGE = "V is having trouble connecting to the intake service. I have not created a booking yet - please try again in a moment."

function humanize(s: string): string {
  return s.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

type Message = { role: "employer" | "v"; text: string; ts: string }

type OrgSite = { id: string; name: string; address: string }
type OrgUser = { id: string; name: string; email: string; role: string }
type OrgProfile = {
  id: string
  name: string
  sector: string
  type: string
  timezone: string
  sites: OrgSite[]
  users: OrgUser[]
}
type OrgGuardrail = {
  autonomyLevel?: string
  budgetCeiling?: number | null
  payFloor?: number | null
  maxCommuteMinutes?: number | null
  approvedRoleTypes?: string[]
} | null
type MemoryEntry = {
  id: string
  title: string
  content: string
  kind: string
  visibility: "private" | "operational" | "shared"
  status: "pending_confirmation" | "active" | "archived" | "deleted"
  confidence: number
}

// ── Icons (thin line, inherit colour via currentColor) ──────────────────────────

function Icon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" /></>,
    bookings: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>,
    workers: <><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-5 6-5s6 1.7 6 5" /><path d="M16 6.6a3 3 0 0 1 0 5.4M21 20c0-2.4-1.3-4-3.4-4.6" /></>,
    finance: <><path d="M4 20V11M10 20V5M16 20v-6M21 20H3" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></>,
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

// ── Employer settings ───────────────────────────────────────────────────────────

function SettingsTab({
  orgId, apiUrl, onSwitchAccount, onSignOut,
}: {
  orgId: string
  apiUrl: string
  onSwitchAccount: () => void
  onSignOut: () => void
}) {
  const [org, setOrg] = useState<OrgProfile | null>(null)
  const [guardrail, setGuardrail] = useState<OrgGuardrail>(null)
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiUrl}/v1/organisations/${orgId}`)
      if (res.ok) {
        const data = await res.json()
        setOrg(data.organisation)
        setGuardrail(data.guardrail)
      } else {
        setOrg(null)
      }
      const memoryRes = await fetch(`${apiUrl}/v1/organisations/${orgId}/memory`)
      if (memoryRes.ok) {
        const memoryData = await memoryRes.json()
        setMemories(memoryData.memories ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [orgId, apiUrl])

  useEffect(() => { load() }, [load])

  const patchOrg = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch(`${apiUrl}/v1/organisations/${orgId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    })
    if (!res.ok) { alert("Could not save — please try again."); throw new Error("save failed") }
    const data = await res.json()
    // Org PATCH returns profile fields only — keep the sites/team we already loaded.
    setOrg(prev => (prev ? { ...prev, ...data.organisation } : prev))
  }, [orgId, apiUrl])

  const patchGuardrail = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch(`${apiUrl}/v1/organisations/${orgId}/guardrail`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    })
    if (!res.ok) { alert("Could not save — please try again."); throw new Error("save failed") }
    const data = await res.json()
    setGuardrail(data.guardrail)
  }, [orgId, apiUrl])

  const saveGuardrailNumber = (key: string) => async (next: string) => {
    if (next === "") return patchGuardrail({ [key]: null })
    const n = Number(next)
    if (Number.isNaN(n)) { alert("Please enter a number."); throw new Error("nan") }
    return patchGuardrail({ [key]: n })
  }

  const addMemory = useCallback(async () => {
    const title = window.prompt("Memory title")
    if (!title) return
    const content = window.prompt("What should V remember?")
    if (!content) return
    const res = await fetch(`${apiUrl}/v1/organisations/${orgId}/memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "preference", title, content, visibility: "operational" }),
    })
    if (!res.ok) { alert("Could not save memory."); return }
    const data = await res.json()
    setMemories(prev => [data.memory, ...prev])
  }, [apiUrl, orgId])

  const patchMemory = useCallback(async (memoryId: string, body: Record<string, unknown>) => {
    const res = await fetch(`${apiUrl}/v1/organisations/${orgId}/memory/${memoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) { alert("Could not update memory."); return }
    const data = await res.json()
    setMemories(prev => prev.map(m => m.id === memoryId ? data.memory : m))
  }, [apiUrl, orgId])

  const deleteMemory = useCallback(async (memoryId: string) => {
    if (!window.confirm("Delete this memory?")) return
    const res = await fetch(`${apiUrl}/v1/organisations/${orgId}/memory/${memoryId}`, { method: "DELETE" })
    if (!res.ok) { alert("Could not delete memory."); return }
    setMemories(prev => prev.filter(m => m.id !== memoryId))
  }, [apiUrl, orgId])

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Loading settings…</div>
  }
  if (!org) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Organisation unavailable.</div>
  }

  return (
    <div style={{ padding: "8px 20px 24px", display: "flex", flexDirection: "column", gap: 18, width: "100%", maxWidth: 460, margin: "0 auto" }}>
      <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 16, padding: 16, display: "flex", alignItems: "center", gap: 14 }}>
        <Avatar name={org.name} size={52} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ color: "var(--text)", fontSize: 16, fontWeight: 700, margin: 0 }}>{org.name}</p>
          <p style={{ color: "var(--muted)", fontSize: 12, margin: "2px 0 0" }}>{humanize(org.sector)} · {humanize(org.type)}</p>
        </div>
      </div>

      <SectionCard title="Organisation">
        <EditableField label="Name" value={org.name} onSave={(v) => patchOrg({ name: v })} />
        <EditableField label="Type" value={org.type} format={(v) => humanize(String(v))} onSave={(v) => patchOrg({ type: v })} />
        <EditableField label="Timezone" value={org.timezone} onSave={(v) => patchOrg({ timezone: v })} />
        <SettingRow label="Sector" sublabel="Set by Viora — read only">{humanize(org.sector)}</SettingRow>
      </SectionCard>

      <SectionCard title={`Sites (${org.sites.length})`}>
        {org.sites.length
          ? org.sites.map(s => <SettingRow key={s.id} label={s.name} sublabel={s.address} />)
          : <SettingRow label="No sites yet" />}
      </SectionCard>

      <SectionCard title={`Team (${org.users.length})`}>
        {org.users.length
          ? org.users.map(u => <SettingRow key={u.id} label={u.name} sublabel={`${u.email} · ${humanize(u.role)}`} />)
          : <SettingRow label="No team members yet" />}
      </SectionCard>

      <SectionCard title="Automation guardrails" hint="Limits V respects when booking on your behalf.">
        <EditableField
          label="Autonomy level" value={guardrail?.autonomyLevel ?? "L1"} placeholder="L0–L4"
          onSave={(v) => {
            const lvl = v.toUpperCase()
            if (!/^L[0-4]$/.test(lvl)) { alert("Use L0, L1, L2, L3 or L4."); throw new Error("bad level") }
            return patchGuardrail({ autonomyLevel: lvl })
          }}
        />
        <EditableField label="Budget ceiling" type="number" value={guardrail?.budgetCeiling ?? null} placeholder="No ceiling" format={(v) => `£${v}`} onSave={saveGuardrailNumber("budgetCeiling")} />
        <EditableField label="Pay floor" type="number" value={guardrail?.payFloor ?? null} placeholder="No floor" format={(v) => `£${v}`} onSave={saveGuardrailNumber("payFloor")} />
        <EditableField label="Max commute" type="number" value={guardrail?.maxCommuteMinutes ?? null} suffix="min" placeholder="No limit" onSave={saveGuardrailNumber("maxCommuteMinutes")} />
        <ChipsField label="Approved roles" values={guardrail?.approvedRoleTypes ?? []} format={humanize} placeholder="None" onSave={(v) => patchGuardrail({ approvedRoleTypes: v })} />
      </SectionCard>

      <SectionCard title="What V remembers" hint="Confirmed organisation and site memory V can use for intake, ranking and briefings.">
        {memories.length ? memories.map(memory => (
          <SettingRow
            key={memory.id}
            label={memory.title}
            sublabel={`${memory.content} · ${humanize(memory.kind)} · ${humanize(memory.visibility)} · ${humanize(memory.status)}`}
          >
            <div style={{ display: "flex", gap: 6 }}>
              {memory.status === "pending_confirmation" && (
                <button onClick={() => void patchMemory(memory.id, { status: "active" })} style={{ border: "none", background: "var(--accent)", color: "#fff", borderRadius: 8, padding: "5px 8px", fontSize: 11, cursor: "pointer" }}>Confirm</button>
              )}
              <button onClick={() => {
                const content = window.prompt("Update memory", memory.content)
                if (content) void patchMemory(memory.id, { content })
              }} style={{ border: "none", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>Edit</button>
              <button onClick={() => void deleteMemory(memory.id)} style={{ border: "none", background: "transparent", color: "#b42318", fontSize: 11, cursor: "pointer" }}>Delete</button>
            </div>
          </SettingRow>
        )) : <SettingRow label="No memories yet" sublabel="V will learn from confirmed events and updates." />}
        <SettingRow label="Add memory" sublabel="Create a confirmed operational memory for V.">
          <button onClick={() => void addMemory()} style={{ border: "none", background: "var(--accent)", color: "#fff", borderRadius: 8, padding: "6px 10px", fontSize: 12, cursor: "pointer" }}>Add</button>
        </SettingRow>
      </SectionCard>

      <SectionCard title="Account">
        <AccountRow label="Switch organisation" sublabel={org.name} onClick={onSwitchAccount} />
        <AccountRow label="Sign out" danger onClick={onSignOut} />
      </SectionCard>
    </div>
  )
}

export default function EmployerApp() {
  return (
    <Suspense fallback={null}>
      <EmployerAppInner />
    </Suspense>
  )
}

function EmployerAppInner() {
  const searchParams = useSearchParams()
  const orgId = searchParams.get("orgId") ?? DEFAULT_ORG_ID

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

  useEffect(() => {
    setMessages([])
    setConvId(undefined)
    setWaveState("rest")
  }, [orgId])

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
        body: JSON.stringify({ organisationId: orgId, rawInput: msg, channel: "web", conversationId: convId }),
      })
      const data = await res.json().catch(() => ({}))
      if (data.conversationId) setConvId(data.conversationId)
      const reply = res.ok && typeof data.message === "string" ? data.message : API_FALLBACK_MESSAGE
      setWaveState("speaking")
      setMessages(prev => [...prev, { role: "v", text: reply, ts: now() }])
      const confirmed = /confirm|booked|booking confirmed/i.test(reply)
      setTimeout(() => setWaveState(confirmed ? "confirmed" : "rest"), 1400)
      if (confirmed) setTimeout(() => setWaveState("rest"), 3600)
    } catch {
      setMessages(prev => [...prev, { role: "v", text: API_FALLBACK_MESSAGE, ts: now() }])
      setWaveState("rest")
    } finally {
      setLoading(false)
    }
  }, [convId, loading, orgId])

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
    { id: "settings", label: "Settings", icon: <Icon name="settings" /> },
  ]

  // Interim account actions — the auth agent's switcher/session replaces these.
  const switchAccount = useCallback(() => {
    const next = window.prompt("Switch to organisation id (demo bypass):", orgId)
    if (next && next.trim()) window.location.search = `?orgId=${encodeURIComponent(next.trim())}`
  }, [orgId])

  const signOut = useCallback(() => { window.location.href = "/" }, [])

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
      footer={activeNav === "settings" ? undefined : footer}
    >
      {activeNav === "settings" ? (
        <SettingsTab orgId={orgId} apiUrl={API_URL} onSwitchAccount={switchAccount} onSignOut={signOut} />
      ) : messages.length === 0 ? (
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
