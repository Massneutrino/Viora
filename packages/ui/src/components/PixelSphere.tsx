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
}: {
  state?: WaveState
  size?: number
  onTap?: () => void
  ariaLabel?: string
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
    const step = Math.max(5, size / 23)
    const u = step / 8.6 // square-size scale relative to the 200px reference
    // Precompute the sphere normal (nx, ny, z) per dot so we can shade it as a 3D ball.
    const dots: { x: number; y: number; nx: number; ny: number; z: number }[] = []
    for (let y = cy - R; y <= cy + R; y += step)
      for (let x = cx - R; x <= cx + R; x += step) {
        const dx = (x - cx) / R, dy = (y - cy) / R
        const r2 = dx * dx + dy * dy
        if (r2 <= 1) dots.push({ x, y, nx: dx, ny: dy, z: Math.sqrt(1 - r2) })
      }

    let raf = 0
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
      let lx = Math.cos(t * 0.7) * 0.42, ly = Math.sin(t * 0.7) * 0.42, lz = 0.6
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
        const sp2 = spec * (0.4 + relief * 1.1) * 0.4
        r += 255 * sp2 - rest * 55 + active * relief * 18
        g += 255 * sp2 - rest * 55 + active * relief * 18
        b += 255 * sp2 - rest * 52 + active * relief * 20

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
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [size])

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
