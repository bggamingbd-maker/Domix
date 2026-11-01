import { useEffect, useRef } from 'react'

const EVENT = 'domix:confetti'
const COLORS = ['#3b82ff', '#8b5cf6', '#22d3ee', '#7aa8ff', '#ffffff']

/** Fire a short celebratory burst. Ignored when the user prefers reduced motion. */
export function fireConfetti() {
  window.dispatchEvent(new Event(EVENT))
}

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  size: number
  rot: number
  vr: number
  color: string
}

export function ConfettiHost() {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = canvas.current
    if (!el) return
    const ctx = el.getContext('2d')
    if (!ctx) return
    let raf = 0
    let particles: Particle[] = []
    let last = 0

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      el.width = window.innerWidth * dpr
      el.height = window.innerHeight * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const step = (t: number) => {
      const dt = Math.min((t - last) / 16.7, 2)
      last = t
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
      particles = particles.filter((p) => p.y < window.innerHeight + 40)
      for (const p of particles) {
        p.vy += 0.16 * dt
        p.vx *= 0.995
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.rot += p.vr * dt
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.rot)
        ctx.fillStyle = p.color
        ctx.globalAlpha = Math.max(0, Math.min(1, (window.innerHeight - p.y) / 260 + 0.35))
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2)
        ctx.restore()
      }
      if (particles.length) raf = requestAnimationFrame(step)
      else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight)
    }

    const burst = () => {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      resize()
      const cx = window.innerWidth / 2
      const cy = window.innerHeight * 0.38
      particles = Array.from({ length: 110 }, () => {
        const angle = Math.random() * Math.PI * 2
        const speed = 4 + Math.random() * 8
        return {
          x: cx,
          y: cy,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 5,
          size: 6 + Math.random() * 6,
          rot: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.35,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
        }
      })
      cancelAnimationFrame(raf)
      last = performance.now()
      raf = requestAnimationFrame(step)
    }

    window.addEventListener(EVENT, burst)
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener(EVENT, burst)
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(raf)
    }
  }, [])

  return <canvas ref={canvas} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60] h-full w-full" />
}
