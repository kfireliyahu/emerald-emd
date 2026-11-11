import { Button } from '@/ui/components/Button.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { countKey } from '@/i18n/count.ts'
import { useT, type Translate } from '@/i18n/current.ts'
import { fillNodes } from '@/i18n/nodes.tsx'
import { Bidi } from '@/ui/Bidi.tsx'

/**
 * Where a reader comes from and what it is called. On screen it is a **reader**
 * (M31 U2): the code's `mapping` is the same thing, and the one word a person
 * sees for reader / mapping / layout / template is *reader*.
 *
 * The three outcomes of matching a file against the saved mappings (f01,
 * "Matching a file to a saved mapping") are all announced here, because the one
 * thing that must never happen is a file being parsed by a mapping the user
 * cannot see. An exact match saves them the whole screen; it does not get to
 * save them from knowing about it, and it never takes away the escape hatch.
 */
export interface SavedMappingRef {
  readonly id: string
  readonly name: string
  /**
   * The account this format's files belong to, when the user has bound one
   * (`ImportMapping.accountId`, set on the mappings screen). Carried through the
   * mapper because it is how a file that names no card still finds the right one.
   */
  readonly accountId: string | undefined
}

export function MappingBar({
  saved,
  dirty,
  editing,
  changedCount,
  name,
  onNameChange,
  onEdit,
  onPropose,
  proposing,
}: {
  saved: SavedMappingRef | undefined
  /** The user has changed the mapping since it was matched or last saved. */
  dirty: boolean
  /** The grid is on screen. False only for an exact match the user has not reopened. */
  editing: boolean
  /** Columns that moved since the mapping was saved. Zero unless this was a close match. */
  changedCount: number
  name: string
  onNameChange: (name: string) => void
  onEdit: () => void
  /**
   * Ask the local model where the columns are — absent when no model is chosen,
   * which is most of the time and is not a degraded state (F17's rung 3 is the
   * mapper, and the mapper is this screen).
   */
  onPropose: (() => void) | undefined
  proposing: boolean
}) {
  const t = useT()
  if (saved !== undefined && !dirty && !editing) {
    return (
      <Bar>
        <span>{fillNodes(t('reading.reader.readBy'), { name: <Name>{saved.name}</Name> })}</span>
        <span className="text-ink-secondary">{t('reading.reader.matched')}</span>
        <Button size="sm" className="ms-auto" onClick={onEdit}>
          {t('reading.reader.mapAnyway')}
        </Button>
      </Bar>
    )
  }

  // **No save button** (M31 U2): Read it below keeps the reader, so there is one
  // filled button on this screen and a file read once is never a new layout
  // again next month. The name is still the person's to change before then.
  return (
    <Bar>
      <span>{status(t, saved, dirty, changedCount)}</span>

      <label className="ms-auto flex items-center gap-2">
        <span className="text-ink-secondary">{t('reading.reader.name')}</span>
        <input
          type="text"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder={t('reading.reader.namePlaceholder')}
          className={`${FIELD} w-64`}
        />
      </label>

      {/* Beside the name rather than in the grid: it is an answer about the
          whole sheet, and what judges it is the preview under the grid and the
          file's own printed total — the two checks the mapper already ran
          (D-013). */}
      {onPropose !== undefined && (
        <Button
          size="sm"
          onClick={onPropose}
          busy={proposing ? t('reading.reader.working') : undefined}
          title={t('reading.reader.proposeTitle')}
        >
          {t('reading.reader.propose')}
        </Button>
      )}
    </Bar>
  )
}

function status(
  t: Translate,
  saved: SavedMappingRef | undefined,
  dirty: boolean,
  changedCount: number,
): React.ReactNode {
  if (saved !== undefined && changedCount > 0 && !dirty) {
    return (
      <>
        <span className="text-negative">{t(countKey('reading.reader.changed', changedCount), { count: changedCount })}</span>{' '}
        {fillNodes(t('reading.reader.since'), { name: <Name>{saved.name}</Name> })}{' '}
        <span className="text-ink-secondary">{t('reading.reader.checkMarked')}</span>
      </>
    )
  }

  if (saved !== undefined && dirty) {
    return (
      <>
        {fillNodes(t('reading.reader.changedFrom'), { name: <Name>{saved.name}</Name> })}{' '}
        <span className="text-ink-secondary">{t('reading.reader.keepsChange')}</span>
      </>
    )
  }

  if (saved !== undefined) {
    return (
      <>
        {fillNodes(t('reading.reader.yours'), { name: <Name>{saved.name}</Name> })}{' '}
        <span className="text-ink-secondary">{t('reading.reader.skips')}</span>
      </>
    )
  }

  return (
    <span className="text-ink-secondary">{t('reading.reader.keeps')}</span>
  )
}

function Name({ children }: { children: string }) {
  // Isolated like anything else: the user is free to name a mapping in Hebrew,
  // and "כאל ויזה 4321" is precisely the digits-inside-RTL shape that visibly
  // scrambles without it.
  return <Bidi className="font-medium">{children}</Bidi>
}

function Bar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline px-6 py-2">
      {children}
    </div>
  )
}
