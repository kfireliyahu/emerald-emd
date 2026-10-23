---
name: emerald-setup
description: Tell the person how to make Emerald's tools available on their own computer. Use when they want to open, create or work in a .emd, declare a format, or ask Emerald for rows, and this session has no Emerald tools under any name or prefix (no start_here, formats or declare_format) even though the emerald plugin's skills are here.
---

# Make Emerald available here

**First, look at your tools.** If any have `emerald` in their name, whatever the prefix (for
example `mcp__remote-devices__emerald__start_here`, reached through the person's computer), then
Emerald is already there: use those tools, and skip everything below.

Otherwise: the emerald plugin is installed, but its MCP server isn't running in this session. A
Cowork task in the cloud starts a plugin's skills and hooks but never its MCP server. It can still
reach an Emerald the person installed in the Claude app on their own computer, so the fix is
theirs, on that computer, and takes a few minutes. Tell them once, plainly, in your own words. Don't start the
server by hand here, and don't write files for them to import later, unless they ask for that
instead.

**The easy way, on macOS or Windows: the desktop extension.** They download `emerald.mcpb` from
https://github.com/kfireliyahu/emerald-emd/releases/latest/download/emerald.mcpb, double-click it
and press **Install** in the Claude app (or drag it onto Settings → Extensions). It runs on the Node
the app ships, so they need no Node and edit no file. Then they start a new task with the folder that
holds their `.emd`. Offer this first.

**Or by hand**, if they'd rather, or already keep servers in the configuration file:

1. **Find `npx`.** In Terminal on macOS, `which npx`; in a terminal on Windows, `where npx`. If it
   prints nothing, they install Node from nodejs.org first.
2. **Open the Claude desktop app's configuration file**, creating it if it's missing and keeping
   anything already in it:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
3. **Add Emerald under `"mcpServers"`.** On macOS, with the path from step 1:

   ```json
   {
     "mcpServers": {
       "emerald": {
         "command": "/opt/homebrew/bin/npx",
         "args": ["-y", "emerald-mcp@0.2.0", "--engine-only"]
       }
     }
   }
   ```

   On Windows, through `cmd`, which finds `npx` itself:

   ```json
   {
     "mcpServers": {
       "emerald": {
         "command": "cmd",
         "args": ["/c", "npx", "-y", "emerald-mcp@0.2.0", "--engine-only"]
       }
     }
   }
   ```

   If the file already has an `"mcpServers"` section, `"emerald": { … }` goes inside it, beside
   what's there. Straight quotes only: a text editor that turns them curly breaks the file.
4. **Quit the Claude app completely and reopen it**, then start a new task with the folder that
   holds their `.emd`. Emerald's tools are there from then on, in chat and in Cowork.

If they paste the file and want it merged, merge it for them. If the tools still don't appear after
a restart, the server's log says why: `~/Library/Logs/Claude/mcp-server-emerald.log` on macOS,
`%APPDATA%\Claude\logs\mcp-server-emerald.log` on Windows.
