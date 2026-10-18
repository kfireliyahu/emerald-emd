import { useMemo, useState } from 'react'

import { instantDay } from '@/core/instant.ts'
import { pairsThatReadAlike } from '@/data/importer/labelTemplate.ts'
import { listDeductionTypes } from '@/data/repositories/deductionTypeRepository.ts'
import {
  deleteTemplate,
  listTemplates,
  renameTemplate,
} from '@/data/repositories/documentTemplateRepository.ts'
import { deductionsOf, type DocumentTemplate } from '@/domain/model/templates.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Chip } from '@/ui/components/Chip.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'

/**
 * The formats stored in this document — F17's templates, in the word the confirm
 * surfaces already use for them. Payslips and fund reports in one list, because
 * they are one artifact with one set of operations and a person who has a wrong
 * format wants the list, not the list for its kind.
 *
 * **It exists because there was nowhere to see them** (08 C14). Four real months
 * read in a row produced a bad format saved beside a good one, and slips then
 * seemed to be read by “a random one of the same keywords”. Every part of that
 * is a decision working as written — the matcher prefers what was used last, one
 * employer can produce two signatures because an OCR-read slip carries slightly
 * different labels from a natively read one (D-146, D-147), and a template is
 * stored whenever the slip reconciled (D-139), so a wrong-but-reconciling format
 * is kept and looks exactly like a good one. What was missing was a list.
 *
 * So this is the mappings screen's argument for the other half of F17, and it
 * holds the same lines. **Nothing is created here**: a format is taught by
 * reading a slip, because a set of anchors means nothing away from a document
 * carrying those labels. **Nothing is confirmed here either** — the gate
 * `readableTemplates` keeps is a person agreeing to anchors they watched read a
 * slip, and a checkbox on a list is not that.
 *
 * **Delete is the wide door.** A format holds a convenience, not history: the
 * paychecks it read are rows of their own and keep every figure. Deleting one
 * costs the next slip of that layout a trip through the model, or through the
 * form — which is what the first one cost.
 *
 * **One list again since M36 U10**: M28 split them by kind, a tab of Paychecks
 * and a menu entry of Funds beside the statement readers' tab of Transactions;
 * `Readers` draws all three kinds under one count, beside Home's Read files,
 * which reads all three.
 */
export function DocumentReaders() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)

  const [editing, setEditing] = useState<string | undefined>()
  const [deleting, setDeleting] = useState<DocumentTemplate | undefined>()

  const data = useMemo(() => {
    if (db === undefined) return undefined
    // Every current one, of every kind, confirmed or not: `readableTemplates` is
    // the ladder's gate, and a proposal nobody agreed to is still a row taking up
    // space in the document, which is precisely what a list is for.
    const templates = listTemplates(db)
    return {
      templates,
      types: listDeductionTypes(db).length,
      alike: alikeNames(templates),
    }
  }, [db, revision])

  if (data === undefined || data.templates.length === 0) return null

  return (
    <>
      <ul>
        {data.templates.map((template) => (
          <Row
            key={template.id}
            template={template}
            typeCount={data.types}
            alike={data.alike.get(template.id) ?? []}
            isEditing={editing === template.id}
            onEdit={() => setEditing(template.id)}
            onRename={(name) => {
              setEditing(undefined)
              if (name !== '' && name !== template.name) {
                mutate((database) => renameTemplate(database, template.id, name, Date.now()))
              }
            }}
            onDelete={() => setDeleting(template)}
          />
        ))}
      </ul>

      {deleting !== undefined && (
        <DeletePanel
          template={deleting}
          onCancel={() => setDeleting(undefined)}
          onDelete={() => {
            const id = deleting.id
            setDeleting(undefined)
            mutate((database) => deleteTemplate(database, id, Date.now()))
          }}
        />
      )}
    </>
  )
}

function Row({
  template,
  typeCount,
  alike,
  isEditing,
  onEdit,
  onRename,
  onDelete,
}: {
  template: DocumentTemplate
  typeCount: number
  alike: readonly string[]
  isEditing: boolean
  onEdit: () => void
  onRename: (name: string) => void
  onDelete: () => void
}) {
  return (
    <li className="group border-b border-hairline px-6 py-3 transition-colors duration-[var(--duration-micro)] hover:bg-surface">
      <div className="flex items-center gap-x-3">
        {isEditing ? (
          <input
            autoFocus
            defaultValue={template.name}
            aria-label={`Rename ${template.name}`}
            onFocus={(event) => event.target.select()}
            onBlur={(event) => onRename(event.target.value.trim())}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') onRename(template.name)
            }}
            // An employer's name is as likely to be Hebrew as English.
            dir="auto"
            className={`${FIELD} h-7 w-72`}
          />
        ) : (
          <button type="button" onClick={onEdit} title="Rename" className="hover:underline">
            <Bidi className="font-medium">{template.name}</Bidi>
          </button>
        )}

        {/* The one thing on this screen worth acting on, and so the one thing
            wearing a colour: two formats competing for the same slips is what
            made reading four months in a row feel arbitrary. */}
        {alike.length > 0 && (
          <Chip problem>reads like {alike.length === 1 ? alike[0] : `${alike.length} others`}</Chip>
        )}
        <Chip>{template.kind === 'PAYSLIP' ? 'paycheck' : 'fund report'}</Chip>
        {template.confirmedAt === undefined && <Chip>a proposal — never agreed to</Chip>}
        {template.version > 1 && <Chip>version {template.version}</Chip>}

        {/* Quiet until the row is hovered or something in it has focus, and kept
            in the DOM so keyboard focus still reaches it. */}
        <span className="ml-auto flex items-center gap-x-3 text-caption text-ink-secondary opacity-0 transition-opacity duration-[var(--duration-micro)] group-hover:opacity-100 focus-within:opacity-100">
          <button type="button" onClick={onDelete} className="hover:text-negative">
            Delete
          </button>
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-caption">
        <FieldSummary template={template} />
        <span className="ml-auto whitespace-nowrap text-ink-tertiary tabular-nums">
          {usage(template)}
        </span>
      </div>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-caption text-ink-tertiary">
        <span>{provenance(template)}</span>
        {template.kind === 'PAYSLIP' && <span>{deductionRows(template, typeCount)}</span>}
      </div>
    </li>
  )
}

/**
 * The English name of each single field, in the order the document prints them.
 *
 * Both shapes in one map: the field names do not collide, the order within each
 * shape is what matters, and a row only ever holds one shape's fields.
 */
const FIELD_LABEL: Readonly<Record<string, string>> = {
  salaryMonthLine: 'salary month',
  payDateLine: 'pay date',
  grossLine: 'gross',
  employeeDeductionsTotalLine: 'deductions total',
  netLine: 'net',
  asOfDateLine: 'as of',
  closingBalanceLine: 'balance',
  openingBalanceLine: 'opening balance',
  depositsLine: 'paid in',
  yieldLine: 'earned',
  feesLine: 'fees',
  employeeComponentLine: 'your contributions',
  employerComponentLine: 'employer contributions',
  severanceComponentLine: 'severance',
}

const FIELD_ORDER = Object.keys(FIELD_LABEL)

/**
 * What this format reads, in the slip's own words.
 *
 * The label on each anchor is the text the document carries, which is the whole
 * of what a template stores about where a field is (D-139) — so the summary
 * shows it rather than a line number, and a person who knows their slip can see
 * at a glance that `gross` is anchored to the wrong Hebrew phrase. A field no
 * deriver found is simply absent, which is the honest rendering of a format that
 * does not read it.
 */
function FieldSummary({ template }: { template: DocumentTemplate }) {
  const anchors = [...template.anchors.fields].sort((a, b) => order(a.field) - order(b.field))
  const pinned = new Set(template.pinnedFields)

  if (anchors.length === 0) {
    return <span className="text-ink-tertiary">reads no single figure — deduction rows only</span>
  }

  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {anchors.map((anchor, index) => (
        <span key={anchor.field} className="whitespace-nowrap">
          {index > 0 && <span className="mr-2 text-ink-tertiary/60">·</span>}
          <Bidi className="text-ink-secondary">{anchor.label}</Bidi>{' '}
          <span className="text-ink-tertiary">
            {FIELD_LABEL[anchor.field] ?? anchor.field}
            {/* A field the user moved by hand, which no re-derivation moves back
                (`carryPinnedFields`). Worth seeing on the row that keeps it. */}
            {pinned.has(anchor.field) && <span className="text-ink-tertiary/60"> · yours</span>}
          </span>
        </span>
      ))}
    </span>
  )
}

function order(field: string): number {
  const at = FIELD_ORDER.indexOf(field)
  return at === -1 ? FIELD_ORDER.length : at
}

/** How many deduction rows it finds, and how many of them it can already name. */
function deductionRows(template: DocumentTemplate, typeCount: number): string {
  const all = deductionsOf(template.anchors)
  if (all.length === 0) return 'no deduction rows'

  const named = all.filter((row) => row.deductionTypeId !== undefined).length
  const count = all.length === 1 ? '1 deduction row' : `${all.length} deduction rows`
  if (named === all.length) return `${count}, all named`
  if (named === 0) {
    // Not a defect: no deriver ever names a row (D-132), and a name is kept the
    // first time somebody answers (D-145). Saying how many rows are still asked
    // about every month is what makes that legible.
    return typeCount === 0
      ? `${count}, none named yet`
      : `${count}, none named yet — asked again on every paycheck until you name them`
  }
  return `${count}, ${named} named`
}

/** Where the anchors came from. Provenance, in the words F17 uses. */
function provenance(template: DocumentTemplate): string {
  switch (template.derivedBy) {
    case 'LOCAL_MODEL':
      return 'worked out by the local model'
    case 'PLUGIN':
      return 'worked out through the Claude plugin'
    case 'SEED':
      return 'shipped with the app'
    case 'MANUAL':
      return 'chosen by you'
  }
}

/** When it last did any work, and how much. Never used is worth saying out loud. */
function usage(template: DocumentTemplate): string {
  if (template.lastUsedAt === undefined) return 'never used'
  const times = template.useCount === 1 ? 'once' : `${template.useCount} times`
  return `read ${times} · last ${instantDay(template.lastUsedAt)}`
}

/**
 * Deleting a format is safe, and the panel says what it costs rather than
 * warning. A template is a convenience; the paychecks it read are rows of their
 * own and not one of their figures is stored here.
 */
function DeletePanel({
  template,
  onCancel,
  onDelete,
}: {
  template: DocumentTemplate
  onCancel: () => void
  onDelete: () => void
}) {
  return (
    <div className="fc-pop-enter shrink-0 border-t border-hairline bg-surface px-6 py-4">
      {template.kind === 'PAYSLIP' ? (
        <>
          <p>
            Forget <Bidi className="font-medium">{template.name}</Bidi>. The next paycheck like it
            is worked out again — by the local model if one is switched on, and otherwise typed into the
            paycheck form, exactly as the first one was.
          </p>
          <p className="mt-1 text-ink-secondary">
            Nothing already recorded changes: the paychecks this reader read keep their gross, net and
            every deduction line.
            {template.useCount > 0 &&
              ` It read ${template.useCount === 1 ? '1 paycheck' : `${template.useCount} paychecks`}.`}
          </p>
        </>
      ) : (
        <>
          <p>
            Forget <Bidi className="font-medium">{template.name}</Bidi>. The next report like it is
            worked out again, exactly as the first one was.
          </p>
          <p className="mt-1 text-ink-secondary">
            Nothing already recorded changes: the readings this reader made keep every figure.
          </p>
        </>
      )}

      <div className="mt-3 flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={onDelete}>
          Delete reader
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * For each template, the names of the ones close enough to compete with it for
 * the same slips.
 *
 * The relation is the matcher's own (`pairsThatReadAlike`), so a row says “reads
 * like” exactly when a document could plausibly match either — which is the case
 * 08 C14 reported and the case where the fix is to delete one of them.
 *
 * **Two formats the user has given the same name are not that case**, and they
 * are the ordinary end of the correction this milestone added: one employer whose
 * OCR-read slip signs differently from its natively read one ends up with two
 * rows, both named after the employer and both reading a slip the same way
 * (D-148). Flagging those in red would be warning somebody about the thing they
 * just fixed.
 */
function alikeNames(templates: readonly DocumentTemplate[]): ReadonlyMap<string, readonly string[]> {
  const names = new Map<string, string[]>()
  for (const [one, other] of pairsThatReadAlike(templates)) {
    // Two kinds never compete for one document, whatever their labels say.
    if (one.kind !== other.kind) continue
    if (one.name === other.name) continue
    names.set(one.id, [...(names.get(one.id) ?? []), other.name])
    names.set(other.id, [...(names.get(other.id) ?? []), one.name])
  }
  return names
}
