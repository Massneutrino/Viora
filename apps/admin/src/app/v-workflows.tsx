"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeType,
  WorkflowSimulationResult,
  WorkflowSummary,
  WorkflowValidationWarning,
} from "@viora/domain";
import { formatLabel } from "./ui";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200";

export interface WorkflowDetailResponse {
  workflow: WorkflowDefinition;
  validationWarnings: WorkflowValidationWarning[];
}

export interface WorkflowSimulationResponse {
  result: WorkflowSimulationResult;
}

function nodeTone(type: WorkflowNodeType): {
  border: string;
  bg: string;
  color: string;
} {
  if (type === "deterministic_check") return { border: "var(--accent)", bg: "#eef3ff", color: "var(--accent)" };
  if (type === "human_approval") return { border: "var(--warning)", bg: "#fff7e9", color: "var(--warning)" };
  if (type === "api_action") return { border: "#4b67d6", bg: "#f3f6ff", color: "#2f48b6" };
  if (type === "audit_event") return { border: "var(--border-strong)", bg: "var(--surface-2)", color: "var(--muted)" };
  if (type === "end") return { border: "var(--success)", bg: "#ecf8f1", color: "var(--success)" };
  if (type === "llm_extract") return { border: "#7557d8", bg: "#f5f1ff", color: "#6346bd" };
  if (type === "memory_context") return { border: "#008f7a", bg: "#eaf8f5", color: "#007767" };
  return { border: "var(--border-strong)", bg: "var(--surface)", color: "var(--text)" };
}

function edgeColor(tone: string | undefined, active: boolean): string {
  if (!active) return "#d8dde4";
  if (tone === "warning") return "var(--warning)";
  if (tone === "danger") return "var(--error)";
  if (tone === "success") return "var(--success)";
  return "var(--accent)";
}

function getNode(workflow: WorkflowDefinition, id: string): WorkflowNode | undefined {
  return workflow.nodes.find((node) => node.id === id);
}

function pathForEdge(from: WorkflowNode, to: WorkflowNode): string {
  const sx = from.x + 150;
  const sy = from.y + 34;
  const tx = to.x;
  const ty = to.y + 34;
  const dx = Math.max(80, Math.abs(tx - sx) / 2);
  return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
}

function compact(value: string | undefined): string {
  return value && value.trim().length > 0 ? value : "None";
}

function NodeDetail({ node }: { node: WorkflowNode | undefined }) {
  if (!node) {
    return <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>Select a node to inspect its boundaries.</p>;
  }
  const rows = [
    ["Type", formatLabel(node.type)],
    ["Owner", node.agent ?? "system"],
    ["LLM", node.mayCallLLM ? "Allowed" : "No"],
    ["Mutates state", node.mutatesState ? "Yes" : "No"],
    ["Audit action", compact(node.auditAction)],
    ["API / route", compact(node.apiSurface)],
    ["Guardrail", compact(node.guardrailBoundary)],
    ["Compliance", compact(node.complianceBoundary)],
    ["Memory", compact(node.memoryBoundary)],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      <div>
        <h3 style={{ fontSize: "0.95rem", fontWeight: 700 }}>{node.label}</h3>
        <p style={{ color: "var(--muted)", fontSize: "0.8125rem", marginTop: 4 }}>{node.description}</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "0.5rem" }}>
        {rows.map(([label, value]) => (
          <div key={label} style={{ borderTop: "0.5px solid var(--border)", paddingTop: "0.45rem" }}>
            <p style={{ color: "var(--faint)", fontSize: "0.68rem", fontWeight: 700, textTransform: "uppercase" }}>{label}</p>
            <p style={{ color: "var(--text)", fontSize: "0.78rem", overflowWrap: "anywhere" }}>{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function WorkflowGraph({
  workflow,
  result,
  selectedNodeId,
  onSelectNode,
}: {
  workflow: WorkflowDefinition;
  result: WorkflowSimulationResult | null;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}) {
  const activePath = result?.path ?? [];
  const activeNodes = new Set(activePath);
  const activeEdges = new Set(activePath.slice(0, -1).map((nodeId, index) => `${nodeId}->${activePath[index + 1]}`));
  const width = Math.max(1560, ...workflow.nodes.map((node) => node.x + 190));
  const height = Math.max(430, ...workflow.nodes.map((node) => node.y + 120));

  return (
    <div style={{ overflowX: "auto", border: "0.5px solid var(--border)", borderRadius: 8, background: "#fbfcfe" }}>
      <div style={{ position: "relative", width, height }}>
        <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
          <defs>
            <marker id="workflow-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="#b9c0ca" />
            </marker>
            <marker id="workflow-arrow-active" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
              <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--accent)" />
            </marker>
          </defs>
          {workflow.edges.map((edge) => {
            const from = getNode(workflow, edge.from);
            const to = getNode(workflow, edge.to);
            if (!from || !to) return null;
            const active = activeEdges.has(`${edge.from}->${edge.to}`);
            const color = edgeColor(edge.tone, active);
            const midX = (from.x + to.x) / 2 + 75;
            const midY = (from.y + to.y) / 2 + 20;
            return (
              <g key={edge.id}>
                <path
                  d={pathForEdge(from, to)}
                  fill="none"
                  stroke={color}
                  strokeWidth={active ? 2.4 : 1.2}
                  markerEnd={active ? "url(#workflow-arrow-active)" : "url(#workflow-arrow)"}
                />
                {edge.label && (
                  <text x={midX} y={midY} textAnchor="middle" fill={active ? color : "var(--muted)"} fontSize="11" fontWeight={active ? 700 : 500}>
                    {edge.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {workflow.nodes.map((node) => {
          const tone = nodeTone(node.type);
          const active = activeNodes.has(node.id);
          const selected = selectedNodeId === node.id;
          return (
            <button
              key={node.id}
              type="button"
              onClick={() => onSelectNode(node.id)}
              style={{
                position: "absolute",
                left: node.x,
                top: node.y,
                width: 150,
                minHeight: 68,
                textAlign: "left",
                border: `1px solid ${selected || active ? tone.border : "var(--border)"}`,
                borderRadius: 8,
                background: active ? tone.bg : "var(--surface)",
                color: tone.color,
                padding: "0.65rem",
                boxShadow: selected ? "0 0 0 3px rgba(31,77,255,0.12)" : active ? "0 8px 20px rgba(31,77,255,0.08)" : "none",
              }}
            >
              <span style={{ display: "block", fontSize: "0.64rem", fontWeight: 700, textTransform: "uppercase", color: "var(--faint)" }}>
                {formatLabel(node.type)}
              </span>
              <span style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: tone.color, lineHeight: 1.25, marginTop: 3 }}>
                {node.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const pillStyle: CSSProperties = {
  border: "0.5px solid var(--border)",
  borderRadius: 999,
  padding: "0.18rem 0.55rem",
  fontSize: "0.72rem",
  color: "var(--muted)",
  background: "var(--surface)",
};

export function VWorkflows({ initialWorkflows }: { initialWorkflows: WorkflowSummary[] }) {
  const [workflowId, setWorkflowId] = useState(initialWorkflows[0]?.id ?? "");
  const [detail, setDetail] = useState<WorkflowDetailResponse | null>(null);
  const [scenarioId, setScenarioId] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [result, setResult] = useState<WorkflowSimulationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workflowId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResult(null);
    fetch(`${API_URL}/v1/admin/v-workflows/${workflowId}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Workflow fetch failed (${response.status})`);
        return (await response.json()) as WorkflowDetailResponse;
      })
      .then((next) => {
        if (cancelled) return;
        setDetail(next);
        setScenarioId(next.workflow.scenarios[0]?.id ?? "");
        setSelectedNodeId(next.workflow.nodes[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load workflow details. Check the API console.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workflowId]);

  const selectedNode = useMemo(() => {
    if (!detail?.workflow || !selectedNodeId) return undefined;
    return getNode(detail.workflow, selectedNodeId);
  }, [detail, selectedNodeId]);

  async function simulate() {
    if (!workflowId || !scenarioId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`${API_URL}/v1/admin/v-workflows/${workflowId}/simulate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenarioId }),
      });
      if (!response.ok) throw new Error(await response.text());
      const body = (await response.json()) as WorkflowSimulationResponse;
      setResult(body.result);
      setSelectedNodeId(body.result.path[0] ?? null);
    } catch {
      setError("Could not run workflow simulation. Check the API console.");
    } finally {
      setLoading(false);
    }
  }

  if (initialWorkflows.length === 0) {
    return <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>No V workflows are available.</p>;
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", alignItems: "flex-start" }}>
      <aside style={{ width: 240, flex: "0 0 240px", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {initialWorkflows.map((workflow) => {
          const active = workflow.id === workflowId;
          return (
            <button
              key={workflow.id}
              type="button"
              onClick={() => setWorkflowId(workflow.id)}
              style={{
                border: `0.5px solid ${active ? "var(--accent)" : "var(--border)"}`,
                background: active ? "rgba(31,77,255,0.06)" : "var(--surface)",
                color: active ? "var(--accent)" : "var(--text)",
                borderRadius: 8,
                padding: "0.7rem",
                textAlign: "left",
              }}
            >
              <span style={{ display: "block", fontSize: "0.82rem", fontWeight: 700 }}>{workflow.title}</span>
              <span style={{ display: "block", color: "var(--muted)", fontSize: "0.72rem", marginTop: 2 }}>
                v{workflow.version} - {workflow.scenarioCount} scenarios
              </span>
            </button>
          );
        })}
      </aside>

      <main style={{ minWidth: 420, flex: "1 1 520px", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
        {detail && (
          <>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              <div>
                <h3 style={{ fontSize: "1.05rem", fontWeight: 700 }}>{detail.workflow.title}</h3>
                <p style={{ color: "var(--muted)", fontSize: "0.84rem", maxWidth: 720 }}>{detail.workflow.description}</p>
                <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap", marginTop: "0.45rem" }}>
                  {detail.workflow.tags.map((tag) => (
                    <span key={tag} style={pillStyle}>{formatLabel(tag)}</span>
                  ))}
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <select
                  value={scenarioId}
                  onChange={(event) => {
                    setScenarioId(event.target.value);
                    setResult(null);
                  }}
                  style={{ border: "0.5px solid var(--border)", borderRadius: 8, padding: "0.45rem 0.6rem", background: "var(--surface)" }}
                >
                  {detail.workflow.scenarios.map((scenario) => (
                    <option key={scenario.id} value={scenario.id}>{scenario.title}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={simulate}
                  disabled={loading}
                  style={{
                    border: "none",
                    borderRadius: 8,
                    padding: "0.5rem 0.8rem",
                    background: "var(--accent)",
                    color: "white",
                    fontWeight: 700,
                  }}
                >
                  {loading ? "Simulating..." : "Simulate"}
                </button>
              </div>
            </div>

            {error && <p style={{ color: "var(--error)", fontSize: "0.85rem" }}>{error}</p>}
            {detail.validationWarnings.length > 0 && (
              <div style={{ border: "0.5px solid var(--warning)", borderRadius: 8, padding: "0.65rem", background: "#fff8ec", color: "var(--warning)", fontSize: "0.8rem" }}>
                {detail.validationWarnings.length} validation warning(s) need review.
              </div>
            )}

            <WorkflowGraph workflow={detail.workflow} result={result} selectedNodeId={selectedNodeId} onSelectNode={setSelectedNodeId} />

            {result && (
              <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem" }}>
                <div>
                  <h3 style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.35rem" }}>Messages</h3>
                  <ul style={{ listStyle: "none", color: "var(--muted)", fontSize: "0.8rem" }}>
                    {result.messages.map((message, index) => (
                      <li key={`${message.audience}-${index}`} style={{ padding: "0.35rem 0", borderBottom: "0.5px solid var(--border)" }}>
                        <strong style={{ color: "var(--text)" }}>{message.audience}:</strong> {message.text}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.35rem" }}>Decisions</h3>
                  <ul style={{ listStyle: "none", color: "var(--muted)", fontSize: "0.8rem" }}>
                    {result.decisions.map((decision) => (
                      <li key={`${decision.nodeId}-${decision.outcome}`} style={{ padding: "0.35rem 0", borderBottom: "0.5px solid var(--border)" }}>
                        <strong style={{ color: "var(--text)" }}>{formatLabel(decision.outcome)}:</strong> {decision.reason}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 style={{ fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.35rem" }}>Expected audit</h3>
                  <div style={{ display: "flex", gap: "0.35rem", flexWrap: "wrap" }}>
                    {result.expectedAuditActions.map((action) => (
                      <span key={action} style={pillStyle}>{action}</span>
                    ))}
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </main>

      <aside style={{ flex: "1 1 280px", maxWidth: 340, border: "0.5px solid var(--border)", borderRadius: 8, background: "var(--surface)", padding: "1rem", position: "sticky", top: 16 }}>
        <NodeDetail node={selectedNode} />
      </aside>
    </div>
  );
}
