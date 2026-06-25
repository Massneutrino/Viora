"use client";

import { useState, type CSSProperties } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200";

const btn: CSSProperties = {
  fontSize: "0.75rem",
  fontWeight: 600,
  padding: "0.35rem 0.7rem",
  borderRadius: 8,
  border: "0.5px solid var(--border)",
  background: "var(--surface-2)",
  color: "var(--text)",
};

const primaryBtn: CSSProperties = {
  ...btn,
  border: "none",
  background: "var(--accent)",
  color: "#fff",
};

export function LeadActions({ leadId, initialStatus }: { leadId: string; initialStatus: string }) {
  const [status, setStatus] = useState(initialStatus);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);

  const approve = async () => {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`${API_URL}/v1/admin/pilot/leads/${leadId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminId: "admin" }),
      });
      const data = (await res.json().catch(() => null)) as { link?: string } | null;
      if (!res.ok || !data?.link) throw new Error("approve failed");
      setStatus("approved");
      setLink(data.link);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the link is still shown */
    }
  };

  if (status === "approved") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem", alignItems: "flex-start" }}>
        <span style={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--success)" }}>Approved</span>
        {link ? (
          <div style={{ display: "flex", gap: "0.4rem", alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" style={btn} onClick={copy}>
              {copied ? "Copied" : "Copy link"}
            </button>
            <a href={link} target="_blank" rel="noreferrer" style={{ ...btn, textDecoration: "none" }}>
              Open
            </a>
          </div>
        ) : (
          <button type="button" style={btn} onClick={approve} disabled={busy}>
            {busy ? "…" : "Get link"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", alignItems: "flex-start" }}>
      <button type="button" style={primaryBtn} onClick={approve} disabled={busy}>
        {busy ? "Approving…" : "Approve & mint"}
      </button>
      {error && <span style={{ fontSize: "0.7rem", color: "var(--warning)" }}>Failed — retry</span>}
    </div>
  );
}
