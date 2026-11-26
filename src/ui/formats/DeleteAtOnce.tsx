import { useRef, useState, type ReactNode } from 'react'

import { useT } from '@/i18n/current.ts'
import { countKey } from '@/i18n/count.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { IconAction } from '@/ui/components/IconAction.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { useDismiss } from '@/ui/components/useDismiss.ts'

/** Why a delete was refused: the sentence, and what still links to it. */
export interface DeleteRefusal {
  readonly say: ReactNode
  readonly why?: string | undefined
  /** What still names it, one sentence a line (D-263). */
  readonly lines?: readonly string[] | undefined
}

/**
 * **A delete that deletes at once** (M64 U13, D-625, after D-617): pressed, the
 * row is gone and the screen says *Deleted · Undo* near where it was — no
 * question first. Only when the delete is refused (another entry still links
 * to the row, D-300) does anything open, and then it opens **at this button**:
 * the sentence naming the row and what links to it, and Close — never a bar at
 * the foot of the screen. Esc or a press outside closes it (`useDismiss`), and
 * focus goes back to the icon.
 */
export function DeleteAtOnce({
  label,
  onDelete,
  reveal = false,
}: {
  /** The icon's name, naming the row: `Delete Book Nook`. */
  readonly label: string
  /** Delete now; a refusal opens at the button instead. */
  readonly onDelete: () => DeleteRefusal | undefined
  /** Shown only on the row's hover or focus, as a table's row actions are. */
  readonly reveal?: boolean
}) {
  const t = useT()
  const [refused, setRefused] = useState<DeleteRefusal | undefined>(undefined)
  const box = useRef<HTMLSpanElement>(null)
  const close = (): void => {
    setRefused(undefined)
    box.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }
  const dismissKey = useDismiss(refused !== undefined, box, close)

  return (
    <span
      ref={box}
      className={`relative inline-flex ${
        reveal && refused === undefined
          ? 'opacity-0 transition-opacity duration-[var(--duration-micro)] group-hover:opacity-100 focus-within:opacity-100'
          : ''
      }`}
      onKeyDown={dismissKey}
    >
      <IconAction
        label={label}
        tone="negative"
        onClick={(event) => {
          event.stopPropagation()
          setRefused(onDelete())
        }}
      >
        <path d="M4 7h16" />
        <path d="M10 11v6M14 11v6" />
        <path d="M6 7l1 13h10l1-13" />
        <path d="M9 7V4h6v3" />
      </IconAction>
      {refused !== undefined && (
        <span
          role="alertdialog"
          aria-label={label}
          className="fc-pop-enter absolute end-0 top-full z-40 mt-1 flex w-80 cursor-default flex-col gap-2 border border-hairline bg-elevated p-3 text-start text-body font-normal whitespace-normal shadow-pop"
          onClick={(event) => event.stopPropagation()}
        >
          <span className="font-medium">{refused.say}</span>
          {refused.lines !== undefined && refused.lines.length > 0 && (
            <span className="flex flex-col gap-1 text-caption text-ink-secondary">
              {refused.lines.map((line) => (
                <Bidi key={line}>{line}</Bidi>
              ))}
            </span>
          )}
          {refused.why !== undefined && <span className="text-caption text-ink-secondary">{refused.why}</span>}
          <span className="mt-1 flex items-center gap-2">
            <Button autoFocus variant="secondary" size="sm" onClick={close}>
              {t('formats.deleted.close')}
            </Button>
          </span>
        </span>
      )}
    </span>
  )
}

/**
 * **What was just deleted, and its Undo** (M64 U6's line, D-618): a sentence
 * that names the row and one text action, in a line that keeps its place.
 */
export function DeletedNote({
  name,
  more = 0,
  onUndo,
}: {
  readonly name: string
  /** How many more were deleted before it, still to be put back newest first. */
  readonly more?: number
  readonly onUndo: () => void
}) {
  const t = useT()
  return (
    <span className="inline-flex items-baseline gap-3 text-caption" role="status">
      <span className="text-ink">
        <Phrase text={t('formats.deleted.said')} parts={{ name: <Bidi>{name}</Bidi> }} />
        {more > 0 && <> {t(countKey('formats.deleted.more', more), { count: more })}</>}
      </span>
      <button type="button" className="fc-text-action" onClick={onUndo} title={t('formats.deleted.undoHint')}>
        {t('formats.deleted.undo')}
      </button>
    </span>
  )
}
