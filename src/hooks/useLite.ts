import { useSyncExternalStore } from 'react'

/** Small screens, touch devices and people who prefer reduced motion get the lighter, mostly static interface. */
const QUERY = '(max-width: 767px), (pointer: coarse), (prefers-reduced-motion: reduce)'

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}

export function useLite(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}
