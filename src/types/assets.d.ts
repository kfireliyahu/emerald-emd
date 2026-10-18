/**
 * pdf.js's worker, imported for its side effect rather than its shape.
 *
 * `pdfText.ts` hands it to pdf.js as `globalThis.pdfjsWorker`, which is the
 * documented way to run on the main thread — the alternative is a `Worker`,
 * and the shell's CSP has no `worker-src` in it. The package ships no types
 * for this entry point because nobody is meant to call into it.
 */
declare module 'pdfjs-dist/legacy/build/pdf.worker.min.mjs' {
  const worker: unknown
  export = worker
}

/** Provided by the `fc:wasm-as-bytes` plugin in vite.config.ts. */
declare module '*?bytes' {
  const bytes: Uint8Array
  export default bytes
}

/** The MCP App's page, compiled in by the `fc:frame-embedded` plugin in vite.config.ts (M41 U1). */
declare module 'virtual:emerald-frame' {
  const page: string
  export default page
}
