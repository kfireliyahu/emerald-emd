/**
 * **`init`: a repository set up to keep its planning in a document, by one
 * command** (M50 U1).
 *
 *     npx emerald-mcp init [path/to/document.emd]
 *
 * run in the repository's folder. A study of seventeen sessions on three
 * documents (2026-10-13) found `formats` called up to eight times a session and
 * the columns learned again every session, because those projects' CLAUDE.md
 * said nothing about the document. This writes what this repository's own
 * CLAUDE.md has, for any repository:
 *
 * 1. **The document.** Named, or the one `.claude/emerald.json` already names, or
 *    the one `.emd` in the folder, or `docs/memory.emd`. One that does not exist
 *    is created keeping the development pack — **stored as text** when it is
 *    inside the repository, so it is committed and diffs, and as SQLite bytes
 *    when it is kept outside every repository. One that exists is only read.
 *    `.claude/emerald.json` names it, which is how a hook finds it.
 * 2. **A marked section of CLAUDE.md**, between `<!-- emerald-init: … -->` and
 *    `<!-- /emerald-init -->`: the questions `start_here` answers, from the
 *    document's own views (the table `startTableOf` writes for this repository),
 *    and one line per format — the same lines `start_here` ends with
 *    (`compactDeclarations`, M47 U2, D-460). A run writes that section again in
 *    place and touches nothing outside it; a file without one gets it at the end.
 * 3. **The two hooks**, SessionStart → `start-here` and UserPromptSubmit → the
 *    inbox's new rows, into `.claude/settings.json` — **only where the Claude
 *    plugin is not enabled**, which brings the same two. Merged into what is
 *    there; a hook already printing start_here that this did not write is left
 *    alone and said.
 * 4. **What it wrote, and what a session here now sees first**: start_here.
 *
 * **Idempotent**: a second run writes nothing, so CLAUDE.md and the settings stay
 * byte-identical; after a format changes, only the section is written again.
 * Every file is compared before it is written, and nothing is written that
 * would come out the same.
 *
 * Here stdout is lines for a person, as under `watch`: this is a subcommand of
 * the server's own bin, never the server.
 */

import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from 'node:path'

import { err, ok, type Result } from '@/core/result.ts'
import { startTableOf } from '@/data/packs/development/pack.ts'
import { packById, packsKeptBy } from '@/data/packs/packs.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { viewSettings } from '@/data/repositories/formatViewRepository.ts'
import type { DocumentEncoding } from '@/data/storage/encoding.ts'
import type { ColumnDeclaration, FormatDeclaration } from '@/domain/format/declaration.ts'
import { startQuestions } from '@/domain/format/view.ts'

import { DOCUMENT_EXTENSION, isNamedCopyOf } from '../../electron/bridge.ts'
import { openDocument, PLUGIN_VERSION, refusalText } from './document.ts'
import { paragraphs } from './format.ts'
import { compactDeclarations } from './tools/formats.ts'
import { startHereTool } from './tools/startHere.ts'
import { NO_CLIENT } from './tools/tool.ts'
import { createDocumentFile } from './write.ts'

export interface InitArgs {
  /** The repository's folder: where the command runs. */
  readonly folder: string
  /** The document, as given, resolved against the folder; undefined to find or make one. */
  readonly document?: string
}

export interface InitPlace {
  /** Where the person's Claude settings are: `CLAUDE_CONFIG_DIR`, or `~/.claude`. */
  readonly configDir: string
}

export interface InitOutput {
  readonly line: (text: string) => void
  readonly complain: (text: string) => void
}

const INIT_USAGE =
  'Usage: npx emerald-mcp init [path/to/document.emd]\n' +
  'Run in a repository: names its Emerald document (creating it with the development pack), writes a ' +
  'marked section of CLAUDE.md, and, where the Claude plugin is not enabled, its two hooks.'

/** The document a repository gets when it names none and holds none. */
export const DEFAULT_DOCUMENT = 'docs/memory.emd'

/** Where a project names its document — what a hook reads (`hosts/claude/hooks/project.ts`). */
export const PROJECT_FILE = join('.claude', 'emerald.json')

/** The section's first line starts with this, and its last line is `SECTION_END`. */
export const SECTION_BEGIN = '<!-- emerald-init:'
export const SECTION_END = '<!-- /emerald-init -->'

/** The hooks the plugin carries, pinned to this package (`hosts/claude/hooks/hooks.json`). */
const HOOKS = {
  SessionStart: {
    matcher: 'startup|clear|compact',
    subcommand: 'start-here',
    command: `npx -y --prefer-offline -p emerald-mcp@${PLUGIN_VERSION} emerald-hooks start-here "$CLAUDE_PROJECT_DIR"`,
    timeout: 60,
  },
  UserPromptSubmit: {
    matcher: undefined,
    subcommand: 'rows',
    command: `npx -y --prefer-offline -p emerald-mcp@${PLUGIN_VERSION} emerald-hooks rows "$CLAUDE_PROJECT_DIR" inbox --match state=new --once-per-session`,
    timeout: 15,
  },
} as const

type HookEvent = keyof typeof HOOKS

/** A hook this command wrote, at any version. */
function isOurs(command: string, subcommand: string): boolean {
  return new RegExp(`^npx -y --prefer-offline -p emerald-mcp@\\S+ emerald-hooks ${subcommand} "\\$CLAUDE_PROJECT_DIR"`).test(command)
}

/** A hook that prints the same thing and that this command did not write — a build's own, say. */
function isOtherEmerald(command: string, subcommand: string): boolean {
  return /emerald-hooks|hooks\.mjs/.test(command) && new RegExp(`\\s${subcommand}\\s`).test(`${command} `)
}

/** Reads `init`'s arguments — everything after the word `init`. */
export function parseInitArgs(argv: readonly string[], cwd: string): Result<InitArgs, string> {
  let document: string | undefined
  for (const word of argv) {
    if (word === '--help' || word === '-h') return err(INIT_USAGE)
    if (word.startsWith('--')) return err(`init does not know ${word}.\n${INIT_USAGE}`)
    if (document !== undefined) return err(`init takes one document; ${word} is a second.\n${INIT_USAGE}`)
    if (!word.toLowerCase().endsWith(DOCUMENT_EXTENSION)) return err(`${word} is not a ${DOCUMENT_EXTENSION} file.\n${INIT_USAGE}`)
    document = resolvePath(cwd, word)
  }
  return ok({ folder: resolvePath(cwd), ...(document === undefined ? {} : { document }) })
}

/** Where the person's Claude settings live, as Claude Code itself reads it. */
export function claudeConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude')
}

async function readText(path: string): Promise<string | undefined> {
  return readFile(path, 'utf8').catch(() => undefined)
}

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isFile() === true
}

/** `path` inside `folder`, with forward slashes; undefined when it is outside. */
function inside(folder: string, path: string): string | undefined {
  const at = relative(folder, path)
  return at === '' || at.startsWith('..') || isAbsolute(at) ? undefined : at.split(sep).join('/')
}

/** Writes `text` at `path` only when it differs; says which. */
async function writeIfChanged(path: string, text: string): Promise<'written' | 'unchanged'> {
  if ((await readText(path)) === text) return 'unchanged'
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text)
  return 'written'
}

/** The document `init` means, by the order in the header. */
async function chooseDocument(args: InitArgs): Promise<Result<string, string>> {
  if (args.document !== undefined) return ok(args.document)
  const named = join(args.folder, PROJECT_FILE)
  const text = await readText(named)
  if (text !== undefined) {
    let document: unknown
    try {
      document = (JSON.parse(text) as { document?: unknown } | null)?.document
    } catch {
      return err(`${named} is not JSON; name the document instead: npx emerald-mcp init <document.emd>.`)
    }
    if (typeof document === 'string' && document.trim() !== '') return ok(resolvePath(args.folder, document))
  }
  const names = await readdir(args.folder).catch(() => [] as string[])
  const documents = names.filter((name) => name.toLowerCase().endsWith(DOCUMENT_EXTENSION))
  const originals = documents.filter((name) => !documents.some((other) => other !== name && isNamedCopyOf(other, name)))
  if (originals.length === 1) return ok(join(args.folder, originals[0] as string))
  return ok(resolvePath(args.folder, DEFAULT_DOCUMENT))
}

/** What the section says, from the open document. */
function sectionOf(shown: string, declared: readonly FormatDeclaration[], questions: ReturnType<typeof startQuestions>): string {
  const names = declared.map((each) => `\`${each.name}\``).join(', ')
  return paragraphs(
    `${SECTION_BEGIN} written by \`npx emerald-mcp init\`; a run writes it again, so edit outside the two markers -->`,
    `## The project's memory: \`${shown}\``,
    `This project's planning is rows in \`${shown}\`, an Emerald document${names === '' ? '' : ` — ${names}`}: ` +
      'ask it for rows rather than reading notes. **`start_here` is the first call**, and the SessionStart ' +
      'hook makes it before you do. Every tool takes the document’s absolute path, and every write is a ' +
      'dry run until `commit: true`.',
    questions.length === 0 ? 'The document declares no start-here questions yet.' : startTableOf(questions),
    compactDeclarations(declared),
    SECTION_END,
  )
}

/** `claude` with the section in place: replaced between its markers, or added at the end. */
export function withSection(claude: string | undefined, section: string): Result<string, string> {
  const eol = claude?.includes('\r\n') === true ? '\r\n' : '\n'
  const block = section.split('\n').join(eol)
  if (claude === undefined || claude.trim() === '') return ok(`${block}${eol}`)
  const lines = claude.split(eol)
  const begin = lines.findIndex((line) => line.startsWith(SECTION_BEGIN))
  const end = lines.findIndex((line, at) => at > begin && line.trim() === SECTION_END)
  if (begin === -1) {
    if (lines.some((line) => line.trim() === SECTION_END)) return err(`CLAUDE.md has ${SECTION_END} and no section opening it; nothing was written there.`)
    return ok(`${claude.replace(/(\r?\n)*$/, '')}${eol}${eol}${block}${eol}`)
  }
  if (end === -1) return err(`CLAUDE.md opens an Emerald section and never closes it with ${SECTION_END}; nothing was written there.`)
  return ok([...lines.slice(0, begin), ...block.split(eol), ...lines.slice(end + 1)].join(eol))
}

interface HookGroup {
  matcher?: string
  hooks?: { type?: string; command?: string; timeout?: number }[]
}

/** Whether the Claude plugin is enabled for the person or this repository. */
async function pluginEnabled(folder: string, place: InitPlace): Promise<string | undefined> {
  for (const path of [
    join(place.configDir, 'settings.json'),
    join(folder, '.claude', 'settings.json'),
    join(folder, '.claude', 'settings.local.json'),
  ]) {
    const text = await readText(path)
    if (text === undefined) continue
    try {
      const enabled = (JSON.parse(text) as { enabledPlugins?: Record<string, unknown> } | null)?.enabledPlugins ?? {}
      const found = Object.entries(enabled).find(([name, on]) => name.startsWith('emerald@') && on === true)
      if (found !== undefined) return `${found[0]} is enabled in ${path}`
    } catch {
      // A settings file that is not JSON enables nothing we can see; the merge below says so if it is ours.
    }
  }
  return undefined
}

/** The settings with the two hooks merged in, and what happened to each. */
export function withHooks(settings: Record<string, unknown>): Result<{ settings: Record<string, unknown>; said: readonly string[] }, string> {
  const hooks = (settings['hooks'] ?? {}) as Record<string, unknown>
  if (typeof hooks !== 'object' || hooks === null || Array.isArray(hooks)) return err('its `hooks` is not an object')
  const next: Record<string, unknown> = { ...hooks }
  const said: string[] = []
  for (const event of Object.keys(HOOKS) as HookEvent[]) {
    const want = HOOKS[event]
    const groups = (next[event] ?? []) as HookGroup[]
    if (!Array.isArray(groups)) return err(`its \`hooks.${event}\` is not a list`)
    const copy: HookGroup[] = groups.map((group) => ({ ...group, ...(Array.isArray(group.hooks) ? { hooks: group.hooks.map((hook) => ({ ...hook })) } : {}) }))
    const all = copy.flatMap((group) => group.hooks ?? [])
    const ours = all.find((hook) => typeof hook.command === 'string' && isOurs(hook.command, want.subcommand))
    const other = all.find((hook) => typeof hook.command === 'string' && !isOurs(hook.command, want.subcommand) && isOtherEmerald(hook.command, want.subcommand))
    if (ours !== undefined) {
      if (ours.command === want.command && ours.timeout === want.timeout) {
        said.push(`${event}: already there`)
      } else {
        ours.command = want.command
        ours.timeout = want.timeout
        said.push(`${event}: pinned to emerald-mcp@${PLUGIN_VERSION}`)
      }
    } else if (other !== undefined) {
      said.push(`${event}: left as it is — a hook this did not write already runs \`${other.command ?? ''}\``)
    } else {
      copy.push({ ...(want.matcher === undefined ? {} : { matcher: want.matcher }), hooks: [{ type: 'command', command: want.command, timeout: want.timeout }] })
      said.push(`${event}: added`)
    }
    next[event] = copy
  }
  return ok({ settings: { ...settings, hooks: next }, said })
}

/** Runs `init`; returns the exit code: 0 done, 1 a step refused (the rest still done). */
export async function runInit(args: InitArgs, place: InitPlace, output: InitOutput): Promise<number> {
  const { folder } = args
  if (!(await stat(folder).catch(() => undefined))?.isDirectory()) {
    output.complain(`${folder} is not a folder.`)
    return 1
  }
  const chosen = await chooseDocument(args)
  if (!chosen.ok) {
    output.complain(chosen.error)
    return 1
  }
  const path = chosen.value
  const within = inside(folder, path)
  const shown = within ?? path.split(sep).join('/')
  const said: string[] = []
  let refused = false

  // 1. The document: created when it is not there, only read when it is.
  if (await isFile(path)) {
    const opened = await openDocument(path)
    if (!opened.ok) {
      output.complain(refusalText(path, opened.error))
      return 1
    }
    const { encoding, db } = opened.value
    const keepsDevelopment = packsKeptBy(db).has('development')
    db.close()
    said.push(
      `${shown} — there already; read, never written. ${storedText(encoding, within !== undefined)}` +
        (keepsDevelopment ? '' : ' It does not keep the development pack: `keep_packs` with `packs:["development"]` brings it.'),
    )
  } else {
    const development = packById('development')
    if (development === undefined) {
      output.complain('This build has no development pack.')
      return 1
    }
    const encoding: DocumentEncoding = within === undefined ? 'sqlite' : 'text'
    await mkdir(dirname(path), { recursive: true })
    const created = await createDocumentFile(path, [development], encoding)
    if (!created.ok) {
      output.complain(created.error.message)
      return 1
    }
    said.push(`${shown} — created, keeping the development pack. ${storedText(encoding, within !== undefined)}`)
  }

  // Where the hooks find it: relative inside the repository, so every clone means its own copy.
  const project = join(folder, PROJECT_FILE)
  const current = await readText(project)
  let named: string | undefined
  try {
    const document = current === undefined ? undefined : (JSON.parse(current) as { document?: unknown } | null)?.document
    named = typeof document === 'string' ? document : undefined
  } catch {
    named = undefined
  }
  if (named !== undefined && resolvePath(folder, named) === path) {
    said.push(`${PROJECT_FILE.split(sep).join('/')} — unchanged; it names ${named}.`)
  } else {
    await writeIfChanged(project, `${JSON.stringify({ document: shown }, null, 2)}\n`)
    said.push(`${PROJECT_FILE.split(sep).join('/')} — written: it names ${shown}, which is how a hook finds the document.`)
  }

  // 2. The section, from the document as it is now.
  const opened = await openDocument(path)
  if (!opened.ok) {
    output.complain(refusalText(path, opened.error))
    return 1
  }
  let section: string
  try {
    const declared = listFormats(opened.value.db)
    const questions = startQuestions<ColumnDeclaration, FormatDeclaration>(
      declared,
      (format) => viewSettings(opened.value.db, format, 'ready'),
      (format) => viewSettings(opened.value.db, format, 'start'),
    )
    section = sectionOf(shown, declared, questions)
  } finally {
    opened.value.db.close()
  }
  const claudePath = join(folder, 'CLAUDE.md')
  const claude = await readText(claudePath)
  const placed = withSection(claude, section)
  if (!placed.ok) {
    said.push(`CLAUDE.md — ${placed.error}`)
    refused = true
  } else {
    const wrote = await writeIfChanged(claudePath, placed.value)
    said.push(
      wrote === 'unchanged'
        ? 'CLAUDE.md — unchanged; its Emerald section already says this.'
        : claude === undefined
          ? 'CLAUDE.md — written, holding the Emerald section.'
          : `CLAUDE.md — its Emerald section written, between ${SECTION_BEGIN} … --> and ${SECTION_END}; nothing outside them touched.`,
    )
  }

  // 3. The hooks, where the plugin is not there to bring them.
  const settingsPath = join(folder, '.claude', 'settings.json')
  const plugin = await pluginEnabled(folder, place)
  if (plugin !== undefined) {
    said.push(`.claude/settings.json — no hooks written: the Claude plugin brings the same two (${plugin}).`)
  } else {
    const text = await readText(settingsPath)
    let settings: unknown = {}
    let readable = true
    try {
      settings = text === undefined || text.trim() === '' ? {} : JSON.parse(text)
    } catch {
      readable = false
    }
    const merged =
      !readable || typeof settings !== 'object' || settings === null || Array.isArray(settings)
        ? err('it is not a JSON object')
        : withHooks(settings as Record<string, unknown>)
    if (!merged.ok) {
      said.push(`.claude/settings.json — no hooks written: ${merged.error}.`)
      refused = true
    } else if (text !== undefined && JSON.stringify(merged.value.settings) === JSON.stringify(settings)) {
      said.push(`.claude/settings.json — unchanged (${merged.value.said.join('; ')}).`)
    } else {
      const eol = text?.includes('\r\n') === true ? '\r\n' : '\n'
      await writeIfChanged(settingsPath, `${JSON.stringify(merged.value.settings, null, 2).split('\n').join(eol)}${eol}`)
      said.push(`.claude/settings.json — ${merged.value.said.join('; ')}.`)
    }
  }

  // 4. What it wrote, and what a session here now sees first.
  output.line(`emerald-mcp init in ${folder.split(sep).join('/')}:`)
  for (const each of said) output.line(`- ${each}`)
  output.line('')
  output.line(`A session here now sees first — start_here on ${shown}:`)
  output.line('')
  output.line(await startHereTool.run({ path }, NO_CLIENT))
  return refused ? 1 : 0
}

function storedText(encoding: DocumentEncoding, within: boolean): string {
  if (encoding === 'text') {
    return within
      ? 'Stored as text: commit it, and it diffs and merges in git like any file.'
      : 'Stored as text, outside this repository.'
  }
  return within
    ? 'Stored as SQLite bytes inside the repository: `store_document_as` with `as:"text"` makes it diff in git.'
    : 'Stored as SQLite bytes, outside this repository: every session reaches the one file by its path.'
}
