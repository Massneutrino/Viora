import { formatLabel, type OpsCount } from "./ui";

/** Map common status keys to a semantic tone for the bar/label colour. */
function toneFor(key: string): string {
  const k = key.toLowerCase();
  if (["accepted", "verified", "filled", "completed", "checked_out", "success", "paid"].includes(k))
    return "var(--success)";
  if (["pending", "broadcasting", "at_risk", "pre_shift_check", "draft", "sent"].includes(k))
    return "var(--warning)";
  if (
    ["declined", "expired", "rejected", "cancelled", "no_show", "failed"].some((s) => k.includes(s))
  )
    return "var(--error)";
  return "var(--accent)";
}

/**
 * A titled breakdown: rows of `label · count` each with a thin proportional bar.
 * Bars are scaled against the largest bucket so the shape is readable at a glance.
 */
export function BreakdownPanel({ title, counts }: { title: string; counts: OpsCount[] }) {
  const max = counts.reduce((m, c) => Math.max(m, c.count), 0);
  return (
    <section
      style={{
        background: "var(--surface)",
        border: "0.5px solid var(--border)",
        borderRadius: 14,
        padding: "1.25rem",
      }}
    >
      <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "0.875rem" }}>{title}</h2>
      {counts.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>No data yet</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
          {counts.map((c) => {
            const tone = toneFor(c.key);
            const pct = max > 0 ? Math.max(4, Math.round((c.count / max) * 100)) : 0;
            return (
              <div key={c.key}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "0.8125rem",
                    marginBottom: 4,
                  }}
                >
                  <span style={{ color: "var(--text)" }}>{formatLabel(c.key)}</span>
                  <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>
                    {c.count}
                  </span>
                </div>
                <div
                  style={{
                    height: 6,
                    borderRadius: 6,
                    background: "var(--surface-2)",
                    overflow: "hidden",
                  }}
                >
                  <div style={{ width: `${pct}%`, height: "100%", background: tone }} />
                </div>
              </div>
            );
          })}
        </div>
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
