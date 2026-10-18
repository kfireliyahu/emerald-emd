/**
 * **What a Claude Code hook runs** (M47 U1, moved here by M42 U6). `npm run
 * build:plugin` bundles this to `dist-plugin/hooks.mjs`, beside `server.mjs`:
 *
 *     node dist-plugin/hooks.mjs start-here <document.emd | folder>
 *     node dist-plugin/hooks.mjs rows <document.emd | folder> <format> [--match <column>=<value>]...
 *     node dist-plugin/hooks.mjs status <document.emd | folder>
 *
 * These were subcommands of `server.mjs` until a hook turned out to be
 * Claude's alone: MCP has no hooks, so another client never runs one, and the
 * server stays what every client gets. Stdout here is a session's context, and
 * a problem exits 1, never 2 (`commands.ts`). `status` is the status line's slow
 * half (M51 U6), started by `status-line.mjs`.
 */

import { readFileSync } from 'node:fs'

import { isHookCommand, parseHookArgs, runHook, sessionOf } from './commands.ts'

/**
 * All of stdin, as a hook's input arrives: the host writes it and closes the
 * pipe. Read from the descriptor rather than the stream, which a runner that
 * loads this module (vite-node, in the tests) may already hold.
 */
function readStdin(): string {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    // An input that could not be read is a session not known, and every row is printed.
    return ''
  }
}

const argv = process.argv.slice(2)

if (!isHookCommand(argv[0])) {
  process.stderr.write('Usage: node dist-plugin/hooks.mjs start-here | rows | status <document.emd | folder> …\n')
  process.exitCode = 1
} else {
  const args = parseHookArgs(argv[0], argv.slice(1), process.cwd())
  if (!args.ok) {
    process.stderr.write(`${args.error}\n`)
    process.exitCode = 1
  } else {
    // `--once-per-session` (M51 U6): the session's id is in the hook's input on stdin.
    const session = args.value.once === true && process.stdin.isTTY !== true ? sessionOf(readStdin()) : undefined
    process.exitCode = await runHook(session === undefined ? args.value : { ...args.value, session }, {
      line: (text) => process.stdout.write(`${text}\n`),
      complain: (text) => process.stderr.write(`${text}\n`),
    })
  }
}
