/**
 * A localStorage snapshot of the document, so a crashed or closed tab does not
 * take unsaved work with it (D-021).
 *
 * localStorage rather than IndexedDB, because IndexedDB is blocked on
 * `file://` and that is the mode this matters most in. The cost is a base64
 * round-trip and a size ceiling, which is why the snapshot is skipped rather
 * than allowed to fail loudly when the document outgrows it.
 */

const KEY = 'emerald:crash-snapshot'

/** Comfortably under the usual 5 MB localStorage quota once base64 inflates it by a third. */
const MAX_SNAPSHOT_BYTES = 3_000_000

export interface Snapshot {
  readonly savedAt: number
  readonly documentName: string
  readonly bytes: Uint8Array
}

export function writeSnapshot(bytes: Uint8Array, documentName: string, now: number): boolean {
  if (bytes.byteLength > MAX_SNAPSHOT_BYTES) return false

  try {
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    localStorage.setItem(
      KEY,
      JSON.stringify({ savedAt: now, documentName, base64: btoa(binary) }),
    )
    return true
  } catch {
    // A full or disabled localStorage must never break saving the real file.
    return false
  }
}

export function readSnapshot(): Snapshot | undefined {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === null) return undefined

    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return undefined

    const record = parsed as Record<string, unknown>
    const base64 = record['base64']
    const savedAt = record['savedAt']
    if (typeof base64 !== 'string' || typeof savedAt !== 'number') return undefined

    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

    return { savedAt, documentName: String(record['documentName'] ?? 'document'), bytes }
  } catch {
    return undefined
  }
}

export function clearSnapshot(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing to do; a stale snapshot is offered, not forced.
  }
}
