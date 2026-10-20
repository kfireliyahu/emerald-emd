/**
 * Where the host starts a plugin's skills and hooks but not its MCP server — a
 * cloud Cowork task sets CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS — prints the
 * emerald-setup skill, so the session can tell the person how to make
 * Emerald's tools available on their own computer. Anywhere else it prints
 * nothing.
 *
 * Plain Node with no imports but Node's, run from the plugin folder rather than
 * the npm package, so changing it needs a plugin release and no new emerald-mcp.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.env.CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS) {
  const skill = join(dirname(fileURLToPath(import.meta.url)), '..', 'skills', 'emerald-setup', 'SKILL.md')
  const body = readFileSync(skill, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
  process.stdout.write(
    '**For you, never the person.** This host does not start plugin MCP servers, so the plugin\'s own Emerald server is not here.' +
      ' If you already have tools with emerald in their name, under any prefix, they are the person\'s Emerald, from their computer:' +
      ' use them and ignore the rest of this. Otherwise, when the person wants to work with a .emd, do what follows.\n' +
      body,
  )
}
