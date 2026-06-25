"use client";

import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200";
const EMPLOYER_URL = process.env.NEXT_PUBLIC_EMPLOYER_URL ?? "http://localhost:6100";
const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? "http://localhost:6102";

type DemoEmployer = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type DemoOrg = {
  id: string;
  name: string;
  type: string;
  site: { id: string; name: string; address: string } | null;
  employer: DemoEmployer | null;
};

type DemoWorker = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  roleTypes: string[];
  reliabilityScore: number | null;
  complianceLabel: string;
};

const TYPE_ORDER = ["daycare", "nursery", "primary", "mat", "secondary", "university"];

function formatType(type: string) {
  return type.replace(/_/g, " ");
}

function complianceColor(label: string) {
  if (label === "verified") return "var(--success)";
  if (label === "no passport") return "var(--muted)";
  return "var(--warning)";
}

async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    // ignore
  }
}

export function DemoPersonas() {
  const [orgs, setOrgs] = useState<DemoOrg[]>([]);
  const [workers, setWorkers] = useState<DemoWorker[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API_URL}/v1/admin/demo/directory`, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load demo directory");
        return res.json() as Promise<{ organisations: DemoOrg[]; workers: DemoWorker[] }>;
      })
      .then((data) => {
        setOrgs(data.organisations);
        setWorkers(data.workers);
      })
      .catch(() => setError("Could not load demo personas — is the API running on :6200?"));
  }, []);

  const sortedOrgs = [...orgs].sort((a, b) => {
    const ai = TYPE_ORDER.indexOf(a.type);
    const bi = TYPE_ORDER.indexOf(b.type);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a.name.localeCompare(b.name);
  });

  const grouped = TYPE_ORDER.reduce<Record<string, DemoOrg[]>>((acc, type) => {
    const items = sortedOrgs.filter((o) => o.type === type);
    if (items.length > 0) acc[type] = items;
    return acc;
  }, {});
  for (const org of sortedOrgs) {
    if (!TYPE_ORDER.includes(org.type)) {
      grouped[org.type] = grouped[org.type] ?? [];
      if (!grouped[org.type].includes(org)) grouped[org.type].push(org);
    }
  }

  if (error) {
    return <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>{error}</p>;
  }

  if (orgs.length === 0 && workers.length === 0) {
    return (
      <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>
        Loading demo personas… run <code>npm run db:seed</code> if empty.
      </p>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <p style={{ color: "var(--muted)", fontSize: "0.8125rem", margin: 0 }}>
        Dev shortcuts — no passwords. Login UI is handled separately. Opens employer or worker app with{" "}
        <code>?orgId=</code> / <code>?workerId=</code>.
      </p>

      {Object.entries(grouped).map(([type, items]) => (
        <div key={type}>
          <h3
            style={{
              fontSize: "0.75rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--muted)",
              margin: "0 0 0.5rem",
            }}
          >
            {formatType(type)}
          </h3>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {items.map((org) => {
              const employerUrl = `${EMPLOYER_URL}?orgId=${encodeURIComponent(org.id)}`;
              return (
                <li
                  key={org.id}
                  style={{
                    padding: "0.625rem 0",
                    borderBottom: "1px solid var(--border)",
                    display: "flex",
                    flexWrap: "wrap",
                    gap: "0.5rem",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 500 }}>{org.name}</p>
                    <p style={{ margin: "0.15rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                      {org.site?.name ?? "No site"} · {org.employer?.name ?? "No employer"} ·{" "}
                      <code style={{ fontSize: "0.7rem" }}>{org.id}</code>
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "0.375rem", flexShrink: 0 }}>
                    <LaunchLink href={employerUrl} label="Employer app" />
                    <button
                      type="button"
                      onClick={() => copyLink(employerUrl)}
                      style={ghostButtonStyle}
                      title="Copy link"
                    >
                      Copy
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      <div>
        <h3
          style={{
            fontSize: "0.75rem",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--muted)",
            margin: "0 0 0.5rem",
          }}
        >
          Workers ({workers.length})
        </h3>
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {workers.map((worker) => {
            const workerUrl = `${WORKER_URL}?workerId=${encodeURIComponent(worker.id)}`;
            const name = `${worker.firstName} ${worker.lastName}`;
            return (
              <li
                key={worker.id}
                style={{
                  padding: "0.625rem 0",
                  borderBottom: "1px solid var(--border)",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.5rem",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: "0.875rem", fontWeight: 500 }}>{name}</p>
                  <p style={{ margin: "0.15rem 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                    {worker.roleTypes.join(", ")} ·{" "}
                    <span style={{ color: complianceColor(worker.complianceLabel) }}>
                      {worker.complianceLabel}
                    </span>
                    {worker.reliabilityScore != null && ` · ${worker.reliabilityScore}★`} ·{" "}
                    <code style={{ fontSize: "0.7rem" }}>{worker.id}</code>
                  </p>
                </div>
                <div style={{ display: "flex", gap: "0.375rem", flexShrink: 0 }}>
                  <LaunchLink href={workerUrl} label="Worker app" />
                  <button
                    type="button"
                    onClick={() => copyLink(workerUrl)}
                    style={ghostButtonStyle}
                    title="Copy link"
                  >
                    Copy
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function LaunchLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" style={linkButtonStyle}>
      {label}
    </a>
  );
}

const linkButtonStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 500,
  padding: "0.35rem 0.65rem",
  borderRadius: 6,
  background: "var(--accent, #1f4dff)",
  color: "#fff",
  textDecoration: "none",
  border: "none",
};

const ghostButtonStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  padding: "0.35rem 0.65rem",
  borderRadius: 6,
  background: "transparent",
  color: "var(--muted)",
  border: "1px solid var(--border)",
  cursor: "pointer",
};
