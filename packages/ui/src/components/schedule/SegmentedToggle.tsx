"use client"

import type { ReactNode } from "react"

// Generic segmented (pill) toggle — e.g. employer List|Schedule, or Day|Hour on
// both surfaces. Generalises the hand-rolled rate-mode toggle in apps/web.

export function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: { id: T; label: ReactNode }[]
  value: T
  onChange: (id: T) => void
  size?: "sm" | "md"
}) {
  const pad = size === "sm" ? "5px 11px" : "7px 14px"
  const fontSize = size === "sm" ? 11 : 12
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 2,
        background: "var(--surface)",
        border: "0.5px solid var(--border)",
        borderRadius: 10,
        padding: 3,
      }}
    >
      {options.map((o) => {
        const active = o.id === value
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={active}
            style={{
              border: "none",
              borderRadius: 7,
              padding: pad,
              fontSize,
              fontWeight: 600,
              cursor: "pointer",
              background: active ? "var(--accent)" : "transparent",
              color: active ? "#fff" : "var(--muted)",
              transition: "all 0.12s",
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
