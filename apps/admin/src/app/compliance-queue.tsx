"use client"

import { useState } from "react"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200"

export interface ComplianceQueueItem {
  id: string
  documentType: string
  fileName?: string
  storageKey?: string
  status: string
  createdAt: string
  passport: {
    workerId: string
    worker: {
      firstName: string
      lastName: string
      email: string
    }
  }
}

// Translucent fills derived from the shared semantic tokens (see globals.css):
// --warning #e8920c, --success #1f9d57, --error #e2574a.
const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  pending: { bg: "rgba(232,146,12,0.1)", border: "rgba(232,146,12,0.3)", text: "var(--warning)" },
  verified: { bg: "rgba(31,157,87,0.1)", border: "rgba(31,157,87,0.3)", text: "var(--success)" },
  rejected: { bg: "rgba(226,87,74,0.1)", border: "rgba(226,87,74,0.3)", text: "var(--error)" },
  expired: { bg: "rgba(226,87,74,0.1)", border: "rgba(226,87,74,0.3)", text: "var(--error)" },
}

export function ComplianceQueue({ initial }: { initial: ComplianceQueueItem[] }) {
  const [items, setItems] = useState(initial)
  const [busy, setBusy] = useState<string | null>(null)

  const act = async (id: string, action: "verify" | "reject") => {
    setBusy(id)
    try {
      const res = await fetch(`${API_URL}/v1/admin/compliance/documents/${id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminId: "admin" }),
      })
      if (!res.ok) throw new Error()
      setItems((prev) => prev.filter((item) => item.id !== id))
    } catch {
      alert("Action failed — check API connection.")
    } finally {
      setBusy(null)
    }
  }

  if (items.length === 0) {
    return (
      <p style={{ color: "var(--muted)", fontSize: "0.875rem", padding: "0.375rem 0" }}>
        Document review queue empty
      </p>
    )
  }

  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
      {items.map((item) => {
        const { worker, workerId } = item.passport
        const colors = STATUS_COLORS[item.status] ?? STATUS_COLORS.pending
        const isBusy = busy === item.id
        const downloadUrl = item.storageKey
          ? `${API_URL}/v1/workers/${workerId}/compliance/documents/${item.id}/file`
          : null

        return (
          <li
            key={item.id}
            style={{
              padding: "0.75rem 0",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <span style={{ color: "var(--text)", fontWeight: 500, fontSize: "0.875rem" }}>
                  {worker.firstName} {worker.lastName}
                </span>
                <span style={{ color: "var(--muted)", fontSize: "0.8125rem", marginLeft: 8 }}>
                  {item.documentType.replace(/_/g, " ")}
                </span>
                {item.fileName && (
                  <span style={{ color: "var(--muted)", fontSize: "0.75rem", display: "block", marginTop: 2 }}>
                    {item.fileName}
                  </span>
                )}
                <span style={{ color: "var(--muted)", fontSize: "0.7rem", display: "block" }}>
                  {worker.email}
                </span>
              </div>
              <span
                style={{
                  background: colors.bg,
                  border: `1px solid ${colors.border}`,
                  color: colors.text,
                  fontSize: "0.6875rem",
                  padding: "2px 8px",
                  borderRadius: 20,
                  flexShrink: 0,
                  marginLeft: 8,
                }}
              >
                {item.status}
              </span>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {downloadUrl && (
                <a
                  href={downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--accent)", fontSize: "0.75rem", textDecoration: "none" }}
                >
                  View document ↗
                </a>
              )}
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button
                  onClick={() => act(item.id, "verify")}
                  disabled={isBusy}
                  style={{
                    background: "rgba(31,157,87,0.1)",
                    border: "1px solid rgba(31,157,87,0.3)",
                    color: "var(--success)",
                    fontSize: "0.75rem",
                    padding: "3px 12px",
                    borderRadius: 6,
                    cursor: isBusy ? "default" : "pointer",
                    opacity: isBusy ? 0.5 : 1,
                  }}
                >
                  Verify
                </button>
                <button
                  onClick={() => act(item.id, "reject")}
                  disabled={isBusy}
                  style={{
                    background: "rgba(226,87,74,0.1)",
                    border: "1px solid rgba(226,87,74,0.3)",
                    color: "var(--error)",
                    fontSize: "0.75rem",
                    padding: "3px 12px",
                    borderRadius: 6,
                    cursor: isBusy ? "default" : "pointer",
                    opacity: isBusy ? 0.5 : 1,
                  }}
                >
                  Reject
                </button>
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
