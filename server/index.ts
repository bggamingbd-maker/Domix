/**
 * DOMIX backend: one process runs the event indexer and the read API so the
 * database has a single writer. Start with `bun run server`.
 */
import { startApi } from './api'
import { indexedChains, probeRpc } from './config'
import { migrate } from './db'
import { runIndexer } from './indexer'

await migrate()
await probeRpc(indexedChains())
startApi()
runIndexer().catch((error) => {
  console.error('[indexer] fatal', error)
  process.exit(1)
})
