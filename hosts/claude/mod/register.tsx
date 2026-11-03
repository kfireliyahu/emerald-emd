/**
 * **The emerald plugin's hooks module** (M56): one registration per concern,
 * each in its own file, so the units that fill them never edit this one or
 * `hooks/hooks.json` (D-534). The command hooks beside it stay, for every host
 * that runs no hooks module.
 */
import type { Register } from 'claude-code'

import { registerCommands } from './commands.ts'
import { registerGuards } from './guards.ts'
import { registerInbox } from './inbox.ts'
import { registerPane } from './pane.tsx'

export const register: Register = (on) => {
  registerPane(on)
  registerInbox(on)
  registerGuards(on)
  registerCommands(on)
}
