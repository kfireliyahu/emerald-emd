/**
 * UUIDs, generated in the domain rather than by the database.
 *
 * docs/02-architecture.md: primary keys are made before the row is written, so
 * an object graph can be built and related in memory and then persisted in one
 * transaction.
 */

/**
 * `crypto.randomUUID` needs a secure context. The shell's `app://` origin is
 * one and so is `localhost`, but the fallback costs four lines and this code
 * also runs in `dist-plugin/` under whatever Node the user has.
 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  // Version 4, variant 1.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * A uuid **derived from what a row is**, rather than drawn at random — M22 U6,
 * D-247.
 *
 * ## Why a text document needs one
 *
 * A text `.emd` does not carry row ids (D-245): the id is a generated surrogate
 * with no meaning outside the file, and every pointer in the text is by name.
 * So a document read from text mints its ids as it goes — and with `newId` that
 * meant **a different id every time the same file was opened.**
 *
 * That is fine inside one session and wrong the moment an id leaves it. The
 * plugin holds no document open between calls, on purpose: `format_rows`
 * answers with an id, the file closes, and `record_format_rows` opens it again
 * — so writing a link over an id a previous call handed back, which is the two
 * pass write every self-referential batch needs (D-240), refused **every time**
 * with *"decision has no row with that id"*. A sentence that reads as the
 * caller's mistake and was not.
 *
 * ## What it is derived from, and what that buys
 *
 * A row's own content, which is the only thing about it the text holds. Two
 * consequences worth stating rather than discovering:
 *
 * - **Editing a row changes its id**, because the row is what the id is made
 *   of. Correct here: a conversation holding an id across a change *should* be
 *   told the row it was pointing at is not the row it read.
 * - **Adding a row leaves every other id alone**, which an ordinal-based
 *   derivation would not have managed.
 *
 * Version nibble 8, which RFC 9562 reserves for exactly this — a uuid whose
 * bits are derived rather than random. Claiming version 4 would be a small lie
 * in the one field that exists to say where the bits came from.
 *
 * **A collision is loud.** The id is a `PRIMARY KEY`, so two rows deriving the
 * same one fail the insert and roll the whole read back — a refusal, never a
 * row quietly landing on another. The caller is what keeps identical rows apart
 * (it seeds them with their occurrence), so a collision here means two rows
 * that are the same row.
 */
export function derivedId(seed: string): string {
  // FNV-1a, four times over the same seed with four different prefixes. Boring
  // and obvious beats clever for 128 bits that only have to be spread out: this
  // is not a security boundary and nothing here is a hash somebody verifies.
  const hex = [0, 1, 2, 3].map((salt) => fnv1a(`${String(salt)}\u0000${seed}`)).join('')

  const version = `8${hex.slice(13, 16)}`
  // Variant 1, the same two bits every uuid in this codebase sets.
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${version}-${variant}-${hex.slice(20, 32)}`
}

/** One 32-bit FNV-1a, as eight hex digits. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5
  for (let at = 0; at < text.length; at += 1) {
    hash ^= text.charCodeAt(at) & 0xff
    hash = Math.imul(hash, 0x01000193)
    // A char above U+00FF contributes both its bytes, so Hebrew and a `·` are
    // not all the same input.
    const high = text.charCodeAt(at) >>> 8
    if (high !== 0) {
      hash ^= high
      hash = Math.imul(hash, 0x01000193)
    }
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
