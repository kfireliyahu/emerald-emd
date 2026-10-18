import { setThemePreference, useTheme, type ThemePreference } from '@/ui/theme/useTheme.ts'

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
  const { preference } = useTheme()
  const index = Math.max(0, OPTIONS.findIndex((option) => option.value === preference))

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="relative inline-flex items-center rounded-full border border-hairline bg-surface p-0.5"
    >
      {/* The sliding knob, positioned by the selected index. One transform, so
          it glides rather than repaints. */}
      <span
        aria-hidden
        className="absolute top-0.5 bottom-0.5 w-8 rounded-full bg-elevated shadow-pop transition-transform duration-[var(--duration-base)] ease-[var(--ease-out)]"
        style={{ transform: `translateX(${index * 2}rem)`, left: '0.125rem' }}
      />

      {OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={preference === option.value}
          title={option.label}
          onClick={() => setThemePreference(option.value)}
          className={`relative z-10 flex h-7 w-8 items-center justify-center rounded-full transition-colors duration-[var(--duration-micro)] ${
            preference === option.value ? 'text-ink' : 'text-ink-tertiary hover:text-ink-secondary'
          }`}
        >
          <Icon name={option.value} />
        </button>
      ))}
    </div>
  )
}

/**
 * A compact single-button variant for tight chrome: click to cycle
 * light → dark → system, with the current state shown and announced.
 */
export function ThemeCycleButton() {
  const { preference, resolved } = useTheme()

  const next: ThemePreference =
    preference === 'light' ? 'dark' : preference === 'dark' ? 'system' : 'light'

  return (
    <button
      type="button"
      onClick={() => setThemePreference(next)}
      aria-label={`Theme: ${preference}. Switch to ${next}.`}
      title={`Theme: ${preference}`}
      className="flex h-8 w-8 items-center justify-center rounded-md text-ink-secondary transition-colors duration-[var(--duration-micro)] hover:bg-surface hover:text-ink"
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
