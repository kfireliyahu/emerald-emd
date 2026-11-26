import type { DocumentTemplate } from '@/domain/model/templates.ts'
import { MENU_MOST, ValueChoice } from '@/ui/components/ChoiceField.tsx'
import { SELECT } from '@/ui/components/fieldLook.ts'

/**
 * “Not that one, use this one” — the stored formats, and the one this slip was
 * read with.
 *
 * The matcher picks a format and then the arithmetic judges the picking, which
 * is enough right up until two formats fit and the wrong one wins. That happened
 * for real (08 C14): one employer produced two signatures, the matcher preferred
 * whichever was used last, and there was no way to say which was meant. This is
 * that way, and it is deliberately a *select* rather than a list of buttons — it
 * is the same interaction as binding a mapping to an account, picking one of a
 * handful of named things.
 *
 * Nothing here writes. Choosing re-reads the text that is already on screen, and
 * what comes back is judged by the same reconciliation as any other reading —
 * so a wrong choice is as visible as a wrong match, and costs one more click.
 */
export function FormatPicker({
  formats,
  current,
  onPick,
}: {
  formats: readonly DocumentTemplate[]
  /** The format this reading came from, if it came from one. */
  current: string | undefined
  onPick: (id: string) => void
}) {
  if (formats.length === 0) return null

  return (
    <label className="flex items-center gap-2 text-caption text-ink-tertiary">
      Read with
      <ValueChoice
        value={current ?? ''}
        choices={[
          // Only while nothing stored answered: a placeholder that can be
          // chosen back to is a choice that undoes nothing.
          ...(current === undefined ? [{ value: '', label: 'no reader' }] : []),
          ...formats.map((format) => ({ value: format.id, label: format.name })),
        ]}
        filter={formats.length > MENU_MOST}
        onChange={(id) => {
          if (id !== '') onPick(id)
        }}
        aria-label="Which reader reads this"
        className={`${SELECT} h-7 max-w-56 border-transparent bg-transparent text-caption text-ink-tertiary hover:border-hairline-strong`}
      />
    </label>
  )
}
