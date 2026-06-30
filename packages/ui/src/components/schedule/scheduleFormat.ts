// Pure date / timezone / formatting helpers for the schedule UI.
//
// Why this lives here (not in the apps): both web apps render the same week
// strip + agenda, so the formatting must be identical. Why pure TS (no React,
// no "use client"): it is render-math only and is the single place that owns
// timezone-correct formatting + week arithmetic.
//
// We import ONLY types from @viora/domain (erased at build → zero runtime cost,
// no domain barrel pulled into the client bundle) and re-implement the tiny
// `dayKey` so our client keys match the server's `ScheduleDay.key` exactly.

import type { ScheduleEvent, ScheduleEventKind } from "@viora/domain"

export const DEFAULT_TZ = "Europe/London"

export type PillTone = "success" | "accent" | "warning" | "muted" | "error"

export type WeekRange = { from: string; to: string }

// ── Day key (mirrors @viora/domain scheduleDayKey so keys line up) ────────────

/** "YYYY-MM-DD" for the calendar day of `date` in `tz`. Matches ScheduleDay.key. */
export function dayKey(date: Date | string, tz: string = DEFAULT_TZ): string {
  const value = typeof date === "string" ? new Date(date) : date
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value)
  const by = Object.fromEntries(parts.map((p) => [p.type, p.value]))
  return `${by.year}-${by.month}-${by.day}`
}

// ── Week arithmetic (UTC-anchored, matching the API's defaultRange) ───────────

/** Monday 00:00 UTC of the week containing `d`. */
export function startOfWeekMonday(d: Date): Date {
  const x = new Date(d)
  x.setUTCHours(0, 0, 0, 0)
  const daysSinceMonday = (x.getUTCDay() + 6) % 7 // getUTCDay: 0=Sun..6=Sat
  x.setUTCDate(x.getUTCDate() - daysSinceMonday)
  return x
}

export function addDaysUtc(d: Date, n: number): Date {
  const x = new Date(d)
  x.setUTCDate(x.getUTCDate() + n)
  return x
}

export function addWeeks(d: Date, n: number): Date {
  return addDaysUtc(d, n * 7)
}

/** A 7-day window [Mon 00:00, next Mon 00:00) as ISO strings. */
export function weekRangeFromAnchor(anchor: Date): WeekRange {
  const from = startOfWeekMonday(anchor)
  return { from: from.toISOString(), to: addDaysUtc(from, 7).toISOString() }
}

/** ISO bounds [day 00:00, next day 00:00) for the calendar day `dayKeyStr` in `tz`. */
export function dayRange(dayKeyStr: string, tz: string = DEFAULT_TZ): WeekRange {
  // dayKeyStr is already "YYYY-MM-DD" (zero-padded), so pass it straight through.
  const from = zonedIso(dayKeyStr, "00:00", tz)
  const next = addDaysUtc(new Date(from), 1)
  return { from, to: next.toISOString() }
}

// ── Display formatting ────────────────────────────────────────────────────────

export function formatWeekdayShort(date: Date, tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "short" }).format(date)
}

export function formatDayNumber(date: Date, tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric" }).format(date)
}

/** "Mon 15 Jan" — for an agenda header when no server-provided label is handy. */
export function formatEventDayLabel(iso: string, tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "short",
  }).format(new Date(iso))
}

/** Compact week range label, e.g. "19–25 May" or "28 Apr–4 May". */
export function formatWeekRangeLabel(fromIso: string, tz: string = DEFAULT_TZ): string {
  const from = new Date(fromIso)
  const to = addDaysUtc(from, 6)
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric" })
  const mon = new Intl.DateTimeFormat("en-GB", { timeZone: tz, month: "short" })
  const fromMon = mon.format(from)
  const toMon = mon.format(to)
  return fromMon === toMon
    ? `${day.format(from)}–${day.format(to)} ${toMon}`
    : `${day.format(from)} ${fromMon}–${day.format(to)} ${toMon}`
}

/** "08:15–15:30" — each side formatted in the event's own timezone. */
export function formatEventTimeRange(
  ev: Pick<ScheduleEvent, "startAt" | "endAt" | "timezone">,
): string {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: ev.timezone || DEFAULT_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
  return `${fmt.format(new Date(ev.startAt))}–${fmt.format(new Date(ev.endAt))}`
}

// ── Timezone-correct write helper ─────────────────────────────────────────────

/** Offset of `tz` from UTC at `date`, in minutes (e.g. +60 during BST). */
function tzOffsetMinutes(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date)
  const by = Object.fromEntries(parts.map((p) => [p.type, p.value]))
  // 24:00 can surface as hour "24" in some runtimes — normalise to 0.
  const hour = Number(by.hour) % 24
  const asUtc = Date.UTC(
    Number(by.year),
    Number(by.month) - 1,
    Number(by.day),
    hour,
    Number(by.minute),
    Number(by.second),
  )
  return Math.round((asUtc - date.getTime()) / 60000)
}

/**
 * Turn a wall-clock `dateStr` ("YYYY-MM-DD") + `timeStr` ("HH:MM") in `tz` into
 * the correct absolute UTC instant (ISO). Availability blocks store instants, so
 * we must not let the browser's local timezone leak in via `new Date(localStr)`.
 */
export function zonedIso(dateStr: string, timeStr: string, tz: string = DEFAULT_TZ): string {
  const [y = 0, mo = 1, d = 1] = dateStr.split("-").map(Number)
  const [h = 0, mi = 0] = timeStr.split(":").map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0, 0)
  const offset = tzOffsetMinutes(new Date(guess), tz)
  return new Date(guess - offset * 60000).toISOString()
}

// ── Kind → presentation tokens ────────────────────────────────────────────────

export const SCHEDULE_KIND_META: Record<
  ScheduleEventKind,
  { label: string; tone: PillTone; rail: string }
> = {
  confirmed_shift: { label: "Confirmed", tone: "success", rail: "var(--success)" },
  pending_offer: { label: "Pending offer", tone: "accent", rail: "var(--accent)" },
  open_request: { label: "Open cover", tone: "warning", rail: "var(--warning)" },
  unavailable_block: { label: "Unavailable", tone: "muted", rail: "var(--muted)" },
}
