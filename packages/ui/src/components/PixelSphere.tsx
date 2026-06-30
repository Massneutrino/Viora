"use client"

import { useEffect, useRef } from "react"

export type WaveState = "rest" | "listening" | "processing" | "speaking" | "confirmed" | "risk"

// V identity: a sphere drawn from small squares. Active pixels morph between a
// "V" glyph and a dual waveform. At rest the mark is a darker engraving; colour
// appears only when active (ultramarine), switching to success/warning for
// confirmed/risk. Brand accent is the one knob.
type RGB = readonly [number, number, number]
export const ACCENT: RGB = [31, 77, 255] // ultramarine #1F4DFF — active tint
const SUCCESS: RGB = [31, 157, 87]
const WARNING: RGB = [232, 146, 12]
const SHADOW: RGB = [120, 126, 138] // chrome in shadow
const HI: RGB = [244, 247, 251] // chrome lit

const lerp = (a: number, b: number, t: number) => a + (b - a) * t

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const vx = bx - ax, vy = by - ay, wx = px - ax, wy = py - ay
  let t = (wx * vx + wy * vy) / (vx * vx + vy * vy)
  t = t < 0 ? 0 : t > 1 ? 1 : t
  const ex = px - (ax + t * vx), ey = py - (ay + t * vy)
  return Math.sqrt(ex * ex + ey * ey)
}

function vMask(nx: number, ny: number) {
  const d = Math.min(
    segDist(nx, ny, -0.5, -0.5, 0, 0.52),
    segDist(nx, ny, 0.5, -0.5, 0, 0.52),
  )
  return Math.max(0, 1 - d / 0.16)
}

function waveMask(nx: number, ny: number, ph: number) {
  const y1 = -0.13 + 0.17 * Math.sin(nx * 3.0 + ph)
  const y2 = 0.13 + 0.15 * Math.sin(nx * 3.0 + ph + 2.1)
  const d = Math.min(Math.abs(ny - y1), Math.abs(ny - y2))
  return Math.max(0, 1 - d / 0.12)
}

export function PixelSphere({
  state = "rest",
  size = 200,
  onTap,
  ariaLabel,
  staticMark = false,
}: {
  state?: WaveState
  size?: number
  onTap?: () => void
  ariaLabel?: string
  staticMark?: boolean
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const stateRef = useRef<WaveState>(state)
  stateRef.current = state

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const DPR = window.devicePixelRatio || 1
    canvas.width = size * DPR
    canvas.height = size * DPR
    ctx.scale(DPR, DPR)

    const cx = size / 2, cy = size / 2
    const R = size * 0.44
    // Static lockup marks sample a much finer, fuller grid so the engraved V reads
    // at small header sizes (the animated hero keeps its sparser, glossier grid).
    const step = staticMark ? Math.max(3, size / 30) : Math.max(5, size / 23)
    const u = (staticMark ? step / 7 : step / 8.6) // square-size scale relative to the 200px reference
    // Small marks (rail/header lockup) have few, large dots, so the orbiting glint
    // washes the engraved V. Damp the shine and deepen the engraving as size shrinks;
    // the big hero (≥160px) keeps full gloss.
    const gloss = Math.max(0, Math.min(1, (size - 40) / 120))
    // Precompute the sphere normal (nx, ny, z) per dot so we can shade it as a 3D ball.
    const dots: { x: number; y: number; nx: number; ny: number; z: number }[] = []
    for (let y = cy - R; y <= cy + R; y += step)
      for (let x = cx - R; x <= cx + R; x += step) {
        const dx = (x - cx) / R, dy = (y - cy) / R
        const r2 = dx * dx + dy * dy
        if (r2 <= 1) dots.push({ x, y, nx: dx, ny: dy, z: Math.sqrt(1 - r2) })
      }

    let raf = 0
    let running = false
    let active = 0, morph = 0, t0: number | null = null

    const draw = (ts: number) => {
      if (t0 === null) t0 = ts
      const t = (ts - t0) / 1000
      const st = stateRef.current

      let tActive = 0, tMorph = 0, speed = 1.0, accent = ACCENT
      if (st === "listening") { tActive = 1; tMorph = 1; speed = 2.0 }
      else if (st === "speaking") { tActive = 1; tMorph = 1; speed = 2.6 }
      else if (st === "processing") { tActive = 0.55; tMorph = 0.6; speed = 1.4 }
      else if (st === "confirmed") { tActive = 0.7; tMorph = 0; speed = 1.2; accent = SUCCESS }
      else if (st === "risk") { tActive = 0.6; tMorph = 0.15; speed = 1.0; accent = WARNING }

      active = lerp(active, tActive, 0.08)
      morph = lerp(morph, tMorph, 0.08)
      const ph = t * speed

      // Light orbits the sphere so the chrome glint travels around it (alive at rest).
      // Static lockup marks use a fixed upper-left light (no travelling glint) so the
      // engraved V stays put and legible.
      let lx = staticMark ? -0.35 : Math.cos(t * 0.7) * 0.42
      let ly = staticMark ? -0.45 : Math.sin(t * 0.7) * 0.42
      let lz = staticMark ? 0.85 : 0.6
      const ll = Math.hypot(lx, ly, lz); lx /= ll; ly /= ll; lz /= ll
      let hx = lx, hy = ly, hz = lz + 1
      const hl = Math.hypot(hx, hy, hz); hx /= hl; hy /= hl; hz /= hl

      ctx.clearRect(0, 0, size, size)

      if (active > 0.02) {
        const g = ctx.createRadialGradient(cx, cy, size * 0.05, cx, cy, R * 1.2)
        g.addColorStop(0, `rgba(${accent[0]},${accent[1]},${accent[2]},${0.14 * active})`)
        g.addColorStop(1, `rgba(${accent[0]},${accent[1]},${accent[2]},0)`)
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(cx, cy, R * 1.2, 0, 7)
        ctx.fill()
      }

      for (const dt of dots) {
        const a = Math.min(1, vMask(dt.nx, dt.ny) * (1 - morph) + waveMask(dt.nx, dt.ny, ph) * morph)
        const relief = a * (0.5 + active * 0.65) // V stays raised even at rest
        const rest = a * (1 - active) // strength of the idle engraving

        // Chrome shading from the orbiting light.
        const diff = Math.max(0, dt.nx * lx + dt.ny * ly + dt.z * lz)
        const spec = Math.pow(Math.max(0, dt.nx * hx + dt.ny * hy + dt.z * hz), 70)
        const sh = 0.25 + 0.75 * diff
        let r = SHADOW[0] + (HI[0] - SHADOW[0]) * sh
        let g = SHADOW[1] + (HI[1] - SHADOW[1]) * sh
        let b = SHADOW[2] + (HI[2] - SHADOW[2]) * sh

        // At rest the V/wave reads as a darker engraving (light-independent) so the
        // mark holds as the glint orbits; raised pixels only brighten once active.
        const sp2 = staticMark ? 0 : spec * (0.4 + relief * 1.1) * 0.4 * (0.15 + 0.85 * gloss)
        // Static marks have no shine, so lean on a deep engraving to read the V clearly.
        const engrave = staticMark ? 1.9 : 1 + (1 - gloss) * 0.73
        r += 255 * sp2 - rest * 55 * engrave + active * relief * 18
        g += 255 * sp2 - rest * 55 * engrave + active * relief * 18
        b += 255 * sp2 - rest * 52 * engrave + active * relief * 20

        // Ultramarine (or success/warning) only when active.
        const mix = a * active * 0.9
        r += (accent[0] - r) * mix
        g += (accent[1] - g) * mix
        b += (accent[2] - b) * mix

        const sz = (2.4 + 2.0 * dt.z) * (1 + relief) * u
        const off = a * (1.3 + active * 2.2) * u // emboss toward the light
        ctx.fillStyle = `rgb(${Math.min(255, r | 0)},${Math.min(255, g | 0)},${Math.min(255, b | 0)})`
        ctx.fillRect(dt.x - lx * off - sz / 2, dt.y - ly * off - sz / 2, sz, sz)
      }
      if (!staticMark && running) raf = requestAnimationFrame(draw)
    }

    const start = () => {
      if (running) return
      running = true
      raf = requestAnimationFrame(draw)
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(raf)
    }

    // Gate the loop on visibility: it won't start until the canvas is in view
    // (so it doesn't compete with first-paint hydration before it's even seen),
    // and it pauses when scrolled off-screen instead of burning frames.
    let io: IntersectionObserver | null = null
    if (typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) start()
          else stop()
        },
        { threshold: 0 },
      )
      io.observe(canvas)
    } else {
      start()
    }

    return () => {
      stop()
      io?.disconnect()
    }
  }, [size, staticMark])

  return (
    <canvas
      ref={ref}
      onClick={onTap}
      role={onTap ? "button" : "img"}
      aria-label={ariaLabel ?? "V"}
      tabIndex={onTap ? 0 : undefined}
      onKeyDown={
        onTap
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                onTap()
              }
            }
          : undefined
      }
      style={{ width: size, height: size, cursor: onTap ? "pointer" : "default", display: "block" }}
    />
  )
}
