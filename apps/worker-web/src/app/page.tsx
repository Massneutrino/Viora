"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { AppShell, type WaveState, type NavItem, type PreviewMode } from "@viora/ui"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200"
const WORKER_ID = "demo-worker"

type Offer = {
  id: string
  role: string
  site: string
  payPerDay: number
  travelMinutes?: number
  fitReason?: string
  shiftDate?: string
  shiftStart?: string
  shiftEnd?: string
  hasBriefing?: boolean
}

type PassportDoc = {
  id: string
  documentType: string
  fileName?: string
  status: string
  createdAt: string
  downloadUrl?: string | null
}

type PassportSummary = {
  identityVerified: boolean
  dbsStatus: string
  rightToWorkStatus: string
  safeguardingStatus: string
  qtsStatus?: string | null
  siaStatus?: string | null
  reliabilityScore?: number | null
}

const DOC_LABELS: Record<string, string> = {
  enhanced_dbs: "DBS Certificate",
  right_to_work: "Right to Work",
  safeguarding: "Safeguarding",
  identity: "Identity",
  qts: "QTS",
  sia: "SIA Licence",
  cv: "CV",
  reference_letter: "Reference",
}

const STATUS_STYLE: Record<string, { bg: string; border: string; color: string }> = {
  verified: { bg: "rgba(31,157,87,0.12)", border: "rgba(31,157,87,0.3)", color: "#1f9d57" },
  pending: { bg: "rgba(232,146,12,0.12)", border: "rgba(232,146,12,0.3)", color: "#b9740a" },
  expired: { bg: "rgba(226,87,74,0.12)", border: "rgba(226,87,74,0.3)", color: "#d23b2b" },
  rejected: { bg: "rgba(226,87,74,0.12)", border: "rgba(226,87,74,0.3)", color: "#d23b2b" },
  missing: { bg: "rgba(138,143,152,0.12)", border: "rgba(138,143,152,0.3)", color: "#8a8f98" },
  active: { bg: "rgba(31,77,255,0.12)", border: "rgba(31,77,255,0.3)", color: "#1f4dff" },
  incomplete: { bg: "rgba(232,146,12,0.12)", border: "rgba(232,146,12,0.3)", color: "#b9740a" },
}

const UPLOAD_TYPES = [
  { type: "enhanced_dbs", label: "DBS" },
  { type: "right_to_work", label: "Right to Work" },
  { type: "safeguarding", label: "Safeguarding" },
  { type: "identity", label: "Identity" },
  { type: "cv", label: "CV" },
  { type: "reference_letter", label: "Reference" },
  { type: "qts", label: "QTS" },
]

// ── Icons (currentColor) ────────────────────────────────────────────────────────

function NavIcon({ name }: { name: string }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
  if (name === "deck") return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></svg>
  if (name === "earnings") return <svg {...common}><path d="M16 7c-.7-1.2-2-2-3.5-2C10 5 8.5 6.8 8.5 9c0 4 .5 4 .5 6H7M7 12h6" /></svg>
  if (name === "passport") return <svg {...common}><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /></svg>
  return <svg {...common}><circle cx="12" cy="8" r="3.2" /><path d="M5 20c0-3.5 3-5.5 7-5.5s7 2 7 5.5" /></svg>
}

// ── Countdown ─────────────────────────────────────────────────────────────────

function Countdown({ seconds }: { seconds: number }) {
  const [remaining, setRemaining] = useState(seconds)
  useEffect(() => {
    if (remaining <= 0) return
    const t = setInterval(() => setRemaining(r => Math.max(0, r - 1)), 1000)
    return () => clearInterval(t)
  }, [])
  const mins = Math.floor(remaining / 60)
  const secs = remaining % 60
  const label = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  const urgent = remaining < 120
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: urgent ? "var(--error)" : "var(--warning)", display: "inline-block" }} />
      <span style={{ color: urgent ? "var(--error)" : "var(--warning)", fontSize: 12, fontWeight: 600 }}>
        {remaining === 0 ? "Offer expired" : `Offer expires in ${label}`}
      </span>
    </div>
  )
}

// ── Passport tab ─────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.missing
  return (
    <span style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.color, fontSize: 10, padding: "2px 8px", borderRadius: 20, fontWeight: 600 }}>{status}</span>
  )
}

function PassportTab({ workerId, apiUrl }: { workerId: string; apiUrl: string }) {
  const [docs, setDocs] = useState<PassportDoc[]>([])
  const [passport, setPassport] = useState<PassportSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploadingType, setUploadingType] = useState<string | null>(null)
  const [pendingType, setPendingType] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/v1/workers/${workerId}/compliance/documents`)
      if (res.ok) {
        const data = await res.json()
        setDocs(data.documents ?? [])
        setPassport(data.passport ?? null)
      }
    } finally {
      setLoading(false)
    }
  }, [workerId, apiUrl])

  useEffect(() => { load() }, [load])

  const pickFile = (docType: string) => { setPendingType(docType); fileRef.current?.click() }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !pendingType) return
    e.target.value = ""
    setUploadingType(pendingType)
    try {
      const fileData = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve((reader.result as string).split(",")[1])
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const res = await fetch(`${apiUrl}/v1/workers/${workerId}/compliance/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentType: pendingType, fileName: file.name, contentType: file.type || "application/octet-stream", fileData }),
      })
      if (res.ok) await load()
      else alert("Upload failed.")
    } catch {
      alert("Upload failed.")
    } finally {
      setUploadingType(null)
      setPendingType(null)
    }
  }

  const passportStatus: Record<string, string> = passport
    ? {
        enhanced_dbs: passport.dbsStatus,
        right_to_work: passport.rightToWorkStatus,
        safeguarding: passport.safeguardingStatus,
        identity: passport.identityVerified ? "verified" : "pending",
        qts: passport.qtsStatus ?? "missing",
        sia: passport.siaStatus ?? "missing",
      }
    : {}

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Loading passport…</div>
  }

  return (
    <div style={{ padding: "8px 20px 20px", display: "flex", flexDirection: "column", gap: 18, width: "100%", maxWidth: 460, margin: "0 auto" }}>
      <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" style={{ display: "none" }} onChange={handleFileChange} />

      <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 16, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <p style={{ color: "var(--muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 2px" }}>Reliability score</p>
          <p style={{ color: "var(--text)", fontSize: 26, fontWeight: 700, margin: 0 }}>
            {passport?.reliabilityScore?.toFixed(1) ?? "—"}
            <span style={{ color: "var(--muted)", fontSize: 13, fontWeight: 400, marginLeft: 3 }}>/ 5.0</span>
          </p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ color: "var(--muted)", fontSize: 10, margin: "0 0 4px" }}>Passport status</p>
          <StatusChip status={docs.length > 0 ? "active" : "incomplete"} />
        </div>
      </div>

      <div>
        <p style={{ color: "var(--muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 10px" }}>Compliance status</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[
            { type: "enhanced_dbs", label: "DBS" },
            { type: "right_to_work", label: "Right to Work" },
            { type: "safeguarding", label: "Safeguarding" },
            { type: "identity", label: "Identity" },
            { type: "qts", label: "QTS" },
          ].map(({ type, label }) => {
            const status = passportStatus[type] ?? "missing"
            const s = STATUS_STYLE[status] ?? STATUS_STYLE.missing
            return (
              <div key={type} style={{ background: "var(--surface)", border: `0.5px solid ${status === "verified" ? "rgba(31,157,87,0.3)" : "var(--border)"}`, borderRadius: 12, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ color: "var(--muted)", fontSize: 10 }}>{label}</span>
                <span style={{ color: s.color, fontSize: 11, fontWeight: 600 }}>{status}</span>
              </div>
            )
          })}
        </div>
      </div>

      {docs.length > 0 && (
        <div>
          <p style={{ color: "var(--muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 10px" }}>Uploaded documents</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {docs.map(doc => (
              <div key={doc.id} style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "10px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ color: "var(--text)", fontSize: 12, fontWeight: 600, margin: "0 0 2px" }}>{DOC_LABELS[doc.documentType] ?? doc.documentType.replace(/_/g, " ")}</p>
                  {doc.fileName && <p style={{ color: "var(--faint)", fontSize: 10, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.fileName}</p>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <StatusChip status={doc.status} />
                  {doc.downloadUrl && <a href={`${apiUrl}${doc.downloadUrl}`} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", fontSize: 11, textDecoration: "none" }}>↗</a>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p style={{ color: "var(--muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 10px" }}>Upload document</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {UPLOAD_TYPES.map(({ type, label }) => {
            const isUploading = uploadingType === type
            return (
              <button key={type} onClick={() => pickFile(type)} disabled={!!uploadingType} style={{
                background: isUploading ? "rgba(31,77,255,0.1)" : "var(--surface)",
                border: `0.5px solid ${isUploading ? "rgba(31,77,255,0.4)" : "var(--border)"}`,
                color: isUploading ? "var(--accent)" : "var(--muted)",
                fontSize: 11, padding: "6px 12px", borderRadius: 20,
                opacity: uploadingType && !isUploading ? 0.5 : 1, transition: "all 0.15s",
              }}>
                {isUploading ? "Uploading…" : `+ ${label}`}
              </button>
            )
          })}
        </div>
        <p style={{ color: "var(--faint)", fontSize: 10, margin: "8px 0 0" }}>Accepted: PDF, JPG, PNG, DOC, DOCX · Max 10 MB</p>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WorkerApp() {
  const [offer, setOffer] = useState<Offer | null>(null)
  const [loading, setLoading] = useState(false)
  const [acting, setActing] = useState(false)
  const [message, setMessage] = useState("")
  const [activeTab, setActiveTab] = useState("deck")
  const [waveState, setWaveState] = useState<WaveState>("rest")
  const [preview, setPreview] = useState<PreviewMode>("auto")
  const recognitionRef = useRef<any>(null)

  const fetchOffer = useCallback(async () => {
    setLoading(true)
    setMessage("")
    try {
      const res = await fetch(`${API_URL}/v1/workers/${WORKER_ID}/offer`)
      const data = await res.json()
      setOffer(data.offer ?? null)
    } catch {
      setMessage("Could not load offer — check API connection.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchOffer() }, [fetchOffer])

  const act = useCallback(async (action: "accept" | "decline") => {
    if (!offer) return
    setActing(true)
    try {
      await fetch(`${API_URL}/v1/workers/${WORKER_ID}/offers/${offer.id}/${action}`, { method: "POST" })
      setMessage(action === "accept" ? "Shift accepted! Pre-shift briefing on the way." : "Passed — finding your next match…")
      setOffer(null)
      if (action === "decline") setTimeout(fetchOffer, 1200)
    } catch {
      setMessage("Something went wrong — please try again.")
    } finally {
      setActing(false)
    }
  }, [offer, fetchOffer])

  // Tap the sphere to talk to V; auto-stops on silence, 30s cap.
  const startListening = useCallback(() => {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition
    if (!SR) { alert("Voice input requires Chrome or Edge."); return }
    const rec = new SR()
    rec.continuous = false
    rec.interimResults = false
    rec.lang = "en-GB"
    recognitionRef.current = rec
    const cap = setTimeout(() => { try { rec.stop() } catch {} }, 30000)
    rec.onstart = () => setWaveState("listening")
    rec.onresult = () => { setWaveState("speaking"); setTimeout(() => setWaveState("rest"), 1800) }
    rec.onerror = () => setWaveState("rest")
    rec.onend = () => { clearTimeout(cap); recognitionRef.current = null; setWaveState(s => (s === "listening" ? "rest" : s)) }
    rec.start()
  }, [])

  const toggleMic = useCallback(() => {
    if (waveState === "listening") { try { recognitionRef.current?.stop() } catch {} }
    else startListening()
  }, [waveState, startListening])

  const navItems: NavItem[] = [
    { id: "deck", label: "Shifts", icon: <NavIcon name="deck" /> },
    { id: "earnings", label: "Earnings", icon: <NavIcon name="earnings" /> },
    { id: "passport", label: "Passport", icon: <NavIcon name="passport" /> },
    { id: "profile", label: "Profile", icon: <NavIcon name="profile" /> },
  ]

  const statusLabel =
    waveState === "listening" ? "Listening… tap to stop" :
    waveState === "speaking" ? "V is responding…" : "Tap to talk to V"

  const footer = activeTab === "deck" && offer ? (
    <div style={{ padding: "12px 20px 16px", display: "flex", gap: 12, width: "100%", maxWidth: 460, margin: "0 auto" }}>
      <button onClick={() => act("decline")} disabled={acting} style={{ flex: 1, background: "var(--surface)", border: "0.5px solid var(--border-strong)", color: "var(--muted)", borderRadius: 16, padding: 15, fontSize: 14, fontWeight: 600 }}>✕ Pass</button>
      <button onClick={() => act("accept")} disabled={acting} style={{ flex: 1, background: "var(--accent)", border: "none", color: "#fff", borderRadius: 16, padding: 15, fontSize: 14, fontWeight: 700 }}>{acting ? "…" : "Accept →"}</button>
    </div>
  ) : undefined

  return (
    <AppShell
      navItems={navItems}
      activeNav={activeTab}
      onNavChange={setActiveTab}
      sphereState={waveState}
      onSphereTap={toggleMic}
      statusLabel={statusLabel}
      statusSublabel={waveState === "rest" ? "Ask V about shifts, pay or your passport" : undefined}
      preview={preview}
      onPreviewChange={setPreview}
      footer={footer}
    >
      {activeTab === "deck" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "4px 20px 12px", width: "100%", maxWidth: 460, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 8 }}>
            <span style={{ color: offer ? "var(--success)" : message ? "var(--warning)" : "var(--muted)", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              {offer ? "V found you a match" : loading ? "V is searching…" : message || "No active offer"}
            </span>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 14 }}>
            {offer ? (
              <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 22, padding: 20, boxShadow: "0 10px 40px rgba(28,30,34,0.06)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                  <div>
                    <p style={{ color: "var(--muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 3px" }}>{offer.role}</p>
                    <p style={{ color: "var(--text)", fontSize: 18, fontWeight: 700, margin: "0 0 2px" }}>{offer.site}</p>
                    {offer.shiftDate && (
                      <p style={{ color: "var(--faint)", fontSize: 11, margin: 0 }}>
                        {offer.shiftDate}{offer.shiftStart && ` · ${offer.shiftStart}–${offer.shiftEnd}`}
                      </p>
                    )}
                  </div>
                  <div style={{ background: "rgba(31,157,87,0.1)", border: "1px solid rgba(31,157,87,0.25)", borderRadius: 10, padding: "7px 11px", textAlign: "center" }}>
                    <p style={{ color: "var(--success)", fontSize: 18, fontWeight: 700, margin: 0 }}>£{offer.payPerDay}</p>
                    <p style={{ color: "#1f9d57", fontSize: 9, margin: "1px 0 0" }}>/day</p>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 7, marginBottom: 13, flexWrap: "wrap" }}>
                  {offer.travelMinutes != null && (
                    <span style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", color: "var(--muted)", fontSize: 10, padding: "3px 9px", borderRadius: 20 }}>📍 {offer.travelMinutes} min</span>
                  )}
                  <span style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", color: "var(--muted)", fontSize: 10, padding: "3px 9px", borderRadius: 20 }}>★ 4.8 school</span>
                  {offer.hasBriefing && (
                    <span style={{ background: "rgba(31,77,255,0.1)", border: "1px solid rgba(31,77,255,0.25)", color: "#1a3fd0", fontSize: 10, padding: "3px 9px", borderRadius: 20 }}>📚 Briefing ready</span>
                  )}
                </div>

                {offer.fitReason && (
                  <div style={{ background: "rgba(31,77,255,0.06)", border: "1px solid rgba(31,77,255,0.18)", borderRadius: 11, padding: "10px 12px", marginBottom: 14 }}>
                    <p style={{ color: "var(--muted)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 3px" }}>Why V chose this</p>
                    <p style={{ color: "#1a3fd0", fontSize: 12, lineHeight: 1.5, margin: 0 }}>{offer.fitReason}</p>
                  </div>
                )}

                <Countdown seconds={8 * 60} />
              </div>
            ) : (
              <div style={{ textAlign: "center" }}>
                {message && !loading && <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>{message}</p>}
                <button onClick={fetchOffer} disabled={loading} style={{ background: loading ? "var(--surface-2)" : "var(--accent)", border: "none", color: loading ? "var(--muted)" : "#fff", borderRadius: 16, padding: "14px 28px", fontSize: 14, fontWeight: 600 }}>
                  {loading ? "V is searching…" : "Load next shift"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "passport" && <PassportTab workerId={WORKER_ID} apiUrl={API_URL} />}

      {activeTab !== "deck" && activeTab !== "passport" && (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <p style={{ color: "var(--muted)", fontSize: 13 }}>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} — coming soon</p>
        </div>
      )}
    </AppShell>
  )
}
