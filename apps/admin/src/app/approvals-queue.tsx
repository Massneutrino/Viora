"use client";

import { useCallback, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200";

export interface ApprovalQueueItem {
  id: string;
  organisationId: string;
  actorType: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  explanation: string;
  status: string;
  createdAt: string;
  organisation?: { id: string; name: string };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

function truncateId(id: string, len = 10): string {
  return id.length > len ? `${id.slice(0, len)}…` : id;
}

export function ApprovalsQueue({ initial }: { initial: ApprovalQueueItem[] }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setItems(initial);
  }, [initial]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/v1/admin/approvals`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { approvals: ApprovalQueueItem[] };
      setItems(data.approvals ?? []);
    } catch {
      /* keep current list */
    }
  }, []);

  const act = async (item: ApprovalQueueItem, action: "approve" | "reject") => {
    setBusy(item.id);
    setItems((prev) => prev.filter((row) => row.id !== item.id));

    try {
      const res = await fetch(`${API_URL}/v1/admin/approvals/${item.id}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminId: "admin" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string; explanation?: string } | null;
        throw new Error(data?.error ?? data?.explanation ?? "Action failed");
      }
      await refresh();
    } catch (err) {
      setItems((prev) => {
        if (prev.some((row) => row.id === item.id)) return prev;
        return [item, ...prev];
      });
      setToast(err instanceof Error ? err.message : "Action failed — check API connection.");
    } finally {
      setBusy(null);
    }
  };

  if (items.length === 0) {
    return (
      <p style={{ color: "var(--muted)", fontSize: "0.875rem", padding: "0.375rem 0" }}>
        No pending approvals
      </p>
    );
  }

  return (
    <>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {items.map((item) => {
          const isBusy = busy === item.id;

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
                    {item.action.replace(/[._]/g, " ")}
                  </span>
                  <span style={{ color: "var(--muted)", fontSize: "0.8125rem", marginLeft: 8 }}>
                    {item.entityType} · {truncateId(item.entityId)}
                  </span>
                  {item.organisation?.name && (
                    <span style={{ color: "var(--muted)", fontSize: "0.75rem", display: "block", marginTop: 2 }}>
                      {item.organisation.name}
                    </span>
                  )}
                  <span style={{ color: "var(--muted)", fontSize: "0.8125rem", display: "block", marginTop: 4 }}>
                    {item.explanation}
                  </span>
                  <span style={{ color: "var(--faint)", fontSize: "0.7rem", display: "block", marginTop: 2 }}>
                    {formatTime(item.createdAt)} · {item.actorType}:{item.actorId}
                  </span>
                </div>
                <span
                  style={{
                    background: "rgba(232,146,12,0.1)",
                    border: "1px solid rgba(232,146,12,0.3)",
                    color: "var(--warning)",
                    fontSize: "0.6875rem",
                    padding: "2px 8px",
                    borderRadius: 20,
                    flexShrink: 0,
                    marginLeft: 8,
                  }}
                >
                  pending
                </span>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                <button
                  type="button"
                  onClick={() => act(item, "approve")}
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
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => act(item, "reject")}
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
            </li>
          );
        })}
      </ul>

      {toast && (
        <div
          role="alert"
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            maxWidth: 320,
            padding: "0.75rem 1rem",
            background: "var(--surface-2)",
            border: "1px solid var(--error)",
            borderRadius: 8,
            color: "var(--error)",
            fontSize: "0.8125rem",
            boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
            zIndex: 1000,
          }}
        >
          {toast}
        </div>
      )}
    </>
  );
}
