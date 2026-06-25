"use client";

import { PixelSphere, Wordmark } from "@viora/ui";

export function AdminHeader({ onAskV }: { onAskV?: () => void }) {
  return (
    <header
      style={{
        position: "sticky",
        top: 0,
        zIndex: 10,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "1rem",
        padding: "0.75rem 1.5rem",
        background: "var(--surface)",
        borderBottom: "0.5px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <PixelSphere state="rest" size={28} staticMark />
        <Wordmark scale={0.8} />
        <span
          style={{
            fontSize: "0.6875rem",
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--muted)",
            background: "var(--surface-2)",
            border: "0.5px solid var(--border)",
            borderRadius: 20,
            padding: "2px 10px",
          }}
        >
          Internal · Ops
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: "var(--success)",
              display: "inline-block",
            }}
          />
          <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>V online</span>
        </div>
        {onAskV && (
          <button
            type="button"
            onClick={onAskV}
            style={{
              fontSize: "0.8125rem",
              fontWeight: 600,
              color: "#fff",
              background: "var(--accent)",
              border: "none",
              borderRadius: 10,
              padding: "0.4rem 0.85rem",
            }}
          >
            Ask V
          </button>
        )}
      </div>
    </header>
  );
}
