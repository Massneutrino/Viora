"use client";

import { useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function EmployerDashboard() {
  const [intent, setIntent] = useState("");
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleTellV(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setResponse(null);
    try {
      const res = await fetch(`${API_URL}/v1/intake/parse`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organisationId: "demo-org",
          rawInput: intent,
          channel: "web",
        }),
      });
      const data = await res.json();
      setResponse(data.message ?? JSON.stringify(data, null, 2));
    } catch {
      setResponse("Could not reach Viora API. Start it with: npm run dev --workspace @viora/api");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "2rem 1.5rem" }}>
      <header style={{ marginBottom: "2.5rem" }}>
        <p style={{ color: "var(--muted)", fontSize: "0.875rem", marginBottom: "0.25rem" }}>
          Viora · Employer
        </p>
        <h1 style={{ fontSize: "1.75rem", fontWeight: 600 }}>Tell V what you need</h1>
        <p style={{ color: "var(--muted)", marginTop: "0.5rem" }}>
          No forms. Describe cover in plain language — V handles the rest.
        </p>
      </header>

      <section
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: "1.5rem",
          marginBottom: "1.5rem",
        }}
      >
        <form onSubmit={handleTellV}>
          <label htmlFor="intent" style={{ display: "block", marginBottom: "0.5rem", fontWeight: 500 }}>
            Cover request
          </label>
          <textarea
            id="intent"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            placeholder="Need a KS2 supply for tomorrow — Year 5, 8:15 to 3:30. Behaviour experience helpful."
            rows={4}
            style={{
              width: "100%",
              padding: "0.75rem",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              resize: "vertical",
            }}
          />
          <button
            type="submit"
            disabled={loading || !intent.trim()}
            style={{
              marginTop: "1rem",
              padding: "0.625rem 1.25rem",
              background: "var(--accent)",
              color: "white",
              border: "none",
              borderRadius: 8,
              fontWeight: 500,
            }}
          >
            {loading ? "V is thinking…" : "Send to V"}
          </button>
        </form>
        {response && (
          <div
            style={{
              marginTop: "1rem",
              padding: "1rem",
              background: "var(--bg)",
              borderRadius: 8,
              border: "1px solid var(--border)",
              whiteSpace: "pre-wrap",
            }}
          >
            <strong style={{ color: "var(--accent)" }}>V: </strong>
            {response}
          </div>
        )}
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem" }}>
        {[
          { label: "Open requests", value: "—" },
          { label: "Fill rate", value: "—" },
          { label: "Active bookings", value: "—" },
          { label: "Spend (term)", value: "—" },
        ].map((stat) => (
          <div
            key={stat.label}
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: "1.25rem",
            }}
          >
            <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>{stat.label}</p>
            <p style={{ fontSize: "1.5rem", fontWeight: 600, marginTop: "0.25rem" }}>{stat.value}</p>
          </div>
        ))}
      </section>
    </div>
  );
}
