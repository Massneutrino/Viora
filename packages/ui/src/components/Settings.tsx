"use client"

import { useState, type ReactNode, type CSSProperties } from "react"

// Shared settings/account primitives — light theme, CSS-var tokens, single
// ACCENT. Used by the worker Account hub and the employer Settings tab.

const sectionLabel: CSSProperties = {
  color: "var(--muted)", fontSize: 10, textTransform: "uppercase",
  letterSpacing: "0.08em", margin: "0 0 8px", paddingLeft: 4,
}
const cardStyle: CSSProperties = {
  background: "var(--surface)", border: "0.5px solid var(--border)",
  borderRadius: 16, overflow: "hidden",
}
const rowStyle: CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: 12, padding: "13px 16px",
}
const ghostBtn: CSSProperties = {
  background: "transparent", border: "none", color: "var(--muted)",
  fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "4px 6px",
}
const accentBtn: CSSProperties = {
  background: "var(--accent)", border: "none", color: "#fff",
  fontSize: 12, fontWeight: 600, cursor: "pointer", padding: "6px 12px", borderRadius: 9,
}

/** Titled group of rows. Rows are auto-separated by hairline dividers. */
export function SectionCard({ title, hint, children }: { title?: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      {title && <p style={sectionLabel}>{title}</p>}
      <div className="viora-settings-card" style={cardStyle}>{children}</div>
      {hint && <p style={{ color: "var(--faint)", fontSize: 10, margin: "8px 0 0", paddingLeft: 4 }}>{hint}</p>}
      <style>{`.viora-settings-card > * + *{border-top:0.5px solid var(--border)}`}</style>
    </div>
  )
}

/** A label (+ optional sublabel) with arbitrary right-hand content. */
export function SettingRow({ label, sublabel, children }: { label: string; sublabel?: string; children?: ReactNode }) {
  return (
    <div style={rowStyle}>
      <div style={{ minWidth: 0 }}>
        <p style={{ color: "var(--text)", fontSize: 13, fontWeight: 600, margin: 0 }}>{label}</p>
        {sublabel && <p style={{ color: "var(--muted)", fontSize: 11, margin: "2px 0 0", lineHeight: 1.4 }}>{sublabel}</p>}
      </div>
      {children != null && <div style={{ flexShrink: 0, color: "var(--muted)", fontSize: 13 }}>{children}</div>}
    </div>
  )
}

/** A labelled toggle switch. */
export function ToggleRow({ label, sublabel, checked, onChange }: { label: string; sublabel?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <SettingRow label={label} sublabel={sublabel}>
      <button onClick={() => onChange(!checked)} aria-pressed={checked} aria-label={label} style={{
        width: 42, height: 25, borderRadius: 20, border: "none", cursor: "pointer", padding: 0,
        background: checked ? "var(--accent)" : "var(--border-strong)", position: "relative", transition: "background 0.18s",
      }}>
        <span style={{
          position: "absolute", top: 2.5, left: checked ? 19.5 : 2.5, width: 20, height: 20,
          borderRadius: "50%", background: "#fff", transition: "left 0.18s", boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
        }} />
      </button>
    </SettingRow>
  )
}

/** Inline-editable single value. Persists via onSave (the empty string clears). */
export function EditableField({
  label, value, placeholder, type = "text", suffix, onSave, format,
}: {
  label: string
  value: string | number | null | undefined
  placeholder?: string
  type?: "text" | "number"
  suffix?: string
  onSave: (next: string) => Promise<void> | void
  format?: (v: string | number) => string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)

  const empty = value === null || value === undefined || value === ""
  const display = empty
    ? placeholder ?? "—"
    : format ? format(value as string | number) : `${value}${suffix ? ` ${suffix}` : ""}`

  const start = () => { setDraft(empty ? "" : String(value)); setEditing(true) }
  const cancel = () => { setEditing(false); setSaving(false) }
  const save = async () => {
    setSaving(true)
    try { await onSave(draft.trim()); setEditing(false) }
    finally { setSaving(false) }
  }

  return (
    <div style={rowStyle}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <p style={{ color: "var(--muted)", fontSize: 11, margin: "0 0 3px" }}>{label}</p>
        {editing ? (
          <input
            autoFocus type={type} value={draft} placeholder={placeholder}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") void save(); if (e.key === "Escape") cancel() }}
            style={{
              width: "100%", maxWidth: 220, background: "var(--bg)", border: "0.5px solid var(--border-strong)",
              borderRadius: 9, padding: "7px 10px", fontSize: 13, color: "var(--text)", outline: "none",
            }}
          />
        ) : (
          <p style={{ color: empty ? "var(--faint)" : "var(--text)", fontSize: 13, fontWeight: 600, margin: 0 }}>{display}</p>
        )}
      </div>
      <div style={{ flexShrink: 0, display: "flex", gap: 6 }}>
        {editing ? (
          <>
            <button onClick={cancel} disabled={saving} style={ghostBtn}>Cancel</button>
            <button onClick={() => void save()} disabled={saving} style={accentBtn}>{saving ? "…" : "Save"}</button>
          </>
        ) : (
          <button onClick={start} style={ghostBtn}>Edit</button>
        )}
      </div>
    </div>
  )
}

/** Inline-editable list of string chips (add/remove). Persists via onSave. */
export function ChipsField({
  label, values, placeholder, format, onSave,
}: {
  label: string
  values: string[]
  placeholder?: string
  format?: (v: string) => string
  onSave: (next: string[]) => Promise<void> | void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<string[]>(values)
  const [input, setInput] = useState("")
  const [saving, setSaving] = useState(false)

  const start = () => { setDraft(values); setInput(""); setEditing(true) }
  const cancel = () => { setEditing(false); setSaving(false) }
  const add = () => {
    const v = input.trim().toLowerCase().replace(/\s+/g, "_")
    if (v && !draft.includes(v)) setDraft([...draft, v])
    setInput("")
  }
  const remove = (v: string) => setDraft(draft.filter(d => d !== v))
  const save = async () => {
    setSaving(true)
    try { await onSave(draft); setEditing(false) }
    finally { setSaving(false) }
  }

  const shown = editing ? draft : values
  const chip = (v: string, removable: boolean) => (
    <span key={v} style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: "rgba(31,77,255,0.1)", border: "0.5px solid rgba(31,77,255,0.3)", color: "var(--accent)",
      fontSize: 11, fontWeight: 600, padding: "4px 9px", borderRadius: 20,
    }}>
      {format ? format(v) : v}
      {removable && <button onClick={() => remove(v)} aria-label={`Remove ${v}`} style={{ background: "none", border: "none", color: "var(--accent)", cursor: "pointer", padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>}
    </span>
  )

  return (
    <div style={{ ...rowStyle, alignItems: "flex-start", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
        <p style={{ color: "var(--muted)", fontSize: 11, margin: 0 }}>{label}</p>
        <div style={{ display: "flex", gap: 6 }}>
          {editing ? (
            <>
              <button onClick={cancel} disabled={saving} style={ghostBtn}>Cancel</button>
              <button onClick={() => void save()} disabled={saving} style={accentBtn}>{saving ? "…" : "Save"}</button>
            </>
          ) : (
            <button onClick={start} style={ghostBtn}>Edit</button>
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {shown.length ? shown.map(v => chip(v, editing)) : <span style={{ color: "var(--faint)", fontSize: 12 }}>{placeholder ?? "None"}</span>}
      </div>
      {editing && (
        <div style={{ display: "flex", gap: 6, width: "100%" }}>
          <input
            value={input} placeholder="Add a role…"
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add() } }}
            style={{ flex: 1, background: "var(--bg)", border: "0.5px solid var(--border-strong)", borderRadius: 9, padding: "7px 10px", fontSize: 13, color: "var(--text)", outline: "none" }}
          />
          <button onClick={add} style={{ ...accentBtn, background: "var(--surface-2)", color: "var(--accent)" }}>+ Add</button>
        </div>
      )}
    </div>
  )
}

/** Full-width clickable row, e.g. switch account / sign out. */
export function AccountRow({ label, sublabel, onClick, danger, icon }: { label: string; sublabel?: string; onClick: () => void; danger?: boolean; icon?: ReactNode }) {
  return (
    <button onClick={onClick} style={{ ...rowStyle, width: "100%", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        {icon && <span style={{ color: danger ? "var(--error)" : "var(--muted)", display: "flex", flexShrink: 0 }}>{icon}</span>}
        <div style={{ minWidth: 0 }}>
          <p style={{ color: danger ? "var(--error)" : "var(--text)", fontSize: 13, fontWeight: 600, margin: 0 }}>{label}</p>
          {sublabel && <p style={{ color: "var(--muted)", fontSize: 11, margin: "2px 0 0" }}>{sublabel}</p>}
        </div>
      </div>
      {!danger && <span style={{ color: "var(--faint)", fontSize: 16, flexShrink: 0 }}>›</span>}
    </button>
  )
}

/** Initials avatar from a name. */
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join("") || "?"
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%", flexShrink: 0,
      background: "rgba(31,77,255,0.12)", border: "0.5px solid rgba(31,77,255,0.3)", color: "var(--accent)",
      display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: size * 0.36,
    }}>{initials}</div>
  )
}
