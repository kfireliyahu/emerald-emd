// node scripts/run-source.mjs <entry.ts> -- <args...>
//
// Runs one entry point from source, through this repository's own Vite config —
// the `@` alias, `?bytes` and the rest — so a test can start the real process
// (the stdio server, the watch command, a hook) without a build first. The
// entry sees `process.argv` as if it had been run directly: node, the entry,
// then everything after `--`.
//
// It was `vite-node` until Vitest 4 stopped bringing it (M42 F3); this is the
// same thing over Vite's own module runner, which is what Vitest 4 runs on.
import { resolve } from 'node:path'
import { createServer, createServerModuleRunner } from 'vite'

const [entry, ...rest] = process.argv.slice(2)
if (entry === undefined) {
  process.stderr.write('usage: node scripts/run-source.mjs <entry.ts> -- <args...>\n')
  process.exit(2)
}
const file = resolve(entry)
process.argv = [process.argv[0], file, ...(rest[0] === '--' ? rest.slice(1) : rest)]

const server = await createServer({
  appType: 'custom',
  clearScreen: false,
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true, hmr: false, watch: null, ws: false },
})
const runner = createServerModuleRunner(server.environments.ssr, { hmr: false })
try {
  await runner.import(file)
} finally {
  // The entry's own work is done or running on its own handles: the server
  // is closed so it holds nothing open and the process exits when the entry does.
  await server.close()
}
