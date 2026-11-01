/** The names shown in the Featured Domains tab, in this order. Status, owner and price are always read live from the chain. */
export const FEATURED_NAMES: { label: string; tld: 'arc' | 'circle' }[] = [
  'swap', 'social', 'builder', 'bridge', 'dao', 'nft', 'trade', 'gaming', 'identity', 'studio',
].map((label) => ({ label, tld: 'arc' as const }))
