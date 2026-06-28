"use client";

import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200";

export type MemoryReviewItem = {
  id: string;
  ownerType: string;
  ownerId: string;
  subjectType: string;
  subjectId: string;
  kind: string;
  title: string;
  content: string;
  visibility: string;
  status: string;
  useScopes: string[];
  sensitivity: string;
  sourceLabel?: string | null;
  connectorType?: string | null;
  connectorRef?: string | null;
  confidence: number;
  createdAt: string;
};

export type MemoryEvidenceData = {
  episodes: Array<{
    id: string;
    ownerType: string;
    ownerId: string;
    subjectType: string;
    subjectId: string;
    kind: string;
    label: string;
    sourceType: string;
    sourceRefType?: string | null;
    sourceRefId?: string | null;
    outcome: string;
    occurredAt: string;
    affectedEdgeIds: string[];
    metadata?: Record<string, unknown> | null;
  }>;
  edges: Array<{
    id: string;
    ownerType: string;
    ownerId: string;
    kind: string;
    label: string;
    weight: number;
    confidence: number;
    evidenceCount: number;
    status: string;
    visibility: string;
    decayPolicy: string;
    lastEvidenceAt?: string | null;
  }>;
  influence: Array<{
    id: string;
    entityType: string;
    entityId: string;
    outcome: string;
    createdAt: string;
    inputs?: Record<string, unknown> | null;
    outputs?: Record<string, unknown> | null;
  }>;
};

export const EMPTY_MEMORY_EVIDENCE: MemoryEvidenceData = { episodes: [], edges: [], influence: [] };

export type MemoryConsolidationSuggestion = {
  id: string;
  action: string;
  status: string;
  ownerType: string;
  ownerId: string;
  affectedMemoryIds: string[];
  affectedEdgeIds: string[];
  title: string;
  explanation: string;
  inputs?: Record<string, unknown> | null;
  createdAt: string;
};

function short(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function time(value: string): string {
  return new Date(value).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

function actionLabel(action: string): string {
  if (action === "propose_playbook") return "Procedural playbook";
  if (action === "propose_briefing_note") return "Briefing learning";
  if (action === "propose_fit_feedback") return "Fit feedback";
  return action.replace(/_/g, " ");
}

export function MemoryReview({ initial }: { initial: MemoryReviewItem[] }) {
  const [items, setItems] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function update(id: string, status: "active" | "archived") {
    setBusyId(id);
    try {
      const res = await fetch(`${API_URL}/v1/admin/memory/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, adminId: "admin" }),
      });
      if (!res.ok) throw new Error("update failed");
      setItems((prev) => prev.filter((item) => item.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>No memory candidates awaiting review.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {items.map((item) => (
        <div
          key={item.id}
          style={{
            border: "0.5px solid var(--border)",
            borderRadius: 8,
            padding: "0.75rem",
            background: "rgba(255,255,255,0.55)",
          }}
        >
          <p style={{ margin: 0, color: "var(--text)", fontWeight: 600, fontSize: "0.875rem" }}>
            {item.title}
          </p>
          <p style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.8125rem", lineHeight: 1.45 }}>
            {item.content}
          </p>
          <p style={{ margin: "0.5rem 0 0", color: "var(--faint)", fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {item.ownerType}:{item.ownerId} · {item.kind} · {item.visibility} · {Math.round(item.confidence * 100)}%
          </p>
          <p style={{ margin: "0.35rem 0 0", color: "var(--muted)", fontSize: "0.72rem", lineHeight: 1.45 }}>
            Scopes: {(item.useScopes ?? []).join(", ") || "none"} · Sensitivity: {item.sensitivity ?? "standard"}
            {item.sourceLabel ? ` · Source: ${item.sourceLabel}` : ""}
            {item.connectorType ? ` · Connector: ${item.connectorType}${item.connectorRef ? ` (${item.connectorRef})` : ""}` : ""}
          </p>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
            <button
              disabled={busyId === item.id}
              onClick={() => void update(item.id, "active")}
              style={{ border: "none", borderRadius: 7, padding: "0.4rem 0.7rem", background: "var(--accent)", color: "#fff", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}
            >
              Confirm
            </button>
            <button
              disabled={busyId === item.id}
              onClick={() => void update(item.id, "archived")}
              style={{ border: "0.5px solid var(--border)", borderRadius: 7, padding: "0.4rem 0.7rem", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}
            >
              Archive
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function MemoryEvidence({ initial }: { initial: MemoryEvidenceData }) {
  const latestInfluence = initial.influence.slice(0, 8);
  const latestEpisodes = initial.episodes.slice(0, 8);
  const latestEdges = initial.edges.slice(0, 8);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div>
        <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem" }}>Recent episodes</h3>
        {latestEpisodes.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: "0.8125rem" }}>No memory episodes yet.</p>
        ) : latestEpisodes.map((episode) => (
          <p key={episode.id} style={{ margin: "0.35rem 0", color: "var(--muted)", fontSize: "0.8125rem", lineHeight: 1.45 }}>
            <strong style={{ color: "var(--text)" }}>{episode.label}</strong> · {episode.outcome} · {episode.ownerType}:{short(episode.ownerId)} · {time(episode.occurredAt)}
          </p>
        ))}
      </div>
      <div>
        <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem" }}>Temporal edges</h3>
        {latestEdges.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: "0.8125rem" }}>No graph edges yet.</p>
        ) : latestEdges.map((edge) => (
          <p key={edge.id} style={{ margin: "0.35rem 0", color: "var(--muted)", fontSize: "0.8125rem", lineHeight: 1.45 }}>
            <strong style={{ color: "var(--text)" }}>{edge.label}</strong> · {edge.kind} · {edge.visibility}/{edge.status} · weight {edge.weight.toFixed(2)} · confidence {Math.round(edge.confidence * 100)}% · evidence {edge.evidenceCount} · {edge.decayPolicy}
          </p>
        ))}
      </div>
      <div>
        <h3 style={{ fontSize: "0.875rem", fontWeight: 600, marginBottom: "0.5rem" }}>Influence audits</h3>
        {latestInfluence.length === 0 ? (
          <p style={{ color: "var(--muted)", fontSize: "0.8125rem" }}>No memory influence audits yet.</p>
        ) : latestInfluence.map((event) => {
          const metadata = event.inputs?.metadata as { temporalMemory?: { includedEdges?: number; excludedEdges?: number } } | undefined;
          const temporal = metadata?.temporalMemory;
          return (
            <p key={event.id} style={{ margin: "0.35rem 0", color: "var(--muted)", fontSize: "0.8125rem", lineHeight: 1.45 }}>
              <strong style={{ color: "var(--text)" }}>{event.entityType}:{short(event.entityId)}</strong> · {event.outcome} · {time(event.createdAt)}
              {temporal ? ` · temporal ${temporal.includedEdges ?? 0} used / ${temporal.excludedEdges ?? 0} excluded` : ""}
            </p>
          );
        })}
      </div>
    </div>
  );
}

export function MemoryConsolidation({ initial }: { initial: MemoryConsolidationSuggestion[] }) {
  const [items, setItems] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function decide(id: string, action: "apply" | "reject") {
    setBusyId(id);
    try {
      const res = await fetch(`${API_URL}/v1/admin/memory/consolidation/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminId: "admin" }),
      });
      if (!res.ok) throw new Error("decision failed");
      setItems((prev) => prev.filter((item) => item.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>No consolidation suggestions pending.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {items.map((item) => (
        <div key={item.id} style={{ border: "0.5px solid var(--border)", borderRadius: 8, padding: "0.75rem", background: "rgba(255,255,255,0.55)" }}>
          <p style={{ margin: 0, color: "var(--text)", fontWeight: 600, fontSize: "0.875rem" }}>{item.title}</p>
          <p style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.8125rem", lineHeight: 1.45 }}>{item.explanation}</p>
          <p style={{ margin: "0.5rem 0 0", color: "var(--faint)", fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {actionLabel(item.action)} / {item.ownerType}:{short(item.ownerId)} / memories {item.affectedMemoryIds.length} / edges {item.affectedEdgeIds.length} / {time(item.createdAt)}
          </p>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
            <button disabled={busyId === item.id} onClick={() => void decide(item.id, "apply")} style={{ border: "none", borderRadius: 7, padding: "0.4rem 0.7rem", background: "var(--accent)", color: "#fff", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}>
              Apply
            </button>
            <button disabled={busyId === item.id} onClick={() => void decide(item.id, "reject")} style={{ border: "0.5px solid var(--border)", borderRadius: 7, padding: "0.4rem 0.7rem", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}>
              Reject
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
