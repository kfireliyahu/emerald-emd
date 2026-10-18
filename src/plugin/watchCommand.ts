/**
 * **`watch`: the line that wakes a session** (M44 U3, D-441).
 *
 * U2 measured that Claude Code neither subscribes nor listens, so a push over
 * MCP reaches no model. What does wake one is a line on the stdout of a command
 * it runs under its Monitor tool. So the server ships a second way in:
 *
 *     node dist-plugin/server.mjs watch docs/memory.emd --format inbox --match state=new
 *
 * which prints **one line per change** a model can act on —
 *
 *     inbox (state=new): 1 new row in F:/projects/financial-companion/docs/memory.emd — "Subject"
 *
 * — and nothing else. It is the same watch a subscription holds
 * (`formatWatch.ts`), taken in this process rather than asked for over a pipe
 * to a second one: there is nothing a protocol round trip would add.
 *
 * - **It reads and never writes**, and makes no network request: a directory
 *   watch and a read-only open, as every read tool here.
 * - **No polling.** `fs.watch` on the directory wakes it; the only timer is the
 *   one that keeps the process alive while it waits, which reads nothing.
 * - **With `--match`, only rows coming to match are told** — a new row, or one
 *   edited while it still matches. A row leaving the match is silent, because
 *   that is what the session's own triage does, and waking a session for its
 *   own write is the gap this exists to close.
 * - **It exits cleanly when the document goes away**: one line saying so, and
 *   code 0. A refusal while it runs (the document a schema ahead, a format
 *   whose table has not caught up) is said once and the watch keeps going.
 */

import { stat } from 'node:fs/promises'
import { resolve as resolvePath, sep } from 'node:path'

import { err, ok, type Result } from '@/core/result.ts'

import { readFormat, watchFormat, type FormatChange, type FormatReading, type RowMatch } from './formatWatch.ts'
import { watchDocument, type StopWatching } from './watch.ts'

interface WatchArgs {
  readonly path: string
  readonly format?: string
  readonly match: RowMatch
}

const WATCH_USAGE =
  'Usage: node dist-plugin/server.mjs watch <document.emd> [--format <name>] [--match <column>=<value>]...\n' +
  'Prints one line per change to the document, or to one format of it, and exits when the document goes away.'

/** How long a document that vanished has to stay gone before the watch believes it. */
const GONE_MS = 1_000

/** Reads `watch`'s arguments — everything after the word `watch`. */
export function parseWatchArgs(argv: readonly string[], cwd: string): Result<WatchArgs, string> {
  let path: string | undefined
  let format: string | undefined
  const match = new Map<string, string>()
  for (let at = 0; at < argv.length; at += 1) {
    const word = argv[at] as string
    const [flag, inline] = word.startsWith('--') && word.includes('=') ? [word.slice(0, word.indexOf('=')), word.slice(word.indexOf('=') + 1)] : [word, undefined]
    const value = (): string | undefined => inline ?? argv[(at += 1)]
    if (flag === '--format') {
      format = value()
      if (format === undefined || format === '') return err(`--format needs a format's name.\n${WATCH_USAGE}`)
    } else if (flag === '--match') {
      const pair = value()
      const equals = pair?.indexOf('=') ?? -1
      if (pair === undefined || equals <= 0) return err(`--match takes column=value, as in --match state=new.\n${WATCH_USAGE}`)
      match.set(pair.slice(0, equals), pair.slice(equals + 1))
    } else if (flag.startsWith('--')) {
      return err(`watch does not know ${flag}.\n${WATCH_USAGE}`)
    } else if (path === undefined) {
      path = resolvePath(cwd, word)
    } else {
      return err(`watch takes one document; ${word} is a second.\n${WATCH_USAGE}`)
    }
  }
  if (path === undefined) return err(`watch needs a document.\n${WATCH_USAGE}`)
  if (match.size > 0 && format === undefined) return err(`--match is on a format's columns, so it needs --format.\n${WATCH_USAGE}`)
  return ok({ path, ...(format === undefined ? {} : { format }), match })
}

/** A path the way the inbox's `from` writes one: forward slashes, on every platform. */
function shownPath(path: string): string {
  return sep === '\\' ? path.split('\\').join('/') : path
}

/** A row's name on one line, short enough to read in a notification. */
function named(label: string): string {
  const flat = label.replace(/\s+/g, ' ').trim()
  return `"${flat.length > 120 ? `${flat.slice(0, 119).trimEnd()}…` : flat}"`
}

/** At most this many rows named in one line; the rest are counted. */
const NAMED_MAX = 5

/** What is watched, as a line opens: `inbox`, or `inbox (state=new)`. */
function headOf(format: string, match: RowMatch): string {
  return match.size === 0 ? format : `${format} (${[...match].map(([key, value]) => `${key}=${value}`).join(', ')})`
}

/** The one line a change is told in. */
export function changeLine(format: string, path: string, change: FormatChange, match: RowMatch): string {
  const head = headOf(format, match)
  const counted = [
    change.added.length === 0 ? '' : `${String(change.added.length)} new ${change.added.length === 1 ? 'row' : 'rows'}`,
    change.changed.length === 0 ? '' : `${String(change.changed.length)} changed`,
    change.removed.length === 0 ? '' : `${String(change.removed.length)} removed`,
  ].filter((part) => part !== '')
  const names = [
    ...change.added.map((row) => named(row.label)),
    ...change.changed.map((each) => `${named(each.after.label)} (changed)`),
    ...change.removed.map((row) => `${named(row.label)} (removed)`),
  ]
  const shown = names.length > NAMED_MAX ? [...names.slice(0, NAMED_MAX), `and ${String(names.length - NAMED_MAX)} more`] : names
  return `${head}: ${counted.join(', ')} in ${shownPath(path)} — ${shown.join('; ')}`
}

interface WatchOutput {
  /** A line a model acts on: stdout. */
  readonly line: (text: string) => void
  /** Why it could not start, and that it has: stderr, which wakes nobody. */
  readonly complain: (text: string) => void
}

/**
 * Runs the watch until the document goes away or `stop` is called; resolves
 * with the exit code. Refuses to start — code 2, said on stderr — when the
 * document or the format is not there to watch.
 */
export async function runWatch(
  args: WatchArgs,
  output: WatchOutput,
  stop?: Promise<void>,
): Promise<number> {
  const there = await stat(args.path).catch(() => undefined)
  if (there === undefined || !there.isFile()) {
    output.complain(`No document at ${args.path} to watch.`)
    return 2
  }

  let first: FormatReading | undefined
  if (args.format !== undefined) {
    const reading = await readFormat(args.path, args.format)
    if (reading.kind !== 'rows') {
      output.complain(reading.kind === 'gone' ? `No document at ${args.path} to watch.` : reading.message)
      return 2
    }
    first = reading
    const unknown = [...args.match.keys()].filter((name) => !reading.columns.includes(name))
    if (unknown.length > 0) {
      output.complain(`--match names ${unknown.join(', ')}, which ${args.format} has not got. It has ${first.columns.join(', ')}.`)
      return 2
    }
  }

  return new Promise<number>((settle) => {
    let watching: StopWatching = () => undefined
    let done = false
    // The process's only reason to stay up: `fs.watch` here does not hold it
    // open (watch.ts), and nothing is read when this fires.
    const alive = setInterval(() => undefined, 1 << 30)
    const finish = (code: number): void => {
      if (done) return
      done = true
      clearInterval(alive)
      watching()
      settle(code)
    }
    void stop?.then(() => finish(0))

    /** Believed only once it has stayed gone: a writer that deletes before it writes is not leaving. */
    const maybeGone = (): void => {
      setTimeout(() => {
        void stat(args.path).then(
          () => undefined,
          () => {
            output.line(`${args.format ?? 'document'}: ${shownPath(args.path)} is gone, so the watch has stopped.`)
            finish(0)
          },
        )
      }, GONE_MS).unref()
    }

    let said: string | undefined
    const begin =
      args.format === undefined
        ? watchDocument(args.path, () => {
            void stat(args.path).then(
              () => output.line(`document: ${shownPath(args.path)} changed.`),
              maybeGone,
            )
          })
        : watchFormat({
            path: args.path,
            format: args.format,
            match: args.match,
            ...(first === undefined ? {} : { first }),
            onChange: (change) => {
              said = undefined
              // Leaving the match is the session's own triage: not told (see above).
              const told = args.match.size === 0 ? change : { ...change, removed: [] }
              if (told.added.length + told.changed.length + told.removed.length === 0) return
              output.line(changeLine(args.format as string, args.path, told, args.match))
            },
            onReading: (reading) => {
              if (reading.kind === 'gone') return maybeGone()
              if (reading.message === said) return
              said = reading.message
              output.line(`${args.format as string}: cannot read ${shownPath(args.path)} — ${reading.message.replace(/\s+/g, ' ')} Still watching.`)
            },
          })
    void begin.then((stopWatching) => {
      if (done) return stopWatching()
      watching = stopWatching
      // Said on stderr, so a person sees it started and a Monitor is not woken by it.
      const what = args.format === undefined ? 'every change' : headOf(args.format, args.match)
      output.complain(`Watching ${what} in ${shownPath(args.path)}.`)
    })
  })
}
