import { readPreference, writePreference } from '@/data/runtime/preference.ts'
import { createStore } from '@/state/store.ts'

/**
 * The light/dark preference, and how it reaches the DOM.
 *
 * Three states, not two: `system` follows the OS and is the honest default —
 * the app should look like the machine it opened on until the user says
 * otherwise. `light` and `dark` are explicit overrides that persist.
 *
 * No Zustand here. The resolved theme is a single string that also has to be
 * applied before React mounts (see `applyThemeEarly`, called from the HTML
 * head) to avoid a flash of the wrong palette, so a plain store the early
 * script and the hook can share is simpler than a framework one.
 */

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'fc-theme'

function storedTheme(): ThemePreference {
  const stored = readPreference(STORAGE_KEY)
  // Nothing stored, or nowhere to store it: system it is.
  return stored === 'light' || stored === 'dark' ? stored : 'system'
}

function systemPrefersDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolve(preference: ThemePreference): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark() ? 'dark' : 'light'
  return preference
}

/**
 * Put the resolved theme on the root element, where the CSS variable overrides
 * key off it. The single place the DOM is touched.
 */
function apply(preference: ThemePreference): void {
  document.documentElement.dataset.theme = resolve(preference)
}

export interface ThemeState {
  readonly preference: ThemePreference
  readonly resolved: ResolvedTheme
}

/**
 * The preference and what it resolves to, set together — so a change of the
 * machine's own theme while `system` is chosen is a new state like any other.
 * The same state is not a new one, which keeps `useSyncExternalStore` from
 * looping on a fresh object.
 */
const theme = createStore<ThemeState>(
  { preference: 'system', resolved: 'light' },
  (a, b) => a.preference === b.preference && a.resolved === b.resolved,
)

function choose(preference: ThemePreference): void {
  apply(preference)
  theme.set({ preference, resolved: resolve(preference) })
}

/**
 * Run once, as early as possible — from `main.tsx`, before the first render —
 * so the correct palette is on the element for the first paint. Also wires the
 * OS-preference listener, so `system` tracks a change made while the app is
 * open.
 */
export function initTheme(): void {
  choose(storedTheme())

  if (typeof matchMedia === 'function') {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (theme.get().preference === 'system') choose('system')
    })
  }
}

export function setThemePreference(next: ThemePreference): void {
  writePreference(STORAGE_KEY, next)
  choose(next)
}

export function useTheme(): ThemeState {
  return theme.use()
}
