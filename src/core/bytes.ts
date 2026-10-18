/**
 * A byte array as the DOM's buffer types take it.
 *
 * TypeScript 5.7 made `Uint8Array` generic over its buffer, and `BufferSource`
 * and `BlobPart` take only `Uint8Array<ArrayBuffer>` — not the `ArrayBufferLike`
 * (which admits a `SharedArrayBuffer`) every byte array here is typed as. None
 * is shared: sql.js, the file APIs, `TextEncoder` and SheetJS all hand back
 * ordinary buffers. So the narrowing is a claim about where bytes come from,
 * made once and said here rather than as a bare double cast at every call.
 */
export function plainBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes as Uint8Array<ArrayBuffer>
}
