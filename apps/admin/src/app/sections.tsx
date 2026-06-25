import type { CSSProperties } from "react";
import { PHASE_0_MUST_HAVE } from "@viora/domain";
import { ApprovalsQueue, type ApprovalQueueItem } from "./approvals-queue";
import { ComplianceQueue, type ComplianceQueueItem } from "./compliance-queue";
import { MemoryReview, type MemoryReviewItem } from "./memory-review";
import { MemoryLab, type MemoryLabState } from "./memory-lab";
import { DemoPersonas } from "./demo-personas";
import { SandboxPanel } from "./sandbox-panel";
import { BreakdownPanel, MiniStat } from "./analytics";
import { LeadActions } from "./pilot-approve";
import {
  EMPTY_STATS,
  Panel,
  SimpleList,
  StatCard,
  formatLabel,
  formatPct,
  type OpsStats,
} from "./ui";

export type { MemoryReviewItem };
export type { MemoryLabState };

export interface UnfilledShift {
  bookingRequestId: string;
  urgency: string;
}

export interface MarketHealth {
  unfilledCount?: number;
  fillRate?: number | null;
  offerAcceptanceRate?: number | null;
  periodDays?: number;
}

export interface PilotLead {
  id: string;
  leadType: string;
  name: string;
  email: string;
  phone?: string | null;
  organisationName?: string | null;
  postcode?: string | null;
  workerRoleTypes: string[];
  status: string;
  createdAt: string;
}

export interface AuditEvent {
  id: string;
  actorType: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  outcome: string;
  createdAt: string;
}

export interface DynamicRateRecord {
  id: string;
  bookingRequestId: string;
  workerId: string;
  employerCeiling: number;
  workerFloor: number;
  agreedRate?: number | null;
  explanation: string;
  createdAt: string;
  bookingRequest?: {
    roleType: string;
    payRate: number;
    maxPayRate?: number | null;
    site?: { name: string } | null;
    organisation?: { name: string } | null;
  };
}

export interface ConsoleData {
  unfilled: UnfilledShift[];
  marketHealth: MarketHealth;
  compliance: ComplianceQueueItem[];
  approvals: ApprovalQueueItem[];
  memory: MemoryReviewItem[];
  pilotLeads: PilotLead[];
  audit: AuditEvent[];
  negotiations: DynamicRateRecord[];
  stats: OpsStats;
  memoryLab: MemoryLabState;
}

const RECOVERY_ACTIONS = [
  "booking.cancel",
  "booking.reopen",
  "booking.assign",
  "replacement.trigger",
];

const gridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
  gap: "1.25rem",
  alignItems: "start",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

function formatGbp(value: number): string {
  return `£${Math.round(value).toLocaleString("en-GB")}`;
}

// ── Overview ────────────────────────────────────────────────────────────────
export function OverviewSection({ data }: { data: ConsoleData }) {
  const { stats, marketHealth, unfilled, compliance, approvals, pilotLeads } = data;
  const reliability =
    stats.workforce.avgReliability != null
      ? stats.workforce.avgReliability.toFixed(2)
      : "—";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: "1rem",
        }}
      >
        <StatCard label="Workers" value={String(stats.workforce.totalWorkers)} />
        <StatCard label="Fill rate · 7d" value={formatPct(marketHealth.fillRate)} tone="accent" />
        <StatCard
          label="Unfilled shifts"
          value={String(unfilled.length)}
          tone={unfilled.length > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Compliance queue"
          value={String(compliance.length)}
          tone={compliance.length > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Approvals queue"
          value={String(approvals.length)}
          tone={approvals.length > 0 ? "warning" : "default"}
        />
        <StatCard label="Pilot leads" value={String(pilotLeads.length)} />
      </section>

      <section style={gridStyle}>
        <BreakdownPanel title="Booking requests" counts={stats.funnel.bookingRequests} />
        <BreakdownPanel title="Offer funnel" counts={stats.funnel.offers} />
        <BreakdownPanel title="Bookings" counts={stats.funnel.bookings} />
        <BreakdownPanel title="Shift outcomes" counts={stats.operations.shifts} />
        <BreakdownPanel title="Compliance documents" counts={stats.workforce.complianceDocs} />
        <BreakdownPanel title="Agent outcomes · 7d" counts={stats.operations.auditOutcomes7d} />
      </section>

      <div>
        <h2
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--faint)",
            marginBottom: "0.75rem",
          }}
        >
          Financial &amp; workforce
        </h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
          <MiniStat label="Revenue (Viora fees)" value={formatGbp(stats.financial.revenue)} tone="accent" />
          <MiniStat label="Worker pay" value={formatGbp(stats.financial.workerPayTotal)} />
          <MiniStat
            label="Timesheets to approve"
            value={String(stats.financial.unapprovedTimesheets)}
            tone={stats.financial.unapprovedTimesheets > 0 ? "warning" : "default"}
          />
          <MiniStat
            label="Docs expiring ≤30d"
            value={String(stats.workforce.docsExpiringSoon)}
            tone={stats.workforce.docsExpiringSoon > 0 ? "warning" : "default"}
          />
          <MiniStat label="Avg reliability" value={reliability} />
          <MiniStat label="Offer acceptance" value={formatPct(marketHealth.offerAcceptanceRate)} />
        </div>
      </div>
    </div>
  );
}

// ── Operations ────────────────────────────────────────────────────────────────
export function OperationsSection({ data }: { data: ConsoleData }) {
  const { compliance, approvals, memory, unfilled, audit, negotiations } = data;
  const recovery = audit.filter((e) => RECOVERY_ACTIONS.includes(e.action));

  return (
    <div style={gridStyle}>
      <Panel title="Compliance queue" description="Manual verification (Phase 0)">
        <ComplianceQueue initial={compliance} />
      </Panel>
      <Panel title="Approvals queue" description="Guardrail-blocked actions awaiting human sign-off">
        <ApprovalsQueue initial={approvals} />
      </Panel>
      <Panel title="Memory review" description="Inferred memories pending confirmation">
        <MemoryReview initial={memory} />
      </Panel>
      <Panel title="Unfilled shifts" description="Ops Agent dashboard">
        <SimpleList
          empty="No unfilled shifts"
          items={unfilled.map((item) => `${item.bookingRequestId} · ${item.urgency}`)}
        />
      </Panel>
      <Panel title="Recovery activity" description="Cancellations, reopens, replacements">
        <SimpleList
          empty="No recovery actions"
          items={recovery
            .slice(0, 10)
            .map((e) => `${e.action} · ${e.outcome} · ${formatTime(e.createdAt)}`)}
        />
      </Panel>
      <Panel title="Dynamic Rate" description="Recent L3 rate clearing records">
        <SimpleList
          empty="No Dynamic Rate records"
          items={negotiations.slice(0, 10).map((record) => {
            const shift = record.bookingRequest
              ? `${formatLabel(record.bookingRequest.roleType)} at ${record.bookingRequest.site?.name ?? "site TBC"}`
              : record.bookingRequestId;
            const rate = record.agreedRate != null ? formatGbp(record.agreedRate) : "Escalated";
            return `${rate} - floor ${formatGbp(record.workerFloor)} - ceiling ${formatGbp(record.employerCeiling)} - ${shift}`;
          })}
        />
      </Panel>
      <Panel title="Audit log" description="Latest platform actions">
        <SimpleList
          empty="No audit events"
          items={audit
            .slice(0, 12)
            .map(
              (e) =>
                `${e.action} · ${e.outcome} · ${e.actorType}:${e.actorId} · ${formatTime(e.createdAt)}`,
            )}
        />
      </Panel>
    </div>
  );
}

// ── Pilot leads ────────────────────────────────────────────────────────────────
const cellStyle: CSSProperties = {
  padding: "0.625rem 0.75rem",
  fontSize: "0.8125rem",
  borderBottom: "0.5px solid var(--border)",
  textAlign: "left",
  verticalAlign: "top",
};
const headStyle: CSSProperties = {
  ...cellStyle,
  color: "var(--muted)",
  fontWeight: 600,
  fontSize: "0.6875rem",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
};

export function PilotSection({ data }: { data: ConsoleData }) {
  const { pilotLeads } = data;

  return (
    <Panel title="Pilot leads" description="Captured from the marketing site (/v1/pilot/leads)">
      {pilotLeads.length === 0 ? (
        <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>No pilot leads yet.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={headStyle}>Type</th>
                <th style={headStyle}>Name</th>
                <th style={headStyle}>Org / location</th>
                <th style={headStyle}>Roles</th>
                <th style={headStyle}>Contact</th>
                <th style={headStyle}>Created</th>
                <th style={headStyle}>Access</th>
              </tr>
            </thead>
            <tbody>
              {pilotLeads.map((lead) => (
                <tr key={lead.id}>
                  <td style={{ ...cellStyle, textTransform: "capitalize" }}>{lead.leadType}</td>
                  <td style={{ ...cellStyle, color: "var(--text)", fontWeight: 500 }}>
                    {lead.name}
                  </td>
                  <td style={cellStyle}>
                    {lead.leadType === "worker"
                      ? (lead.postcode ?? "—")
                      : (lead.organisationName ?? "—")}
                  </td>
                  <td style={cellStyle}>
                    {lead.workerRoleTypes.length > 0
                      ? lead.workerRoleTypes.map(formatLabel).join(", ")
                      : "—"}
                  </td>
                  <td style={cellStyle}>{lead.email}</td>
                  <td style={{ ...cellStyle, color: "var(--muted)" }}>
                    {formatTime(lead.createdAt)}
                  </td>
                  <td style={cellStyle}>
                    <LeadActions leadId={lead.id} initialStatus={lead.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

// ── Sandbox & dev tools ─────────────────────────────────────────────────────────
export function SandboxSection({ data }: { data: ConsoleData }) {
  const extra = PHASE_0_MUST_HAVE.length - 8;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <Panel title="Demo sandbox" description="Deterministic full-loop scenarios for testing and demos">
        <SandboxPanel />
      </Panel>
      <Panel title="Memory Lab" description="Create memory, run learning scenarios, inspect graph edges">
        <MemoryLab initial={data.memoryLab} />
      </Panel>
      <Panel
        title="Demo personas"
        description="Launch employer or worker app as any seeded persona (dev only)"
      >
        <DemoPersonas />
      </Panel>
      <Panel title="Phase 0 checklist" description={`${PHASE_0_MUST_HAVE.length} must-have items`}>
        <SimpleList
          empty="No checklist items"
          items={[
            ...PHASE_0_MUST_HAVE.slice(0, 8).map((item) => formatLabel(item)),
            ...(extra > 0 ? [`${extra} more items`] : []),
          ]}
        />
      </Panel>
    </div>
  );
}

export { EMPTY_STATS };
