import { useCallback, useEffect, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react'

const NAV_EVENT = 'domix:navigate'

export function navigate(to: string, replace = false) {
  if (replace) window.history.replaceState({}, '', to)
  else window.history.pushState({}, '', to)
  window.dispatchEvent(new Event(NAV_EVENT))
  window.scrollTo({ top: 0 })
}

export function useLocation() {
  const [loc, setLoc] = useState(() => ({ path: window.location.pathname, search: window.location.search }))
  useEffect(() => {
    const update = () => setLoc({ path: window.location.pathname, search: window.location.search })
    window.addEventListener('popstate', update)
    window.addEventListener(NAV_EVENT, update)
    return () => {
      window.removeEventListener('popstate', update)
      window.removeEventListener(NAV_EVENT, update)
    }
  }, [])
  return loc
}

export function useSearchParam(key: string): [string, (value: string) => void] {
  const { search } = useLocation()
  const value = new URLSearchParams(search).get(key) ?? ''
  const set = useCallback(
    (next: string) => {
      const params = new URLSearchParams(window.location.search)
      if (next) params.set(key, next)
      else params.delete(key)
      const qs = params.toString()
      navigate(`${window.location.pathname}${qs ? `?${qs}` : ''}`, true)
    },
    [key],
  )
  return [value, set]
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  to: string
  children: ReactNode
}

export function Link({ to, children, onClick, ...rest }: LinkProps) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e)
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
    e.preventDefault()
    navigate(to)
  }
  return (
    <a href={to} onClick={handle} {...rest}>
      {children}
    </a>
  )
}
