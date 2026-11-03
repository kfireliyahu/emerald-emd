/**
 * **The project pane** (M56 U1): what `start_here` answers for the project's
 * document, beside the chat and kept current.
 *
 * - **It opens by itself** at `session.start` only in a folder that means a
 *   document (`project.ts`, the rule the command hooks follow), and stays
 *   silent everywhere else.
 * - **Closed by the person, it stays closed for that project** — kept in
 *   `$.store` under the document's path, so every worktree of one checkout
 *   shares it — until `/emerald` asks for it again.
 * - **It reads, never writes**: the only calls it makes are the two read tools
 *   named in `READ_TOOLS`.
 * - **It reads unasked only where the person's rules allow it** (D-541). Claude
 *   Code puts a plugin's `$.mcp.call` to the person's permission check like any
 *   tool call, and a module cannot allow its own. So it asks `$.tool.check`
 *   first: where the read is allowed (`npx emerald-mcp init` writes the two
 *   rules into the project's settings) it reads; where it is not, the pane holds
 *   a "Read" button, and the dialog follows the person's own press.
 * - **It redraws after an emerald write** — any tool of an emerald server the
 *   server does not call read-only — once that call has answered.
 * - **`/emerald show <format> [view]`** puts one format, or one of its saved
 *   views, in the same pane; `/emerald` alone puts the project back.
 *
 * Its words are the document's and the person's (D-493): the lines an answer
 * keeps for the model are left out by `answer.ts`, and nothing here speaks of
 * servers, tools or drawing.
 */
import type { EngineInterface, On } from 'claude-code'

import { paneSections, type PaneSection } from './answer.ts'
import { basename, projectDocument, type ProjectDocument, type ProjectFiles } from './project.ts'

/** The pane's id. */
export const PANE = 'emerald'
/** The plugin's own server, by its key in `plugin.json`. */
const SERVER = 'emerald'
/** Everything the pane may ask of the server: two answers, both read-only. */
export const READ_TOOLS = ['start_here', 'show_format'] as const

type Shown = { readonly kind: 'start' } | { readonly kind: 'format'; readonly format: string; readonly view?: string }
type Answer = { readonly sections: readonly PaneSection[] } | { readonly problem: string }

// What one load of the module knows; a reload runs `session.start` again,
// which finds the project again and reads its answer again.
let project: ProjectDocument = { kind: 'none' }
let shown: Shown = { kind: 'start' }
let isOpen = false
/** The last answer read for what `shown` says; undefined until the first read is back. */
let answer: Answer | undefined
/** Counts reads, so an answer that comes back after a newer read was asked is dropped. */
let asked = 0
/** The person's rules would ask before the next read: the pane waits for a press. */
let waiting = false

const closedKey = (document: string) => `closed:${document}`

/** The three file calls the folder rule reads with, each spelled at its call as a module must. */
function filesOf($: EngineInterface): ProjectFiles {
  return {
    read: (path) => $.fs.read(path),
    list: (path) => $.fs.list(path),
    stat: (path) => $.fs.stat(path),
  }
}

function titleOf(document: string): string {
  return shown.kind === 'start' ? basename(document) : `${shown.format} · ${basename(document)}`
}

/** One of the read tools, on the plugin's own server; its text, or what went wrong in plain words. */
async function ask($: EngineInterface, tool: (typeof READ_TOOLS)[number], args: Record<string, unknown>): Promise<Answer> {
  const connected = await $.mcp.connect(SERVER)
  if (!connected.isConnected) return { problem: 'The document cannot be read just now.' }
  const result = await $.mcp.call(connected.server, tool, args)
  const text = result.content
    .flatMap((block) => (block.type === 'text' && typeof block.text === 'string' ? [block.text] : []))
    .join('\n\n')
  if (result.isError) {
    // The server's sentence, without the name of what failed.
    return { problem: text.replace(/^\w+ failed:\s*/, '').split('\n')[0] ?? 'The document could not be read.' }
  }
  return { sections: paneSections(text) }
}

type ReadTool = (typeof READ_TOOLS)[number]

const toolOf = (what: Shown): ReadTool => (what.kind === 'start' ? 'start_here' : 'show_format')

function read($: EngineInterface, document: string): Promise<Answer> {
  const reading =
    shown.kind === 'start'
      ? ask($, 'start_here', { path: document })
      : ask($, 'show_format', { path: document, format: shown.format, ...(shown.view === undefined ? {} : { view: shown.view }) })
  return reading.catch(() => ({ problem: 'The document could not be read just now.' }))
}

/**
 * Whether the person's rules let this read run without asking them. The server
 * is connected first: at a session's start its tools are not there yet, and a
 * check of a tool the session lacks is refused.
 */
async function isAllowed($: EngineInterface, tool: ReadTool): Promise<boolean> {
  const connected = await $.mcp.connect(SERVER)
  if (!connected.isConnected) return false
  const name = `mcp__${connected.server.replace(/[^A-Za-z0-9_-]/g, '_')}__${tool}`
  const verdict = await $.tool.check({ tool: name, input: {} }).catch(() => undefined)
  return verdict?.decision === 'allow'
}

/** Reads, and redraws with what came back unless a newer read was asked meanwhile. */
async function load($: EngineInterface, document: string, mine: number): Promise<void> {
  const got = await read($, document)
  if (mine !== asked) return
  answer = got
  waiting = false
  $.ui.invalidate('ui.render')
}

/**
 * Reads the answer again, where the person's rules allow it, and redraws when
 * it is back; where they would ask, the pane waits for a press. Never from a
 * drawing, which may call nothing (a render hook's `$.mcp.call` is refused),
 * and never awaited by the hook that asks, so neither a session's start nor a
 * tool's answer waits on the server: the read is a timer's dispatch of its own.
 */
function refresh($: EngineInterface): void {
  if (project.kind !== 'document') return
  const document = project.path
  const mine = ++asked
  const tool = toolOf(shown)
  $.clock.after(0, () => {
    void isAllowed($, tool).then((allowed) => {
      if (mine !== asked) return undefined
      if (allowed) return load($, document, mine)
      waiting = true
      $.ui.invalidate('ui.render')
      return undefined
    })
  })
}

/** The person pressed Read: the read runs now, and any dialog it raises is theirs to answer. */
async function readNow($: EngineInterface): Promise<void> {
  if (project.kind !== 'document') return
  await load($, project.path, ++asked)
}

/** Puts the pane up on what `shown` says, and reads it afresh. */
async function open($: EngineInterface, document: string, isNew: boolean): Promise<void> {
  if (isNew) {
    answer = undefined
    waiting = false
  }
  isOpen = true
  refresh($)
  await $.ui.open({ id: PANE, title: titleOf(document) })
  $.ui.invalidate('ui.render')
}

/** Whether a call that answered went to an emerald server and may have changed a document. */
export function isEmeraldWrite(tool: string, result: { readonly isReadOnly?: true | undefined; readonly deny?: string | undefined; readonly isError?: true | undefined }): boolean {
  return /^mcp__.*emerald.*__[a-z_]+$/i.test(tool) && result.isReadOnly !== true && result.deny === undefined && result.isError !== true
}

const USAGE = '`/emerald` shows this project’s document beside the chat; `/emerald show <format> [view]` shows one of its formats.'

export function registerPane(on: On): void {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'emerald',
      description: 'Show this project’s document beside the chat, or one of its formats',
      argumentHint: '[show <format> [view]]',
    })
    project = await projectDocument(filesOf($), e.cwd)
    if (project.kind === 'document' && (await $.store.get(closedKey(project.path))) !== true) {
      shown = { kind: 'start' }
      await open($, project.path, true)
    }
    return next(e)
  })

  on('command.run', { command: 'emerald' }, async ($, e) => {
    if (project.kind === 'none') project = await projectDocument(filesOf($), await $.session.cwd())
    if (project.kind === 'problem') return { text: project.message }
    if (project.kind === 'none') {
      return { text: 'This folder has no Emerald document: name one in .claude/emerald.json, or keep one .emd here.' }
    }
    const words = e.args.trim().split(/\s+/).filter((word) => word !== '')
    if (words.length === 0) {
      const isNew = shown.kind !== 'start'
      shown = { kind: 'start' }
      await $.store.delete(closedKey(project.path))
      await open($, project.path, isNew || !isOpen)
      return { text: `Showing ${basename(project.path)}.` }
    }
    const [verb, format, view] = words
    if (verb !== 'show' || format === undefined || words.length > 3) return { text: USAGE }
    shown = view === undefined ? { kind: 'format', format } : { kind: 'format', format, view }
    await open($, project.path, true)
    return { text: `Showing ${format}${view === undefined ? '' : ` (${view})`} from ${basename(project.path)}.` }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      isOpen = false
      if (e.origin.kind === 'person' && project.kind === 'document') await $.store.set(closedKey(project.path), true)
    }
    return next(e)
  }).catch((_$, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    if (isOpen && isEmeraldWrite(String(e.tool), result)) refresh($)
    return result
  }).catch((_$, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    if (project.kind !== 'document') return <Text dimColor>This folder has no Emerald document.</Text>
    const name = basename(project.path)
    const press = (label: string) => (
      <Button key="read" label={label} onPress={() => readNow($)} />
    )
    const now = answer
    if (now === undefined) return waiting ? press(`Read ${name}`) : <Text dimColor>Reading {name}…</Text>
    if ('problem' in now) return <Text dimColor>{now.problem}</Text>
    if (now.sections.length === 0) return <Text dimColor>Nothing to show yet.</Text>
    return (
      <Box flexDirection="column">
        {waiting && press(`${name} changed: read it again`)}
        {now.sections.map((section, at) => {
          const loose = section.lines.filter((line) => line.under === undefined)
          const groups = [...new Set(section.lines.flatMap((line) => (line.under === undefined ? [] : [line.under])))]
          return (
            <Box flexDirection="column" marginTop={at === 0 ? 0 : 1}>
              {section.heading !== undefined && <Text bold>{section.heading}</Text>}
              {section.notes.map((note) => (
                <Text dimColor>{note}</Text>
              ))}
              {loose.map((line) => (
                <Text>· {line.text}</Text>
              ))}
              {groups.map((under) => (
                <Box flexDirection="column">
                  <Text dimColor>{under}</Text>
                  {section.lines
                    .filter((line) => line.under === under)
                    .map((line) => (
                      <Text>· {line.text}</Text>
                    ))}
                </Box>
              ))}
            </Box>
          )
        })}
      </Box>
    )
  })
}
