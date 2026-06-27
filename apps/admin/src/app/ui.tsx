import type { ReactNode } from "react";

/** A labelled count — one bucket of a status breakdown (mirrors @viora/agents OpsCount). */
export interface OpsCount {
  key: string;
  count: number;
}

/** Aggregate ops metrics from GET /v1/admin/ops/stats (mirrors @viora/agents OpsStats). */
export interface OpsStats {
  workforce: {
    totalWorkers: number;
    avgReliability: number | null;
    docsExpiringSoon: number;
    complianceDocs: OpsCount[];
  };
  funnel: {
    bookingRequests: OpsCount[];
    bookings: OpsCount[];
    offers: OpsCount[];
  };
  operations: {
    shifts: OpsCount[];
    auditOutcomes7d: OpsCount[];
  };
  financial: {
    invoices: OpsCount[];
    revenue: number;
    workerPayTotal: number;
    unapprovedTimesheets: number;
  };
}

export interface MemoryImpactStats {
  periodDays: {
    recent: number;
    baseline: number;
  };
  influence: {
    total7d: number;
    total30d: number;
    byPurpose30d: OpsCount[];
    byAudience30d: OpsCount[];
    byAction30d: OpsCount[];
    byOutcome30d: OpsCount[];
  };
  intake: {
    influencedTurns30d: number;
    clarificationRequired30d: number;
    pendingConfirmation30d: number;
    clarificationRate30d: number | null;
  };
  ranking: {
    influencedBookingRequests30d: number;
    offers30d: number;
    resolvedOffers30d: number;
    acceptedOffers30d: number;
    offerAcceptanceRate30d: number | null;
    bookingsCreated30d: number;
  };
  memoryUsage: {
    topMemories30d: Array<{
      id: string;
      title: string;
      kind: string;
      ownerType: string;
      ownerId: string;
      count: number;
    }>;
    topEdges30d: Array<{
      id: string;
      label: string;
      kind: string;
      ownerType: string;
      ownerId: string;
      count: number;
    }>;
    unusedActiveMemories: number;
    unusedActiveMemoriesByKind: OpsCount[];
  };
  privacy: {
    workerPrivateMemories: number;
    employerFacingPrivateInfluenceCount30d: number;
    leakedMemoryIds30d: string[];
  };
}

export const EMPTY_STATS: OpsStats = {
  workforce: { totalWorkers: 0, avgReliability: null, docsExpiringSoon: 0, complianceDocs: [] },
  funnel: { bookingRequests: [], bookings: [], offers: [] },
  operations: { shifts: [], auditOutcomes7d: [] },
  financial: { invoices: [], revenue: 0, workerPayTotal: 0, unapprovedTimesheets: 0 },
};

export const EMPTY_MEMORY_IMPACT: MemoryImpactStats = {
  periodDays: { recent: 7, baseline: 30 },
  influence: {
    total7d: 0,
    total30d: 0,
    byPurpose30d: [],
    byAudience30d: [],
    byAction30d: [],
    byOutcome30d: [],
  },
  intake: {
    influencedTurns30d: 0,
    clarificationRequired30d: 0,
    pendingConfirmation30d: 0,
    clarificationRate30d: null,
  },
  ranking: {
    influencedBookingRequests30d: 0,
    offers30d: 0,
    resolvedOffers30d: 0,
    acceptedOffers30d: 0,
    offerAcceptanceRate30d: null,
    bookingsCreated30d: 0,
  },
  memoryUsage: {
    topMemories30d: [],
    topEdges30d: [],
    unusedActiveMemories: 0,
    unusedActiveMemoriesByKind: [],
  },
  privacy: {
    workerPrivateMemories: 0,
    employerFacingPrivateInfluenceCount30d: 0,
    leakedMemoryIds30d: [],
  },
};

export function formatLabel(value: string): string {
  return value.replace(/[_-]/g, " ");
}

export function formatPct(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}

export function StatCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "accent" | "warning" | "success";
}) {
  const valueColor =
    tone === "accent"
      ? "var(--accent)"
      : tone === "warning"
        ? "var(--warning)"
        : tone === "success"
          ? "var(--success)"
          : "var(--text)";
  return (
    <div
      style={{
        background: "var(--surface)",
        border: "0.5px solid var(--border)",
        borderRadius: 14,
        padding: "1rem 1.25rem",
      }}
    >
      <p style={{ fontSize: "1.875rem", fontWeight: 600, color: valueColor, lineHeight: 1.1 }}>
        {value}
      </p>
      <p style={{ color: "var(--muted)", fontSize: "0.8125rem", marginTop: "0.35rem" }}>{label}</p>
    </div>
  );
}

export function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--surface)",
        border: "0.5px solid var(--border)",
        borderRadius: 14,
        padding: "1.25rem",
      }}
    >
      <h2 style={{ fontSize: "1rem", fontWeight: 600 }}>{title}</h2>
      {description && (
        <p style={{ color: "var(--muted)", fontSize: "0.8125rem", margin: "0.25rem 0 1rem" }}>
          {description}
        </p>
      )}
      <div style={{ marginTop: description ? 0 : "0.75rem" }}>{children}</div>
    </section>
  );
}

export function SimpleList({ empty, items }: { empty: string; items: string[] }) {
  const listItems = items.length > 0 ? items : [empty];
  return (
    <ul style={{ listStyle: "none", fontSize: "0.875rem", color: "var(--muted)" }}>
      {listItems.map((item, index) => (
        <li
          key={`${index}-${item}`}
          style={{ padding: "0.375rem 0", borderBottom: "0.5px solid var(--border)" }}
        >
          {item}
        </li>
      ))}
    </ul>
  );
}
