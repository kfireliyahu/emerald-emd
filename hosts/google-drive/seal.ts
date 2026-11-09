/**
 * **What the endpoint hands out instead of storing it** (M57 U4, D-562).
 *
 * The endpoint keeps no token and no sign-in in progress. Everything it would
 * otherwise have to remember — a chat app's registration, a sign-in on its way
 * through Google, the code a chat app trades for a token, and the token itself,
 * which carries the person's Google token — is sealed with AES-256-GCM under a
 * key from the environment and handed to whoever needs it back. What comes back
 * is opened with the same key; anything else does not open.
 *
 * Each seal names **what it is** (`purpose`, bound as the cipher's additional
 * data), so a registration cannot be passed off as a token or a code as a
 * registration, and **when it stops opening** (`expires`, inside the sealed
 * text, so it cannot be changed from outside).
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/** What a sealed value is, and so what it may be opened as. */
export type Purpose = 'client' | 'state' | 'code' | 'access' | 'refresh'

const IV_BYTES = 12
const TAG_BYTES = 16

/** The key, read from the environment as 32 bytes in base64; undefined when it is not that. */
export function sealKey(base64: string | undefined): Buffer | undefined {
  if (base64 === undefined || base64.trim() === '') return undefined
  const key = Buffer.from(base64.trim(), 'base64')
  return key.length === 32 ? key : undefined
}

/**
 * `value` sealed as `purpose`, opening until `expires` (seconds since the
 * epoch; omitted, it does not lapse). URL-safe, so it goes in a query.
 */
export function seal(key: Buffer, purpose: Purpose, value: unknown, expires?: number): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(purpose))
  const plain = Buffer.from(JSON.stringify({ v: value, ...(expires === undefined ? {} : { e: expires }) }))
  const sealed = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([iv, sealed, cipher.getAuthTag()]).toString('base64url')
}

/**
 * What `text` was sealed with, if it was sealed with this key as this
 * `purpose` and has not lapsed at `now` (seconds); otherwise undefined —
 * tampered with, sealed as something else, lapsed or not ours alike.
 */
export function unseal<T>(key: Buffer, purpose: Purpose, text: string, now: number): T | undefined {
  let bytes: Buffer
  try {
    bytes = Buffer.from(text, 'base64url')
  } catch {
    return undefined
  }
  if (bytes.length < IV_BYTES + TAG_BYTES + 1) return undefined
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, IV_BYTES))
    decipher.setAAD(Buffer.from(purpose))
    decipher.setAuthTag(bytes.subarray(bytes.length - TAG_BYTES))
    const plain = Buffer.concat([decipher.update(bytes.subarray(IV_BYTES, bytes.length - TAG_BYTES)), decipher.final()])
    const opened = JSON.parse(plain.toString('utf8')) as { v: T; e?: number }
    if (opened.e !== undefined && opened.e <= now) return undefined
    return opened.v
  } catch {
    return undefined
  }
}
