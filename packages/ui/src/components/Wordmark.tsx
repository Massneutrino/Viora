export function Wordmark({ scale = 1 }: { scale?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", color: "var(--text)", letterSpacing: "0.1em" }}>
      <span style={{ fontSize: 24 * scale, fontWeight: 600 }}>V</span>
      <span style={{ fontSize: 15 * scale, fontWeight: 600 }}>IORA</span>
    </span>
  )
}
