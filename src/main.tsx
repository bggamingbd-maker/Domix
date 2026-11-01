/*
 *  ███████╗████████╗██╗   ██╗██████╗ ██╗ ██████╗
 *  ██╔════╝╚══██╔══╝██║   ██║██╔══██╗██║██╔═══██╗
 *  ███████╗   ██║   ██║   ██║██║  ██║██║██║   ██║
 *  ╚════██║   ██║   ██║   ██║██║  ██║██║██║   ██║
 *  ███████║   ██║   ╚██████╔╝██████╔╝██║╚██████╔╝
 *  ╚══════╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝ ╚═════╝
 *
 *  Built with Arc Studio
 *  https://studio.arc.io
 */

import './tracing'
import './console-capture'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConnectKitProvider } from 'connectkit'
import { Toaster } from 'sonner'
import { config } from './config'
import App from './App'
import { installShareSync } from './lib/share'
import { NetworkProvider } from './lib/network'
import { ConfettiHost } from './components/fx/Confetti'
import { ApiError } from './lib/api'
import { persistQueries } from './lib/persistQueries'
import './index.css'

// Reads are cached briefly and not refetched on every tab focus: faster screens and no flicker from background refreshes.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 20_000, gcTime: 10 * 60_000, retry: (count: number, error: Error) => !(error instanceof ApiError) && count < 2, retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000), refetchOnWindowFocus: false } },
})

persistQueries(queryClient)
installShareSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider theme="midnight" customTheme={{ '--ck-font-family': "'Inter', sans-serif", '--ck-primary-button-background': '#3b82ff' }}>
          <NetworkProvider>
            <App />
            <ConfettiHost />
            <Toaster position="top-center" theme="dark" />
          </NetworkProvider>
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)

