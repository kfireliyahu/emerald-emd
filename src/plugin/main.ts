/**
 * The stdio entry point. `npm run build:plugin` bundles this to
 * `dist-plugin/server.mjs`, which is what a Claude Code MCP config runs.
 *
 * Nothing may ever be written to stdout from this process except JSON-RPC —
 * a stray `console.log` anywhere under `src/plugin/` corrupts the stream and
 * the server dies with a parse error that names no cause. Diagnostics go to
 * stderr, which the client shows in its own logs.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { createServer } from './server.ts'
import { claudeConfigDir, parseInitArgs, runInit } from './init.ts'
import { parseWatchArgs, runWatch } from './watchCommand.ts'

/**
 * `--engine-only` offers the engine's tools and not the ledger's (M22 U0).
 *
 * **An argument rather than anything read from a document**: `tools/list`
 * carries no document (D-217), so at the moment this process has to answer
 * there is no `.emd` to ask. It exists for the bill, not for staging (M20 U0's
 * switch is gone, D-266): ~23,900 tokens of definitions become ~4,600, on every
 * turn of every session that has this server loaded.
 *
 * An unknown argument is ignored rather than fatal. Nothing may be written to
 * stdout to complain about it, and a server that refuses to start because a
 * client passed a flag it did not recognise is worse than one that starts.
 */
const argv = process.argv.slice(2)

/**
 * **`watch` is one of two other things this file runs** (M44 U3, D-441), `init` the second (M50 U1): a
 * subcommand rather than a second bin, because the server is one file a person
 * already has and `build:plugin` writes one server — a second entry would be a
 * second thing to build, ship and keep in step. There, and only there, stdout
 * is lines for a model rather than JSON-RPC: `watchCommand.ts`. What a Claude
 * Code hook prints (`start-here`, `rows`, `status`) was here too until M42 U6;
 * it is Claude's alone, so it is `hosts/claude/hooks/main.ts` → `hooks.mjs`.
 */
if (argv[0] === 'init') {
  // **`init`, the other** (M50 U1): a repository set up to keep its planning
  // in a document — `init.ts`. Run once by a person, so stdout is theirs.
  const args = parseInitArgs(argv.slice(1), process.cwd())
  if (!args.ok) {
    process.stderr.write(`${args.error}
`)
    process.exitCode = 2
  } else {
    process.exitCode = await runInit(args.value, { configDir: claudeConfigDir() }, {
      line: (text) => process.stdout.write(`${text}
`),
      complain: (text) => process.stderr.write(`${text}
`),
    })
  }
} else if (argv[0] === 'watch') {
  const args = parseWatchArgs(argv.slice(1), process.cwd())
  if (!args.ok) {
    process.stderr.write(`${args.error}
`)
    process.exitCode = 2
  } else {
    const stopped = new Promise<void>((resolve) => {
      process.once('SIGINT', resolve)
      process.once('SIGTERM', resolve)
    })
    process.exitCode = await runWatch(
      args.value,
      {
        line: (text) => process.stdout.write(`${text}
`),
        complain: (text) => process.stderr.write(`${text}
`),
      },
      stopped,
    )
  }
} else {
  const engineOnly = argv.includes('--engine-only')
  // What each client advertised goes to stderr, which a host shows in its own
  // log — VS Code under Output → MCP: <server> (M41 F2).
  await createServer({ engineOnly, log: (line) => process.stderr.write(`${line}
`) }).connect(new StdioServerTransport())
}
