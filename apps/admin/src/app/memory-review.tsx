"use client";

import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:6200";

export type MemoryReviewItem = {
  id: string;
  ownerType: string;
  ownerId: string;
  subjectType: string;
  subjectId: string;
  kind: string;
  title: string;
  content: string;
  visibility: string;
  status: string;
  confidence: number;
  createdAt: string;
};

export function MemoryReview({ initial }: { initial: MemoryReviewItem[] }) {
  const [items, setItems] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function update(id: string, status: "active" | "archived") {
    setBusyId(id);
    try {
      const res = await fetch(`${API_URL}/v1/admin/memory/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, adminId: "admin" }),
      });
      if (!res.ok) throw new Error("update failed");
      setItems((prev) => prev.filter((item) => item.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  if (items.length === 0) {
    return <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>No memory candidates awaiting review.</p>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
      {items.map((item) => (
        <div
          key={item.id}
          style={{
            border: "0.5px solid var(--border)",
            borderRadius: 8,
            padding: "0.75rem",
            background: "rgba(255,255,255,0.55)",
          }}
        >
          <p style={{ margin: 0, color: "var(--text)", fontWeight: 600, fontSize: "0.875rem" }}>
            {item.title}
          </p>
          <p style={{ margin: "0.25rem 0 0", color: "var(--muted)", fontSize: "0.8125rem", lineHeight: 1.45 }}>
            {item.content}
          </p>
          <p style={{ margin: "0.5rem 0 0", color: "var(--faint)", fontSize: "0.6875rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            {item.ownerType}:{item.ownerId} · {item.kind} · {item.visibility} · {Math.round(item.confidence * 100)}%
          </p>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.75rem" }}>
            <button
              disabled={busyId === item.id}
              onClick={() => void update(item.id, "active")}
              style={{ border: "none", borderRadius: 7, padding: "0.4rem 0.7rem", background: "var(--accent)", color: "#fff", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}
            >
              Confirm
            </button>
            <button
              disabled={busyId === item.id}
              onClick={() => void update(item.id, "archived")}
              style={{ border: "0.5px solid var(--border)", borderRadius: 7, padding: "0.4rem 0.7rem", background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: "0.75rem", fontWeight: 600 }}
            >
              Archive
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
