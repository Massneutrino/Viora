"use client"

import type { ReactNode } from "react"
import type { ScheduleEvent, ScheduleEventKind, ScheduleHourBucket } from "@viora/domain"
import { SCHEDULE_KIND_META, type PillTone } from "./scheduleFormat"

// Shared, audience-neutral schedule widgets. Light theme, CSS-var tokens.
// They consume already-fetched data + primitive props — never fetch, never know
// worker-vs-org. Worker-private concepts only reach them via the caller's
// `renderCard`, so the employer side cannot accidentally surface them.

const sectionLabel: React.CSSProperties = {
  color: "var(--muted)",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  margin: "0 0 8px",
  paddingLeft: 4,
}

const TONE: Record<PillTone, { bg: string; border: string; fg: string }> = {
  success: { bg: "rgba(31,157,87,0.12)", border: "rgba(31,157,87,0.3)", fg: "#1f7a45" },
  accent: { bg: "rgba(31,77,255,0.1)", border: "rgba(31,77,255,0.3)", fg: "var(--accent)" },
  warning: { bg: "rgba(232,146,12,0.12)", border: "rgba(232,146,12,0.3)", fg: "#b9740a" },
  muted: { bg: "rgba(138,143,152,0.12)", border: "rgba(138,143,152,0.3)", fg: "var(--muted)" },
  error: { bg: "rgba(226,87,74,0.12)", border: "rgba(226,87,74,0.3)", fg: "var(--error, #e2574a)" },
}

// ── Status pill ───────────────────────────────────────────────────────────────

export function SchedulePill({ label, tone }: { label: string; tone: PillTone }) {
  const t = TONE[tone]
  return (
    <span
      style={{
        background: t.bg,
        border: `0.5px solid ${t.border}`,
        color: t.fg,
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 20,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  )
}

// ── Event card ────────────────────────────────────────────────────────────────

export function ScheduleEventCard({
  kind,
  title,
  timeLabel,
  subtitle,
  amountLabel,
  pill,
  onClick,
  actions,
}: {
  kind: ScheduleEventKind
  title: string
  timeLabel: string
  subtitle?: string
  amountLabel?: string
  pill?: { label: string; tone: PillTone }
  onClick?: () => void
  actions?: ReactNode
}) {
  const rail = SCHEDULE_KIND_META[kind].rail
  const inner = (
    <div
      style={{
        display: "flex",
        alignItems: "stretch",
        background: "var(--surface)",
        border: "0.5px solid var(--border)",
        borderRadius: 14,
        overflow: "hidden",
        width: "100%",
      }}
    >
      <div style={{ width: 4, background: rail, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, padding: "11px 13px", display: "flex", flexDirection: "column", gap: 5 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
          <span style={{ color: "var(--faint)", fontSize: 11, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
            {timeLabel}
          </span>
          {amountLabel && <span style={{ color: "var(--text)", fontSize: 12, fontWeight: 700 }}>{amountLabel}</span>}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                color: "var(--text)",
                fontSize: 14,
                fontWeight: 600,
                margin: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {title}
            </p>
            {subtitle && (
              <p
                style={{
                  color: "var(--muted)",
                  fontSize: 11,
                  margin: "2px 0 0",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {subtitle}
              </p>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {pill && <SchedulePill label={pill.label} tone={pill.tone} />}
            {onClick && (
              <span aria-hidden style={{ color: "var(--faint)", fontSize: 16, lineHeight: 1 }}>
                ›
              </span>
            )}
          </div>
        </div>
        {actions && <div style={{ display: "flex", gap: 8, marginTop: 2 }}>{actions}</div>}
      </div>
    </div>
  )

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={{
          display: "block",
          width: "100%",
          padding: 0,
          margin: 0,
          border: "none",
          background: "none",
          textAlign: "left",
          cursor: "pointer",
          font: "inherit",
        }}
      >
        {inner}
      </button>
    )
  }
  return inner
}

// ── Week strip ────────────────────────────────────────────────────────────────

export type WeekStripDay = {
  key: string
  weekdayLabel: string
  dayNumber: string
  isToday?: boolean
  counts?: { confirmed?: number; pending?: number; open?: number; unavailable?: number }
}

function countDots(counts?: WeekStripDay["counts"]): string[] {
  if (!counts) return []
  const out: string[] = []
  if (counts.confirmed) out.push("var(--success)")
  if (counts.pending) out.push("var(--accent)")
  if (counts.open) out.push("var(--warning)")
  if (counts.unavailable) out.push("var(--muted)")
  return out
}

export function WeekStrip({
  days,
  selectedKey,
  onSelect,
}: {
  days: WeekStripDay[]
  selectedKey: string
  onSelect: (key: string) => void
}) {
  return (
    <div style={{ display: "flex", gap: 6, overflowX: "auto", padding: "2px 0" }}>
      {days.map((d) => {
        const selected = d.key === selectedKey
        const dots = countDots(d.counts)
        const borderColor = d.isToday && !selected ? "var(--accent)" : "var(--border)"
        return (
          <button
            key={d.key}
            type="button"
            onClick={() => onSelect(d.key)}
            aria-pressed={selected}
            style={{
              flex: "1 0 auto",
              minWidth: 44,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
              border: selected ? "none" : `0.5px solid ${borderColor}`,
              background: selected ? "var(--accent)" : "var(--surface)",
              color: selected ? "#fff" : "var(--text)",
              borderRadius: 12,
              padding: "8px 6px 6px",
              cursor: "pointer",
              transition: "all 0.12s",
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: selected ? "rgba(255,255,255,0.85)" : "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {d.weekdayLabel}
            </span>
            <span style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{d.dayNumber}</span>
            <span style={{ display: "flex", gap: 2, height: 5, alignItems: "center" }}>
              {dots.map((c, i) => (
                <span
                  key={i}
                  style={{
                    width: 4,
                    height: 4,
                    borderRadius: "50%",
                    background: selected ? "rgba(255,255,255,0.9)" : c,
                  }}
                />
              ))}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// ── Week navigation ───────────────────────────────────────────────────────────

const navBtn: React.CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: 8,
  border: "0.5px solid var(--border)",
  background: "var(--surface)",
  color: "var(--muted)",
  cursor: "pointer",
  fontSize: 16,
  lineHeight: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
}

export function WeekNav({
  rangeLabel,
  onPrev,
  onNext,
  onThisWeek,
  isThisWeek,
}: {
  rangeLabel: string
  onPrev: () => void
  onNext: () => void
  onThisWeek: () => void
  isThisWeek?: boolean
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button type="button" onClick={onPrev} aria-label="Previous week" style={navBtn}>
          ‹
        </button>
        <button type="button" onClick={onNext} aria-label="Next week" style={navBtn}>
          ›
        </button>
        <span style={{ color: "var(--text)", fontSize: 13, fontWeight: 600 }}>{rangeLabel}</span>
      </div>
      <button
        type="button"
        onClick={onThisWeek}
        disabled={isThisWeek}
        style={{
          background: "transparent",
          border: "0.5px solid var(--border)",
          color: isThisWeek ? "var(--faint)" : "var(--accent)",
          borderRadius: 9,
          padding: "6px 11px",
          fontSize: 12,
          fontWeight: 600,
          cursor: isThisWeek ? "default" : "pointer",
        }}
      >
        This week
      </button>
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

export function ScheduleEmpty({ label }: { label?: string }) {
  return (
    <div
      style={{
        padding: "28px 16px",
        textAlign: "center",
        color: "var(--faint)",
        fontSize: 12,
        background: "var(--surface)",
        border: "0.5px dashed var(--border-strong)",
        borderRadius: 14,
      }}
    >
      {label ?? "Nothing scheduled."}
    </div>
  )
}

// ── Agenda (day view) ─────────────────────────────────────────────────────────

export function AgendaList({
  dayLabel,
  events,
  renderCard,
  emptyLabel,
  footer,
}: {
  dayLabel: string
  events: ScheduleEvent[]
  renderCard: (ev: ScheduleEvent) => ReactNode
  emptyLabel?: string
  footer?: ReactNode
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p style={sectionLabel}>{dayLabel}</p>
      {events.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {events.map((ev) => (
            <div key={ev.id}>{renderCard(ev)}</div>
          ))}
        </div>
      ) : (
        <ScheduleEmpty label={emptyLabel} />
      )}
      {footer}
    </div>
  )
}

// ── Hourly timeline (hour view) ───────────────────────────────────────────────

export function HourTimeline({
  hours,
  renderCard,
  windowStart = 6,
  windowEnd = 20,
}: {
  hours: ScheduleHourBucket[]
  renderCard: (ev: ScheduleEvent) => ReactNode
  windowStart?: number
  windowEnd?: number
}) {
  // Each multi-hour event is repeated across every bucket it overlaps; render it
  // only in the bucket where it STARTS so a 08:15–15:30 shift appears once.
  const eventsStartingIn = (h: ScheduleHourBucket) =>
    h.events.filter((ev) => ev.startAt >= h.startAt && ev.startAt < h.endAt)

  // Trim to the span that actually has events, widened to a calm default window.
  let lo = windowStart
  let hi = windowEnd
  const busy = hours.filter((h) => h.events.length)
  if (busy.length) {
    const startHours = busy.map((h) => Number(h.label.slice(0, 2)))
    lo = Math.min(windowStart, ...startHours)
    hi = Math.max(windowEnd, ...startHours.map((x) => x + 1))
  }
  const shown = hours.filter((h) => {
    const hr = Number(h.label.slice(0, 2))
    return hr >= lo && hr < hi
  })

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        border: "0.5px solid var(--border)",
        borderRadius: 14,
        overflow: "hidden",
        background: "var(--surface)",
      }}
    >
      {shown.map((h, i) => {
        const starting = eventsStartingIn(h)
        return (
          <div
            key={h.key}
            style={{
              display: "flex",
              gap: 10,
              padding: "8px 12px",
              borderTop: i === 0 ? "none" : "0.5px solid var(--border)",
              minHeight: 40,
            }}
          >
            <span
              style={{
                width: 42,
                flexShrink: 0,
                color: "var(--faint)",
                fontSize: 11,
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                paddingTop: 2,
              }}
            >
              {h.label}
            </span>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {starting.length ? (
                starting.map((ev) => <div key={ev.id}>{renderCard(ev)}</div>)
              ) : (
                <span style={{ color: "var(--faint)", fontSize: 11, opacity: 0.45 }}>—</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Coverage summaries (employer) ─────────────────────────────────────────────

export function CoverageBar({ filled, open, label }: { filled: number; open: number; label?: string }) {
  const total = filled + open
  const filledPct = total ? (filled / total) * 100 : 0
  const openPct = total ? (open / total) * 100 : 0
  return (
    <div>
      <div style={{ display: "flex", height: 8, borderRadius: 6, overflow: "hidden", background: "var(--surface-2)" }}>
        <div style={{ width: `${filledPct}%`, background: "var(--success)" }} />
        <div style={{ width: `${openPct}%`, background: "var(--warning)" }} />
      </div>
      <p style={{ color: open ? "#b9740a" : "var(--muted)", fontSize: 11, margin: "6px 0 0" }}>
        {label ?? (open ? `${open} open · ${filled} filled` : "Fully covered")}
      </p>
    </div>
  )
}

export function CoverageDonut({ filled, open, label }: { filled: number; open: number; label?: string }) {
  const total = filled + open
  const pct = total ? Math.round((filled / total) * 100) : 100
  const r = 34
  const circ = 2 * Math.PI * r
  const dash = (pct / 100) * circ
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      <div style={{ position: "relative", width: 88, height: 88 }}>
        <svg width="88" height="88" viewBox="0 0 88 88">
          <circle cx="44" cy="44" r={r} fill="none" stroke="var(--surface-2)" strokeWidth="9" />
          <circle
            cx="44"
            cy="44"
            r={r}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circ - dash}`}
            transform="rotate(-90 44 44)"
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span style={{ fontSize: 21, fontWeight: 700, color: "var(--text)" }}>{pct}%</span>
        </div>
      </div>
      <span style={{ fontSize: 12, color: open ? "#b9740a" : "var(--muted)", fontWeight: 600 }}>
        {label ?? (open ? `${open} open cover` : "Fully covered")}
      </span>
    </div>
  )
}
