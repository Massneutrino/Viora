import { PHASE_0_MUST_HAVE } from "@viora/domain";

export default function AdminConsole() {
  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "2rem 1.5rem" }}>
      <header style={{ marginBottom: "2rem" }}>
        <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>Viora · Internal</p>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 600 }}>Ops Console</h1>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
        <Panel title="Unfilled shifts" description="Ops Agent dashboard — connect API for live data">
          <PlaceholderList items={["No unfilled shifts loaded"]} />
        </Panel>
        <Panel title="Compliance queue" description="Manual verification (Phase 0)">
          <PlaceholderList items={["Document review queue empty"]} />
        </Panel>
        <Panel title="Market health" description="Fill rate, supply gaps">
          <PlaceholderList items={["Connect @viora/api to load metrics"]} />
        </Panel>
        <Panel title="Phase 0 checklist" description={`${PHASE_0_MUST_HAVE.length} must-have items`}>
          <ul style={{ listStyle: "none", fontSize: "0.875rem", color: "var(--muted)" }}>
            {PHASE_0_MUST_HAVE.slice(0, 8).map((item) => (
              <li key={item} style={{ padding: "0.25rem 0" }}>○ {item.replace(/_/g, " ")}</li>
            ))}
            <li style={{ padding: "0.25rem 0" }}>… and {PHASE_0_MUST_HAVE.length - 8} more</li>
          </ul>
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

function PlaceholderList({ items }: { items: string[] }) {
  return (
    <ul style={{ listStyle: "none", fontSize: "0.875rem", color: "var(--muted)" }}>
      {items.map((item) => (
        <li key={item} style={{ padding: "0.375rem 0", borderBottom: "1px solid var(--border)" }}>
          {item}
        </li>
      ))}
    </ul>
  );
}
