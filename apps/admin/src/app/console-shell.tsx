"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { AdminHeader } from "./admin-header";
import { VConsole } from "./v-console";
import {
  OverviewSection,
  OperationsSection,
  PilotSection,
  SandboxSection,
  type ConsoleData,
} from "./sections";

type NavId = "overview" | "operations" | "pilot" | "sandbox";

const NAV: { id: NavId; label: string; title: string; subtitle: string; icon: ReactNode }[] = [
  {
    id: "overview",
    label: "Overview",
    title: "Overview",
    subtitle: "Live analytics and platform health.",
    icon: <GridIcon />,
  },
  {
    id: "operations",
    label: "Operations",
    title: "Operations",
    subtitle: "Compliance, approvals queue, unfilled shifts and the audit trail.",
    icon: <PulseIcon />,
  },
  {
    id: "pilot",
    label: "Pilot leads",
    title: "Pilot leads",
    subtitle: "Interest captured from the marketing site.",
    icon: <InboxIcon />,
  },
  {
    id: "sandbox",
    label: "Sandbox & dev",
    title: "Sandbox & dev tools",
    subtitle: "Deterministic scenarios and demo shortcuts.",
    icon: <BeakerIcon />,
  },
];

export function ConsoleShell({ data }: { data: ConsoleData }) {
  const [active, setActive] = useState<NavId>("overview");
  const [narrow, setNarrow] = useState(false);
  const [vOpen, setVOpen] = useState(true);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [vResetKey, setVResetKey] = useState(0);
  const wasNarrow = useRef<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1099px)");
    const on = () => {
      const m = mq.matches;
      setNarrow(m);
      // Only reset V's open state when the breakpoint actually crosses — not on
      // every resize tick — so a manual open/close isn't clobbered by a resize.
      if (wasNarrow.current !== m) {
        setVOpen(!m);
        wasNarrow.current = m;
      }
    };
    on();
    mq.addEventListener("change", on);
    window.addEventListener("resize", on);
    return () => {
      mq.removeEventListener("change", on);
      window.removeEventListener("resize", on);
    };
  }, []);

  const current = NAV.find((n) => n.id === active) ?? NAV[0];

  const collapsed = !narrow && navCollapsed;
  const rail = (
    <nav
      style={
        narrow
          ? {
              display: "flex",
              gap: 4,
              overflowX: "auto",
              padding: "0.5rem 0.75rem",
              borderBottom: "0.5px solid var(--border)",
              background: "var(--surface)",
              flexShrink: 0,
            }
          : {
              width: navCollapsed ? 64 : 220,
              flexShrink: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: navCollapsed ? "center" : "stretch",
              gap: 2,
              padding: navCollapsed ? "1.25rem 0.5rem" : "1.25rem 0.85rem",
              borderRight: "0.5px solid var(--border)",
              background: "var(--surface)",
              overflowY: "auto",
              transition: "width 0.15s",
            }
      }
    >
      {!narrow && (
        <button
          type="button"
          onClick={() => setNavCollapsed((c) => !c)}
          aria-label={navCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={navCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          style={{
            width: 30,
            height: 30,
            flexShrink: 0,
            alignSelf: navCollapsed ? "center" : "flex-start",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 8,
            border: "0.5px solid var(--border)",
            background: "var(--surface)",
            color: "var(--muted)",
            marginBottom: "0.6rem",
          }}
        >
          <PanelLeftIcon />
        </button>
      )}
      {!collapsed && !narrow && (
        <p
          style={{
            fontSize: "0.6875rem",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--faint)",
            padding: "0 0.65rem",
            marginBottom: "0.6rem",
          }}
        >
          Console
        </p>
      )}
      {NAV.map((n) => {
        const isActive = n.id === active;
        return (
          <button
            key={n.id}
            type="button"
            onClick={() => setActive(n.id)}
            title={n.label}
            style={{
              display: "flex",
              alignItems: "center",
              flexShrink: 0,
              border: "none",
              borderRadius: 9,
              background: isActive ? "rgba(31,77,255,0.08)" : "transparent",
              color: isActive ? "var(--accent)" : "var(--muted)",
              fontWeight: isActive ? 600 : 500,
              transition: "background 0.15s, color 0.15s",
              whiteSpace: "nowrap",
              ...(collapsed
                ? { width: 40, height: 40, justifyContent: "center", padding: 0 }
                : {
                    gap: 10,
                    padding: narrow ? "0.5rem 0.75rem" : "0.55rem 0.65rem",
                    fontSize: "0.875rem",
                  }),
            }}
          >
            {n.icon}
            {!collapsed && <span>{n.label}</span>}
          </button>
        );
      })}
    </nav>
  );

  const panelHeader = (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: "0.875rem",
        flexShrink: 0,
      }}
    >
      <div>
        <h2 style={{ fontSize: "1.0625rem", fontWeight: 600 }}>Ask V</h2>
        <p style={{ color: "var(--muted)", fontSize: "0.8125rem" }}>Grounded in live ops data</p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          onClick={() => setVResetKey((k) => k + 1)}
          style={{
            fontSize: "0.75rem",
            color: "var(--muted)",
            background: "transparent",
            border: "0.5px solid var(--border)",
            borderRadius: 8,
            padding: "0.25rem 0.6rem",
          }}
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => setVOpen(false)}
          aria-label="Close Ask V"
          style={{
            border: "0.5px solid var(--border)",
            background: "var(--surface-2)",
            color: "var(--muted)",
            borderRadius: 8,
            width: 28,
            height: 28,
            fontSize: "1rem",
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>
    </div>
  );

  const vPanelInner = (
    <>
      {panelHeader}
      <VConsole key={vResetKey} />
    </>
  );

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      <AdminHeader onAskV={vOpen ? undefined : () => setVOpen(true)} />

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: narrow ? "column" : "row",
        }}
      >
        {rail}
        <main style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: "2rem 1.5rem" }}>
          <div style={{ maxWidth: 980, margin: "0 auto" }}>
            <div style={{ marginBottom: "1.75rem" }}>
              <h1 style={{ fontSize: "1.75rem", fontWeight: 600, letterSpacing: "-0.01em" }}>
                {current.title}
              </h1>
              <p style={{ color: "var(--muted)", fontSize: "0.9375rem", marginTop: "0.25rem" }}>
                {current.subtitle}
              </p>
            </div>

            {active === "overview" && <OverviewSection data={data} />}
            {active === "operations" && <OperationsSection data={data} />}
            {active === "pilot" && <PilotSection data={data} />}
            {active === "sandbox" && <SandboxSection data={data} />}
          </div>
        </main>

        {!narrow && vOpen && (
          <aside
            style={{
              width: 340,
              flexShrink: 0,
              borderLeft: "0.5px solid var(--border)",
              background: "var(--surface)",
              padding: "1.25rem",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
            }}
          >
            {vPanelInner}
          </aside>
        )}
      </div>

      {/* Narrow-screen slide-over */}
      {narrow && vOpen && (
        <>
          <div
            onClick={() => setVOpen(false)}
            style={{ position: "fixed", inset: 0, background: "rgba(28,30,34,0.25)", zIndex: 40 }}
          />
          <aside
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              height: "100vh",
              width: "min(380px, 100vw)",
              background: "var(--surface)",
              borderLeft: "0.5px solid var(--border)",
              boxShadow: "-12px 0 40px rgba(28,30,34,0.12)",
              zIndex: 50,
              display: "flex",
              flexDirection: "column",
              padding: "1.25rem",
            }}
          >
            {vPanelInner}
          </aside>
        </>
      )}
    </div>
  );
}

// ── Icons (16px, inherit colour) ─────────────────────────────────────────────
function iconProps() {
  return {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

function PanelLeftIcon() {
  return (
    <svg
      width={17}
      height={17}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg {...iconProps()}>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </svg>
  );
}

function PulseIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M3 12h4l3 8 4-16 3 8h4" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.5 5.5 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.5A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.5Z" />
    </svg>
  );
}

function BeakerIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M9 3h6" />
      <path d="M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" />
      <path d="M7 15h10" />
    </svg>
  );
}
