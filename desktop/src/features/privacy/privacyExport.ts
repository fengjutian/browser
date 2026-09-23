/**
 * Privacy data export / import. Bundles the user's local-only state
 * (history, closed tabs, bookmarks metadata, downloads summary) into a single
 * encrypted JSON blob they can save to disk and restore on another machine.
 *
 * Crypto uses the Web Crypto AES-GCM with a password-derived key (PBKDF2,
 * 100k iterations, SHA-256). The salt + IV are stored in the header so a
 * password mismatch produces a clean decryption error rather than silent
 * corruption.
 *
 * The format is:
 *   {
 *     format: 'arcadia-privacy-export',
 *     version: 1,
 *     exportedAt: '2025-01-01T00:00:00.000Z',
 *     cipher: 'AES-GCM',
 *     kdf: 'PBKDF2-SHA256',
 *     iterations: 100000,
 *     salt: '<base64>',
 *     iv: '<base64>',
 *     ciphertext: '<base64>',
 *   }
 *
 * We only persist metadata here; the actual history / bookmark records live
 * in the SQLite database. The import path re-emits the records via the
 * existing `bookmark_add` / `history` setters so the rest of the UI keeps
 * its single source of truth.
 */

export interface PrivacyExportSections {
  history: Array<{ url: string; title: string; visitedAt: number }>
  closedTabs: Array<{ id: string; url: string; title: string; favicon?: string; closedAt: number }>
  bookmarks: Array<{ id: string; url: string; title: string; favicon?: string | null; folder?: string | null; note?: string | null }>
  downloads: Array<{ id: string; url: string; fileName: string; status: string; dangerType?: string; startedAt: string }>
  searchEngine?: { presetId: string; customTemplate?: string }
  /** Each entry is one origin with allow/deny/ask per permission kind. */
  sitePermissions?: Array<{
    origin: string
    camera?: 'allow' | 'deny' | 'ask'
    microphone?: 'allow' | 'deny' | 'ask'
    location?: 'allow' | 'deny' | 'ask'
    notifications?: 'allow' | 'deny' | 'ask'
    clipboard?: 'allow' | 'deny' | 'ask'
  }>
}

export interface PrivacyExportEnvelope {
  format: 'arcadia-privacy-export'
  version: 1
  exportedAt: string
  cipher: 'AES-GCM'
  kdf: 'PBKDF2-SHA256'
  iterations: number
  salt: string
  iv: string
  ciphertext: string
}

const PBKDF2_ITERATIONS = 100_000
const KEY_USAGE: KeyUsage[] = ['encrypt', 'decrypt']
const ALGO = 'AES-GCM'
const HASH = 'SHA-256'

const subtle = typeof globalThis !== 'undefined' && globalThis.crypto?.subtle

function toBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

export async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  if (!subtle) throw new Error('Web Crypto is not available in this environment')
  const encoder = new TextEncoder()
  const baseKey = await subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: HASH },
    baseKey,
    { name: ALGO, length: 256 },
    false,
    KEY_USAGE,
  )
}

export async function encryptPrivacyPayload(sections: PrivacyExportSections, password: string): Promise<PrivacyExportEnvelope> {
  if (!subtle) throw new Error('Web Crypto is not available in this environment')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS)
  const encoder = new TextEncoder()
  const plain = encoder.encode(JSON.stringify(sections))
  const cipherBuffer = await subtle.encrypt({ name: ALGO, iv }, key, plain)
  return {
    format: 'arcadia-privacy-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    cipher: ALGO,
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(cipherBuffer),
  }
}

export async function decryptPrivacyPayload(envelope: PrivacyExportEnvelope, password: string): Promise<PrivacyExportSections> {
  if (!subtle) throw new Error('Web Crypto is not available in this environment')
  if (envelope.format !== 'arcadia-privacy-export') throw new Error('Not an Arcadia privacy export')
  if (envelope.version !== 1) throw new Error(`Unsupported export version: ${envelope.version}`)
  const salt = fromBase64(envelope.salt)
  const iv = fromBase64(envelope.iv)
  const ciphertext = fromBase64(envelope.ciphertext)
  const key = await deriveKey(password, salt, envelope.iterations)
  const plainBuffer = await subtle.decrypt({ name: ALGO, iv }, key, ciphertext)
  const decoder = new TextDecoder()
  const parsed = JSON.parse(decoder.decode(plainBuffer)) as PrivacyExportSections
  return normaliseSections(parsed)
}

export function normaliseSections(input: PrivacyExportSections): PrivacyExportSections {
  const history = (input.history ?? []).filter(entry => typeof entry.url === 'string' && typeof entry.title === 'string' && Number.isFinite(entry.visitedAt))
  const closedTabs = (input.closedTabs ?? []).filter(entry => typeof entry.url === 'string' && typeof entry.title === 'string')
  const bookmarks = (input.bookmarks ?? []).filter(entry => typeof entry.url === 'string' && typeof entry.title === 'string')
  const downloads = (input.downloads ?? []).filter(entry => typeof entry.url === 'string' && typeof entry.fileName === 'string')
  return {
    history,
    closedTabs,
    bookmarks,
    downloads,
    searchEngine: input.searchEngine,
    sitePermissions: input.sitePermissions,
  }
}

export interface MergeOptions {
  /** When true, existing entries with the same URL are skipped (default true). */
  skipExisting?: boolean
  /** Cap on the number of entries to insert per section (default 5000). */
  maxPerSection?: number
}

const DEFAULT_MAX = 5000

export function mergeHistory(existing: Array<{ url: string; title: string; visitedAt: number }>, incoming: Array<{ url: string; title: string; visitedAt: number }>, options: MergeOptions = {}): Array<{ url: string; title: string; visitedAt: number }> {
  const skipExisting = options.skipExisting ?? true
  const max = options.maxPerSection ?? DEFAULT_MAX
  if (!incoming.length) return existing
  const seen = new Set(existing.map(entry => entry.url))
  const merged = existing.slice()
  for (const entry of incoming) {
    if (skipExisting && seen.has(entry.url)) continue
    seen.add(entry.url)
    merged.push(entry)
  }
  merged.sort((a, b) => b.visitedAt - a.visitedAt)
  return merged.slice(0, Math.max(max, merged.length))
}

export function mergeBookmarks(existing: Array<{ id: string; url: string; title: string }>, incoming: Array<{ id: string; url: string; title: string; favicon?: string | null; folder?: string | null; note?: string | null }>, options: MergeOptions = {}): Array<{ id: string; url: string; title: string; favicon?: string | null; folder?: string | null; note?: string | null }> {
  const skipExisting = options.skipExisting ?? true
  const max = options.maxPerSection ?? DEFAULT_MAX
  if (!incoming.length) return existing
  const seen = new Set(existing.map(entry => entry.url))
  const merged = existing.slice()
  for (const entry of incoming) {
    if (skipExisting && seen.has(entry.url)) continue
    seen.add(entry.url)
    merged.push({ ...entry, id: entry.id || crypto.randomUUID() })
  }
  return merged.slice(0, Math.max(max, merged.length))
}

export interface PrivacyExportStats {
  history: number
  closedTabs: number
  bookmarks: number
  downloads: number
  bytes: number
}

export function exportStats(sections: PrivacyExportSections): PrivacyExportStats {
  return {
    history: sections.history.length,
    closedTabs: sections.closedTabs.length,
    bookmarks: sections.bookmarks.length,
    downloads: sections.downloads.length,
    bytes: new TextEncoder().encode(JSON.stringify(sections)).length,
  }
}

/** Convenience for tests / environments where Web Crypto is missing. */
export const __testInternals = { toBase64, fromBase64 }