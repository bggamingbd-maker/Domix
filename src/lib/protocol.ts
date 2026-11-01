/**
 * Naming protocol integration: ArcNS (.arc and .circle).
 *
 * DOMIX never owns domains. Ownership, expiry and resolver records stay in the
 * ArcNS registrar (ERC-721, tokenId = keccak256(label)), registry and resolver.
 * Addresses are taken from the ArcNS project's own deployment files
 * (deployments/arc_mainnet-v3.json and deployments/arc_testnet-v3.json in
 * github.com/khenzarr/arcns) and cross-checked against onchain reads
 * (registrar.tld(), registrar.registry()). Verify them again before mainnet use.
 */
import { keccak256, namehash, parseAbi, toBytes, type Address } from 'viem'

export interface Tld {
  tld: 'arc' | 'circle'
  registrar: Address
  controller: Address
}

export interface ProtocolDeployment {
  name: string
  registry: Address
  resolver: Address
  tlds: Tld[]
}

export const ARCNS: Record<number, ProtocolDeployment> = {
  5042002: {
    name: 'ArcNS',
    registry: '0xc20B3F8C7A7B4FcbFfe35c6C63331a1D9D12fD1A',
    resolver: '0x4c3a2D4245346732CE498937fEAD6343e77Eb097',
    tlds: [
      {
        tld: 'arc',
        registrar: '0xD600B8D80e921ec48845fC1769c292601e5e90C4',
        controller: '0xe0A67F2E74Bcb740F0446fF2aCF32081DB877D46',
      },
      {
        tld: 'circle',
        registrar: '0xE1fdE46df4bAC6F433C52a337F4818822735Bf8a',
        controller: '0x4CB0650847459d9BbDd5823cc6D320C900D883dA',
      },
    ],
  },
  5042: {
    name: 'ArcNS',
    registry: '0xcA4d60A6d237EDa59aA1F57EbAe6B3150BcAb8Fb',
    resolver: '0x68Bb5D43E8c7394876de2174d1BA320745D47023',
    tlds: [
      {
        tld: 'arc',
        registrar: '0x1a99540B48A21db03c768760052c3F915F9852aB',
        controller: '0xE62De42eAcb270D2f2465c017C30bbf24F3f9350',
      },
      {
        tld: 'circle',
        registrar: '0xC3568DF382599495ed7f10188a417858E00eb720',
        controller: '0x5A1275Ed5638C9aD5005d6087c696BFb3848e9E1',
      },
    ],
  },
}

export const registrarAbi = parseAbi([
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'function nameExpires(uint256 id) view returns (uint256)',
  'function available(uint256 id) view returns (bool)',
  'function labelOf(uint256 id) view returns (string)',
  'function tld() view returns (string)',
  'function GRACE_PERIOD() view returns (uint256)',
  'function getApproved(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function approve(address to, uint256 tokenId)',
  'function setApprovalForAll(address operator, bool approved)',
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function reclaim(uint256 id, address owner)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
])

export const controllerAbi = parseAbi([
  'function available(string name) view returns (bool)',
  'function rentPrice(string name, uint256 duration) view returns ((uint256 base, uint256 premium))',
  'function makeCommitment(string name, address owner, uint256 duration, bytes32 secret, address resolverAddr, bool reverseRecord, address sender) pure returns (bytes32)',
  'function getCommitmentStatus(bytes32 commitment) view returns (uint256 timestamp, bool exists, bool matured, bool expired)',
  'function commit(bytes32 commitment)',
  'function register(string name, address owner, uint256 duration, bytes32 secret, address resolverAddr, bool reverseRecord, uint256 maxCost)',
  'function renew(string name, uint256 duration, uint256 maxCost)',
  'function MIN_REGISTRATION_DURATION() view returns (uint256)',
  'event NameRegistered(string name, bytes32 indexed label, address indexed owner, uint256 cost, uint256 expires)',
  'event NameRenewed(string name, bytes32 indexed label, uint256 cost, uint256 expires)',
])

export const registryAbi = parseAbi([
  'function owner(bytes32 node) view returns (address)',
  'function resolver(bytes32 node) view returns (address)',
  'function setResolver(bytes32 node, address resolver)',
])

export const resolverAbi = parseAbi([
  'function addr(bytes32 node) view returns (address)',
  'function setAddr(bytes32 node, address a)',
])

export const DAY = 86_400n
export const YEAR = 365n * DAY

export function getProtocol(chainId: number): ProtocolDeployment | undefined {
  return ARCNS[chainId]
}

export function tldInfo(chainId: number, tld: string): Tld | undefined {
  return ARCNS[chainId]?.tlds.find((t) => t.tld === tld)
}

export function tldByRegistrar(chainId: number, registrar: string): Tld | undefined {
  return ARCNS[chainId]?.tlds.find((t) => t.registrar.toLowerCase() === registrar.toLowerCase())
}

export interface ParsedName {
  label: string
  tld: 'arc' | 'circle'
  full: string
}

const LABEL_RE = /^[a-z0-9]([a-z0-9-]{1,61})[a-z0-9]$|^[a-z0-9]{1,3}$/

/** Lowercases, strips whitespace and a trailing TLD. Returns an error string for invalid labels. */
export function parseDomainInput(input: string, defaultTld: 'arc' | 'circle' = 'arc'): ParsedName | string {
  const raw = input.trim().toLowerCase()
  if (!raw) return 'Enter a name'
  let tld: 'arc' | 'circle' = defaultTld
  let label = raw
  if (raw.endsWith('.arc')) {
    label = raw.slice(0, -4)
    tld = 'arc'
  } else if (raw.endsWith('.circle')) {
    label = raw.slice(0, -7)
    tld = 'circle'
  }
  if (label.includes('.')) return 'Subdomains are not supported'
  if (label.length < 1) return 'Name is too short'
  if (label.length > 63) return 'Name is too long'
  if (!LABEL_RE.test(label)) return 'Use letters, numbers and hyphens only'
  return { label, tld, full: `${label}.${tld}` }
}

export function labelToTokenId(label: string): bigint {
  return BigInt(keccak256(toBytes(label)))
}

export function nodeOf(label: string, tld: string): `0x${string}` {
  return namehash(`${label}.${tld}`)
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
