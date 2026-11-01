import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

/**
 * Dev-only same-origin RPC relay. The browser calls /rpc/<chainId>; this server forwards to the public Arc RPC.
 * It avoids the browser's own rate limit and cross-origin issues. Production builds talk to the public RPC
 * directly (see src/config.ts).
 */
const rpcRelay = (publicUrl: string) => ({ target: publicUrl, changeOrigin: true, rewrite: () => '/' })

export default defineConfig({
  plugins: [react(), nodePolyfills()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      '@tanstack/react-query',
      'wagmi',
      'wagmi/chains',
      'wagmi/connectors',
      'viem',
      'viem/chains',
      'connectkit',
      'framer-motion',
      'lucide-react',
      'sonner',
      'clsx',
      'tailwind-merge',
      'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shims/process',
    ],
  },
  build: {
    rollupOptions: {
      output: {
        // Stable vendor files: browsers cache them across releases and the entry file stays small.
        manualChunks(id: string) {
          if (!id.includes('/node_modules/')) return undefined
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react'
          if (/\/node_modules\/(framer-motion|motion-dom|motion-utils)\//.test(id)) return 'motion'
          if (/\/node_modules\/(viem|wagmi|@wagmi|abitype|ox)\//.test(id)) return 'web3'
          return undefined
        },
      },
    },
  },
  server: {
    allowedHosts: true,
    cors: true,
    proxy: {
      '^/rpc/5042$': rpcRelay('https://rpc.mainnet.arc.io'),
      '^/rpc/5042002$': rpcRelay('https://rpc.testnet.arc.io'),
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
