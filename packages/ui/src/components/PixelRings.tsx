"use client"

import { useEffect, useRef } from "react"
import { ACCENT, type WaveState } from "./PixelSphere"

// Sonar-ring backdrop, drawn from the same small squares as the PixelSphere so the
// whole identity reads as one pixel grid. Concentric rings of dots radiate from the
// sphere centre. At rest they're a faint, static cool-grey; while V is listening or
// speaking they ripple outward and tint ultramarine — motion means the voice is live.
const REST: readonly [number, number, number] = [70, 84, 110] // faint cool blue-grey
const DECAY = 90 // px — how fast the dissipation fades outward from the orb edge
const RIPPLE_K = 0.18 // ripple speed per unit of the orb's wave speed

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const isActive = (s: WaveState) => s === "listening" || s === "speaking" || s === "processing"
// Match PixelSphere's per-state wave speeds so the ripple emanates in the orb's cadence.
const waveSpeed = (s: WaveState) => (s === "speaking" ? 2.6 : s === "listening" ? 2.0 : s === "processing" ? 1.4 : 0)

export function PixelRings({
  state = "rest",
  centerY,
  innerRadius,
  spacing = 20,
  intensity = 0.1,
}: {
  state?: WaveState
  centerY: number
  innerRadius: number
  spacing?: number
  intensity?: number
}) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const stateRef = useRef<WaveState>(state)
  stateRef.current = state
  const startRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    const DPR = window.devicePixelRatio || 1
    let W = 1, H = 1

    const resize = () => {
      const r = canvas.getBoundingClientRect()
      W = Math.max(1, r.width)
      H = Math.max(1, r.height)
      canvas.width = Math.round(W * DPR)
      canvas.height = Math.round(H * DPR)
    }

    const SQ = 3
    let act = 0, frac = 0, last = 0, raf = 0, running = false

    const render = () => {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
      ctx.clearRect(0, 0, W, H)
      const cx = W / 2, cy = centerY
      const maxR = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) + spacing
      const cr = lerp(REST[0], ACCENT[0], act * 0.9)
      const cg = lerp(REST[1], ACCENT[1], act * 0.9)
      const cb = lerp(REST[2], ACCENT[2], act * 0.9)
      const baseA = intensity * (1 + act * 0.8) // a touch stronger when active

      // Rings start at the orb edge and dissipate outward — brightest at the sphere,
      // thinning into the off-white, as if the orb is shedding its own pixels.
      for (let k = 0; ; k++) {
        const r = innerRadius + spacing * (k + frac)
        if (r > maxR) break
        const falloff = Math.exp(-(r - innerRadius) / DECAY)
        const a = baseA * falloff
        if (a < 0.012) break // faded out — no point drawing fainter rings
        const n = Math.max(8, Math.round((2 * Math.PI * r) / spacing))
        const rot = r * 0.015 // slight per-ring twist so dots don't line up into spokes
        ctx.fillStyle = `rgba(${cr | 0},${cg | 0},${cb | 0},${a.toFixed(3)})`
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * Math.PI * 2 + rot
          const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r
          if (x < -4 || x > W + 4 || y < -4 || y > H + 4) continue
          ctx.fillRect(x - SQ / 2, y - SQ / 2, SQ, SQ)
        }
      }
    }

    const frame = (ts: number) => {
      if (!last) last = ts
      const dt = Math.min(0.05, (ts - last) / 1000)
      last = ts
      const s = stateRef.current
      const target = isActive(s) ? 1 : 0
      act = lerp(act, target, 0.08)
      frac = (frac + dt * waveSpeed(s) * RIPPLE_K) % 1 // ripple outward, synced to the orb's wave
      render()
      if (act > 0.004 || target > 0) {
        raf = requestAnimationFrame(frame)
      } else {
        // settled back to rest: snap to a clean static frame and stop the loop
        running = false
        act = 0
        frac = 0
        render()
      }
    }

    const ensureRunning = () => {
      if (running || reduce) return
      running = true
      last = 0
      raf = requestAnimationFrame(frame)
    }
    startRef.current = ensureRunning

    resize()
    render()
    const ro = new ResizeObserver(() => {
      resize()
      render()
    })
    ro.observe(canvas)
    if (isActive(stateRef.current)) ensureRunning()

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      startRef.current = null
    }
  }, [centerY, spacing, intensity])

  // Restart the ripple loop whenever V becomes active.
  useEffect(() => {
    if (isActive(state)) startRef.current?.()
  }, [state])

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0, pointerEvents: "none" }}
    />
  )
}
