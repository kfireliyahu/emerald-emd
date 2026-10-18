/**
 * The status line's entry point (M51 U6). `npm run build:plugin` bundles this,
 * alone, to `dist-plugin/status-line.mjs` — a pass of its own beside `hooks.mjs`,
 * because a bundle holding the tools takes a third of a second to load and a
 * status line has a fifth (`statusLine.ts`):
 *
 *     node dist-plugin/status-line.mjs [<document.emd | folder>]
 *
 * With no argument the folder is the one the host's status-line input names —
 * `workspace.project_dir`, as Claude Code sends it on stdin — or else the
 * current one. Prints one line, or nothing; always exits 0, because a status
 * line that fails is noise in front of a person.
 *
 * When what it knows is stale it starts `hooks.mjs status <document>` beside
 * it, detached, to read the document and write what it found; the next prompt
 * shows it.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { statusLine } from './statusLine.ts'

/** The host's input, when it sent one: stdin read for at most a tenth of a second. */
async function hostFolder(): Promise<string | undefined> {
  if (process.stdin.isTTY) return undefined
  const text = await new Promise<string>((settle) => {
    let read = ''
    const done = (): void => settle(read)
    const timer = setTimeout(done, 100)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (chunk: string) => (read += chunk))
    process.stdin.on('end', () => {
      clearTimeout(timer)
      done()
    })
    process.stdin.on('error', done)
  })
  try {
    const input = JSON.parse(text) as { workspace?: { project_dir?: unknown; current_dir?: unknown }; cwd?: unknown }
    const folder = input.workspace?.project_dir ?? input.workspace?.current_dir ?? input.cwd
    return typeof folder === 'string' && folder !== '' ? folder : undefined
  } catch {
    return undefined
  }
}

const hooks = fileURLToPath(new URL('./hooks.mjs', import.meta.url))
const target = resolve(process.argv[2] ?? (await hostFolder()) ?? process.cwd())

const text = await statusLine(target, {
  refresh: (document) => {
    if (!existsSync(hooks)) return
    spawn(process.execPath, [hooks, 'status', document], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  },
})
if (text !== '') process.stdout.write(`${text}\n`)
process.exit(0)
