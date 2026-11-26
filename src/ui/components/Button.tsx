import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

import { ActionGlyph, type ActionGlyphName } from '@/ui/components/ActionGlyph.tsx'
import { Working } from '@/ui/components/Working.tsx'

/**
 * The one button in the app: the **split tile** chosen in M28 U4's
 * mockup (option B), in three weights.
 *
 * Square, like everything since D-306. `primary` is emerald with its icon in a
 * darker leading tile — the one thing to do on a screen (D-125). `secondary`
 * is a `surface` plane with a `hairline` tile that turns emerald on hover.
 * `ghost` is a word in `accent` whose underline draws in on hover, for the
 * actions that should barely register until wanted.
 *
 * **The tile is there only when the button has an icon.** A button without one
 * is the same plane and the same square, with its label centred; most of the
 * app's buttons are that until their screen gets its own pass.
 *
 * `count` goes inside the button rather than into the sentence beside it
 * (*Write 5*), and `busy` replaces the icon with the progress indicator and the
 * label with what is happening, and disables the button while it lasts.
 *
 * This retires D-154's inset highlight and hover shadow: a split tile carries
 * its depth in the tile, and a shadow under it would be a second answer.
 *
 * **`sm` is the chrome row's button** (M64 F2, D-630): 32px high, its label on
 * the body step like `md`'s, so a screen's small buttons cost it no type size
 * of their own (it was 13px, off the ramp). It forwards its ref, so a
 * confirmation can anchor to it and a panel can hand focus back to it.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'ghost'
export type ButtonSize = 'sm' | 'md'

export type ButtonProps = {
  variant?: ButtonVariant
  size?: ButtonSize
  /** The glyph in the leading tile. Ignored on `ghost`, which is a word. */
  icon?: ActionGlyphName | undefined
  /** A figure the action applies to, shown inside the button. */
  count?: number | undefined
  /** In progress: what is happening, or `true` to keep the label. */
  busy?: string | boolean | undefined
  children?: ReactNode
} & ButtonHTMLAttributes<HTMLButtonElement>

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, count, busy, className, type = 'button', disabled, children, ...rest },
  ref,
) {
  const working = busy !== undefined && busy !== false
  const tiled = variant !== 'ghost' && (icon !== undefined || working)
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled === true || working}
      aria-busy={working || undefined}
      className={[
        'fc-btn',
        `fc-btn-${variant}`,
        size === 'sm' ? 'fc-btn-sm' : '',
        tiled ? 'fc-btn-tiled' : '',
        className ?? '',
      ].join(' ')}
      {...rest}
    >
      {tiled && (
        <span className="fc-btn-tile" aria-hidden>
          {working ? (
            <Working size={size === 'sm' ? 14 : 16} />
          ) : icon === undefined ? null : (
            <ActionGlyph name={icon} size={size === 'sm' ? 14 : 16} />
          )}
        </span>
      )}
      {working && typeof busy === 'string' ? busy : children}
      {count !== undefined && !working && <span className="fc-btn-count">{count}</span>}
    </button>
  )
})
