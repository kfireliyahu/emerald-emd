# Emerald for Claude

**The database under the chat.** Emerald keeps what you and Claude work out — which tables you
keep, which fields they have, what has to add up — as a typed table in a `.emd` file on your own disk: a real SQLite database, with no account, no server and no
network call. This plugin gives Claude Code the engine's tools, draws a format's table, board or
roadmap in the conversation, and teaches Claude to declare a format with you.

## Install

In Claude Code:

```
/plugin marketplace add kfireliyahu/emerald-emd
/plugin install emerald@emerald-emd
```

Then restart the session. It needs Node 24 or later on your `PATH`.

### In the Claude desktop app and Cowork

Adding the marketplace under **Customize → Plugins** brings the skills to chat and Cowork, but a
Cowork task in the cloud never starts a plugin's MCP server. Add the server to the desktop app
itself instead. It then runs on your computer, in chat and in Cowork, and a cloud task reaches it
there through the app.

**The easy way: the desktop extension.** Download
[`emerald.mcpb`](https://github.com/kfireliyahu/emerald-emd/releases/latest/download/emerald.mcpb)
from the latest release, double-click it, and press **Install** in the Claude app (or drag it onto
**Settings → Extensions**). It runs on the Node the app ships, so you don't need Node installed and
there's no file to edit. It doesn't update itself: download the new one when a release says so.

**Or by hand.** Find `npx` (`which npx` on macOS, `where npx` on Windows), then add Emerald under
`"mcpServers"` in the app's configuration file, keeping anything already there:

- macOS, `~/Library/Application Support/Claude/claude_desktop_config.json`:
  `"emerald": { "command": "<the path to npx>", "args": ["-y", "emerald-mcp@0.1.5", "--engine-only"] }`
- Windows, `%APPDATA%\Claude\claude_desktop_config.json`:
  `"emerald": { "command": "cmd", "args": ["/c", "npx", "-y", "emerald-mcp@0.1.5", "--engine-only"] }`

Quit the app completely and reopen it. A session that has the plugin's skills but no server, as in a
cloud task, is told these same steps (the `emerald-setup` skill), so it can walk you through them.

## Updating

Claude Code updates a plugin from a marketplace like this one only when you ask, unless you turn
auto-update on for it: `/plugin`, the **Marketplaces** tab, `emerald-emd`, **Enable auto-update**.
Then a new version arrives in the background and loads in your next session, or after
`/reload-plugins`. To update by hand:

```
claude plugin marketplace update emerald-emd
claude plugin update emerald@emerald-emd
```

The plugin's version is `<package>` when it moves to a new `emerald-mcp`, and `<package>+<n>` for a
release of its own skills, hooks or README on the same package.

## What it adds

- **The MCP server** `emerald`, engine-only: declare a format, read a spreadsheet, a `.json` of
  rows or a folder of Markdown notes onto it,
  record and update rows (every write is a dry run until you say yes), and `start_here` /
  `show_format` to see a document's rows, board or roadmap.
- **The `declare-a-format` skill**: work out a format with you and declare it into your document.
- **Three skills for a project that keeps the `development` pack** — milestones, units, decisions,
  review entries and an inbox in the project's `.emd`: `run-milestone` drives a milestone's planned
  units, each built by a fresh session (several at once where `dispatch_plan` says they share no
  path), `closing-pass` lands a finished unit with its commit and report, and `review-phase` walks a
  built milestone's open review entries with you, one at a time.
- **The `emerald-setup` skill**: in a session with the plugin's skills but no server, the steps
  above, so Claude can walk you through them.
- **Three hooks.** At session start, `start_here` on the project's document; before each prompt, the
  inbox's new rows, each printed once per session. Both are silent in a folder with no `.emd` in
  it, or none named by `.claude/emerald.json` (`{ "document": "docs/project.emd" }`).
  The third, at session start too, prints the `emerald-setup` steps where the host starts no
  plugin server (a cloud Cowork task), and nothing anywhere else. It runs from the plugin folder.

## What it runs, and what it fetches

Everything here runs the published npm package `emerald-mcp` through `npx`, pinned to this
plugin's version:

- the server as `npx -y --prefer-offline emerald-mcp@<version> --engine-only`, once a session;
- the hooks as `npx -y --prefer-offline -p emerald-mcp@<version> emerald-hooks …`. npm's own
  start-up makes each one about two seconds on Windows, and the inbox hook runs before every
  prompt.

npm downloads the package from the npm registry the first time and keeps it in its cache;
`--prefer-offline` keeps a pinned version off the network after that. Nothing else is fetched, and
nothing is sent anywhere. The [privacy policy](https://github.com/kfireliyahu/emerald-emd/blob/main/PRIVACY.md) has
the whole of it. The source is this repository, under AGPL-3.0-only.

## A status line, if you want one

The status line is your setting, not the plugin's. Add to `~/.claude/settings.json`, with the
version this plugin pins:

```json
"statusLine": { "type": "command", "command": "npx -y --prefer-offline -p emerald-mcp@0.1.5 emerald-status-line" }
```

It prints the inbox's new rows and the units in progress, for the project's document; through npx it
takes about two seconds to refresh.

More: [getemerald.dev](https://getemerald.dev) · [the plugin's notes](https://github.com/kfireliyahu/emerald-emd/blob/main/docs/plugin.md) · [issues](https://github.com/kfireliyahu/emerald-emd/issues)
