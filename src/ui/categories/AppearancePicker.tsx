import { useRef, useState } from 'react'

import { firstGrapheme } from '@/core/text.ts'
import { CATEGORY_COLOR_TOKENS, slotOf, token } from '@/ui/charts/categoryColor.ts'
import type { CategoryPalette } from '@/ui/charts/categoryPalette.ts'
import { useDismiss } from '@/ui/components/useDismiss.ts'

/**
 * A category's colour and icon — the editor docs/f02 has been promising since
 * migration 002 put the two columns there.
 *
 * **One popover for both**, because they are one decision: how this category
 * looks. The trigger is the result — a dot in the chosen hue with the icon
 * inside it — so the row shows what a chart will show, and the swatch grid
 * offers the palette's eleven token names rather than a colour wheel. There is no
 * free colour choice on purpose (D-088): the palette is tuned for two themes and
 * carries a lifted variant of every hue, and a hex the user picked against the
 * white page would be wrong on the black one with nothing to fix it.
 *
 * **Auto is a real choice, not the absence of one.** Clearing the colour hands
 * the category back to a slot chosen from its id, which is stable across months
 * — so "auto" keeps the guarantee that a category is the same colour in January
 * and in June, and its swatch shows the slot it landed on rather than a blank.
 *
 * **And the grid says who else is already wearing each hue** (M13). Eight hues
 * cannot make forty-six categories distinct, so the honest thing is not to
 * pretend: a swatch a sibling already wears is marked and names them, and a
 * level with more categories than hues says so under the grid. `resolvePalette`
 * has already spread the automatic ones as far as eleven slots go; what is left
 * is the user's to decide, with the collision visible instead of discovered in
 * a donut three screens away.
 */
export function AppearancePicker({
  id,
  name,
  color,
  icon,
  palette,
  onChange,
}: {
  id: string
  /** For the labels, so a screen reader hears which category is being dressed. */
  name: string
  color: string | undefined
  icon: string | undefined
  /** Resolved over the whole taxonomy, so the dot here is the wedge there. */
  palette: CategoryPalette
  onChange: (next: { color: string | undefined; icon: string | undefined }) => void
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // What the dot draws now, and what *automatic* would draw. They are the same
  // thing while the category is automatic — which is the state where being
  // right matters — and while a colour is chosen the auto swatch shows the
  // starting slot, since where resolution would land it depends on the choice
  // being given up.
  const shown = palette.colorOf(id)
  const automatic =
    color === undefined ? shown : token(CATEGORY_COLOR_TOKENS[slotOf(id)] ?? '')

  // Close on a press anywhere else, like the category picker it sits beside: a
  // popover left open behind the next row the user clicks is maddening in a
  // forty-row list. Escape closes it too, from anywhere (M45 F1).
  const dismissKey = useDismiss(open, containerRef, () => setOpen(false))

  return (
    <div ref={containerRef} className="relative shrink-0" onKeyDown={dismissKey}>
      <button
        type="button"
        onClick={() => setOpen((wasOpen) => !wasOpen)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Colour and icon for ${name}`}
        title="Colour and icon"
        className="flex size-5 items-center justify-center rounded-full text-[0.6875rem] leading-none transition-shadow duration-[var(--duration-micro)] hover:ring-1 hover:ring-hairline-strong hover:ring-offset-2 hover:ring-offset-background"
        style={{ backgroundColor: shown }}
      >
        <span aria-hidden>{icon ?? ''}</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={`Colour and icon for ${name}`}
          className="fc-pop-enter absolute z-40 mt-1 w-64 rounded-lg border border-hairline bg-elevated p-3 shadow-pop"
        >
          <p className="text-label text-ink-tertiary uppercase">Colour</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Swatch
              label={`Automatic colour for ${name}`}
              title="Automatic — a stable slot, chosen from the category and moved aside when a sibling is already on it"
              fill={automatic}
              chosen={color === undefined}
              auto
              onClick={() => onChange({ color: undefined, icon })}
            />
            {CATEGORY_COLOR_TOKENS.map((slot, index) => {
              const worn = palette.peersWearing(id, slot)
              return (
                <Swatch
                  key={slot}
                  label={
                    worn.length === 0
                      ? `Colour ${index + 1} for ${name}`
                      : `Colour ${index + 1} for ${name} — also ${worn.join(', ')}`
                  }
                  title={worn.length === 0 ? `Colour ${index + 1}` : `Also ${worn.join(', ')}`}
                  fill={token(slot)}
                  chosen={color === slot}
                  taken={worn.length > 0}
                  onClick={() => onChange({ color: slot, icon })}
                />
              )
            })}
          </div>

          {/* Said out loud rather than left to be noticed. Above eight there is
              no arrangement that makes a level distinct, and a user hunting for
              the free colour deserves to know there is not one. */}
          <p className="mt-2 text-caption text-ink-tertiary">
            {palette.crowded(id)
              ? `${palette.levelSize(id)} categories at this level and eleven colours — some share, and a marked swatch says which.`
              : 'A marked swatch is one a category at this level already wears.'}
          </p>

          <p className="mt-4 text-label text-ink-tertiary uppercase">Icon</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {SUGGESTED_ICONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                aria-label={`Use ${suggestion} as the icon for ${name}`}
                aria-pressed={icon === suggestion}
                onClick={() => onChange({ color, icon: suggestion })}
                className={`flex size-7 items-center justify-center rounded-md transition-colors duration-[var(--duration-micro)] hover:bg-surface ${
                  icon === suggestion ? 'bg-surface ring-1 ring-hairline-strong' : ''
                }`}
              >
                <span aria-hidden>{suggestion}</span>
              </button>
            ))}
          </div>

          {/* A field as well as the grid, because sixteen suggestions are not
              everybody's categories and the emoji keyboard is the operating
              system's job rather than this app's. One grapheme in: anything
              longer is a label, and the row already has a name for that. */}
          <div className="mt-2 flex items-center gap-2">
            <IconField icon={icon} name={name} onSet={(next) => onChange({ color, icon: next })} />
            {icon !== undefined && (
              <button
                type="button"
                onClick={() => onChange({ color, icon: undefined })}
                className="text-caption text-ink-secondary hover:text-ink"
              >
                Clear icon
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The emoji field.
 *
 * Kept to **one grapheme** — `core/text.ts` explains why that is not one
 * character. A pasted string is trimmed to its first emoji rather than refused,
 * because refusing a paste with no explanation is worse than taking the part of
 * it that was meant.
 */
function IconField({
  icon,
  name,
  onSet,
}: {
  icon: string | undefined
  name: string
  onSet: (icon: string | undefined) => void
}) {
  const stored = icon ?? ''
  const [text, setText] = useState(stored)

  // The swatch grid above writes the same column, so the field follows the
  // stored value whenever it is not the thing being typed into.
  const [lastStored, setLastStored] = useState(stored)
  if (stored !== lastStored) {
    setLastStored(stored)
    setText(stored)
  }

  const commit = (): void => {
    const next = firstGrapheme(text.trim())
    setText(next)
    if (next !== stored) onSet(next === '' ? undefined : next)
  }

  return (
    <input
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') setText(stored)
      }}
      placeholder="Any emoji"
      aria-label={`Icon for ${name}`}
      className="h-7 w-24 rounded-md border border-hairline bg-background px-2 text-center outline-none focus:border-hairline-strong"
    />
  )
}

/**
 * Somewhere to start. Sixteen, chosen against docs/f02's seed set — a house, a
 * bulb, a trolley — rather than a general emoji picker, which belongs to the
 * operating system and would be a screen of its own here.
 */
const SUGGESTED_ICONS: readonly string[] = [
  '🏠',
  '💡',
  '🛒',
  '🍽️',
  '🚗',
  '⛽',
  '🚌',
  '💊',
  '🎁',
  '✈️',
  '📱',
  '🐾',
  '🎓',
  '💰',
  '🏦',
  '💳',
]

/**
 * One hue.
 *
 * `taken` is a hole punched in the middle rather than a badge or a tint: the
 * swatch has to keep showing its colour truthfully, and docs/11 has no room for
 * a pill on a 24px circle. The name of whoever has it is in the title and in the
 * accessible label, because a mark on its own is not information — colour is
 * never the only carrier here (docs/11), and neither is a dot.
 */
function Swatch({
  label,
  title,
  fill,
  chosen,
  auto = false,
  taken = false,
  onClick,
}: {
  label: string
  title: string
  fill: string
  chosen: boolean
  auto?: boolean
  taken?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={chosen}
      title={title}
      onClick={onClick}
      className={`flex size-6 items-center justify-center rounded-full transition-shadow duration-[var(--duration-micro)] ${
        chosen
          ? 'ring-2 ring-accent ring-offset-2 ring-offset-elevated'
          : 'hover:ring-1 hover:ring-hairline-strong'
      } ${auto ? 'border border-dashed border-ink-tertiary' : ''}`}
      style={{ backgroundColor: fill }}
    >
      {taken && <span aria-hidden className="size-2 rounded-full bg-elevated" />}
    </button>
  )
}
