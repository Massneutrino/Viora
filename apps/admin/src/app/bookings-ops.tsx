"use client";

import { useCallback, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200";

export interface UnfilledShift {
  bookingRequestId: string;
  urgency: string;
}

export interface BookingOpsItem {
  id: string;
  status: string;
  roleType: string;
  startAt: string;
  endAt: string;
  bookingRequestId: string;
  worker: { firstName: string; lastName: string };
  site: { name: string } | null;
  bookingRequest: { id: string; status: string };
}

function truncateId(id: string, len = 10): string {
  return id.length > len ? `${id.slice(0, len)}…` : id;
}

function formatLabel(value: string): string {
  return value.replace(/_/g, " ");
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

const URGENCY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  critical: { bg: "rgba(226,87,74,0.1)", border: "rgba(226,87,74,0.3)", text: "var(--error)" },
  warning: { bg: "rgba(232,146,12,0.1)", border: "rgba(232,146,12,0.3)", text: "var(--warning)" },
  low: { bg: "rgba(31,157,87,0.1)", border: "rgba(31,157,87,0.3)", text: "var(--success)" },
};

const actionBtn = (tone: "success" | "neutral" | "error", disabled: boolean) => ({
  background:
    tone === "success"
      ? "rgba(31,157,87,0.1)"
      : tone === "error"
        ? "rgba(226,87,74,0.1)"
        : "rgba(31,77,255,0.08)",
  border:
    tone === "success"
      ? "1px solid rgba(31,157,87,0.3)"
      : tone === "error"
        ? "1px solid rgba(226,87,74,0.3)"
        : "1px solid rgba(31,77,255,0.25)",
  color: tone === "success" ? "var(--success)" : tone === "error" ? "var(--error)" : "var(--accent)",
  fontSize: "0.75rem",
  padding: "3px 12px",
  borderRadius: 6,
  cursor: disabled ? "default" : "pointer",
  opacity: disabled ? 0.5 : 1,
});

async function parseError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as {
    error?: string;
    explanation?: string;
    message?: string;
  } | null;
  return data?.error ?? data?.explanation ?? data?.message ?? "Action failed";
}

export function BookingsOps({
  initialUnfilled,
  initialBookings,
}: {
  initialUnfilled: UnfilledShift[];
  initialBookings: BookingOpsItem[];
}) {
  const [unfilled, setUnfilled] = useState(initialUnfilled);
  const [bookings, setBookings] = useState(initialBookings);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [assignWorkerId, setAssignWorkerId] = useState<Record<string, string>>({});

  useEffect(() => {
    setUnfilled(initialUnfilled);
  }, [initialUnfilled]);

  useEffect(() => {
    setBookings(initialBookings);
  }, [initialBookings]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const refresh = useCallback(async () => {
    try {
      const [unfilledRes, bookingsRes] = await Promise.all([
        fetch(`${API_URL}/v1/admin/ops/unfilled`, { cache: "no-store" }),
        fetch(`${API_URL}/v1/admin/bookings/ops`, { cache: "no-store" }),
      ]);
      if (unfilledRes.ok) {
        const data = (await unfilledRes.json()) as { unfilled: UnfilledShift[] };
        setUnfilled(data.unfilled ?? []);
      }
      if (bookingsRes.ok) {
        const data = (await bookingsRes.json()) as { bookings: BookingOpsItem[] };
        setBookings(data.bookings ?? []);
      }
    } catch {
      /* keep current lists */
    }
  }, []);

  const broadcast = async (item: UnfilledShift) => {
    const key = `unfilled:${item.bookingRequestId}`;
    setBusyKey(key);

    try {
      const res = await fetch(`${API_URL}/v1/bookings/${item.bookingRequestId}/broadcast`, {
        method: "POST",
      });
      if (res.status === 202) {
        const data = (await res.json()) as { explanation?: string };
        setToast(data.explanation ?? "Broadcast queued for approval.");
        return;
      }
      if (!res.ok) throw new Error(await parseError(res));
      setUnfilled((prev) => prev.filter((row) => row.bookingRequestId !== item.bookingRequestId));
      await refresh();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Broadcast failed — check API connection.");
    } finally {
      setBusyKey(null);
    }
  };

  const assign = async (item: UnfilledShift) => {
    const workerId = assignWorkerId[item.bookingRequestId]?.trim();
    if (!workerId) {
      setToast("Enter a worker ID to assign.");
      return;
    }

    const key = `assign:${item.bookingRequestId}`;
    setBusyKey(key);
    setUnfilled((prev) => prev.filter((row) => row.bookingRequestId !== item.bookingRequestId));

    try {
      const res = await fetch(`${API_URL}/v1/admin/bookings/${item.bookingRequestId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerId, adminId: "admin" }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      await refresh();
    } catch (err) {
      setUnfilled((prev) => {
        if (prev.some((row) => row.bookingRequestId === item.bookingRequestId)) return prev;
        return [item, ...prev];
      });
      setToast(err instanceof Error ? err.message : "Assign failed — check API connection.");
    } finally {
      setBusyKey(null);
    }
  };

  const cancelBooking = async (item: BookingOpsItem) => {
    const key = `cancel:${item.id}`;
    setBusyKey(key);
    setBookings((prev) => prev.filter((row) => row.id !== item.id));

    try {
      const res = await fetch(`${API_URL}/v1/admin/bookings/${item.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminId: "admin" }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      await refresh();
    } catch (err) {
      setBookings((prev) => {
        if (prev.some((row) => row.id === item.id)) return prev;
        return [item, ...prev];
      });
      setToast(err instanceof Error ? err.message : "Cancel failed — check API connection.");
    } finally {
      setBusyKey(null);
    }
  };

  const reopenBooking = async (item: BookingOpsItem) => {
    const key = `reopen:${item.id}`;
    setBusyKey(key);

    try {
      const res = await fetch(`${API_URL}/v1/admin/bookings/${item.id}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminId: "admin" }),
      });
      if (!res.ok) throw new Error(await parseError(res));
      await refresh();
    } catch (err) {
      setToast(err instanceof Error ? err.message : "Reopen failed — check API connection.");
    } finally {
      setBusyKey(null);
    }
  };

  const empty = unfilled.length === 0 && bookings.length === 0;

  if (empty) {
    return (
      <p style={{ color: "var(--muted)", fontSize: "0.875rem", padding: "0.375rem 0" }}>
        No unfilled shifts or actionable bookings
      </p>
    );
  }

  return (
    <>
      {unfilled.length > 0 && (
        <>
          <p
            style={{
              color: "var(--faint)",
              fontSize: "0.6875rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: "0 0 0.5rem",
            }}
          >
            Unfilled shifts
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1rem" }}>
            {unfilled.map((item) => {
              const colors = URGENCY_COLORS[item.urgency] ?? URGENCY_COLORS.low;
              const broadcastBusy = busyKey === `unfilled:${item.bookingRequestId}`;
              const assignBusy = busyKey === `assign:${item.bookingRequestId}`;
              const isBusy = broadcastBusy || assignBusy;

              return (
                <li
                  key={item.bookingRequestId}
                  style={{
                    padding: "0.75rem 0",
                    borderBottom: "1px solid var(--border)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <span style={{ color: "var(--text)", fontWeight: 500, fontSize: "0.875rem" }}>
                      Request {truncateId(item.bookingRequestId)}
                    </span>
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
                      {item.urgency}
                    </span>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "center",
                      justifyContent: "flex-end",
                      gap: 6,
                    }}
                  >
                    <input
                      type="text"
                      placeholder="Worker ID"
                      value={assignWorkerId[item.bookingRequestId] ?? ""}
                      onChange={(e) =>
                        setAssignWorkerId((prev) => ({
                          ...prev,
                          [item.bookingRequestId]: e.target.value,
                        }))
                      }
                      disabled={isBusy}
                      style={{
                        fontSize: "0.75rem",
                        padding: "3px 8px",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        background: "var(--surface)",
                        color: "var(--text)",
                        width: 120,
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => broadcast(item)}
                      disabled={isBusy}
                      style={actionBtn("success", isBusy)}
                    >
                      Broadcast
                    </button>
                    <button
                      type="button"
                      onClick={() => assign(item)}
                      disabled={isBusy}
                      style={actionBtn("neutral", isBusy)}
                    >
                      Assign
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {bookings.length > 0 && (
        <>
          <p
            style={{
              color: "var(--faint)",
              fontSize: "0.6875rem",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              margin: unfilled.length > 0 ? "0 0 0.5rem" : "0 0 0.5rem",
            }}
          >
            Bookings
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {bookings.map((item) => {
              const cancelBusy = busyKey === `cancel:${item.id}`;
              const reopenBusy = busyKey === `reopen:${item.id}`;
              const isBusy = cancelBusy || reopenBusy;
              const canCancel = !["cancelled", "completed"].includes(item.status);
              const canReopen = ["cancelled", "at_risk"].includes(item.status);

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
                  <div>
                    <span style={{ color: "var(--text)", fontWeight: 500, fontSize: "0.875rem" }}>
                      {item.worker.firstName} {item.worker.lastName}
                    </span>
                    <span style={{ color: "var(--muted)", fontSize: "0.8125rem", marginLeft: 8 }}>
                      {formatLabel(item.roleType)}
                      {item.site?.name ? ` · ${item.site.name}` : ""}
                    </span>
                    <span style={{ color: "var(--muted)", fontSize: "0.75rem", display: "block", marginTop: 2 }}>
                      {formatTime(item.startAt)} · {truncateId(item.id)}
                    </span>
                  </div>

                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                    {canCancel && (
                      <button
                        type="button"
                        onClick={() => cancelBooking(item)}
                        disabled={isBusy}
                        style={actionBtn("error", isBusy)}
                      >
                        Cancel
                      </button>
                    )}
                    {canReopen && (
                      <button
                        type="button"
                        onClick={() => reopenBooking(item)}
                        disabled={isBusy}
                        style={actionBtn("neutral", isBusy)}
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

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
