import { lazy, Suspense, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Layout } from '@/components/Layout'
import { Card } from '@/components/ui'
import { useLite } from '@/hooks/useLite'
import { useLocation } from '@/lib/router'
import { useIsAdmin } from '@/hooks/useOwner'
import { HomePage } from '@/pages/Home'

// Pages other than the dashboard load on demand, so the first screen downloads less code.
const loadActivity = () => import('@/pages/ActivityPage')
const loadAdmin = () => import('@/pages/Admin')
const loadDomain = () => import('@/pages/DomainPage')
const loadExplore = () => import('@/pages/Explore')
const loadMarketplace = () => import('@/pages/Marketplace')
const loadMyDomains = () => import('@/pages/MyDomains')
const ActivityPage = lazy(() => loadActivity().then((m) => ({ default: m.ActivityPage })))
const AdminPage = lazy(() => loadAdmin().then((m) => ({ default: m.AdminPage })))
const DomainPage = lazy(() => loadDomain().then((m) => ({ default: m.DomainPage })))
const ExplorePage = lazy(() => loadExplore().then((m) => ({ default: m.ExplorePage })))
const MarketplacePage = lazy(() => loadMarketplace().then((m) => ({ default: m.MarketplacePage })))
const MyDomainsPage = lazy(() => loadMyDomains().then((m) => ({ default: m.MyDomainsPage })))

function PageFallback() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading page">
      <div className="h-10 w-48 animate-pulse rounded-xl bg-[var(--surface)]" />
      <div className="h-40 animate-pulse rounded-2xl bg-[var(--surface)]" />
    </div>
  )
}

function Routes({ path }: { path: string }) {
  if (path === '/') return <HomePage />
  if (path === '/explore') return <ExplorePage />
  if (path === '/marketplace') return <MarketplacePage />
  if (path === '/my-domains') return <MyDomainsPage />
  if (path === '/activity') return <ActivityPage />
  if (path === '/admin') return <AdminPage />
  const domain = /^\/domain\/([^/]+)$/.exec(path)
  if (domain) return <DomainPage name={decodeURIComponent(domain[1])} />
  return <Card>Page not found.</Card>
}

export default function App() {
  const { path } = useLocation()
  const isAdmin = useIsAdmin()
  const reduce = useLite()

  // Keep <html class="lite"> in step with the device (index.html sets it before first paint).
  useEffect(() => {
    document.documentElement.classList.toggle('lite', reduce)
  }, [reduce])

  // Once the first screen is idle, fetch the other pages in the background so navigation feels instant.
  useEffect(() => {
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
    const run = () => {
      void loadMarketplace()
      void loadMyDomains()
      void loadDomain()
      void loadActivity()
      if (isAdmin) void loadAdmin()
    }
    if (idle) idle(run)
    else setTimeout(run, 1500)
  }, [isAdmin])
  return (
    <Layout isAdmin={isAdmin}>
      <motion.div
        key={path}
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduce ? 0 : 0.16, ease: 'easeOut' }}
      >
        <Suspense fallback={<PageFallback />}>
          <Routes path={path} />
        </Suspense>
      </motion.div>
    </Layout>
  )
}
