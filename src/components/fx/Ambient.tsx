import { useEffect, useRef } from 'react'
import clsx from 'clsx'
import { useLite } from '@/hooks/useLite'

/** Slow floating gradient light behind the whole app. Transform-only animation, no blur filters. */
export function FloatingOrbs() {
  const lite = useLite()
  if (lite) return null
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="orb orb-a" />
      <div className="orb orb-b" />
      <div className="orb orb-c" />
    </div>
  )
}

/** Soft light that follows a mouse pointer on desktop. Not rendered for touch or reduced motion. */
export function CursorGlow() {
  const lite = useLite()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const fine = window.matchMedia('(pointer: fine)').matches
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!fine || reduce) return
    let frame = 0
    let tx = 0
    let ty = 0
    const paint = () => {
      frame = 0
      node.style.transform = `translate3d(${tx}px, ${ty}px, 0)`
    }
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      tx = e.clientX
      ty = e.clientY
      node.style.opacity = '1'
      if (!frame) frame = requestAnimationFrame(paint)
    }
    const leave = () => {
      node.style.opacity = '0'
    }
    window.addEventListener('pointermove', move, { passive: true })
    document.addEventListener('pointerleave', leave)
    return () => {
      window.removeEventListener('pointermove', move)
      document.removeEventListener('pointerleave', leave)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [lite])
  if (lite) return null
  return <div ref={ref} aria-hidden="true" className="cursor-glow hidden md:block" />
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={clsx('skeleton rounded-2xl', className)} />
}

export function SkeletonCards({ count = 3 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="h-44" />
      ))}
    </div>
  )
}

export function LiveDot({ className }: { className?: string }) {
  return <span aria-hidden="true" className={clsx('live-dot inline-block', className)} />
}
