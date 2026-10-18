/**
 * dist-plugin/ as the npm package `emerald-mcp` (M42 U2, D-497): its manifest and its README,
 * written beside what `build:plugin` built, so the folder is the package as it stands.
 *
 *   node scripts/npm-package.mjs            # the last step of `npm run build:plugin`
 *   cd dist-plugin && npm pack               # the tarball; `npm publish --access public` is the maintainer's
 *
 * **One package, three bins, no dependencies.** The three files are already whole — every
 * package they reach is bundled into them (`published` in vite.config.ts) — so the manifest
 * names no dependency and an `npx` has nothing to install but the tarball:
 *
 *   emerald-mcp          server.mjs        the MCP server; `--engine-only` for the engine's tools alone
 *   emerald-hooks        hooks.mjs         what a Claude Code hook prints (start-here, rows, status)
 *   emerald-status-line  status-line.mjs   Claude Code's status line
 *
 * A bin each rather than one bin with subcommands, because the inbox hook runs on every prompt and
 * the status line has 200 ms: a dispatcher in front of them would load the server's bundle, or be a
 * fourth file, to reach a file that is already its own entry.
 *
 * The version, licence, author and repository are the repository's own `package.json`'s, read here
 * rather than kept twice. The root manifest stays private: it is the app's.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const out = resolve(root, process.argv[2] ?? 'dist-plugin')

const BINS = {
  'emerald-mcp': 'server.mjs',
  'emerald-hooks': 'hooks.mjs',
  'emerald-status-line': 'status-line.mjs',
}

function manifest(app) {
  return {
    name: 'emerald-mcp',
    version: app.version,
    description:
      "Emerald's MCP server: declared formats in a .emd file — a real SQLite database on your disk — that a model reads, writes and checks. Local-first: no account, no network call.",
    keywords: ['mcp', 'model-context-protocol', 'sqlite', 'local-first', 'emerald', 'emd'],
    author: app.author,
    license: app.license,
    homepage: app.homepage,
    repository: app.repository,
    bugs: { url: 'https://github.com/kfireliyahu/emerald-emd/issues' },
    type: 'module',
    bin: BINS,
    files: [...Object.values(BINS), 'LICENSE.txt', 'THIRD_PARTY_NOTICES.txt'],
    // What CI runs on. The files target Node 20, and npm only warns below the range.
    engines: { node: '>=24' },
  }
}

const README = `# emerald-mcp

The MCP server of [Emerald](https://github.com/kfireliyahu/emerald-emd): **Excel that reads your
documents and won't let you be wrong quietly.** A \`.emd\` file is a real SQLite database on your
disk; a *format* declared in it is a real table with real types and real checks, and these tools
are how a model reads, writes and checks it. No account, no service behind it, no network call.

\`\`\`
claude mcp add emerald -- npx emerald-mcp
\`\`\`

Any MCP client that starts a stdio server runs it the same way: the command \`npx\`, the arguments
\`["-y", "emerald-mcp"]\`. Every tool takes the absolute path of the \`.emd\` it works on.

- \`emerald-mcp\` — the server, with the engine's tools and the ledger's (a personal-finance pack).
- \`emerald-mcp --engine-only\` — the engine's tools alone, a fifth of the definitions to carry.
- \`emerald-mcp watch <document.emd> [--format <name>]\` — prints a line for each row that changes.

Two more bins are for Claude Code's plugin: \`emerald-hooks\` (what its hooks print) and
\`emerald-status-line\`. They are reached with \`npx -p emerald-mcp <bin>\`.

Licensed AGPL-3.0-only; \`THIRD_PARTY_NOTICES.txt\` carries the licences of what is bundled.
`

const app = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
writeFileSync(join(out, 'package.json'), `${JSON.stringify(manifest(app), null, 2)}\n`)
writeFileSync(join(out, 'README.md'), README)
