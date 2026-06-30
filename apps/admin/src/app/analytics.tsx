"use client";

import { type CSSProperties, useState } from "react";
import { formatLabel, type OpsCount } from "./ui";

type ToneKind = "success" | "warning" | "error" | "neutral";

/**
 * Classify a status/outcome key into a semantic tone.
 *
 * Failures/degradations are checked first so an operational problem is never
 * masked by a coincidental match. The substring sets cover the open-ended
 * `AuditEvent.outcome` values (e.g. `degraded_llm_unavailable`,
 * `blocked_dynamic_rate_*`, `no_eligible_candidates`) as well as the fixed
 * entity statuses rendered by the other breakdown panels.
 */
function toneKind(key: string): ToneKind {
  const k = key.toLowerCase();
  if (
    [
      "declined", "expired", "rejected", "cancelled", "no_show", "failed",
      "degraded", "unavailable", "blocked", "error", "no_eligible", "no_replacement",
    ].some((s) => k.includes(s))
  )
    return "error";
  if (["accepted", "verified", "filled", "completed", "checked_out", "success", "paid"].includes(k))
    return "success";
  if (
    ["pending", "broadcasting", "at_risk", "pre_shift_check", "draft", "sent"].includes(k) ||
    ["clarification", "queued"].some((s) => k.includes(s))
  )
    return "warning";
  return "neutral";
}

const TONE_VAR: Record<ToneKind, string> = {
  success: "var(--success)",
  warning: "var(--warning)",
  error: "var(--error)",
  neutral: "var(--accent)",
};

/** Map a status key to the CSS var for its bar/label colour. */
function toneFor(key: string): string {
  return TONE_VAR[toneKind(key)];
}

const cardStyle: CSSProperties = {
  background: "var(--surface)",
  border: "0.5px solid var(--border)",
  borderRadius: 14,
  padding: "1.25rem",
};

/** One `label · count` row with a thin proportional bar (scaled against `max`). */
function BarRow({ item, max }: { item: OpsCount; max: number }) {
  const pct = max > 0 ? Math.max(4, Math.round((item.count / max) * 100)) : 0;
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.8125rem",
          marginBottom: 4,
        }}
      >
        <span style={{ color: "var(--text)" }}>{formatLabel(item.key)}</span>
        <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
          {item.count}
        </span>
      </div>
      <div
        style={{ height: 6, borderRadius: 6, background: "var(--surface-2)", overflow: "hidden" }}
      >
        <div style={{ width: `${pct}%`, height: "100%", background: toneFor(item.key) }} />
      </div>
    </div>
  );
}

/**
 * A titled breakdown: rows of `label · count` each with a thin proportional bar.
 * Bars are scaled against the largest bucket so the shape is readable at a glance.
 */
export function BreakdownPanel({ title, counts }: { title: string; counts: OpsCount[] }) {
  const max = counts.reduce((m, c) => Math.max(m, c.count), 0);
  return (
    <section style={cardStyle}>
      <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.875rem" }}>{title}</h2>
      {counts.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>No data yet</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          {counts.map((c) => (
            <BarRow key={c.key} item={c} max={max} />
          ))}
        </div>
      )}
    </section>
  );
}

const CHIP_COLORS: Record<"success" | "warning" | "error", { bg: string; text: string }> = {
  success: { bg: "rgba(31,157,87,0.1)", text: "var(--success)" },
  warning: { bg: "rgba(232,146,12,0.1)", text: "var(--warning)" },
  error: { bg: "rgba(226,87,74,0.1)", text: "var(--error)" },
};

/** A small pill summarising one tone bucket (dot + count + label). */
function SummaryChip({
  kind,
  value,
  label,
}: {
  kind: "success" | "warning" | "error";
  value: number;
  label: string;
}) {
  const c = CHIP_COLORS[kind];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: c.bg,
        color: c.text,
        fontSize: "0.75rem",
        padding: "3px 10px",
        borderRadius: 20,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.text }} />
      <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{value}</span>
      <span>{label}</span>
    </span>
  );
}

/**
 * Agent outcomes is an open-ended, ever-growing breakdown (grouped from
 * `AuditEvent.outcome`). Rendered as a plain BreakdownPanel it becomes 20+
 * undifferentiated rows, so instead we (1) lead with a health summary,
 * (2) pin failure/at-risk rows to the top, and (3) collapse the routine
 * long-tail behind a toggle so the panel stays a sensible height.
 */
export function AgentOutcomesPanel({ title, counts }: { title: string; counts: OpsCount[] }) {
  const [expanded, setExpanded] = useState(false);
  const max = counts.reduce((m, c) => Math.max(m, c.count), 0);

  // counts arrive pre-sorted by count desc (see toCounts in ops-agent.ts).
  const tagged = counts.map((c) => ({ ...c, tone: toneKind(c.key) }));
  const attention = tagged.filter((c) => c.tone === "error" || c.tone === "warning");
  const routine = tagged.filter((c) => c.tone === "success" || c.tone === "neutral");

  // Always show every attention row, plus enough routine rows to reach ~8 total.
  const routineHead = Math.max(3, 8 - attention.length);
  const visibleRoutine = expanded ? routine : routine.slice(0, routineHead);
  const hidden = routine.length - routineHead;

  let failed = 0;
  let atRisk = 0;
  let ok = 0;
  for (const c of tagged) {
    if (c.tone === "error") failed += c.count;
    else if (c.tone === "warning") atRisk += c.count;
    else ok += c.count; // success + neutral — not flagged
  }

  const scrollStyle: CSSProperties = expanded ? { maxHeight: 360, overflowY: "auto" } : {};

  return (
    <section style={cardStyle}>
      <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.75rem" }}>{title}</h2>
      {counts.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>No data yet</p>
      ) : (
        <>
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: "0.375rem", marginBottom: "0.875rem" }}
          >
            {failed > 0 && <SummaryChip kind="error" value={failed} label="failed" />}
            {atRisk > 0 && <SummaryChip kind="warning" value={atRisk} label="at risk" />}
            {ok > 0 && <SummaryChip kind="success" value={ok} label="ok" />}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem", ...scrollStyle }}>
            {attention.map((c) => (
              <BarRow key={c.key} item={c} max={max} />
            ))}
            {visibleRoutine.map((c) => (
              <BarRow key={c.key} item={c} max={max} />
            ))}
          </div>
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              style={{
                marginTop: "0.75rem",
                background: "rgba(31,77,255,0.08)",
                border: "0.5px solid var(--border)",
                color: "var(--accent)",
                fontSize: "0.75rem",
                padding: "4px 12px",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              {expanded ? "Show less" : `Show all (${counts.length})`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

/** A compact label + value used in the financial mini-row. */
export function MiniStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "accent" | "warning";
}) {
  const color =
    tone === "accent" ? "var(--accent)" : tone === "warning" ? "var(--warning)" : "var(--text)";
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "0.5px solid var(--border)",
        borderRadius: 12,
        padding: "0.75rem 1rem",
        flex: "1 1 130px",
      }}
    >
      <p style={{ fontSize: "1.125rem", fontWeight: 600, color, lineHeight: 1.2 }}>{value}</p>
      <p style={{ color: "var(--muted)", fontSize: "0.75rem", marginTop: 2 }}>{label}</p>
    </div>
  );
}
