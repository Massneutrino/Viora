"use client"

import { useState, useEffect, useRef, useCallback, useMemo, Suspense, type CSSProperties, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import {
  AppShell, SectionCard, SettingRow, EditableField, ChipsField, ToggleRow, AccountRow, Avatar,
  cancelVSpeech, playVSpeech, startVoiceCapture, type VoiceCaptureController, type VoicePurpose, type WaveState, type NavItem, type PreviewMode,
  WeekStrip, WeekNav, AgendaList, HourTimeline, ScheduleEventCard, SegmentedToggle, Sheet, type WeekStripDay,
  dayKey, dayRange, startOfWeekMonday, addWeeks, addDaysUtc, weekRangeFromAnchor,
  formatWeekdayShort, formatDayNumber, formatWeekRangeLabel, formatEventTimeRange, formatEventDayLabel,
  zonedIso, DEFAULT_TZ,
} from "@viora/ui"
import type { ScheduleResponse, ScheduleEvent } from "@viora/domain"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200"
const DEFAULT_WORKER_ID = "demo-worker"

function humanizeRole(s: string): string {
  return s.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

function formatGbp(value?: number | null): string {
  return `£${Number(value ?? 0).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`
}

function formatDate(value?: string | null): string {
  if (!value) return "Date TBC"
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "2-digit", month: "short" }).format(new Date(value))
}

function formatTime(value?: string | null): string {
  if (!value) return ""
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(new Date(value))
}

type WorkerProfile = {
  id: string
  firstName: string
  lastName: string
  email: string
  phone?: string | null
  homeAddress?: string | null
  homeCity?: string | null
  homePostcode?: string | null
  homeLatitude?: number | null
  homeLongitude?: number | null
  workRadiusKm?: number | null
  roleTypes: string[]
  reliabilityScore?: number | null
}

type WorkerGuardrail = {
  autonomyLevel?: string
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
  useScopes: string[]
  sensitivity: "standard" | "sensitive"
  sourceLabel?: string | null
  connectorType?: string | null
  connectorRef?: string | null
  value?: unknown
  expiresAt?: string | null
  updatedAt?: string
  confidence: number
}

type Offer = {
  id: string
  role: string
  site: string
  siteAddress?: string
  payPerDay: number
  rateMode?: "standard" | "dynamic"
  rateExplanation?: string
  travelMinutes?: number
  fitReason?: string
  shiftDate?: string
  shiftStart?: string
  shiftEnd?: string
  hasBriefing?: boolean
  memoryReasons?: Array<{
    id: string
    type: "memory" | "edge"
    title: string
    detail: string
    kind: string
    visibility: string
    sourceLabel?: string | null
  }>
}

type WorkerVoicePendingAction = {
  type: "accept_offer" | "decline_offer"
  offerId: string
}

type WorkerShiftData = {
  offers: Array<{
    id: string
    status: string
    roleType: string
    organisationName: string
    siteName: string
    siteAddress: string
    startAt: string
    endAt: string
    payRate: number
  }>
  bookings: Array<{
    id: string
    status: string
    roleType: string
    organisationName: string
    siteName: string
    siteAddress: string
    startAt: string
    endAt: string
    payRate: number
    timesheet?: { approved: boolean; hoursWorked: number } | null
  }>
}

type EarningsData = {
  summary: { approvedTotal: number; pendingTotal: number; approvedCount: number; pendingCount: number }
  timesheets: Array<{
    id: string
    approved: boolean
    hoursWorked: number
    payRate: number
    workerTotal: number
    roleType: string
    organisationName: string
    siteName: string
    startAt: string
  }>
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

function memoryMeta(memory: MemoryEntry): string {
  const valueType = memory.value && typeof memory.value === "object" && "valueType" in memory.value
    ? String((memory.value as { valueType?: unknown }).valueType)
    : null
  return [
    memory.visibility,
    memory.status,
    `${Math.round((memory.confidence ?? 0) * 100)}%`,
    (memory.useScopes ?? []).map(humanizeRole).join(", "),
    memory.sensitivity ?? "standard",
    memory.sourceLabel,
    memory.connectorType ? humanizeRole(memory.connectorType) : null,
    valueType ? humanizeRole(valueType) : null,
    memory.expiresAt ? `expires ${formatDate(memory.expiresAt)}` : null,
  ].filter(Boolean).join(" - ")
}

// ── Icons (currentColor) ────────────────────────────────────────────────────────

function NavIcon({ name }: { name: string }) {
  const common = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }
  if (name === "deck") return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></svg>
  if (name === "earnings") return <svg {...common}><path d="M16 7c-.7-1.2-2-2-3.5-2C10 5 8.5 6.8 8.5 9c0 4 .5 4 .5 6H7M7 12h6" /></svg>
  if (name === "passport") return <svg {...common}><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /></svg>
  if (name === "schedule") return <svg {...common}><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /></svg>
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

// ── Profile / account hub ──────────────────────────────────────────────────────

function ProfileTab({
  workerId, apiUrl, onOpenPassport, onSwitchAccount, onSignOut,
}: {
  workerId: string
  apiUrl: string
  onOpenPassport: () => void
  onSwitchAccount: () => void
  onSignOut: () => void
}) {
  const [profile, setProfile] = useState<WorkerProfile | null>(null)
  const [guardrail, setGuardrail] = useState<WorkerGuardrail>(null)
  const [memories, setMemories] = useState<MemoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [shiftAlerts, setShiftAlerts] = useState(true)
  const [sounds, setSounds] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${apiUrl}/v1/workers/${workerId}`)
      if (res.ok) {
        const data = await res.json()
        setProfile(data.worker)
        setGuardrail(data.guardrail)
      } else {
        setProfile(null)
      }
      const memoryRes = await fetch(`${apiUrl}/v1/workers/${workerId}/memory`)
      if (memoryRes.ok) {
        const memoryData = await memoryRes.json()
        setMemories(memoryData.memories ?? [])
      }
    } finally {
      setLoading(false)
    }
  }, [workerId, apiUrl])

  useEffect(() => { load() }, [load])

  // Single PATCH endpoint persists both Worker fields and the worker guardrail.
  const patch = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch(`${apiUrl}/v1/workers/${workerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) { alert("Could not save — please try again."); throw new Error("save failed") }
    const data = await res.json()
    setProfile(data.worker)
    setGuardrail(data.guardrail)
  }, [workerId, apiUrl])

  const saveNumber = (key: string) => async (next: string) => {
    if (next === "") return patch({ [key]: null })
    const n = Number(next)
    if (Number.isNaN(n)) { alert("Please enter a number."); throw new Error("nan") }
    return patch({ [key]: n })
  }

  const addMemory = useCallback(async () => {
    const title = window.prompt("Memory title")
    if (!title) return
    const content = window.prompt("What should V remember?")
    if (!content) return
    const res = await fetch(`${apiUrl}/v1/workers/${workerId}/memory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "preference", title, content, visibility: "private" }),
    })
    if (!res.ok) { alert("Could not save memory."); return }
    const data = await res.json()
    setMemories(prev => [data.memory, ...prev])
  }, [apiUrl, workerId])

  const patchMemory = useCallback(async (memoryId: string, body: Record<string, unknown>) => {
    const res = await fetch(`${apiUrl}/v1/workers/${workerId}/memory/${memoryId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) { alert("Could not update memory."); return }
    const data = await res.json()
    setMemories(prev => prev.map(m => m.id === memoryId ? data.memory : m))
  }, [apiUrl, workerId])

  const deleteMemory = useCallback(async (memoryId: string) => {
    if (!window.confirm("Delete this memory?")) return
    const res = await fetch(`${apiUrl}/v1/workers/${workerId}/memory/${memoryId}`, { method: "DELETE" })
    if (!res.ok) { alert("Could not delete memory."); return }
    setMemories(prev => prev.filter(m => m.id !== memoryId))
  }, [apiUrl, workerId])

  if (loading) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Loading profile…</div>
  }
  if (!profile) {
    return <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Profile unavailable.</div>
  }

  const name = `${profile.firstName} ${profile.lastName}`.trim()

  return (
    <div style={{ padding: "8px 20px 24px", display: "flex", flexDirection: "column", gap: 18, width: "100%", maxWidth: 460, margin: "0 auto" }}>
      <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 16, padding: 16, display: "flex", alignItems: "center", gap: 14 }}>
        <Avatar name={name} size={52} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ color: "var(--text)", fontSize: 16, fontWeight: 700, margin: 0 }}>{name}</p>
          <p style={{ color: "var(--muted)", fontSize: 12, margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile.email}</p>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <p style={{ color: "var(--accent)", fontSize: 18, fontWeight: 700, margin: 0 }}>★ {profile.reliabilityScore?.toFixed(1) ?? "—"}</p>
          <p style={{ color: "var(--faint)", fontSize: 9, margin: 0, textTransform: "uppercase", letterSpacing: "0.06em" }}>reliability</p>
        </div>
      </div>

      <SectionCard title="Personal details">
        <EditableField label="Phone" value={profile.phone} placeholder="Add a phone number" onSave={(v) => patch({ phone: v === "" ? null : v })} />
        <EditableField label="Street address" value={profile.homeAddress} placeholder="Add a street address" onSave={(v) => patch({ homeAddress: v === "" ? null : v })} />
        <EditableField label="City" value={profile.homeCity} placeholder="Add a city" onSave={(v) => patch({ homeCity: v === "" ? null : v })} />
        <EditableField label="Postcode" value={profile.homePostcode} placeholder="Add a postcode" onSave={(v) => patch({ homePostcode: v === "" ? null : v })} />
        <EditableField label="Work radius" type="number" value={profile.workRadiusKm} suffix="km" placeholder="Set radius" onSave={saveNumber("workRadiusKm")} />
      </SectionCard>

      <SectionCard title="Work preferences" hint="What V uses to match you to shifts.">
        <ChipsField label="Roles you cover" values={profile.roleTypes} format={humanizeRole} placeholder="No roles yet" onSave={(v) => patch({ roleTypes: v })} />
        <EditableField label="Minimum day rate" type="number" value={guardrail?.payFloor ?? null} placeholder="No floor set" format={(v) => `£${v}`} onSave={saveNumber("payFloor")} />
        <EditableField label="Max commute" type="number" value={guardrail?.maxCommuteMinutes ?? null} suffix="min" placeholder="No limit" onSave={saveNumber("maxCommuteMinutes")} />
      </SectionCard>

      <SectionCard title="What V remembers about me" hint="Private memories stay worker-side; operational memories can shape matching.">
        {memories.length ? memories.map(memory => (
          <div key={memory.id} style={{ padding: "13px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div>
              <p style={{ color: "var(--text)", fontSize: 13, fontWeight: 600, margin: 0 }}>{memory.title}</p>
              <p style={{ color: "var(--muted)", fontSize: 11, margin: "2px 0 0", lineHeight: 1.4 }}>{memory.content}</p>
              <p style={{ color: memory.visibility === "private" ? "var(--accent)" : "var(--faint)", fontSize: 10, margin: "5px 0 0", textTransform: "uppercase", letterSpacing: "0.06em" }}>{memoryMeta(memory)}</p>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {memory.status === "pending_confirmation" && (
                <button onClick={() => void patchMemory(memory.id, { status: "active" })} style={{ border: "none", background: "var(--accent)", color: "#fff", borderRadius: 8, padding: "5px 8px", fontSize: 11, cursor: "pointer" }}>Confirm</button>
              )}
              {memory.status !== "archived" && memory.status !== "deleted" && (
                <button onClick={() => void patchMemory(memory.id, { status: "archived" })} style={{ border: "0.5px solid var(--border)", background: "var(--surface)", color: "var(--muted)", borderRadius: 8, padding: "5px 8px", fontSize: 11, cursor: "pointer" }}>Archive</button>
              )}
              <button onClick={() => void patchMemory(memory.id, memory.visibility === "private" ? { visibility: "operational", useScopes: ["profile", "ranking_signal", "briefing", "explanation"], status: "active" } : { visibility: "private", useScopes: ["profile"] })} style={{ border: "0.5px solid var(--border)", background: "var(--surface)", color: "var(--muted)", borderRadius: 8, padding: "5px 8px", fontSize: 11, cursor: "pointer" }}>{memory.visibility === "private" ? "Use in matching" : "Make private"}</button>
              <button onClick={() => {
                const content = window.prompt("Update memory", memory.content)
                if (content) void patchMemory(memory.id, { content })
              }} style={{ border: "none", background: "transparent", color: "var(--muted)", fontSize: 11, cursor: "pointer" }}>Edit</button>
              <button onClick={() => void deleteMemory(memory.id)} style={{ border: "none", background: "transparent", color: "#b42318", fontSize: 11, cursor: "pointer" }}>Delete</button>
            </div>
          </div>
        )) : <SettingRow label="No memories yet" sublabel="I will learn from your choices and confirmed preferences." />}
        <AccountRow label="Add memory" sublabel="Tell V something useful for future shifts" onClick={() => void addMemory()} />
      </SectionCard>

      <SectionCard title="Compliance">
        <AccountRow label="Compliance & documents" sublabel="DBS, Right to Work, safeguarding, QTS" onClick={onOpenPassport} />
      </SectionCard>

      <SectionCard title="Notifications">
        <ToggleRow label="Shift alerts" sublabel="Notify me when I find a match" checked={shiftAlerts} onChange={setShiftAlerts} />
        <ToggleRow label="Sounds" sublabel="Audio cues for new offers" checked={sounds} onChange={setSounds} />
      </SectionCard>

      <SectionCard title="Account">
        <AccountRow label="Switch account" sublabel={`Signed in as ${name}`} onClick={onSwitchAccount} />
        <AccountRow label="Sign out" danger onClick={onSignOut} />
      </SectionCard>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

function ShiftHistory({ workerId, apiUrl }: { workerId: string; apiUrl: string }) {
  const [data, setData] = useState<WorkerShiftData | null>(null)

  useEffect(() => {
    let active = true
    fetch(`${apiUrl}/v1/workers/${workerId}/shifts`)
      .then(res => res.ok ? res.json() : null)
      .then(json => { if (active) setData(json) })
      .catch(() => { if (active) setData(null) })
    return () => { active = false }
  }, [workerId, apiUrl])

  if (!data) return null
  const upcoming = data.bookings.filter(booking => ["confirmed", "in_progress"].includes(booking.status)).slice(0, 3)
  const recent = data.bookings.filter(booking => ["completed", "cancelled", "at_risk"].includes(booking.status)).slice(0, 3)
  const pendingOffers = data.offers.filter(offer => offer.status === "pending").slice(0, 2)
  if (upcoming.length === 0 && recent.length === 0 && pendingOffers.length === 0) return null

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
      {upcoming.length > 0 && (
        <SectionCard title="Upcoming">
          {upcoming.map(booking => (
            <SettingRow key={booking.id} label={`${humanizeRole(booking.roleType)} at ${booking.siteName}`} sublabel={`${booking.organisationName} · ${formatDate(booking.startAt)} · ${formatTime(booking.startAt)}-${formatTime(booking.endAt)} · ${booking.siteAddress}`}>
              {formatGbp(booking.payRate)}
            </SettingRow>
          ))}
        </SectionCard>
      )}
      {pendingOffers.length > 0 && (
        <SectionCard title="Open offers">
          {pendingOffers.map(offer => (
            <SettingRow key={offer.id} label={`${humanizeRole(offer.roleType)} at ${offer.siteName}`} sublabel={`${offer.organisationName} · ${formatDate(offer.startAt)} · ${formatTime(offer.startAt)}-${formatTime(offer.endAt)} · ${offer.siteAddress}`}>
              {formatGbp(offer.payRate)}
            </SettingRow>
          ))}
        </SectionCard>
      )}
      {recent.length > 0 && (
        <SectionCard title="Recent shifts">
          {recent.map(booking => (
            <SettingRow key={booking.id} label={`${humanizeRole(booking.roleType)} · ${booking.status}`} sublabel={`${booking.organisationName} · ${booking.siteName} · ${formatDate(booking.startAt)} · ${booking.timesheet ? `${booking.timesheet.hoursWorked}h ${booking.timesheet.approved ? "approved" : "pending"}` : "no timesheet"}`}>
              {formatGbp(booking.payRate)}
            </SettingRow>
          ))}
        </SectionCard>
      )}
    </div>
  )
}

function EarningsTab({ workerId, apiUrl }: { workerId: string; apiUrl: string }) {
  const [data, setData] = useState<EarningsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetch(`${apiUrl}/v1/workers/${workerId}/earnings`)
      .then(res => res.ok ? res.json() : null)
      .then(json => { if (active) setData(json) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [workerId, apiUrl])

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Loading earnings...</div>
  if (!data) return <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Earnings unavailable.</div>

  return (
    <div style={{ padding: "8px 20px 24px", display: "flex", flexDirection: "column", gap: 18, width: "100%", maxWidth: 460, margin: "0 auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "12px 14px" }}>
          <p style={{ color: "var(--success)", fontSize: 22, fontWeight: 700, margin: 0 }}>{formatGbp(data.summary.approvedTotal)}</p>
          <p style={{ color: "var(--muted)", fontSize: 10, margin: "3px 0 0", textTransform: "uppercase", letterSpacing: "0.07em" }}>Approved</p>
        </div>
        <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "12px 14px" }}>
          <p style={{ color: "var(--warning)", fontSize: 22, fontWeight: 700, margin: 0 }}>{formatGbp(data.summary.pendingTotal)}</p>
          <p style={{ color: "var(--muted)", fontSize: 10, margin: "3px 0 0", textTransform: "uppercase", letterSpacing: "0.07em" }}>Pending</p>
        </div>
      </div>
      <SectionCard title={`Timesheets (${data.timesheets.length})`}>
        {data.timesheets.length ? data.timesheets.map(timesheet => (
          <SettingRow key={timesheet.id} label={`${humanizeRole(timesheet.roleType)} at ${timesheet.siteName}`} sublabel={`${timesheet.organisationName} · ${formatDate(timesheet.startAt)} · ${timesheet.hoursWorked}h · ${timesheet.approved ? "approved" : "pending approval"}`}>
            {formatGbp(timesheet.workerTotal)}
          </SettingRow>
        )) : <SettingRow label="No earnings yet" />}
      </SectionCard>
    </div>
  )
}

// ── Schedule tab ─────────────────────────────────────────────────────────────

type AvailabilityPattern = {
  workerId: string
  timezone: string
  daysOfWeek: number[]
  startTime: string | null
  endTime: string | null
} | null

const scheduleInput: CSSProperties = {
  width: "100%", background: "var(--bg)", border: "0.5px solid var(--border-strong)",
  borderRadius: 9, padding: "9px 11px", fontSize: 13, color: "var(--text)", outline: "none", fontFamily: "inherit",
}
const sheetGhostBtn: CSSProperties = {
  flex: 1, background: "var(--surface)", border: "0.5px solid var(--border-strong)", color: "var(--muted)",
  borderRadius: 12, padding: 12, fontSize: 13, fontWeight: 600, cursor: "pointer",
}
const sheetPrimaryBtn: CSSProperties = {
  flex: 1, background: "var(--accent)", border: "none", color: "#fff",
  borderRadius: 12, padding: 12, fontSize: 13, fontWeight: 700, cursor: "pointer",
}
const cardActionBtn: CSSProperties = {
  background: "var(--surface-2)", border: "0.5px solid var(--border)", color: "var(--muted)",
  borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer",
}
const cardActionDanger: CSSProperties = {
  background: "transparent", border: "0.5px solid var(--border)", color: "var(--error)",
  borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer",
}
const centeredNote: CSSProperties = { padding: "28px 16px", textAlign: "center", color: "var(--muted)", fontSize: 12 }

const DOW_ORDER: { v: number; l: string }[] = [
  { v: 1, l: "Mon" }, { v: 2, l: "Tue" }, { v: 3, l: "Wed" }, { v: 4, l: "Thu" },
  { v: 5, l: "Fri" }, { v: 6, l: "Sat" }, { v: 0, l: "Sun" },
]

function ScheduleField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, flex: 1, minWidth: 0 }}>
      <span style={{ color: "var(--muted)", fontSize: 11, fontWeight: 600 }}>{label}</span>
      {children}
    </label>
  )
}

function nextDateKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + 1))
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(dt.getUTCDate()).padStart(2, "0")
  return `${dt.getUTCFullYear()}-${mm}-${dd}`
}
function timeInTz(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso))
}
function scheduleCounts(events: ScheduleEvent[]) {
  const c = { confirmed: 0, pending: 0, open: 0, unavailable: 0 }
  for (const e of events) {
    if (e.kind === "confirmed_shift") c.confirmed++
    else if (e.kind === "pending_offer") c.pending++
    else if (e.kind === "open_request") c.open++
    else if (e.kind === "unavailable_block") c.unavailable++
  }
  return c
}
function patternSummaryText(p: AvailabilityPattern): string {
  if (!p || !p.daysOfWeek?.length) return "Not set yet"
  return DOW_ORDER.filter((d) => p.daysOfWeek.includes(d.v)).map((d) => d.l).join(", ")
}
function patternHoursText(p: AvailabilityPattern): string {
  if (!p || !p.daysOfWeek?.length) return "Set the days & hours you usually work."
  return p.startTime && p.endTime ? `${p.startTime}–${p.endTime}` : "All day"
}

function ScheduleTab({ workerId, apiUrl, onOpenDeck }: { workerId: string; apiUrl: string; onOpenDeck: () => void }) {
  const [weekAnchor, setWeekAnchor] = useState<Date>(() => startOfWeekMonday(new Date()))
  const [view, setView] = useState<"agenda" | "hourly">("agenda")
  const [resp, setResp] = useState<ScheduleResponse | null>(null)
  const [dayHours, setDayHours] = useState<ScheduleResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedKey, setSelectedKey] = useState<string>(() => dayKey(new Date(), DEFAULT_TZ))

  const tz = resp?.range.timezone ?? DEFAULT_TZ
  const { from, to } = useMemo(() => weekRangeFromAnchor(weekAnchor), [weekAnchor])
  const todayKey = useMemo(() => dayKey(new Date(), tz), [tz])
  const thisWeekFrom = useMemo(() => weekRangeFromAnchor(startOfWeekMonday(new Date())).from, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${apiUrl}/v1/workers/${workerId}/schedule?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&granularity=day`)
      if (!res.ok) { setError("Could not load schedule."); setResp(null); return }
      setResp(await res.json())
    } catch { setError("Could not load schedule."); setResp(null) }
    finally { setLoading(false) }
  }, [apiUrl, workerId, from, to])
  useEffect(() => { load() }, [load])

  // Keep the selected day within the visible week.
  useEffect(() => {
    const keys = Array.from({ length: 7 }, (_, i) => dayKey(addDaysUtc(new Date(from), i), tz))
    if (!keys.includes(selectedKey)) setSelectedKey(keys.includes(todayKey) ? todayKey : keys[0])
  }, [from, tz, selectedKey, todayKey])

  // Hour view: fetch the selected day at hour granularity.
  const loadDayHours = useCallback(async () => {
    const { from: dFrom, to: dTo } = dayRange(selectedKey, tz)
    try {
      const res = await fetch(`${apiUrl}/v1/workers/${workerId}/schedule?from=${encodeURIComponent(dFrom)}&to=${encodeURIComponent(dTo)}&granularity=hour`)
      setDayHours(res.ok ? await res.json() : null)
    } catch { setDayHours(null) }
  }, [apiUrl, workerId, selectedKey, tz])
  useEffect(() => { if (view === "hourly") loadDayHours() }, [view, loadDayHours])

  // Weekly availability pattern (summary + editor seed).
  const [pattern, setPattern] = useState<AvailabilityPattern>(null)
  const loadPattern = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/v1/workers/${workerId}/availability`)
      if (res.ok) { const d = await res.json(); setPattern(d.pattern ?? null) }
    } catch { /* non-blocking */ }
  }, [apiUrl, workerId])
  useEffect(() => { loadPattern() }, [loadPattern])

  const days: WeekStripDay[] = useMemo(() => {
    const fromDate = new Date(from)
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDaysUtc(fromDate, i)
      const key = dayKey(d, tz)
      const dayEvents = resp?.days.find((x) => x.key === key)?.events ?? []
      return {
        key,
        weekdayLabel: formatWeekdayShort(d, tz),
        dayNumber: formatDayNumber(d, tz),
        isToday: key === todayKey,
        counts: dayEvents.length ? scheduleCounts(dayEvents) : undefined,
      }
    })
  }, [from, tz, resp, todayKey])

  const selectedDay = resp?.days.find((d) => d.key === selectedKey)
  const selectedEvents = selectedDay?.events ?? []
  const dayLabel = selectedDay?.label ?? formatEventDayLabel(`${selectedKey}T12:00:00Z`, tz)

  // ── Mark-unavailable sheet (block CRUD) ──
  const [blockSheet, setBlockSheet] = useState<null | { mode: "create" } | { mode: "edit"; blockId: string }>(null)
  const [blockDate, setBlockDate] = useState("")
  const [blockAllDay, setBlockAllDay] = useState(true)
  const [blockStart, setBlockStart] = useState("09:00")
  const [blockEnd, setBlockEnd] = useState("17:00")
  const [blockNote, setBlockNote] = useState("")
  const [blockBusy, setBlockBusy] = useState(false)
  const [blockErr, setBlockErr] = useState<string | null>(null)

  const openCreateBlock = () => {
    setBlockDate(selectedKey); setBlockAllDay(true); setBlockStart("09:00"); setBlockEnd("17:00")
    setBlockNote(""); setBlockErr(null); setBlockSheet({ mode: "create" })
  }
  const openEditBlock = (ev: ScheduleEvent) => {
    const id = ev.meta.availabilityBlockId
    if (!id) return
    const sTime = timeInTz(ev.startAt, tz)
    const eTime = timeInTz(ev.endAt, tz)
    const allDay = sTime === "00:00" && eTime === "00:00"
    setBlockDate(dayKey(ev.startAt, tz)); setBlockAllDay(allDay)
    setBlockStart(sTime); setBlockEnd(allDay ? "17:00" : eTime)
    setBlockNote(ev.meta.note ?? ""); setBlockErr(null); setBlockSheet({ mode: "edit", blockId: id })
  }
  const saveBlock = async () => {
    setBlockBusy(true); setBlockErr(null)
    try {
      let startAt: string
      let endAt: string
      if (blockAllDay) {
        startAt = zonedIso(blockDate, "00:00", tz)
        endAt = zonedIso(nextDateKey(blockDate), "00:00", tz)
      } else {
        if (blockEnd <= blockStart) { setBlockErr("End time must be after start time."); setBlockBusy(false); return }
        startAt = zonedIso(blockDate, blockStart, tz)
        endAt = zonedIso(blockDate, blockEnd, tz)
      }
      const body = { startAt, endAt, note: blockNote.trim() || null }
      const editing = blockSheet?.mode === "edit"
      const url = editing
        ? `${apiUrl}/v1/workers/${workerId}/availability/blocks/${blockSheet.blockId}`
        : `${apiUrl}/v1/workers/${workerId}/availability/blocks`
      const res = await fetch(url, { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      if (!res.ok) { setBlockErr(res.status === 422 ? "Please check the times." : "Could not save — please try again."); setBlockBusy(false); return }
      setBlockSheet(null)
      await load()
      if (view === "hourly") await loadDayHours()
    } catch { setBlockErr("Could not save — please try again.") }
    finally { setBlockBusy(false) }
  }
  const removeBlock = async (ev: ScheduleEvent) => {
    const id = ev.meta.availabilityBlockId
    if (!id || !window.confirm("Remove this unavailable block?")) return
    try {
      const res = await fetch(`${apiUrl}/v1/workers/${workerId}/availability/blocks/${id}`, { method: "DELETE" })
      if (res.ok) { await load(); if (view === "hourly") await loadDayHours() }
    } catch { /* ignore */ }
  }

  // ── Weekly availability pattern sheet ──
  const [patternSheet, setPatternSheet] = useState(false)
  const [patternDays, setPatternDays] = useState<number[]>([])
  const [patternHasHours, setPatternHasHours] = useState(false)
  const [patternStart, setPatternStart] = useState("08:00")
  const [patternEnd, setPatternEnd] = useState("16:00")
  const [patternBusy, setPatternBusy] = useState(false)
  const [patternErr, setPatternErr] = useState<string | null>(null)

  const openPattern = () => {
    setPatternDays(pattern?.daysOfWeek ?? [1, 2, 3, 4, 5])
    const hasHours = !!(pattern?.startTime && pattern?.endTime)
    setPatternHasHours(hasHours)
    setPatternStart(pattern?.startTime ?? "08:00")
    setPatternEnd(pattern?.endTime ?? "16:00")
    setPatternErr(null); setPatternSheet(true)
  }
  const togglePatternDay = (v: number) =>
    setPatternDays((d) => (d.includes(v) ? d.filter((x) => x !== v) : [...d, v]))
  const savePattern = async () => {
    setPatternBusy(true); setPatternErr(null)
    try {
      if (patternHasHours && patternEnd <= patternStart) { setPatternErr("End time must be after start time."); setPatternBusy(false); return }
      const body = {
        timezone: pattern?.timezone ?? DEFAULT_TZ,
        daysOfWeek: [...patternDays].sort((a, b) => a - b),
        startTime: patternHasHours ? patternStart : null,
        endTime: patternHasHours ? patternEnd : null,
      }
      const res = await fetch(`${apiUrl}/v1/workers/${workerId}/availability/pattern`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      if (!res.ok) { setPatternErr(res.status === 422 ? "End time must be after start time." : "Could not save — please try again."); setPatternBusy(false); return }
      const d = await res.json(); setPattern(d.pattern ?? null); setPatternSheet(false)
    } catch { setPatternErr("Could not save — please try again.") }
    finally { setPatternBusy(false) }
  }

  const renderCard = (ev: ScheduleEvent) => {
    const time = formatEventTimeRange(ev)
    if (ev.kind === "pending_offer") {
      return (
        <ScheduleEventCard kind={ev.kind} title={ev.title} timeLabel={time} subtitle={ev.subtitle}
          amountLabel={ev.meta.payRate != null ? formatGbp(ev.meta.payRate) : undefined}
          pill={{ label: "Pending offer", tone: "accent" }} onClick={onOpenDeck} />
      )
    }
    if (ev.kind === "unavailable_block") {
      return (
        <ScheduleEventCard kind={ev.kind} title="Unavailable" timeLabel={time} subtitle={ev.meta.note ?? undefined}
          pill={{ label: "Unavailable", tone: "muted" }}
          actions={<>
            <button type="button" onClick={() => openEditBlock(ev)} style={cardActionBtn}>Edit</button>
            <button type="button" onClick={() => removeBlock(ev)} style={cardActionDanger}>Remove</button>
          </>} />
      )
    }
    const atRisk = ev.status === "at_risk"
    return (
      <ScheduleEventCard kind={ev.kind} title={ev.title} timeLabel={time} subtitle={ev.subtitle}
        amountLabel={ev.meta.payRate != null ? formatGbp(ev.meta.payRate) : undefined}
        pill={{ label: atRisk ? "At risk" : "Confirmed", tone: atRisk ? "warning" : "success" }} />
    )
  }

  const markBtn = (
    <button type="button" onClick={openCreateBlock} style={{
      width: "100%", background: "var(--surface)", border: "0.5px solid var(--border-strong)", color: "var(--accent)",
      borderRadius: 14, padding: 12, fontSize: 13, fontWeight: 600, cursor: "pointer",
      display: "flex", alignItems: "center", justifyContent: "center", gap: 7,
    }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4M9 15h6" /></svg>
      Mark unavailable
    </button>
  )

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: "4px 20px 20px", width: "100%", maxWidth: 460, margin: "0 auto", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", margin: 0 }}>Schedule</h2>
        <SegmentedToggle size="sm" value={view} onChange={setView}
          options={[{ id: "agenda", label: "Day" }, { id: "hourly", label: "Hour" }]} />
      </div>

      <WeekNav rangeLabel={formatWeekRangeLabel(from, tz)}
        onPrev={() => setWeekAnchor((a) => addWeeks(a, -1))}
        onNext={() => setWeekAnchor((a) => addWeeks(a, 1))}
        onThisWeek={() => setWeekAnchor(startOfWeekMonday(new Date()))}
        isThisWeek={from === thisWeekFrom} />

      <WeekStrip days={days} selectedKey={selectedKey} onSelect={setSelectedKey} />

      {error ? (
        <div style={centeredNote}>{error} · <button type="button" onClick={load} style={{ background: "none", border: "none", color: "var(--accent)", fontWeight: 600, cursor: "pointer" }}>Retry</button></div>
      ) : loading && !resp ? (
        <div style={centeredNote}>Loading schedule…</div>
      ) : view === "agenda" ? (
        <AgendaList dayLabel={dayLabel} events={selectedEvents} emptyLabel="No shifts or offers this day." renderCard={renderCard} footer={markBtn} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ color: "var(--muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0, paddingLeft: 4 }}>{dayLabel}</p>
          {dayHours ? <HourTimeline hours={dayHours.hours ?? []} renderCard={renderCard} /> : <div style={centeredNote}>Loading hours…</div>}
          {markBtn}
        </div>
      )}

      <SectionCard title="Usual weekly availability" hint="V uses this to know when you generally work.">
        <SettingRow label={patternSummaryText(pattern)} sublabel={patternHoursText(pattern)}>
          <button type="button" onClick={openPattern} style={{ background: "transparent", border: "none", color: "var(--accent)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Edit</button>
        </SettingRow>
      </SectionCard>

      <Sheet open={blockSheet !== null} title={blockSheet?.mode === "edit" ? "Edit unavailable" : "Mark unavailable"} onClose={() => setBlockSheet(null)}
        footer={<div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={() => setBlockSheet(null)} style={sheetGhostBtn}>Cancel</button>
          <button type="button" onClick={saveBlock} disabled={blockBusy} style={sheetPrimaryBtn}>{blockBusy ? "…" : "Save"}</button>
        </div>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <ScheduleField label="Date"><input type="date" value={blockDate} onChange={(e) => setBlockDate(e.target.value)} style={scheduleInput} /></ScheduleField>
          <ToggleRow label="All day" checked={blockAllDay} onChange={setBlockAllDay} />
          {!blockAllDay && (
            <div style={{ display: "flex", gap: 10 }}>
              <ScheduleField label="From"><input type="time" value={blockStart} onChange={(e) => setBlockStart(e.target.value)} style={scheduleInput} /></ScheduleField>
              <ScheduleField label="To"><input type="time" value={blockEnd} onChange={(e) => setBlockEnd(e.target.value)} style={scheduleInput} /></ScheduleField>
            </div>
          )}
          <ScheduleField label="Reason (optional)"><input type="text" maxLength={500} value={blockNote} placeholder="e.g. Holiday, appointment" onChange={(e) => setBlockNote(e.target.value)} style={scheduleInput} /></ScheduleField>
          {blockErr && <p style={{ color: "var(--error)", fontSize: 12, margin: 0 }}>{blockErr}</p>}
        </div>
      </Sheet>

      <Sheet open={patternSheet} title="Usual weekly availability" onClose={() => setPatternSheet(false)}
        footer={<div style={{ display: "flex", gap: 10 }}>
          <button type="button" onClick={() => setPatternSheet(false)} style={sheetGhostBtn}>Cancel</button>
          <button type="button" onClick={savePattern} disabled={patternBusy} style={sheetPrimaryBtn}>{patternBusy ? "…" : "Save"}</button>
        </div>}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <ScheduleField label="Days you usually work">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {DOW_ORDER.map((d) => {
                const on = patternDays.includes(d.v)
                return (
                  <button key={d.v} type="button" onClick={() => togglePatternDay(d.v)} style={{
                    border: on ? "0.5px solid rgba(31,77,255,0.3)" : "0.5px solid var(--border-strong)",
                    background: on ? "rgba(31,77,255,0.1)" : "var(--surface)", color: on ? "var(--accent)" : "var(--muted)",
                    borderRadius: 20, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}>{d.l}</button>
                )
              })}
            </div>
          </ScheduleField>
          <ToggleRow label="Set specific hours" sublabel="Off means available all day on those days." checked={patternHasHours} onChange={setPatternHasHours} />
          {patternHasHours && (
            <div style={{ display: "flex", gap: 10 }}>
              <ScheduleField label="From"><input type="time" value={patternStart} onChange={(e) => setPatternStart(e.target.value)} style={scheduleInput} /></ScheduleField>
              <ScheduleField label="To"><input type="time" value={patternEnd} onChange={(e) => setPatternEnd(e.target.value)} style={scheduleInput} /></ScheduleField>
            </div>
          )}
          {patternErr && <p style={{ color: "var(--error)", fontSize: 12, margin: 0 }}>{patternErr}</p>}
        </div>
      </Sheet>
    </div>
  )
}

export default function WorkerApp() {
  return (
    <Suspense fallback={null}>
      <WorkerAppInner />
    </Suspense>
  )
}

function WorkerAppInner() {
  const searchParams = useSearchParams()
  const workerId = searchParams.get("workerId") ?? DEFAULT_WORKER_ID

  const [offer, setOffer] = useState<Offer | null>(null)
  const [loading, setLoading] = useState(false)
  const [acting, setActing] = useState(false)
  const [message, setMessage] = useState("")
  const [pendingVoiceAction, setPendingVoiceAction] = useState<WorkerVoicePendingAction | null>(null)
  const [activeTab, setActiveTab] = useState("deck")
  const [waveState, setWaveState] = useState<WaveState>("rest")
  const [preview, setPreview] = useState<PreviewMode>("auto")
  const recognitionRef = useRef<VoiceCaptureController | null>(null)

  const speakWorkerReply = useCallback((text: string, purpose: VoicePurpose = "reply", finalState: WaveState = "rest") => {
    setWaveState("speaking")
    void playVSpeech(text, {
      apiUrl: API_URL,
      purpose,
      onEnd: () => {
        setWaveState(finalState)
        if (finalState === "confirmed") setTimeout(() => setWaveState("rest"), 2200)
      },
    })
  }, [])

  const fetchOffer = useCallback(async () => {
    setLoading(true)
    setMessage("")
    try {
      const res = await fetch(`${API_URL}/v1/workers/${workerId}/offer`)
      const data = await res.json()
      setOffer(data.offer ?? null)
    } catch {
      setMessage("Could not load offer — check API connection.")
    } finally {
      setLoading(false)
    }
  }, [workerId])

  useEffect(() => {
    setOffer(null)
    setMessage("")
    setPendingVoiceAction(null)
    cancelVSpeech()
  }, [workerId])

  useEffect(() => { fetchOffer() }, [fetchOffer])

  const act = useCallback(async (action: "accept" | "decline") => {
    if (!offer) return
    setActing(true)
    try {
      await fetch(`${API_URL}/v1/workers/${workerId}/offers/${offer.id}/${action}`, { method: "POST" })
      const reply = action === "accept" ? "Shift accepted! Pre-shift briefing on the way." : "Passed — finding your next match…"
      setMessage(reply)
      speakWorkerReply(reply, action === "accept" ? "confirmation" : "reply", action === "accept" ? "confirmed" : "rest")
      setPendingVoiceAction(null)
      setOffer(null)
      if (action === "decline") setTimeout(fetchOffer, 1200)
    } catch {
      setMessage("Something went wrong — please try again.")
    } finally {
      setActing(false)
    }
  }, [offer, fetchOffer, speakWorkerReply, workerId])

  const submitVoiceCommand = useCallback(async (transcript: string) => {
    const text = transcript.trim()
    if (!text || loading || acting) return
    setWaveState("processing")
    setMessage(`Heard: "${text}"`)
    try {
      const res = await fetch(`${API_URL}/v1/workers/${workerId}/voice/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: text,
          pendingAction: pendingVoiceAction ?? undefined,
        }),
      })
      const data = await res.json().catch(() => null) as {
        reply?: string
        requiresConfirmation?: boolean
        pendingAction?: WorkerVoicePendingAction | null
        actionExecuted?: boolean
      } | null
      if (!res.ok || !data) {
        const reply = "I could not handle that voice command."
        setMessage(reply)
        speakWorkerReply(reply)
        return
      }
      const reply = data.reply ?? "I heard you."
      setMessage(reply)
      setPendingVoiceAction(data.requiresConfirmation ? data.pendingAction ?? null : null)
      if (data.actionExecuted) {
        setOffer(null)
        setTimeout(fetchOffer, 1200)
      }
      speakWorkerReply(reply, data.actionExecuted ? "confirmation" : "reply", data.actionExecuted ? "confirmed" : "rest")
    } catch {
      const reply = "I am unreachable - please try again or use the buttons."
      setMessage(reply)
      speakWorkerReply(reply)
    }
  }, [acting, fetchOffer, loading, pendingVoiceAction, speakWorkerReply, workerId])

  // Tap the sphere to talk to V; auto-stops on silence, 30s cap.
  const startListening = useCallback(() => {
    void startVoiceCapture({
      apiUrl: API_URL,
      onStart: () => setWaveState("listening"),
      onStop: () => {
        recognitionRef.current = null
        setWaveState(s => (s === "listening" ? "rest" : s))
      },
      onTranscript: ({ text }) => void submitVoiceCommand(text),
      onError: () => setWaveState("rest"),
    }).then(controller => {
      recognitionRef.current = controller
    })
  }, [submitVoiceCommand])

  const toggleMic = useCallback(() => {
    if (waveState === "listening") { recognitionRef.current?.stop() }
    else startListening()
  }, [waveState, startListening])

  // Interim account actions — the auth agent's switcher/session replaces these.
  const switchAccount = useCallback(() => {
    const next = window.prompt("Switch to worker id (demo bypass):", workerId)
    if (next && next.trim()) window.location.search = `?workerId=${encodeURIComponent(next.trim())}`
  }, [workerId])

  const signOut = useCallback(() => { window.location.href = "/" }, [])

  const navItems: NavItem[] = [
    { id: "deck", label: "Shifts", icon: <NavIcon name="deck" /> },
    { id: "schedule", label: "Schedule", icon: <NavIcon name="schedule" /> },
    { id: "earnings", label: "Earnings", icon: <NavIcon name="earnings" /> },
    { id: "passport", label: "Passport", icon: <NavIcon name="passport" /> },
    { id: "profile", label: "Profile", icon: <NavIcon name="profile" /> },
  ]

  const statusLabel =
    waveState === "listening" ? "Listening… tap to stop" :
    waveState === "speaking" ? "I'm responding…" : "Tap to talk to V"

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
              {offer ? "I found you a match" : loading ? "I'm searching…" : message || "No active offer"}
            </span>
          </div>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 14 }}>
            {offer ? (
              <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 22, padding: 20, boxShadow: "0 10px 40px rgba(28,30,34,0.06)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                  <div>
                    <p style={{ color: "var(--muted)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 3px" }}>{offer.role}</p>
                    <p style={{ color: "var(--text)", fontSize: 18, fontWeight: 700, margin: "0 0 2px" }}>{offer.site}</p>
                    {offer.siteAddress && (
                      <p style={{ color: "var(--muted)", fontSize: 11, margin: "0 0 3px", lineHeight: 1.35 }}>{offer.siteAddress}</p>
                    )}
                    {offer.shiftDate && (
                      <p style={{ color: "var(--faint)", fontSize: 11, margin: 0 }}>
                        {offer.shiftDate}{offer.shiftStart && ` · ${offer.shiftStart}–${offer.shiftEnd}`}
                      </p>
                    )}
                  </div>
                  <div style={{ background: "rgba(31,157,87,0.1)", border: "1px solid rgba(31,157,87,0.25)", borderRadius: 10, padding: "7px 11px", textAlign: "center" }}>
                    <p style={{ color: "var(--success)", fontSize: 18, fontWeight: 700, margin: 0 }}>£{offer.payPerDay}</p>
                    <p style={{ color: "#1f9d57", fontSize: 9, margin: "1px 0 0" }}>{offer.rateMode === "dynamic" ? "Dynamic Rate" : "/day"}</p>
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
                    {offer.memoryReasons?.length ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 9 }}>
                        {offer.memoryReasons.slice(0, 3).map(reason => (
                          <div key={reason.id} style={{ borderTop: "1px solid rgba(31,77,255,0.12)", paddingTop: 6 }}>
                            <p style={{ color: "#1a3fd0", fontSize: 11, fontWeight: 650, lineHeight: 1.35, margin: 0 }}>{reason.title}</p>
                            <p style={{ color: "var(--muted)", fontSize: 10, lineHeight: 1.35, margin: "2px 0 0" }}>{reason.detail}</p>
                            <p style={{ color: "var(--faint)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", margin: "3px 0 0" }}>{humanizeRole(reason.kind)} Â· {reason.visibility}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                )}

                {offer.rateMode === "dynamic" && offer.rateExplanation && (
                  <div style={{ background: "rgba(31,157,87,0.07)", border: "1px solid rgba(31,157,87,0.2)", borderRadius: 11, padding: "10px 12px", marginBottom: 14 }}>
                    <p style={{ color: "var(--muted)", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.07em", margin: "0 0 3px" }}>Dynamic Rate</p>
                    <p style={{ color: "#1f7a45", fontSize: 12, lineHeight: 1.5, margin: 0 }}>{offer.rateExplanation}</p>
                  </div>
                )}

                <Countdown seconds={8 * 60} />
              </div>
            ) : (
              <div style={{ textAlign: "center" }}>
                {message && !loading && <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>{message}</p>}
                <button onClick={fetchOffer} disabled={loading} style={{ background: loading ? "var(--surface-2)" : "var(--accent)", border: "none", color: loading ? "var(--muted)" : "#fff", borderRadius: 16, padding: "14px 28px", fontSize: 14, fontWeight: 600 }}>
                  {loading ? "I'm searching…" : "Load next shift"}
                </button>
              </div>
            )}
          </div>
          <ShiftHistory workerId={workerId} apiUrl={API_URL} />
        </div>
      )}

      {activeTab === "schedule" && (
        <ScheduleTab workerId={workerId} apiUrl={API_URL} onOpenDeck={() => setActiveTab("deck")} />
      )}

      {activeTab === "passport" && <PassportTab workerId={workerId} apiUrl={API_URL} />}

      {activeTab === "profile" && (
        <ProfileTab
          workerId={workerId}
          apiUrl={API_URL}
          onOpenPassport={() => setActiveTab("passport")}
          onSwitchAccount={switchAccount}
          onSignOut={signOut}
        />
      )}

      {activeTab === "earnings" && (
        <EarningsTab workerId={workerId} apiUrl={API_URL} />
      )}
    </AppShell>
  )
}
