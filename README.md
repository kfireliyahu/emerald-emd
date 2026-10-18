<img src="src/ui/emerald.svg" width="72" height="72" align="right" alt="" />

# Emerald

**The database under the chat.** A local, file-based database that you and an AI model fill
together, where every table has real types and real checks, so what you worked out stays true.
Free software, AGPL-3.0. Desktop only, no server, no account. [getemerald.dev](https://getemerald.dev)

## What Emerald is

- **A document is a file.** `.emd`, a real SQLite database on your disk, stored as SQLite bytes or
  as text and chosen per file. `sqlite3` opens it, the schema is documented, and ordinary tools
  read every table, including the ones you declared.
- **Declare a table for anything you keep**: a charge, a paycheck, a book, a milestone. It is a
  *format*: a real table with real types and a `CHECK` for every rule you state, not a template. A value that
  does not fit is refused when it is written, not found later.
- **Formats link**, and figures are worked out across them: hours from a start and an end, a total
  over the rows that point here. A total never quietly skips a row it cannot read.
- **Claims** are rules that have to hold: the receipt total is the card charge, every hour was
  paid. Each one is proved, failed or unchecked, and unchecked says why.
- **Files are read onto formats**: a spreadsheet, a CSV, a JSON file of rows, a Markdown note or a
  folder of them. The columns are placed once, kept as a *reader*, and checked every time. A model
  may give a mapping or a position, never a value.
- **A model works in it through MCP.** The server reads and writes the document directly, with
  shaped tools, never a general query: 28 for any document, 85 with the ledger. Every write is a
  dry run until you say commit; a copy is kept beside the document before any write; a document
  older than the server's schema is never migrated, only reported.
- **It draws in the conversation.** Ask to see a sheet, a board or a roadmap and the server draws
  it as the app does, where the host supports MCP Apps (seen in the Claude desktop app's Code tab
  and in VS Code's Copilot Chat); everywhere else, the same answer as text.
- **Packs are formats somebody already worked out**, with their views. Two come with Emerald:
  the ledger and the development pack. Making and sharing your own is next.
- **No internet, no login.** The app makes no network call of its own, not for AI, not for updates,
  not for telemetry, and a test fails if it ever does. A local model runtime on this machine can
  be used, and looking for one happens only on your click, over loopback.

### The ledger

- For people who want to manage their money, not be managed by it: everything they have, in one
  place that is theirs.
- Reads what you already get: card statements, bank exports, payslips, fund reports.
- Files every charge, and tells a transfer from a spend and a monthly bill from a one-off.
- Every total opens to the rows it was summed from.
- A year of study-fund reports read in: one month the fund received nothing, though the payslip
  showed the deduction.
- Nothing connects to your bank. You give it the files.

### The development pack

- A project's memory as rows: milestones, units, decisions, open questions, an inbox.
- A session starts from the rows, not from a summary of a chat. A request that contradicts a
  decision already taken is answered with the decision.
- One project's session leaves a note in another project's inbox, and the next session there
  starts with it.
- Emerald is built with it: [docs/memory.emd](./docs/memory.emd) is this project's memory, and every
  session on this repository starts by asking it.

## Installing it

Three ways in, all available today:

- **The desktop app**, for Windows and macOS, from the
  [latest release](https://github.com/kfireliyahu/emerald-emd/releases/latest).
  `.emd` documents get their own icon and open on a double-click. It is not code-signed: Windows
  shows *"Windows protected your PC"* (click **More info**, then **Run anyway**; the installer is
  per-user and asks for no administrator password), and macOS refuses the first open (**System
  Settings → Privacy & Security**, **Open Anyway**). Every release is built by this repository's
  [release workflow](./.github/workflows/release.yml) from a tag and attested, with a `SHA256SUMS`
  file beside it: `gh attestation verify <file> --repo kfireliyahu/emerald-emd` asks GitHub whether
  the file is one the workflow built. Updates are "download the new one"; there is no update check.
- **The MCP server**, as the npm package `emerald-mcp`: one line in your assistant's MCP
  configuration, for any document, and `--engine-only` for the engine's tools without the ledger's:

  ```bash
  claude mcp add emerald -- npx -y emerald-mcp
  ```
- **The Claude Code plugin**, with the server, its views drawn in the conversation, the skill for
  declaring a format with a person, and the hooks that bring a project's `start_here` and inbox
  into a session ([what it runs](./hosts/claude/README.md)):

  ```
  /plugin marketplace add kfireliyahu/emerald-emd
  /plugin install emerald@emerald-emd
  ```

## The repository

**Build and run**

```bash
git clone https://github.com/kfireliyahu/emerald-emd.git
cd emerald-emd
npm ci                 # npm install works too; this is the reproducible form
npm run dev            # the app, in a browser tab
npm run test           # the whole suite
npm run build          # the app -> dist/, what the desktop shell serves
npm run desktop        # build everything and open the desktop window
npm run build:plugin   # the MCP server -> dist-plugin/server.mjs
npm run build:demo     # Emerald's page and the tours -> dist-demo/
npm run dist:win       # the Windows installer -> release/
npm run dist:mac       # the macOS disk image -> release/   (needs a Mac)
```

- Built and tested on Node 24. `npm ci` prints audit advisories (in the MCP SDK and the router;
  tracked). The first run of anything that opens the desktop window downloads Electron's binary
  once; that is the one time the build needs the network.
- The screens are wide-data screens, a column mapper, an import review, a table of deposits, and
  there is deliberately no phone layout. In a browser, Chrome and Edge save silently through the
  File System Access API; Safari and Firefox save by download. The desktop app saves silently
  everywhere.

**The MCP server from this checkout**

`.mcp.json` points at `dist-plugin/server.mjs` with `--engine-only`, so a Claude Code session
started in this directory picks it up and asks you to approve it once. From anywhere else:

```bash
claude mcp add emerald -- node /absolute/path/to/dist-plugin/server.mjs --engine-only
```

Leave `--engine-only` off for the ledger's tools as well. The built folder is self-contained —
every package is bundled into it, and it is the npm package as it stands — so it runs from anywhere
Node does. [docs/plugin.md](./docs/plugin.md) has the tool surface, the hosts tried, and the rules.

**Where things are**

- [`docs/`](./docs/00-index.md): the specification, architecture, data model, the engine, a note
  per area. [`docs/09-decision-log.md`](./docs/09-decision-log.md) records why things are the way
  they are, and [`docs/memory.emd`](./docs/memory.emd) holds where the build is, as rows.
- [`docs/demo.md`](./docs/demo.md): the page, the tours, and how another page embeds one.
- `src/domain/` is the engine and imports nothing from React, SQLite or the DOM; `src/data/` is
  storage; `src/ui/` the app; `src/plugin/` the MCP server; `electron/` the desktop shell;
  `src/data/packs/` the two packs.

**Issues and contributions**

- Issues and discussion are welcome.
- Code contributions wait for a contributor agreement; [LICENSING.md](./LICENSING.md) says why.
  When they open, import mappings and locale packs are the pieces that benefit most from people who
  live with those formats.
- **Never include real statement files.** Fixtures are synthetic, and a test refuses anything
  else.

## Disclaimers

- **It computes; it does not advise.** Nothing Emerald shows is financial, tax, legal or investment
  advice. It adds up what you gave it and says when something does not; what to do about it is
  yours to decide, with whoever you would have asked anyway.
- **Check what it read.** A figure read from a payslip, a statement, a fund report or a receipt is
  a reading of that document, by code or by a model, and either can be wrong. The document is the
  truth; Emerald keeps the reading beside it so you can compare.
- **A model's words are the model's.** When an assistant works in a document through MCP, what it
  says and what it asks to write come from that assistant and its provider, under their terms, not
  from this project. Emerald's part is to refuse what does not fit and to show every write before
  it happens.
- **Your file is your file.** Emerald writes the document you opened and keeps copies beside it,
  and it makes no other copy anywhere. Back it up as you would any file; nothing here can recover
  one you lost.
- **No affiliation.** Emerald is not connected to, endorsed by or acting for any bank, card
  issuer, fund, employer, payroll provider or AI provider. The ledger reads the files those
  institutions give you, in whatever layout they come in.
- **As is.** The software is provided without warranty of any kind, as sections 15 and 16 of the
  [AGPL-3.0](./LICENSE) say in full. The desktop builds are unsigned and built by this
  repository's workflow; use them, or build from source, at your own judgement.

## Privacy

Emerald collects nothing. The policy, in full, is [PRIVACY.md](./PRIVACY.md).

## License

The code is AGPL-3.0-only ([LICENSE](./LICENSE)); the notes and essays CC BY 4.0; format
declarations, packs and synthetic fixtures CC0. [LICENSING.md](./LICENSING.md) says which is
which, what the name and mark are not, and how to get a commercial licence. The desktop app says
the same in its About, with the third-party notices of everything it bundles a click away in Help.
