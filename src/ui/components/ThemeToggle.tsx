import { useRef } from 'react'

import { useT } from '@/i18n/current.ts'
import { setThemePreference, useTheme, type ThemePreference } from '@/ui/theme/useTheme.ts'
import { arrowStep } from '@/ui/direction.ts'

/**
 * A light/dark control that offers the honest third option: follow the system.
 *
 * A segmented control rather than a single flip, because a plain toggle cannot
 * express "match my machine" — and the machine is the right default, so hiding
 * it would push everyone onto an explicit choice they did not ask to make. The
 * knob slides between the three under a spring-less ease; the icons are inline
 * SVG so nothing here needs an icon font, which would be a face to ship or a
 * request to make and the app makes none.
 */
const OPTIONS: readonly { readonly value: ThemePreference; readonly label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
]

export function ThemeToggle() {
  const t = useT()
  const { preference } = useTheme()
  const index = Math.max(0, OPTIONS.findIndex((option) => option.value === preference))
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  // **One tab stop, moved by the arrows** (the APG radio group, M54 F5): the
  // chosen option is the stop, and an arrow chooses the next one and takes focus
  // to it, wrapping at either end.
  const onKeyDown = (event: React.KeyboardEvent): void => {
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : arrowStep(event.key)
    if (step === 0) return
    event.preventDefault()
    const next = (index + step + OPTIONS.length) % OPTIONS.length
    const option = OPTIONS[next]
    if (option === undefined) return
    setThemePreference(option.value)
    buttons.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-label={t('chrome.components.theme.group')}
      onKeyDown={onKeyDown}
      className="relative inline-flex items-center rounded-control border border-hairline bg-surface"
    >
      {/* The knob: the chosen option's plane, square, with no shadow (M54 F5).
          It slides by its own width, so it always lands on a button. */}
      <span
        aria-hidden
        className="absolute inset-y-0 start-0 w-8 translate-x-[calc(var(--knob)*100%)] rounded-control border border-hairline-strong bg-elevated transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)] rtl:translate-x-[calc(var(--knob)*-100%)]"
        style={{ '--knob': index } as React.CSSProperties}
      />

      {OPTIONS.map((option, at) => {
        const chosen = preference === option.value
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttons.current[at] = element
            }}
            type="button"
            role="radio"
            aria-checked={chosen}
            aria-label={t(`chrome.components.theme.${option.value}`)}
            title={t(`chrome.components.theme.${option.value}`)}
            tabIndex={chosen ? 0 : -1}
            onClick={() => setThemePreference(option.value)}
            className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-control transition-colors duration-[var(--duration-micro)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
              chosen ? 'text-ink' : 'text-ink-secondary hover:bg-hairline hover:text-ink'
            }`}
          >
            <Icon name={option.value} />
          </button>
        )
      })}
    </div>
  )
}

/**
 * A compact single-button variant for tight chrome: click to cycle
 * light → dark → system, with the current state shown and announced. It is an
 * icon action (`fc-icon-action`): square, `ink-secondary` at rest, and its hover
 * a `hairline` plane, which shows on the rail's `surface` (M54 F5).
 */
export function ThemeCycleButton() {
  const t = useT()
  const { preference, resolved } = useTheme()

  const next: ThemePreference =
    preference === 'light' ? 'dark' : preference === 'dark' ? 'system' : 'light'

  return (
    <button
      type="button"
      onClick={() => setThemePreference(next)}
      aria-label={t('chrome.components.theme.switchTo', { now: t(`chrome.components.theme.short.${preference}`), next: t(`chrome.components.theme.short.${next}`) })}
      title={t('chrome.components.theme.now', { now: t(`chrome.components.theme.short.${preference}`) })}
      className="fc-icon-action"
    >
      <Icon name={preference === 'system' ? resolved : preference} />
    </button>
  )
}

function Icon({ name }: { name: ThemePreference | 'light' | 'dark' }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }

  if (name === 'dark') {
    return (
      <svg {...common} aria-hidden>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
    )
  }
  if (name === 'light') {
    return (
      <svg {...common} aria-hidden>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    )
  }
  // System: a half-filled circle — the machine decides.
  return (
    <svg {...common} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" stroke="none" />
    </svg>
  )
}
