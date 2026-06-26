"use client";

import { useCallback, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200";

export interface PendingTimesheet {
  id: string;
  hoursWorked: number;
  workerId: string;
  createdAt: string;
  worker: { id: string; firstName: string; lastName: string };
  booking: { roleType: string; startAt: string; endAt: string; payRate: number };
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

function formatLabel(value: string): string {
  return value.replace(/_/g, " ");
}

const actionBtn = (tone: "success" | "error", disabled: boolean) => ({
  background: tone === "success" ? "rgba(31,157,87,0.1)" : "rgba(226,87,74,0.1)",
  border: tone === "success" ? "1px solid rgba(31,157,87,0.3)" : "1px solid rgba(226,87,74,0.3)",
  color: tone === "success" ? "var(--success)" : "var(--error)",
  fontSize: "0.75rem",
  padding: "3px 12px",
  borderRadius: 6,
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.5 : 1,
});

export function TimesheetsQueue({ initial }: { initial: PendingTimesheet[] }) {
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
      const res = await fetch(`${API_URL}/v1/admin/timesheets/pending`, { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { pending: PendingTimesheet[] };
      setItems(data.pending ?? []);
    } catch {
      /* keep current list */
    }
  }, []);

  const approve = async (item: PendingTimesheet) => {
    setBusy(item.id);
    setItems((prev) => prev.filter((row) => row.id !== item.id));

    try {
      const res = await fetch(`${API_URL}/v1/admin/timesheets/${item.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedBy: "admin" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "Approve failed");
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
        No timesheets awaiting approval
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
                    {item.worker.firstName} {item.worker.lastName}
                  </span>
                  <span style={{ color: "var(--muted)", fontSize: "0.8125rem", marginLeft: 8 }}>
                    {formatLabel(item.booking.roleType)} · {item.hoursWorked}h
                  </span>
                  <span style={{ color: "var(--muted)", fontSize: "0.75rem", display: "block", marginTop: 2 }}>
                    {formatTime(item.booking.startAt)} – {formatTime(item.booking.endAt)}
                  </span>
                  <span style={{ color: "var(--faint)", fontSize: "0.7rem", display: "block", marginTop: 2 }}>
                    Submitted {formatTime(item.createdAt)}
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
                  onClick={() => approve(item)}
                  disabled={isBusy}
                  style={actionBtn("success", isBusy)}
                >
                  Approve
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
