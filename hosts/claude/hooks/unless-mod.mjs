/**
 * **The npx hooks' gate** (M56 U2, D-547): runs the command after it — the
 * plugin's `npx … emerald-hooks …` — unless the plugin's hooks module already
 * answered this event.
 *
 *     node "${CLAUDE_PLUGIN_ROOT}/hooks/unless-mod.mjs" npx -y --prefer-offline -p emerald-mcp@<pin> emerald-hooks …
 *
 * Where Claude Code runs the module (`mod/inbox.ts`), it answers SessionStart
 * and UserPromptSubmit itself and passes the event on with
 * `"emerald_mod_answered": true` in the hook's input; this reads stdin, sees
 * the mark and exits 0 at once, so no npx process starts. It cannot simply
 * answer without passing on: that would keep every other hook on the event
 * from running too, the person's own included. Where no module runs (cloud
 * Cowork, an older Claude Code) the input carries no mark, and the command
 * runs as written, with the same input on its stdin and its exit code passed
 * back — never 2, which would refuse the person's prompt.
 *
 * Plain Node with nothing imported but Node's, like `no-server.mjs`: it runs
 * from the plugin folder before anything is installed.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const MARK = 'emerald_mod_answered'

let input = ''
try {
  input = readFileSync(0, 'utf8')
} catch {
  // An input that could not be read carries no mark: the command runs.
}

let answered = false
try {
  answered = JSON.parse(input)?.[MARK] === true
} catch {
  answered = false
}

const [command, ...args] = process.argv.slice(2)
if (answered || command === undefined) process.exit(0)

/** npm's own npx beside this node, run by it: no shell, so nothing to quote. */
function npxBesideNode() {
  const home = dirname(process.execPath)
  return [join(home, 'node_modules', 'npm', 'bin', 'npx-cli.js'), join(home, '..', 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js')].find(
    (path) => existsSync(path),
  )
}

/** One argument for cmd.exe, where npx is a .cmd only a shell can start. */
const quoted = (word) => (/^[\w@./:=+-]+$/.test(word) ? word : `"${word.replace(/"/g, '""')}"`)

const cli = command === 'npx' ? npxBesideNode() : undefined
const child =
  cli !== undefined
    ? spawn(process.execPath, [cli, ...args], { stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true })
    : process.platform === 'win32'
      ? spawn([command, ...args].map(quoted).join(' '), { shell: true, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true })
      : spawn(command, args, { stdio: ['pipe', 'inherit', 'inherit'] })

child.stdin.on('error', () => undefined)
child.stdin.end(input)
child.on('error', (error) => {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
})
child.on('close', (code) => process.exit(code === 0 ? 0 : 1))
