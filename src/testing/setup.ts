// Runs before every test file (vite.config.ts `setupFiles`): whatever the file
// made with `tempDir` is gone when it finishes.
import { afterAll } from 'vitest'

import { BACKUPS_ROOT_VARIABLE } from '../../electron/bridge'
import { removeTempDirs, tempDirSync } from './tempDir'

// The plugin's copies before a write go to Emerald's own per-user folder
// (D-455); a test's go to a folder of the file's own, removed with the rest.
process.env[BACKUPS_ROOT_VARIABLE] = tempDirSync('emerald-backups-')

afterAll(removeTempDirs)
