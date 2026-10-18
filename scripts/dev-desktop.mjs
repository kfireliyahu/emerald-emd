#!/usr/bin/env node
/**
 * The desktop dev loop: Vite serving the renderer with hot reload, and the
 * Electron shell pointed at it.
 *
 * Vite runs through its JavaScript API rather than as a spawned CLI, so this
 * is one process and a child instead of three processes and a wait: `listen()`
 * resolves when the server is actually answering, which is the thing Electron
 * has to be started after — loading a URL before the server replies gets a
 * Chromium error page and stays on it.
 *
 * **`electron/` is bundled once, here, and not watched.** A change under
 * `src/` hot-reloads in place; a change to the main process or the preload
 * needs this command restarted. Watching the shell would mean restarting the
 * process anyway, which is the same keystroke with more machinery.
 *
 *   npm run dev:desktop
 *   PORT=5180 npm run dev:desktop
 */

import { spawn } from 'node:child_process'

import electronPath from 'electron'
import { build, createServer } from 'vite'

// One pass per entry — see the electron modes in `vite.config.ts` for why.
await build({ mode: 'electron' })
await build({ mode: 'electron-preload' })

const server = await createServer({
  mode: 'development',
  server: { port: Number(process.env.PORT) || 5173, strictPort: true },
})
await server.listen()
server.printUrls()

const local = server.resolvedUrls?.local?.[0]
if (local === undefined) throw new Error('the dev server started without a local URL')
const origin = new URL(local).origin

// `EMERALD_DEV_SERVER_URL` is what tells the main process to load from Vite
// rather than from `dist/`, and it is also the one origin the session guard
// will let through. Nothing else sets it, which is why a packaged app cannot
// reach an HTTP origin at all.
const shell = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, EMERALD_DEV_SERVER_URL: origin },
})

async function shutDown(code) {
  if (shell.exitCode === null && shell.signalCode === null) shell.kill()
  await server.close()
  process.exit(code)
}

process.on('SIGINT', () => void shutDown(0))
process.on('SIGTERM', () => void shutDown(0))

// Closing the window is how this loop ends; the dev server has nothing left to
// serve once the only thing reading it has gone.
shell.on('exit', (code) => void shutDown(code ?? 0))
