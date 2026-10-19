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
 *
 * **`mcpName` is `server.json`'s `name`** (M42 U3, D-500): the MCP Registry lists the server from
 * that file and accepts it only when the package it points at, as published, carries the same name.
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

function manifest(app, listing) {
  return {
    name: 'emerald-mcp',
    version: app.version,
    mcpName: listing.name,
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

The MCP server of [Emerald](https://getemerald.dev): **the database under the chat.** A \`.emd\`
file is a real SQLite database on your disk. Keep anything as rows of a table you declare — tasks,
meetings, notes, a project's decisions, money — and your assistant asks for the rows it needs
instead of re-reading files: typed fields filter exactly, links are followed, and every session sees
the same rows. Writes are checked as they land.

\`\`\`
claude mcp add emerald -- npx -y emerald-mcp --engine-only
\`\`\`

Any MCP client that starts a stdio server runs it the same way: the command \`npx\`, the arguments
\`["-y", "emerald-mcp", "--engine-only"]\`. Leave the flag off for the ledger's tools too. Every tool takes the absolute path of the \`.emd\` it works on. In Claude
Code, the plugin brings it with its hooks and a skill: \`/plugin marketplace add
kfireliyahu/emerald-emd\`, then \`/plugin install emerald@emerald-emd\`.

## A model works in it

- Your assistant reads and writes the file directly, and where the app draws MCP Apps, shows a
  table, board or roadmap in the chat.
- Every write is shown first as a dry run. Nothing changes until you say commit.
- It reads what you already keep onto your tables: a spreadsheet (\`.csv\`, \`.xlsx\`), a \`.json\` of
  rows, or a folder of Markdown notes — a note a row, its frontmatter as columns, its \`[[links]]\`
  as links — read where it is and never changed.
- Shaped tools, never a general query: 28 for any document, 85 with the ledger.
- A document answers in rows, so the model asks for what it needs instead of reading notes end to
  end.
- One project's session leaves a note in another's inbox, and the next session there starts with it.

## Packs

A pack is formats somebody already worked out, with their views, ready to keep in a document. Two
come with Emerald:

- **The development pack**: a project's memory as rows — milestones, units, decisions, open
  questions, an inbox. A session starts from the rows, not from a summary of a chat.
- **The ledger**: personal finance from the files you already get — card statements, bank exports,
  payslips, fund reports. Every total opens to the rows it was summed from. Nothing connects to
  your bank.

## No internet, no login

- The server opens the file it is given, does one job, closes it, and makes no network call of its
  own.
- The file is yours: \`sqlite3\` and ordinary tools read it; back it up where you like, take it
  anywhere.

## Running it

- \`emerald-mcp --engine-only\` — the engine's tools, for any document; a fifth of the definitions
  to carry.
- \`emerald-mcp\` — the engine's tools and the ledger's (a personal-finance pack).
- \`emerald-mcp watch <document.emd> [--format <name>]\` — prints a line for each row that changes.

Two more bins are for Claude Code's plugin: \`emerald-hooks\` (what its hooks print) and
\`emerald-status-line\`. They are reached with \`npx -p emerald-mcp <bin>\`.

Licensed AGPL-3.0-only; \`THIRD_PARTY_NOTICES.txt\` carries the licences of what is bundled.
`

const app = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const listing = JSON.parse(readFileSync(join(root, 'server.json'), 'utf8'))
writeFileSync(join(out, 'package.json'), `${JSON.stringify(manifest(app, listing), null, 2)}\n`)
writeFileSync(join(out, 'README.md'), README)
