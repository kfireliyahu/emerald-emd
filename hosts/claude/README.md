# Emerald for Claude

**Excel that reads your documents and won't let you be wrong quietly.** Emerald keeps what you and
Claude work out — what a kind of thing is, which fields it has, what has to add up — as a typed
table in a `.emd` file on your own disk: a real SQLite database, with no account, no server and no
network call. This plugin gives Claude Code the engine's tools, draws a format's table, board or
roadmap in the conversation, and teaches Claude to declare a format with you.

## Install

In Claude Code:

```
/plugin marketplace add kfireliyahu/emerald-emd
/plugin install emerald@emerald-emd
```

Then restart the session. It needs Node 24 or later on your `PATH`.

## What it adds

- **The MCP server** `emerald`, engine-only: declare a format, read a `.csv` or `.xlsx` onto it,
  record and update rows (every write is a dry run until you say yes), and `start_here` /
  `show_format` to see a document's rows, board or roadmap.
- **The `declare-a-format` skill**: work out a format with you and declare it into your document.
- **Two hooks.** At session start, `start_here` on the project's document; before each prompt, the
  inbox's new rows, each printed once per session. Both are silent in a folder with no `.emd` in
  it, or none named by `.claude/emerald.json` (`{ "document": "docs/project.emd" }`).

## What it runs, and what it fetches

Everything here runs the published npm package `emerald-mcp`, pinned to this plugin's version:

- the server as `npx -y --prefer-offline emerald-mcp@<version> --engine-only`;
- the hooks through `emerald.mjs`, a short script in this folder that keeps a copy of the same
  package in the plugin's data folder (`~/.claude/plugins/data/emerald-emerald-emd/`), installs it
  there with npm at the first session start after an install or update, and then runs it with
  plain `node`, so the hook before each prompt costs a third of a second rather than npx's two.

npm downloads the package from the npm registry; nothing else is fetched, and nothing is sent
anywhere. The [privacy policy](https://github.com/kfireliyahu/emerald-emd/blob/main/PRIVACY.md) has
the whole of it. The source is this repository, under AGPL-3.0-only.

## A status line, if you want one

The status line is your setting, not the plugin's. Once a session has started with the plugin, add
to `~/.claude/settings.json`:

```json
"statusLine": { "type": "command", "command": "node \"~/.claude/plugins/data/emerald-emerald-emd/node_modules/emerald-mcp/status-line.mjs\"" }
```

with `~` written out as your home folder. It prints the inbox's new rows and the units in progress,
for the project's document.

More: [getemerald.dev](https://getemerald.dev) · [the plugin's notes](https://github.com/kfireliyahu/emerald-emd/blob/main/docs/plugin.md) · [issues](https://github.com/kfireliyahu/emerald-emd/issues)
