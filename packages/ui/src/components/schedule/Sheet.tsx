"use client"

import { useEffect, type ReactNode } from "react"

// Bottom-sheet on narrow screens, centred modal on desktop. Mounted only while
// `open` (no SSR/measure quirks). Backdrop + Escape close. Used by the worker
// "Mark unavailable" and "Weekly availability" forms.
//
// The `!important` rules override the inline mobile-first styles at ≥900px —
// inline styles are only beaten by `!important`, which is exactly what we want.

export function Sheet({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="viora-sheet-overlay"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(28,30,34,0.4)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        className="viora-sheet-panel"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--surface)",
          width: "100%",
          maxWidth: 460,
          borderRadius: "20px 20px 0 0",
          boxShadow: "0 -10px 40px rgba(28,30,34,0.18)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "85vh",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 18px 12px",
            borderBottom: "0.5px solid var(--border)",
          }}
        >
          <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{title}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "var(--surface-2)",
              border: "none",
              borderRadius: 8,
              width: 28,
              height: 28,
              color: "var(--muted)",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: "14px 18px", overflowY: "auto" }}>{children}</div>
        {footer && <div style={{ padding: "12px 18px 16px", borderTop: "0.5px solid var(--border)" }}>{footer}</div>}
      </div>
      <style>{`@media (min-width:900px){.viora-sheet-overlay{align-items:center !important}.viora-sheet-panel{border-radius:20px !important}}`}</style>
    </div>
  )
}
