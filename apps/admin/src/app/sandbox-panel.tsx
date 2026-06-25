"use client";

import { useEffect, useMemo, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200";

type CoverageStatus =
  | "requested"
  | "accepted"
  | "declined"
  | "backup"
  | "compliance-blocked"
  | "role-excluded";

type AvatarCoverage = {
  id: string;
  name: string;
  kind: "employer" | "worker";
  status: CoverageStatus;
  note: string;
};

type Scenario = {
  id: string;
  title: string;
  description: string;
  coverage: AvatarCoverage[];
};

type TimelineItem = {
  id: string;
  at: string;
  actor: "employer" | "v" | "market" | "worker" | "compliance" | "ops";
  action: string;
  summary: string;
  outcome: string;
};

type ScenarioSummary = {
  conversations: number;
  bookingRequests: number;
  matches: number;
  offers: number;
  bookings: number;
  shifts: number;
  timesheets: number;
  invoices: number;
  auditEvents: number;
};

type ScenarioRun = {
  runId: string;
  scenarioId: string;
  title: string;
  summary: ScenarioSummary;
  timeline: TimelineItem[];
  coverage: AvatarCoverage[];
};

const EMPTY_SUMMARY: ScenarioSummary = {
  conversations: 0,
  bookingRequests: 0,
  matches: 0,
  offers: 0,
  bookings: 0,
  shifts: 0,
  timesheets: 0,
  invoices: 0,
  auditEvents: 0,
};

const ACTOR_LABELS: Record<TimelineItem["actor"], string> = {
  employer: "Employer",
  v: "V",
  market: "Market",
  worker: "Worker",
  compliance: "Compliance",
  ops: "Ops",
};

const STATUS_COLORS: Record<CoverageStatus, string> = {
  requested: "var(--accent)",
  accepted: "var(--success)",
  declined: "var(--muted)",
  backup: "var(--warning)",
  "compliance-blocked": "var(--error)",
  "role-excluded": "var(--faint)",
};

function label(value: string) {
  return value.replace(/-/g, " ");
}

async function postJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as T;
}

export function SandboxPanel() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedId, setSelectedId] = useState<string>("single-cover-loop");
  const [run, setRun] = useState<ScenarioRun | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/v1/admin/sandbox/scenarios`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load sandbox scenarios");
        return res.json() as Promise<{ scenarios: Scenario[] }>;
      })
      .then((data) => {
        setScenarios(data.scenarios);
        if (data.scenarios[0]) setSelectedId(data.scenarios[0].id);
      })
      .catch(() => setError("Could not load sandbox scenarios. Is the API running on :6200?"));
  }, []);

  const selectedScenario = useMemo(
    () => scenarios.find((scenario) => scenario.id === selectedId) ?? scenarios[0],
    [scenarios, selectedId],
  );
  const coverage = run?.coverage ?? selectedScenario?.coverage ?? [];
  const summary = run?.summary ?? EMPTY_SUMMARY;

  async function runScenario(id: string) {
    setLoading(id);
    setError(null);
    try {
      const result = await postJson<ScenarioRun>(`/v1/admin/sandbox/scenarios/${id}/run`);
      setRun(result);
      setSelectedId(id);
    } catch {
      setError("Scenario run failed. Check the API console for details.");
    } finally {
      setLoading(null);
    }
  }

  async function resetSandbox() {
    setLoading("reset");
    setError(null);
    try {
      await postJson<{ success: boolean }>("/v1/admin/sandbox/reset");
      setRun(null);
    } catch {
      setError("Sandbox reset failed. Check the API console for details.");
    } finally {
      setLoading(null);
    }
  }

  if (scenarios.length === 0 && !error) {
    return <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>Loading sandbox...</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      {error && (
        <div
          style={{
            border: "1px solid rgba(226, 87, 74, 0.35)",
            color: "var(--error)",
            borderRadius: 8,
            padding: "0.75rem 0.875rem",
            fontSize: "0.875rem",
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: "0.75rem",
        }}
      >
        {scenarios.map((scenario) => {
          const active = selectedId === scenario.id;
          return (
            <button
              key={scenario.id}
              type="button"
              onClick={() => setSelectedId(scenario.id)}
              style={{
                textAlign: "left",
                border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                background: active ? "rgba(31, 77, 255, 0.05)" : "var(--surface)",
                borderRadius: 8,
                padding: "0.875rem",
                color: "var(--text)",
                minHeight: 132,
              }}
            >
              <strong style={{ display: "block", fontSize: "0.9375rem", marginBottom: "0.35rem" }}>
                {scenario.title}
              </strong>
              <span style={{ color: "var(--muted)", fontSize: "0.8125rem", display: "block" }}>
                {scenario.description}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={!selectedScenario || loading !== null}
          onClick={() => selectedScenario && runScenario(selectedScenario.id)}
          style={primaryButtonStyle}
        >
          {loading && loading !== "reset" ? "Running..." : "Run scenario"}
        </button>
        <button type="button" disabled={loading !== null} onClick={resetSandbox} style={ghostButtonStyle}>
          {loading === "reset" ? "Resetting..." : "Reset sandbox"}
        </button>
        {run && (
          <span style={{ alignSelf: "center", color: "var(--muted)", fontSize: "0.75rem" }}>
            Latest run: <code>{run.runId}</code>
          </span>
        )}
      </div>

      <SummaryGrid summary={summary} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.15fr) minmax(280px, 0.85fr)",
          gap: "1rem",
          alignItems: "start",
        }}
      >
        <Timeline items={run?.timeline ?? []} />
        <CoverageTable coverage={coverage} />
      </div>
    </div>
  );
}

function SummaryGrid({ summary }: { summary: ScenarioSummary }) {
  const items = [
    ["Conversations", summary.conversations],
    ["Requests", summary.bookingRequests],
    ["Matches", summary.matches],
    ["Offers", summary.offers],
    ["Bookings", summary.bookings],
    ["Shifts", summary.shifts],
    ["Timesheets", summary.timesheets],
    ["Invoices", summary.invoices],
    ["Audits", summary.auditEvents],
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
        gap: "0.625rem",
      }}
    >
      {items.map(([name, value]) => (
        <div
          key={name}
          style={{
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "0.75rem",
            background: "var(--surface-2)",
          }}
        >
          <p style={{ fontSize: "1.35rem", fontWeight: 600, lineHeight: 1 }}>{value}</p>
          <p style={{ color: "var(--muted)", fontSize: "0.75rem", marginTop: "0.3rem" }}>{name}</p>
        </div>
      ))}
    </div>
  );
}

function Timeline({ items }: { items: TimelineItem[] }) {
  const grouped = items.reduce<Record<string, TimelineItem[]>>((acc, item) => {
    const key = item.actor;
    acc[key] = acc[key] ?? [];
    acc[key].push(item);
    return acc;
  }, {});

  return (
    <section style={sectionStyle}>
      <h3 style={sectionTitleStyle}>Timeline</h3>
      {items.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>
          Run a scenario to see the full request and booking loop.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          {Object.entries(grouped).map(([actor, actorItems]) => (
            <div key={actor}>
              <p
                style={{
                  color: "var(--faint)",
                  fontSize: "0.7rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: "0.35rem",
                }}
              >
                {ACTOR_LABELS[actor as TimelineItem["actor"]] ?? actor}
              </p>
              <ol style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                {actorItems.map((item) => (
                  <li
                    key={item.id}
                    style={{
                      borderLeft: "2px solid var(--accent)",
                      padding: "0.1rem 0 0.1rem 0.65rem",
                    }}
                  >
                    <p style={{ fontSize: "0.875rem", color: "var(--text)" }}>{item.summary}</p>
                    <p style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: "0.1rem" }}>
                      {new Date(item.at).toLocaleTimeString("en-GB", {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}{" "}
                      - {label(item.outcome)}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CoverageTable({ coverage }: { coverage: AvatarCoverage[] }) {
  return (
    <section style={sectionStyle}>
      <h3 style={sectionTitleStyle}>Avatar Coverage</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
        {coverage.map((item) => (
          <div
            key={item.id}
            style={{
              borderBottom: "1px solid var(--border)",
              paddingBottom: "0.45rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
              <p style={{ fontSize: "0.8125rem", fontWeight: 500 }}>{item.name}</p>
              <span
                style={{
                  color: STATUS_COLORS[item.status],
                  fontSize: "0.68rem",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {label(item.status)}
              </span>
            </div>
            <p style={{ color: "var(--muted)", fontSize: "0.72rem", marginTop: "0.1rem" }}>
              {item.kind} - {item.note}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

const sectionStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  background: "var(--surface)",
  padding: "1rem",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: "0.95rem",
  fontWeight: 600,
  marginBottom: "0.75rem",
};

const primaryButtonStyle: React.CSSProperties = {
  border: "none",
  borderRadius: 6,
  background: "var(--accent)",
  color: "#fff",
  padding: "0.55rem 0.85rem",
  fontSize: "0.8125rem",
  fontWeight: 600,
};

const ghostButtonStyle: React.CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 6,
  background: "transparent",
  color: "var(--text)",
  padding: "0.55rem 0.85rem",
  fontSize: "0.8125rem",
  fontWeight: 600,
};
