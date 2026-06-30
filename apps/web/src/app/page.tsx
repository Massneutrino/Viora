"use client"

import { useState, useEffect, useRef, useCallback, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import {
  AppShell, PixelSphere, SectionCard, SettingRow, EditableField, ChipsField, AccountRow, Avatar,
  startVoiceCapture, type VoiceCaptureController, type WaveState, type NavItem, type PreviewMode,
} from "@viora/ui"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200"
const DEFAULT_ORG_ID = "demo-org"
const API_FALLBACK_MESSAGE = "V is having trouble connecting to the intake service. I have not created a booking yet - please try again in a moment."

function humanize(s: string): string {
  return s.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

type Message = { role: "employer" | "v"; text: string; ts: string }
type RateMode = "standard" | "dynamic"

type OrgSite = { id: string; name: string; address: string; city?: string | null; postcode?: string | null }
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

type DashboardData = {
  summary: { fillRate: number | null; activeBookings: number; openRequests: number; termSpend: number }
  lastBooking: null | {
    roleType: string
    status: string
    startAt: string
    endAt: string
    payRate: number
    totalCost: number
    worker: { firstName: string; lastName: string }
    site: OrgSite
  }
}

type BookingData = {
  requests: Array<{
    id: string
    status: string
    roleType: string
    startAt: string
    endAt: string
    payRate: number
    site: OrgSite
    offers: Array<{ id: string; status: string }>
  }>
  bookings: Array<{
    id: string
    status: string
    roleType: string
    startAt: string
    endAt: string
    payRate: number
    totalCost: number
    worker: { firstName: string; lastName: string }
    site: OrgSite
    timesheet?: { approved: boolean; hoursWorked: number } | null
  }>
}

type OrgWorker = {
  id: string
  name: string
  roleTypes: string[]
  reliabilityScore?: number | null
  relationship: string
  bookingCount: number
  lastRoleType: string
  lastSiteName: string
  lastWorkedAt: string
  compliance: Record<string, string | null>
}

type FinanceData = {
  summary: { workerPayTotal: number; vioraFeeTotal: number; totalAmount: number; unapprovedTimesheets: number }
  invoices: Array<{ id: string; status: string; workerPayTotal: number; vioraFeeTotal: number; totalAmount: number; periodStart: string; periodEnd: string }>
  timesheets: Array<{ id: string; approved: boolean; hoursWorked: number; workerName: string; roleType: string; siteName: string; payRate: number; workerTotal: number; vioraFee: number; startAt: string }>
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

function siteLine(site?: OrgSite | null): string {
  return site ? [site.address, site.city, site.postcode].filter(Boolean).join(", ") : ""
}

function memoryMeta(memory: MemoryEntry): string {
  const valueType = memory.value && typeof memory.value === "object" && "valueType" in memory.value
    ? String((memory.value as { valueType?: unknown }).valueType)
    : null
  return [
    humanize(memory.kind),
    humanize(memory.visibility),
    humanize(memory.status),
    `${Math.round((memory.confidence ?? 0) * 100)}%`,
    (memory.useScopes ?? []).map(humanize).join(", "),
    humanize(memory.sensitivity ?? "standard"),
    memory.sourceLabel,
    memory.connectorType ? humanize(memory.connectorType) : null,
    valueType ? humanize(valueType) : null,
    memory.expiresAt ? `expires ${formatDate(memory.expiresAt)}` : null,
  ].filter(Boolean).join(" - ")
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

function HomeTab({ orgId, apiUrl }: { orgId: string; apiUrl: string }) {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetch(`${apiUrl}/v1/organisations/${orgId}/dashboard`)
      .then(res => res.ok ? res.json() : null)
      .then(json => { if (active) setData(json) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [orgId, apiUrl])

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Loading overview...</div>
  if (!data) return <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Overview unavailable.</div>

  const last = data.lastBooking
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: 14, padding: "0 20px", maxWidth: 460, width: "100%", margin: "0 auto" }}>
      {last && (
        <SectionCard title="Last booking">
          <SettingRow
            label={`${humanize(last.roleType)} at ${last.site.name}`}
            sublabel={`${formatDate(last.startAt)} · ${formatTime(last.startAt)}-${formatTime(last.endAt)} · ${last.worker.firstName} ${last.worker.lastName} · ${siteLine(last.site)}`}
          >
            {formatGbp(last.payRate)}/day
          </SettingRow>
        </SectionCard>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <StatCard label="Fill rate" value={data.summary.fillRate == null ? "-" : `${Math.round(data.summary.fillRate * 100)}%`} accent />
        <StatCard label="Active" value={String(data.summary.activeBookings)} />
        <StatCard label="Open" value={String(data.summary.openRequests)} />
        <StatCard label="Term spend" value={formatGbp(data.summary.termSpend)} />
      </div>
    </div>
  )
}

function BookingsTab({ orgId, apiUrl }: { orgId: string; apiUrl: string }) {
  const [data, setData] = useState<BookingData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetch(`${apiUrl}/v1/organisations/${orgId}/bookings`)
      .then(res => res.ok ? res.json() : null)
      .then(json => { if (active) setData(json) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [orgId, apiUrl])

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Loading bookings...</div>
  if (!data) return <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Bookings unavailable.</div>

  const open = data.requests.filter(r => ["pending_confirmation", "confirmed", "broadcasting"].includes(r.status))
  return (
    <div style={{ padding: "8px 20px 24px", display: "flex", flexDirection: "column", gap: 18, width: "100%", maxWidth: 520, margin: "0 auto" }}>
      <SectionCard title={`Open requests (${open.length})`}>
        {open.length ? open.map(request => (
          <SettingRow key={request.id} label={`${humanize(request.roleType)} · ${humanize(request.status)}`} sublabel={`${request.site.name} · ${formatDate(request.startAt)} · ${formatTime(request.startAt)}-${formatTime(request.endAt)} · ${request.offers.length} offer(s)`}>
            {formatGbp(request.payRate)}
          </SettingRow>
        )) : <SettingRow label="No open requests" />}
      </SectionCard>
      <SectionCard title={`Bookings (${data.bookings.length})`}>
        {data.bookings.length ? data.bookings.map(booking => (
          <SettingRow key={booking.id} label={`${humanize(booking.roleType)} · ${humanize(booking.status)}`} sublabel={`${booking.site.name} · ${booking.worker.firstName} ${booking.worker.lastName} · ${formatDate(booking.startAt)} · ${formatTime(booking.startAt)}-${formatTime(booking.endAt)} · ${booking.timesheet ? `${booking.timesheet.hoursWorked}h ${booking.timesheet.approved ? "approved" : "pending"}` : "timesheet pending"}`}>
            {formatGbp(booking.payRate)}
          </SettingRow>
        )) : <SettingRow label="No bookings yet" />}
      </SectionCard>
    </div>
  )
}

function WorkersTab({ orgId, apiUrl }: { orgId: string; apiUrl: string }) {
  const [workers, setWorkers] = useState<OrgWorker[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetch(`${apiUrl}/v1/organisations/${orgId}/workers`)
      .then(res => res.ok ? res.json() : { workers: [] })
      .then(json => { if (active) setWorkers(json.workers ?? []) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [orgId, apiUrl])

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Loading workers...</div>

  return (
    <div style={{ padding: "8px 20px 24px", width: "100%", maxWidth: 520, margin: "0 auto" }}>
      <SectionCard title={`Workers (${workers.length})`}>
        {workers.length ? workers.map(worker => (
          <SettingRow key={worker.id} label={`${worker.name} · ${humanize(worker.relationship)}`} sublabel={`${worker.roleTypes.map(humanize).join(", ")} · ${worker.bookingCount} booking(s) · ${humanize(worker.lastRoleType)} at ${worker.lastSiteName} · DBS ${worker.compliance.dbsStatus ?? "-"} · RTW ${worker.compliance.rightToWorkStatus ?? "-"}`}>
            {worker.reliabilityScore != null ? worker.reliabilityScore.toFixed(1) : "-"}
          </SettingRow>
        )) : <SettingRow label="No workers yet" />}
      </SectionCard>
    </div>
  )
}

function FinanceTab({ orgId, apiUrl }: { orgId: string; apiUrl: string }) {
  const [data, setData] = useState<FinanceData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetch(`${apiUrl}/v1/organisations/${orgId}/finance`)
      .then(res => res.ok ? res.json() : null)
      .then(json => { if (active) setData(json) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [orgId, apiUrl])

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Loading finance...</div>
  if (!data) return <div style={{ padding: 40, textAlign: "center", color: "var(--muted)", fontSize: 12 }}>Finance unavailable.</div>

  return (
    <div style={{ padding: "8px 20px 24px", display: "flex", flexDirection: "column", gap: 18, width: "100%", maxWidth: 520, margin: "0 auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <StatCard label="Worker pay" value={formatGbp(data.summary.workerPayTotal)} />
        <StatCard label="Viora fee" value={formatGbp(data.summary.vioraFeeTotal)} />
        <StatCard label="Total" value={formatGbp(data.summary.totalAmount)} accent />
        <StatCard label="Pending sheets" value={String(data.summary.unapprovedTimesheets)} />
      </div>
      <SectionCard title={`Invoices (${data.invoices.length})`}>
        {data.invoices.length ? data.invoices.map(invoice => (
          <SettingRow key={invoice.id} label={`${humanize(invoice.status)} invoice`} sublabel={`${formatDate(invoice.periodStart)}-${formatDate(invoice.periodEnd)} · worker ${formatGbp(invoice.workerPayTotal)} · fee ${formatGbp(invoice.vioraFeeTotal)}`}>
            {formatGbp(invoice.totalAmount)}
          </SettingRow>
        )) : <SettingRow label="No invoices yet" />}
      </SectionCard>
      <SectionCard title={`Timesheets (${data.timesheets.length})`}>
        {data.timesheets.length ? data.timesheets.map(timesheet => (
          <SettingRow key={timesheet.id} label={`${timesheet.workerName} · ${humanize(timesheet.roleType)}`} sublabel={`${timesheet.siteName} · ${formatDate(timesheet.startAt)} · ${timesheet.hoursWorked}h · ${timesheet.approved ? "approved" : "pending approval"}`}>
            {formatGbp(timesheet.workerTotal)}
          </SettingRow>
        )) : <SettingRow label="No timesheets yet" />}
      </SectionCard>
    </div>
  )
}

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
      body: JSON.stringify({
        kind: "preference",
        title,
        content,
        visibility: "operational",
        useScopes: ["intake_default", "ranking_signal", "briefing", "explanation", "connector_export"],
      }),
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
          ? org.sites.map(s => <SettingRow key={s.id} label={s.name} sublabel={siteLine(s)} />)
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
            sublabel={`${memory.content} · ${memoryMeta(memory)}`}
          >
            <div style={{ display: "flex", gap: 6 }}>
              {memory.status === "pending_confirmation" && (
                <button onClick={() => void patchMemory(memory.id, { status: "active" })} style={{ border: "none", background: "var(--accent)", color: "#fff", borderRadius: 8, padding: "5px 8px", fontSize: 11, cursor: "pointer" }}>Confirm</button>
              )}
              {memory.status !== "archived" && memory.status !== "deleted" && (
                <button onClick={() => void patchMemory(memory.id, { status: "archived" })} style={{ border: "0.5px solid var(--border)", background: "var(--surface)", color: "var(--muted)", borderRadius: 8, padding: "5px 8px", fontSize: 11, cursor: "pointer" }}>Archive</button>
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
  const [rateMode, setRateMode] = useState<RateMode>("standard")
  const [convId, setConvId] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [activeNav, setActiveNav] = useState("home")
  const [preview, setPreview] = useState<PreviewMode>("auto")

  const endRef = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<VoiceCaptureController | null>(null)

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
        body: JSON.stringify({ organisationId: orgId, rawInput: msg, rateMode, channel: "web", conversationId: convId }),
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
  }, [convId, loading, orgId, rateMode])

  // Tap the sphere to talk; auto-stops on silence, hard 30s safety cap.
  const startListening = useCallback(() => {
    void startVoiceCapture({
      apiUrl: API_URL,
      onStart: () => { setIsListening(true); setWaveState("listening") },
      onStop: () => {
        setIsListening(false)
        recognitionRef.current = null
        setWaveState(s => (s === "listening" ? "rest" : s))
      },
      onTranscript: ({ text }) => submit(text),
      onError: () => {
        setIsListening(false)
        setWaveState("rest")
      },
    }).then(controller => {
      recognitionRef.current = controller
    })
  }, [submit])

  const toggleMic = useCallback(() => {
    if (isListening) { recognitionRef.current?.stop() }
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
    <div style={{ padding: "12px 16px 16px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", width: 230, background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 10, padding: 3, flexShrink: 0 }}>
        {(["standard", "dynamic"] as RateMode[]).map(mode => {
          const active = rateMode === mode
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setRateMode(mode)}
              style={{
                border: "none",
                borderRadius: 8,
                background: active ? "var(--accent)" : "transparent",
                color: active ? "#fff" : "var(--muted)",
                padding: "7px 8px",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {mode === "standard" ? "Standard" : "Dynamic"}
            </button>
          )
        })}
      </div>
      {messages.length > 0 && (
        <button onClick={() => { setMessages([]); setConvId(undefined); setWaveState("rest") }} style={{ background: "transparent", border: "0.5px solid var(--border)", color: "var(--muted)", borderRadius: 10, padding: "9px 11px", fontSize: 12, flexShrink: 0 }}>New</button>
      )}
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8, background: "var(--bg)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "0 6px 0 14px" }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(input) } }}
          placeholder={isListening ? "Listening…" : rateMode === "dynamic" ? "starting rate and max…" : "or type to V…"}
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
      footer={activeNav === "home" ? footer : undefined}
    >
      {activeNav === "settings" ? (
        <SettingsTab orgId={orgId} apiUrl={API_URL} onSwitchAccount={switchAccount} onSignOut={signOut} />
      ) : activeNav === "bookings" ? (
        <BookingsTab orgId={orgId} apiUrl={API_URL} />
      ) : activeNav === "workers" ? (
        <WorkersTab orgId={orgId} apiUrl={API_URL} />
      ) : activeNav === "finance" ? (
        <FinanceTab orgId={orgId} apiUrl={API_URL} />
      ) : messages.length === 0 ? (
        <HomeTab orgId={orgId} apiUrl={API_URL} />
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
