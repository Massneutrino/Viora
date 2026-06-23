import { PHASE_0_MUST_HAVE } from "@viora/domain";
import { ComplianceQueue } from "./compliance-queue";
import type { ComplianceQueueItem } from "./compliance-queue";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200";

interface AuditEvent {
  id: string;
  actorType: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  outcome: string;
  createdAt: string;
}

interface UnfilledShift {
  bookingRequestId: string;
  urgency: string;
}

async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export default async function AdminConsole() {
  const [unfilledData, marketHealth, complianceData, auditData] = await Promise.all([
    getJson<{ unfilled: UnfilledShift[] }>("/v1/admin/ops/unfilled", { unfilled: [] }),
    getJson<Record<string, unknown>>("/v1/admin/ops/market-health", {}),
    getJson<{ pending: ComplianceQueueItem[] }>("/v1/admin/compliance/queue", { pending: [] }),
    getJson<{ events: AuditEvent[] }>("/v1/admin/audit", { events: [] }),
  ]);
  const recoveryEvents = auditData.events.filter((event) =>
    ["booking.cancel", "booking.reopen", "booking.assign", "replacement.trigger"].includes(
      event.action,
    ),
  );

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1.5rem" }}>
      <header style={{ marginBottom: "2rem" }}>
        <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>Viora · Internal</p>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 600 }}>Ops Console</h1>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
        <Panel title="Unfilled shifts" description="Ops Agent dashboard">
          <SimpleList
            empty="No unfilled shifts"
            items={unfilledData.unfilled.map(
              (item) => `${item.bookingRequestId} · ${item.urgency}`,
            )}
          />
        </Panel>
        <Panel title="Compliance queue" description="Manual verification (Phase 0)">
          <ComplianceQueue initial={complianceData.pending} />
        </Panel>
        <Panel title="Market health" description="Fill rate, supply gaps">
          <SimpleList
            empty="No market health metrics"
            items={Object.entries(marketHealth).map(([key, value]) => `${formatLabel(key)}: ${String(value)}`)}
          />
        </Panel>
        <Panel title="Recovery activity" description="Cancellations, reopens, replacements">
          <SimpleList
            empty="No recovery actions"
            items={recoveryEvents.slice(0, 8).map((event) => {
              const createdAt = new Date(event.createdAt).toLocaleString("en-GB", {
                dateStyle: "short",
                timeStyle: "short",
              });
              return `${event.action} - ${event.outcome} - ${createdAt}`;
            })}
          />
        </Panel>
        <Panel title="Audit log" description="Latest platform actions">
          <SimpleList
            empty="No audit events"
            items={auditData.events.slice(0, 8).map((event) => {
              const createdAt = new Date(event.createdAt).toLocaleString("en-GB", {
                dateStyle: "short",
                timeStyle: "short",
              });
              return `${event.action} · ${event.outcome} · ${event.actorType}:${event.actorId} · ${createdAt}`;
            })}
          />
        </Panel>
        <Panel title="Phase 0 checklist" description={`${PHASE_0_MUST_HAVE.length} must-have items`}>
          <SimpleList
            empty="No checklist items"
            items={[
              ...PHASE_0_MUST_HAVE.slice(0, 8).map((item) => formatLabel(item)),
              `${PHASE_0_MUST_HAVE.length - 8} more items`,
            ]}
          />
        </Panel>
      </div>
    </div>
  );
}

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "1.25rem",
      }}
    >
      <h2 style={{ fontSize: "1rem", fontWeight: 600 }}>{title}</h2>
      <p style={{ color: "var(--muted)", fontSize: "0.8125rem", margin: "0.25rem 0 1rem" }}>
        {description}
      </p>
      {children}
    </section>
  );
}

function SimpleList({ empty, items }: { empty: string; items: string[] }) {
  const listItems = items.length > 0 ? items : [empty];

  return (
    <ul style={{ listStyle: "none", fontSize: "0.875rem", color: "var(--muted)" }}>
      {listItems.map((item) => (
        <li key={item} style={{ padding: "0.375rem 0", borderBottom: "1px solid var(--border)" }}>
          {item}
        </li>
      ))}
    </ul>
  );
}

function formatLabel(value: string) {
  return value.replace(/_/g, " ");
}
