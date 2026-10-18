/**
 * The chosen provider: where it is kept, and how the page asks what is
 * installed.
 *
 * Two halves, and the interesting one is where the choice lives.
 *
 * **It is not in the document, and that is a decision rather than an
 * oversight.** A `.emd` is a file you own and carry — to another machine, to
 * a backup, to a laptop that has no Ollama on it and never will. A provider is a
 * fact about *this machine's* installed software, so a document carrying one
 * would arrive somewhere it is meaningless, and the app would either fail
 * quietly or go looking on a port that belongs to something else. D-115 is the
 * standing warning here: the shell could store state anywhere now, and the
 * mistake it exists to prevent is making the app stateful because it finally
 * could. This is the other side of the same rule — machine state belongs to the
 * machine, not to the file.
 *
 * So it is `localStorage`, beside the theme and the sidebar (D-130): a
 * preference this copy of the app remembers, that no document ever sees.
 *
 * The other half is the bridge call, which is one line, because the socket and
 * the loopback guard are in the main process where a page cannot reach them
 * (D-134).
 */

import type { Provider, RuntimeProbe } from '../../../electron/bridge.ts'
import { shellBridge } from '@/data/storage/desktop.ts'

import { readPreference, writePreference } from './preference.ts'

const STORAGE_KEY = 'fc-provider'

/**
 * Feature detection, the same shape as `isDesktopShell` and for the same reason
 * (D-021): the app picks at runtime, so a shell too old to serve this falls
 * back to "not supported" instead of crashing on a missing method.
 */
export function isProviderSupported(): boolean {
  return shellBridge()?.runtimes !== undefined
}

/**
 * Look for the runtimes on this machine.
 *
 * **Called only from a person's click.** Off by default is kept by there being
 * no other caller — a probe is a socket, and a socket opened on a schedule is
 * one nobody chose to open (D-134).
 */
export async function detectRuntimes(): Promise<readonly RuntimeProbe[]> {
  const runtimes = shellBridge()?.runtimes
  if (runtimes === undefined) return []
  return runtimes.detect()
}

/**
 * The stored choice, or nothing.
 *
 * Validated field by field rather than trusted: this is `localStorage`, which
 * survives an app that has been upgraded, downgraded, and had its keys edited by
 * whoever opened DevTools. A stored value that is not a provider is treated as
 * no choice at all, which lands on `off` — the safe default and the resting
 * state anyway.
 */
export function readChosenProvider(): Provider | undefined {
  const raw = readPreference(STORAGE_KEY)
  // Nothing stored, or no storage: no choice, which means off.
  if (raw === undefined) return undefined

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const { runtime, origin, model } = parsed
    if (runtime !== 'ollama' && runtime !== 'lmstudio') return undefined
    if (typeof origin !== 'string' || origin === '') return undefined
    if (typeof model !== 'string' || model === '') return undefined
    return { runtime, origin, model }
  } catch {
    return undefined
  }
}

/** Write the choice, or clear it — turning the feature back off. */
export function writeChosenProvider(provider: Provider | undefined): void {
  writePreference(STORAGE_KEY, provider === undefined ? undefined : JSON.stringify(provider))
}
