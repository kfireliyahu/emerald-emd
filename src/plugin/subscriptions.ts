/**
 * **A document is a resource you can subscribe to** (M44 U2, D-440).
 *
 * The server declares `resources.subscribe`. A client sends `resources/subscribe`
 * with the document's `file://` URI — or its absolute path, as every tool takes
 * it — and is sent `notifications/resources/updated` with that same string each
 * time the file changes on disk, whoever wrote it: the app, this server's own
 * writes, another session's server. `resources/unsubscribe` stops it, and so
 * does the client going.
 *
 * **This is the only state the server holds** (D-440 amends "nothing is
 * remembered between calls"): which document each subscription names, for as
 * long as the connection lasts. Tools stay stateless, and a subscription holds
 * nothing of the document — the watch is `watch.ts`'s, a mark and a path.
 *
 * **One format of a document is a resource too** (M44 U3, D-441): the
 * document's URI with the format's name as its fragment —
 * `file:///F:/notes/memory.emd#inbox`, or `F:/notes/memory.emd#inbox` as a path.
 * A fragment because a format is a part of the document and not another
 * document: the part before `#` is still exactly U2's URI, so nothing U2
 * accepted reads differently. Such a subscription is told only when that
 * format's rows differ from the last reading (`formatWatch.ts`), so a
 * subscriber to the inbox hears a new inbox row and not a driver's unit row. It
 * holds that format's last reading, as printed, for as long as it lasts.
 */

import { stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js'

import { readFormat, watchFormat } from './formatWatch.ts'
import { watchDocument, type StopWatching } from './watch.ts'

/** A document's resource URI: `file:///F:/notes/memory.emd` on Windows. */
export function documentUri(path: string): string {
  return pathToFileURL(path).href
}

/** One format of a document, as a resource: `file:///F:/notes/memory.emd#inbox`. */
export function formatUri(path: string, format: string): string {
  return `${documentUri(path)}#${encodeURIComponent(format)}`
}

/** What a subscription names: a document, and one of its formats or none. */
interface SubscriptionTarget {
  readonly path: string
  readonly format?: string
}

/** A format's name, as a fragment may carry one. */
const FORMAT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * The document a URI names, and the format its fragment names — or `undefined`
 * when it names no document. A bare path is split at its last `#` only when
 * what follows is a format's name; a file whose own name ends that way is
 * subscribed to by its `file://` URI, where `pathToFileURL` writes its `#` as
 * `%23`.
 */
export function subscriptionTargetOf(uri: string): SubscriptionTarget | undefined {
  if (uri.startsWith('file:')) {
    try {
      const url = new URL(uri)
      const fragment = decodeURIComponent(url.hash.replace(/^#/, ''))
      url.hash = ''
      const path = fileURLToPath(url)
      return fragment === '' ? { path } : { path, format: fragment }
    } catch {
      return undefined
    }
  }
  if (!isAbsolute(uri)) return undefined
  const at = uri.lastIndexOf('#')
  const named = at > 0 ? uri.slice(at + 1) : ''
  return FORMAT_NAME.test(named) ? { path: uri.slice(0, at), format: named } : { path: uri }
}

/** The path a subscription names, or `undefined` when it names none. */
export function documentPathOf(uri: string): string | undefined {
  return subscriptionTargetOf(uri)?.path
}

/**
 * Wires subscriptions onto a server: the two handlers, and dropping every
 * watch when the client goes. One per connection — a stdio server has one
 * client — while the watch itself is shared across the process.
 */
export function addSubscriptions(server: Server): void {
  /** The URI as the client spelled it, to the watch it holds. */
  const held = new Map<string, StopWatching>()

  server.setRequestHandler(SubscribeRequestSchema, async (request) => {
    const uri = request.params.uri
    if (held.has(uri)) return {}
    const target = subscriptionTargetOf(uri)
    if (target === undefined) {
      throw new Error(
        `Cannot subscribe to ${uri}. A document is subscribed to by its file:// URI ` +
          `(file:///C:/notes/memory.emd, file:///home/me/memory.emd) or by its absolute path, ` +
          `and one of its formats by either with the format's name after a #: file:///C:/notes/memory.emd#inbox.`,
      )
    }
    const { path, format } = target
    const info = await stat(path).catch(() => undefined)
    if (info === undefined || !info.isFile()) throw new Error(`No document at ${path} to subscribe to.`)

    // The client may be gone between the change and the word; that is not an
    // error anybody can act on.
    const tell = (): void => void server.sendResourceUpdated({ uri }).catch(() => undefined)
    let stopWatching: StopWatching
    if (format === undefined) {
      stopWatching = await watchDocument(path, tell)
    } else {
      // Refused now rather than silent forever: a format the document does not
      // declare, or cannot read, would never change.
      const first = await readFormat(path, format)
      if (first.kind === 'gone') throw new Error(`No document at ${path} to subscribe to.`)
      if (first.kind === 'problem') throw new Error(first.message)
      stopWatching = await watchFormat({
        path,
        format,
        first,
        onChange: tell,
        // The document going away is a change to every format in it.
        onReading: (reading) => {
          if (reading.kind === 'gone') tell()
        },
      })
    }
    // Subscribed twice while the first was still starting: keep one.
    if (held.has(uri)) stopWatching()
    else held.set(uri, stopWatching)
    return {}
  })

  server.setRequestHandler(UnsubscribeRequestSchema, (request) => {
    held.get(request.params.uri)?.()
    held.delete(request.params.uri)
    return {}
  })

  const previous = server.onclose
  server.onclose = () => {
    for (const stopWatching of held.values()) stopWatching()
    held.clear()
    previous?.()
  }
}
