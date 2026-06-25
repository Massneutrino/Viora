"use client";

import { useMemo, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200";

type MemoryOwnerType = "organisation" | "worker";
type MemoryVisibility = "private" | "operational" | "shared";
type MemoryKind =
  | "preference"
  | "instruction"
  | "pattern"
  | "risk"
  | "fit_signal"
  | "briefing_note"
  | "availability_signal"
  | "pay_signal"
  | "feedback_summary";

export type MemoryLabState = {
  organisations: Array<{ id: string; name: string; sites: Array<{ id: string; name: string }> }>;
  workers: Array<{
    id: string;
    name: string;
    roleTypes: string[];
    compliance: Record<string, string | boolean | null>;
  }>;
  bookingRequests: Array<{
    id: string;
    organisationId: string;
    organisationName: string;
    siteId: string;
    siteName: string;
    roleType: string;
    status: string;
  }>;
  memories: Array<{
    id: string;
    ownerType: MemoryOwnerType;
    ownerId: string;
    kind: MemoryKind;
    title: string;
    content: string;
    visibility: MemoryVisibility;
    status: string;
    confidence: number;
    updatedAt: string;
  }>;
  edges: Array<{
    id: string;
    ownerType: MemoryOwnerType;
    ownerId: string;
    fromType: string;
    fromId: string;
    toType: string;
    toId: string;
    kind: MemoryKind;
    label: string;
    weight: number;
    confidence: number;
    evidenceCount: number;
    status: string;
  }>;
  pending: MemoryLabState["memories"];
  audit: Array<{ id: string; action: string; entityId: string; outcome: string; createdAt: string }>;
};

type ScenarioResult = {
  runId: string;
  scenario: string;
  result: Record<string, unknown>;
  state: MemoryLabState;
};

const EMPTY_STATE: MemoryLabState = {
  organisations: [],
  workers: [],
  bookingRequests: [],
  memories: [],
  edges: [],
  pending: [],
  audit: [],
};

const memoryKinds: MemoryKind[] = [
  "preference",
  "instruction",
  "pattern",
  "risk",
  "fit_signal",
  "briefing_note",
  "availability_signal",
  "pay_signal",
  "feedback_summary",
];

function label(value: string) {
  return value.replace(/_/g, " ").replace(/-/g, " ");
}

async function postJson<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as T;
}

const inputStyle = {
  width: "100%",
  border: "0.5px solid var(--border)",
  borderRadius: 8,
  padding: "0.55rem 0.65rem",
  background: "var(--surface)",
  color: "var(--text)",
  fontSize: "0.8125rem",
};

const buttonStyle = {
  border: "0.5px solid var(--border)",
  borderRadius: 8,
  padding: "0.5rem 0.7rem",
  background: "var(--surface)",
  color: "var(--text)",
  fontSize: "0.8125rem",
  fontWeight: 600,
};

const mutedStyle = { color: "var(--muted)", fontSize: "0.8125rem" };

function MiniList({
  empty,
  items,
}: {
  empty: string;
  items: string[];
}) {
  if (items.length === 0) return <p style={mutedStyle}>{empty}</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {items.map((item) => (
        <div
          key={item}
          style={{
            border: "0.5px solid var(--border)",
            borderRadius: 8,
            padding: "0.625rem 0.7rem",
            fontSize: "0.8125rem",
            color: "var(--text)",
          }}
        >
          {item}
        </div>
      ))}
    </div>
  );
}

export function MemoryLab({ initial }: { initial?: MemoryLabState }) {
  const [state, setState] = useState<MemoryLabState>(initial ?? EMPTY_STATE);
  const [ownerType, setOwnerType] = useState<MemoryOwnerType>("organisation");
  const [ownerId, setOwnerId] = useState(initial?.organisations[0]?.id ?? "demo-org");
  const [workerId, setWorkerId] = useState(initial?.workers[0]?.id ?? "demo-worker");
  const [bookingRequestId, setBookingRequestId] = useState(
    initial?.bookingRequests.find((request) => request.id === "demo-booking-request")?.id ??
      initial?.bookingRequests[0]?.id ??
      "demo-booking-request",
  );
  const [kind, setKind] = useState<MemoryKind>("preference");
  const [visibility, setVisibility] = useState<MemoryVisibility>("operational");
  const [title, setTitle] = useState("Prefers repeat workers");
  const [content, setContent] = useState("Use familiar, compliant workers first when the site context is similar.");
  const [note, setNote] = useState(
    "Greenfield often rebooks KS2 teachers with SEN confidence and wants gate instructions in the briefing.",
  );
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScenarioResult | null>(null);

  const ownerOptions = ownerType === "organisation" ? state.organisations : state.workers;
  const selectedWorker = state.workers.find((worker) => worker.id === workerId);
  const ineligibleWorker = useMemo(
    () =>
      state.workers.find(
        (worker) =>
          worker.id === "demo-worker-5" ||
          worker.compliance.dbsStatus !== "verified" ||
          worker.compliance.rightToWorkStatus !== "verified",
      ) ?? state.workers[0],
    [state.workers],
  );

  async function createMemory() {
    setLoading("memory");
    setError(null);
    try {
      const response = await postJson<{ state: MemoryLabState }>("/v1/admin/sandbox/memory-lab/memory", {
        ownerType,
        ownerId,
        kind,
        title,
        content,
        visibility,
        status: visibility === "private" ? "pending_confirmation" : "active",
        confidence: visibility === "private" ? 0.7 : 0.9,
      });
      setState(response.state);
    } catch {
      setError("Could not create lab memory. Check the API console.");
    } finally {
      setLoading(null);
    }
  }

  async function runScenario(scenario: ScenarioResult["scenario"]) {
    setLoading(scenario);
    setError(null);
    try {
      const response = await postJson<ScenarioResult>("/v1/admin/sandbox/memory-lab/scenarios/run", {
        scenario,
        organisationId: state.organisations[0]?.id ?? "demo-org",
        workerId: scenario === "ineligible_memory_boundary" ? ineligibleWorker?.id : workerId,
        bookingRequestId,
        note,
      });
      setResult(response);
      setState(response.state);
    } catch {
      setError("Memory Lab scenario failed. Check the API console.");
    } finally {
      setLoading(null);
    }
  }

  async function resetLab() {
    setLoading("reset");
    setError(null);
    try {
      const response = await postJson<{ state: MemoryLabState }>("/v1/admin/sandbox/memory-lab/reset");
      setResult(null);
      setState(response.state);
    } catch {
      setError("Memory Lab reset failed. Check the API console.");
    } finally {
      setLoading(null);
    }
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

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.9rem" }}>
        <label style={mutedStyle}>
          Owner
          <select
            value={ownerType}
            onChange={(event) => {
              const next = event.target.value as MemoryOwnerType;
              setOwnerType(next);
              setOwnerId(next === "organisation" ? state.organisations[0]?.id ?? "" : state.workers[0]?.id ?? "");
            }}
            style={{ ...inputStyle, marginTop: "0.35rem" }}
          >
            <option value="organisation">Organisation</option>
            <option value="worker">Worker</option>
          </select>
        </label>
        <label style={mutedStyle}>
          Subject
          <select
            value={ownerId}
            onChange={(event) => setOwnerId(event.target.value)}
            style={{ ...inputStyle, marginTop: "0.35rem" }}
          >
            {ownerOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        <label style={mutedStyle}>
          Kind
          <select value={kind} onChange={(event) => setKind(event.target.value as MemoryKind)} style={{ ...inputStyle, marginTop: "0.35rem" }}>
            {memoryKinds.map((item) => (
              <option key={item} value={item}>
                {label(item)}
              </option>
            ))}
          </select>
        </label>
        <label style={mutedStyle}>
          Visibility
          <select
            value={visibility}
            onChange={(event) => setVisibility(event.target.value as MemoryVisibility)}
            style={{ ...inputStyle, marginTop: "0.35rem" }}
          >
            <option value="operational">Operational</option>
            <option value="private">Private</option>
            <option value="shared">Shared</option>
          </select>
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.5fr)", gap: "0.9rem" }}>
        <input value={title} onChange={(event) => setTitle(event.target.value)} style={inputStyle} />
        <input value={content} onChange={(event) => setContent(event.target.value)} style={inputStyle} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem" }}>
        <button type="button" onClick={createMemory} disabled={loading !== null} style={buttonStyle}>
          {loading === "memory" ? "Adding..." : "Add memory"}
        </button>
        <button type="button" onClick={resetLab} disabled={loading !== null} style={buttonStyle}>
          Reset lab
        </button>
      </div>

      <div style={{ borderTop: "0.5px solid var(--border)", paddingTop: "1rem" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.9rem" }}>
          <label style={mutedStyle}>
            Worker
            <select value={workerId} onChange={(event) => setWorkerId(event.target.value)} style={{ ...inputStyle, marginTop: "0.35rem" }}>
              {state.workers.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.name}
                </option>
              ))}
            </select>
          </label>
          <label style={mutedStyle}>
            Booking request
            <select
              value={bookingRequestId}
              onChange={(event) => setBookingRequestId(event.target.value)}
              style={{ ...inputStyle, marginTop: "0.35rem" }}
            >
              {state.bookingRequests.map((request) => (
                <option key={request.id} value={request.id}>
                  {request.id} - {label(request.roleType)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={3}
          style={{ ...inputStyle, marginTop: "0.9rem", resize: "vertical" }}
        />

        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.6rem", marginTop: "0.75rem" }}>
          <button type="button" onClick={() => runScenario("worker_accepts_offer")} disabled={loading !== null} style={buttonStyle}>
            Accept offer
          </button>
          <button type="button" onClick={() => runScenario("worker_declines_offer")} disabled={loading !== null} style={buttonStyle}>
            Decline offer
          </button>
          <button type="button" onClick={() => runScenario("infer_from_note")} disabled={loading !== null} style={buttonStyle}>
            Infer from note
          </button>
          <button type="button" onClick={() => runScenario("ineligible_memory_boundary")} disabled={loading !== null} style={buttonStyle}>
            Compliance boundary
          </button>
        </div>
      </div>

      {result && (
        <div style={{ border: "0.5px solid var(--border)", borderRadius: 8, padding: "0.75rem" }}>
          <p style={{ fontSize: "0.8125rem", fontWeight: 600 }}>{label(result.scenario)} - {result.runId}</p>
          <pre style={{ ...mutedStyle, overflowX: "auto", marginTop: "0.5rem" }}>
            {JSON.stringify(result.result, null, 2)}
          </pre>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "0.9rem" }}>
        <section>
          <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem" }}>Lab memories</h3>
          <MiniList
            empty="No lab memories yet."
            items={state.memories.slice(0, 8).map((memory) =>
              `${label(memory.kind)} - ${memory.title} - ${memory.visibility} - ${memory.status} - ${(memory.confidence * 100).toFixed(0)}%`,
            )}
          />
        </section>
        <section>
          <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem" }}>Memory graph edges</h3>
          <MiniList
            empty="No lab edges yet."
            items={state.edges.slice(0, 8).map((edge) =>
              `${edge.label} - weight ${edge.weight.toFixed(2)} - confidence ${edge.confidence.toFixed(2)} - evidence ${edge.evidenceCount}`,
            )}
          />
        </section>
        <section>
          <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem" }}>Pending inferred</h3>
          <MiniList
            empty="No lab memories pending review."
            items={state.pending.slice(0, 8).map((memory) => `${memory.title} - ${(memory.confidence * 100).toFixed(0)}%`)}
          />
        </section>
        <section>
          <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem" }}>Recent memory audit</h3>
          <MiniList
            empty="No memory audit events yet."
            items={state.audit.slice(0, 8).map((event) => `${event.action} - ${event.outcome} - ${event.entityId}`)}
          />
        </section>
      </div>

      {selectedWorker && (
        <p style={mutedStyle}>
          Selected worker: {selectedWorker.name} - {selectedWorker.roleTypes.map(label).join(", ")} - DBS{" "}
          {String(selectedWorker.compliance.dbsStatus)}
        </p>
      )}
    </div>
  );
}
