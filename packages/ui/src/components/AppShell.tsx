"use client"

import { useEffect, useState, type ReactNode } from "react"
import { PixelSphere, type WaveState } from "./PixelSphere"

export type PreviewMode = "auto" | "web" | "phone"
export type NavItem = { id: string; label: string; icon: ReactNode }

// Subtle dot grid behind the hero/content — keeps the clean white, adds quiet structure.
const DOT_GRID: React.CSSProperties = {
  backgroundImage: "radial-gradient(circle, #e3e6ea 1px, transparent 1px)",
  backgroundSize: "18px 18px",
}

function Wordmark({ scale = 1 }: { scale?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", color: "var(--text)", letterSpacing: "0.1em" }}>
      <span style={{ fontSize: 24 * scale, fontWeight: 600 }}>V</span>
      <span style={{ fontSize: 15 * scale, fontWeight: 600 }}>IORA</span>
    </span>
  )
}

function OnlineDot() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--success)", display: "inline-block" }} />
      <span style={{ color: "var(--muted)", fontSize: 12 }}>V online</span>
    </div>
  )
}

function PreviewToggle({ preview, onChange }: { preview: PreviewMode; onChange: (m: PreviewMode) => void }) {
  const opts: { id: PreviewMode; label: string }[] = [
    { id: "web", label: "Web" },
    { id: "phone", label: "Phone" },
  ]
  const resolved = preview === "auto" ? "web" : preview
  return (
    <div style={{ position: "fixed", top: 14, right: 16, display: "flex", gap: 2, background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 9, padding: 3, zIndex: 50 }}>
      {opts.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)} style={{
          border: "none", borderRadius: 6, padding: "5px 12px", fontSize: 11, fontWeight: 600,
          background: resolved === o.id ? "var(--accent)" : "transparent",
          color: resolved === o.id ? "#fff" : "var(--muted)",
        }}>{o.label}</button>
      ))}
    </div>
  )
}

function Hero({
  sphereState, onSphereTap, statusLabel, statusSublabel, size,
}: { sphereState: WaveState; onSphereTap: () => void; statusLabel: string; statusSublabel?: string; size: number }) {
  const labelColor = sphereState === "confirmed" ? "var(--success)" : sphereState === "risk" ? "var(--warning)" : "var(--text)"
  return (
    <div style={{ flexShrink: 0, padding: "26px 20px 12px", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <PixelSphere state={sphereState} size={size} onTap={onSphereTap} ariaLabel="Tap to talk to V" />
      <div style={{ textAlign: "center" }}>
        <p style={{ color: labelColor, fontSize: 17, fontWeight: 600, margin: 0, transition: "color 0.3s" }}>{statusLabel}</p>
        {statusSublabel && <p style={{ color: "var(--muted)", fontSize: 12, margin: "4px 0 0" }}>{statusSublabel}</p>}
      </div>
    </div>
  )
}

export function AppShell({
  navItems, activeNav, onNavChange,
  sphereState, onSphereTap, statusLabel, statusSublabel,
  preview, onPreviewChange,
  children, footer,
}: {
  navItems: NavItem[]
  activeNav: string
  onNavChange: (id: string) => void
  sphereState: WaveState
  onSphereTap: () => void
  statusLabel: string
  statusSublabel?: string
  preview: PreviewMode
  onPreviewChange: (m: PreviewMode) => void
  children: ReactNode
  footer?: ReactNode
}) {
  const [isNarrow, setNarrow] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 899px)")
    const on = () => setNarrow(mq.matches)
    on()
    mq.addEventListener("change", on)
    return () => mq.removeEventListener("change", on)
  }, [])

  let layout: "desktop" | "mobile" = "desktop"
  let framed = false
  if (preview === "web") layout = "desktop"
  else if (preview === "phone") { layout = "mobile"; framed = true }
  else { layout = isNarrow ? "mobile" : "desktop" }

  // ── Desktop: side-rail + main column ────────────────────────────────────────
  if (layout === "desktop") {
    return (
      <div style={{ display: "flex", height: "100vh", background: "var(--bg)", overflow: "hidden" }}>
        <PreviewToggle preview={preview} onChange={onPreviewChange} />

        <nav style={{ width: 76, background: "var(--surface)", borderRight: "0.5px solid var(--border)", display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 14, gap: 4, flexShrink: 0 }}>
          <div style={{ marginBottom: 14 }}><PixelSphere state="rest" size={30} /></div>
          {navItems.map(n => (
            <button key={n.id} onClick={() => onNavChange(n.id)} title={n.label} style={{
              width: 60, borderRadius: 11, border: "none", padding: "8px 0",
              background: activeNav === n.id ? "rgba(47,107,255,0.1)" : "transparent",
              color: activeNav === n.id ? "var(--accent)" : "var(--muted)",
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4, transition: "all 0.15s",
            }}>
              {n.icon}
              <span style={{ fontSize: 9, fontWeight: activeNav === n.id ? 600 : 400 }}>{n.label}</span>
            </button>
          ))}
        </nav>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <header style={{ padding: "14px 22px", borderBottom: "0.5px solid var(--border)", background: "var(--surface)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
            <Wordmark />
            <OnlineDot />
          </header>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", ...DOT_GRID, backgroundColor: "var(--bg)" }}>
            <Hero sphereState={sphereState} onSphereTap={onSphereTap} statusLabel={statusLabel} statusSublabel={statusSublabel} size={172} />
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>{children}</div>
          </div>
          {footer && <div style={{ flexShrink: 0, background: "var(--surface)", borderTop: "0.5px solid var(--border)" }}>{footer}</div>}
        </div>

        <style>{`::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:var(--border-strong);border-radius:4px}`}</style>
      </div>
    )
  }

  // ── Mobile: status bar + bottom nav (optionally inside a device frame) ──────
  const inner = (
    <>
      <div style={{ padding: "14px 22px 0", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <span style={{ color: "var(--faint)", fontSize: 11 }}>9:41</span>
        <Wordmark scale={0.8} />
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--muted)" }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--success)", display: "inline-block" }} />V
        </span>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", ...DOT_GRID, backgroundColor: "var(--bg)" }}>
        <Hero sphereState={sphereState} onSphereTap={onSphereTap} statusLabel={statusLabel} statusSublabel={statusSublabel} size={150} />
        <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>{children}</div>
      </div>

      {footer && <div style={{ flexShrink: 0, background: "var(--surface)" }}>{footer}</div>}

      <div style={{ padding: "10px 12px 24px", borderTop: "0.5px solid var(--border)", background: "var(--surface)", display: "flex", justifyContent: "space-around", alignItems: "center", flexShrink: 0 }}>
        {navItems.map(n => {
          const active = activeNav === n.id
          return (
            <button key={n.id} onClick={() => onNavChange(n.id)} style={{
              background: "transparent", border: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              color: active ? "var(--accent)" : "var(--muted)", opacity: active ? 1 : 0.7, transition: "all 0.15s",
            }}>
              {n.icon}
              <span style={{ fontSize: 9, fontWeight: active ? 600 : 400 }}>{n.label}</span>
            </button>
          )
        })}
      </div>
    </>
  )

  if (framed) {
    return (
      <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <PreviewToggle preview={preview} onChange={onPreviewChange} />
        <div style={{ width: 390, height: 844, background: "var(--surface)", borderRadius: 44, border: "1px solid var(--border-strong)", overflow: "hidden", position: "relative", display: "flex", flexDirection: "column", boxShadow: "0 30px 90px rgba(28,30,34,0.12)" }}>
          {inner}
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
      <PreviewToggle preview={preview} onChange={onPreviewChange} />
      {inner}
    </div>
  )
}
