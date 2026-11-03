/**
 * **Which document a project means, asked through `$.fs`** (M56 U1): the rule
 * of `hooks/project.ts`, ported for the hooks module, which has no Node — no
 * `node:path`, no `git` to run. That file stays, for the command hooks, and
 * `project.test.ts` holds the two to the same answers.
 *
 * In order: `.claude/emerald.json` in the folder (`{ "document": "…" }`,
 * relative to the folder or absolute; a named document that is not there is a
 * problem, never a reason to go looking); else the one `.emd` in the folder,
 * not counting the named copies Emerald kept beside one (`<stem>.before-<moment>….emd`);
 * else nothing. **A linked worktree means the main checkout's copy**: where the
 * folder's `.git` is a file pointing into another repository's `.git/worktrees/`,
 * the document is taken at the same place in that repository's main working
 * tree, when it is there — read from `.git` and `commondir` rather than asked
 * of `git rev-parse`, which a module cannot run.
 *
 * Nothing here imports `claude-code` or the DOM: it takes the three calls of
 * `$.fs` it needs, so a Vitest test can hand it Node's.
 */

/** The calls of `$.fs` the rule reads with: each rejects on a missing path. */
export interface ProjectFiles {
  read(path: string): Promise<string>
  list(path: string): Promise<readonly { readonly name: string }[]>
  stat(path: string): Promise<{ readonly kind: 'file' | 'dir' | 'other' }>
}

export type ProjectDocument =
  | { readonly kind: 'document'; readonly path: string; readonly worktreeCopy?: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'problem'; readonly message: string }

/** Where a project names its document, relative to its folder. */
export const PROJECT_FILE = '.claude/emerald.json'

const DOCUMENT_EXTENSION = '.emd'

// --- Paths, with forward slashes, on Windows and POSIX alike -----------------

/** `C:` or `` — the part a POSIX path has none of. */
function driveOf(path: string): string {
  return /^[A-Za-z]:/.exec(path)?.[0] ?? ''
}

export function isAbsolute(path: string): boolean {
  return /^([A-Za-z]:)?[\\/]/.test(path)
}

/** `path` with forward slashes, `.` and `..` folded, no trailing slash. */
export function normalize(path: string): string {
  const drive = driveOf(path)
  const rest = path.slice(drive.length).replace(/\\/g, '/')
  const rooted = rest.startsWith('/')
  const parts: string[] = []
  for (const part of rest.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..' && parts.length > 0 && parts[parts.length - 1] !== '..') parts.pop()
    else if (part !== '..' || !rooted) parts.push(part)
  }
  return `${drive}${rooted ? '/' : ''}${parts.join('/')}` || '.'
}

export function resolve(base: string, path: string): string {
  return normalize(isAbsolute(path) ? path : `${base}/${path}`)
}

export function join(...parts: string[]): string {
  return normalize(parts.join('/'))
}

export function dirname(path: string): string {
  const normal = normalize(path)
  const at = normal.lastIndexOf('/')
  if (at < 0) return '.'
  const head = normal.slice(0, at)
  return head === '' || head === driveOf(normal) ? `${head}/` : head
}

export function basename(path: string): string {
  const normal = normalize(path)
  return normal.slice(normal.lastIndexOf('/') + 1)
}

/** Whether two normalized paths are one, a Windows drive's case aside. */
function samePath(a: string, b: string): boolean {
  return driveOf(a) !== '' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** `path` below `top`, or undefined when it is not inside it. */
function inside(top: string, path: string): string | undefined {
  const [from, to] = [normalize(top), normalize(path)]
  const head = from.endsWith('/') ? from : `${from}/`
  if (samePath(to, from)) return undefined
  return samePath(to.slice(0, head.length), head) ? to.slice(head.length) : undefined
}

// --- The rule ----------------------------------------------------------------

async function isFile(files: ProjectFiles, path: string): Promise<boolean> {
  return (await files.stat(path).catch(() => undefined))?.kind === 'file'
}

/** The `before-` copies Emerald keeps beside a document, as `electron/bridge.ts` names them. */
export function isNamedCopyOf(documentName: string, candidate: string): boolean {
  const stem = documentName.toLowerCase().endsWith(DOCUMENT_EXTENSION)
    ? documentName.slice(0, -DOCUMENT_EXTENSION.length)
    : documentName
  const head = `${stem}.before-`
  return (
    candidate.startsWith(head) &&
    candidate.endsWith(DOCUMENT_EXTENSION) &&
    /^\d{8}T\d{6}(-[a-z0-9-]+)?$/.test(candidate.slice(head.length, -DOCUMENT_EXTENSION.length))
  )
}

/**
 * Where the main working tree has `path`, when `folder` is in a linked worktree
 * and `path` inside it; otherwise undefined. The worktree's top is the nearest
 * folder holding `.git`; there `.git` is a file (`gitdir: …/.git/worktrees/<name>`),
 * and that git dir's `commondir` names the repository's own `.git`, whose parent
 * is the main working tree. A main checkout's `.git` is a folder, a submodule's
 * git dir has no `commondir`, and a bare repository's common dir is not called
 * `.git`: none of them is moved.
 */
export async function mainCheckoutPath(files: ProjectFiles, folder: string, path: string): Promise<string | undefined> {
  let top = normalize(folder)
  let marker = await files.stat(join(top, '.git')).catch(() => undefined)
  while (marker === undefined) {
    const up = dirname(top)
    if (samePath(up, top)) return undefined
    top = up
    marker = await files.stat(join(top, '.git')).catch(() => undefined)
  }
  if (marker.kind !== 'file') return undefined
  const pointer = /^gitdir:\s*(.+?)\s*$/m.exec(await files.read(join(top, '.git')).catch(() => ''))?.[1]
  if (pointer === undefined) return undefined
  const gitDir = resolve(top, pointer)
  const common = (await files.read(join(gitDir, 'commondir')).catch(() => undefined))?.trim()
  if (common === undefined || common === '') return undefined
  const commonDir = resolve(gitDir, common)
  if (samePath(commonDir, gitDir) || basename(commonDir) !== '.git') return undefined
  const below = inside(top, path)
  return below === undefined ? undefined : join(dirname(commonDir), below)
}

async function canonical(files: ProjectFiles, folder: string, found: string): Promise<ProjectDocument> {
  const main = await mainCheckoutPath(files, folder, found)
  return main !== undefined && (await isFile(files, main))
    ? { kind: 'document', path: main, worktreeCopy: found }
    : { kind: 'document', path: found }
}

/** The document the project at `folder` means, by the order above. */
export async function projectDocument(files: ProjectFiles, folder: string): Promise<ProjectDocument> {
  const named = join(folder, PROJECT_FILE)
  const text = await files.read(named).catch(() => undefined)
  if (text !== undefined) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return { kind: 'problem', message: `${named} is not JSON; it should be { "document": "<path to the .emd>" }.` }
    }
    const document = (parsed as { document?: unknown } | null)?.document
    if (typeof document !== 'string' || document.trim() === '') {
      return { kind: 'problem', message: `${named} names no document; it should be { "document": "<path to the .emd>" }.` }
    }
    const path = resolve(folder, document)
    return (await isFile(files, path))
      ? canonical(files, folder, path)
      : { kind: 'problem', message: `${named} names ${path}, and there is no document there.` }
  }

  const names = (await files.list(folder).catch(() => [])).map((entry) => entry.name)
  const documents = names.filter((name) => name.toLowerCase().endsWith(DOCUMENT_EXTENSION))
  const originals = documents.filter((name) => !documents.some((other) => other !== name && isNamedCopyOf(other, name)))
  if (originals.length !== 1) return { kind: 'none' }
  const path = join(folder, originals[0] as string)
  return (await isFile(files, path)) ? canonical(files, folder, path) : { kind: 'none' }
}
