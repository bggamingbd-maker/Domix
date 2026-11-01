import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react'
import { animate, motion, useInView, useMotionValue, useSpring, type Variants } from 'framer-motion'
import clsx from 'clsx'
import { useLite } from '@/hooks/useLite'

const container = (stagger: number, delay: number): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: stagger, delayChildren: delay } },
})

const letterVariants: Variants = {
  hidden: { opacity: 0, y: '0.55em' },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 22 } },
}

interface AnimatedTextProps {
  text: string
  as?: ElementType
  className?: string
  /** Gradient text that slowly shifts colour. */
  gradient?: boolean
  delay?: number
  stagger?: number
  /** Reveal when scrolled into view instead of on mount. */
  onView?: boolean
}

/** Letter-by-letter reveal. Words never break mid-word; reduced motion renders plain text. */
export function AnimatedText({ text, as: Tag = 'span', className, gradient, delay = 0, stagger = 0.028, onView = false }: AnimatedTextProps) {
  const reduce = useLite()
  if (reduce) {
    return <Tag className={clsx(className, gradient && 'grad-text')}>{text}</Tag>
  }
  const words = text.split(' ')
  const trigger = onView ? { whileInView: 'show', viewport: { once: true, margin: '-12%' } } : { animate: 'show' }
  return (
    <Tag aria-label={text} className={className}>
      <motion.span aria-hidden="true" variants={container(stagger, delay)} initial="hidden" {...trigger} style={{ display: 'inline' }}>
        {words.map((word, wi) => (
          <span key={wi} className="inline-block whitespace-nowrap">
            {[...word].map((ch, ci) => (
              <motion.span key={ci} variants={letterVariants} className={clsx('inline-block', gradient && 'grad-text')}>
                {ch}
              </motion.span>
            ))}
            {wi < words.length - 1 ? '\u00A0' : ''}
          </span>
        ))}
      </motion.span>
    </Tag>
  )
}

/** Types, holds, deletes and cycles through messages. Reduced motion shows the first message statically. */
export function Typewriter({ messages, className }: { messages: string[]; className?: string }) {
  const reduce = useLite()
  const [s, setS] = useState({ i: 0, n: 0, deleting: false })

  useEffect(() => {
    if (reduce) return
    const msg = messages[s.i]
    let t: ReturnType<typeof setTimeout>
    if (!s.deleting && s.n < msg.length) t = setTimeout(() => setS((v) => ({ ...v, n: v.n + 1 })), 58)
    else if (!s.deleting) t = setTimeout(() => setS((v) => ({ ...v, deleting: true })), s.i === 0 ? 3200 : 1900)
    else if (s.n > 0) t = setTimeout(() => setS((v) => ({ ...v, n: v.n - 1 })), 26)
    else t = setTimeout(() => setS((v) => ({ i: (v.i + 1) % messages.length, n: 0, deleting: false })), 320)
    return () => clearTimeout(t)
  }, [s, reduce, messages])

  return (
    <span className={className}>
      <span className="sr-only">{messages[0]}</span>
      <span aria-hidden="true">
        {reduce ? messages[0] : messages[s.i].slice(0, s.n)}
        {!reduce && <span className="caret" />}
      </span>
    </span>
  )
}

interface CountUpProps {
  to: number
  format?: (n: number) => string
  /** Exact text shown when the animation ends (keeps large or fractional values precise). */
  finalText?: string
  className?: string
}

const defaultFormat = (n: number) => Math.round(n).toLocaleString('en-US')

/** Counts from the previous value to `to` once visible. The final text always matches the real value. */
export function CountUp({ to, format = defaultFormat, finalText, className }: CountUpProps) {
  const reduce = useLite()
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const prev = useRef(0)

  useEffect(() => {
    const node = ref.current
    if (!inView || !node) return
    const done = () => {
      node.textContent = finalText ?? format(to)
    }
    if (reduce) {
      done()
      prev.current = to
      return
    }
    const controls = animate(prev.current, to, {
      duration: 1.5,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        node.textContent = format(v)
      },
      onComplete: done,
    })
    prev.current = to
    return () => controls.stop()
  }, [inView, to, reduce, format, finalText])

  return (
    <span ref={ref} className={className}>
      {finalText ?? format(0)}
    </span>
  )
}

/** Fades and lifts content in when it scrolls into view. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useLite()
  if (reduce) return <div className={className}>{children}</div>
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 26 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.65, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  )
}

/** Section title that reveals letter by letter when scrolled into view. */
export function SectionTitle({ children, className }: { children: string; className?: string }) {
  return <AnimatedText as="h2" text={children} onView className={clsx('display text-2xl font-bold sm:text-3xl', className)} stagger={0.02} />
}

/** Pulls its child slightly toward a mouse pointer. Disabled for touch and reduced motion. */
export function Magnetic({ children, strength = 0.28, className }: { children: ReactNode; strength?: number; className?: string }) {
  const reduce = useLite()
  const ref = useRef<HTMLDivElement>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const sx = useSpring(x, { stiffness: 220, damping: 18, mass: 0.4 })
  const sy = useSpring(y, { stiffness: 220, damping: 18, mass: 0.4 })
  if (reduce) return <div className={clsx('inline-block', className)}>{children}</div>
  return (
    <motion.div
      ref={ref}
      className={clsx('inline-block', className)}
      style={{ x: sx, y: sy }}
      onPointerMove={(e) => {
        if (e.pointerType !== 'mouse' || !ref.current) return
        const r = ref.current.getBoundingClientRect()
        x.set((e.clientX - (r.left + r.width / 2)) * strength)
        y.set((e.clientY - (r.top + r.height / 2)) * strength)
      }}
      onPointerLeave={() => {
        x.set(0)
        y.set(0)
      }}
    >
      {children}
    </motion.div>
  )
}
