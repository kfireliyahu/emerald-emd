import type { DerivedType } from '@/domain/format/derived.ts'
import type { DerivedDraft, DraftProblem } from '@/domain/format/draft.ts'
import type { FormulaName } from '@/domain/format/formula.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { FormulaField } from '@/ui/formats/FormulaField.tsx'

/**
 * **A column worked out from other columns** — M29 U3b, D-334.
 *
 * Declared from a column's header in the same panel as a stored one, and asked
 * three things: what it is called, what it works out, and why. The expression
 * is the one an identity is written in, without the `=`; what it comes out as
 * — money, a figure in a unit, a number — is said back once it reads, so a
 * person sees the type they made rather than picking one that could disagree.
 *
 * **The formula names its columns** (M29 F5, D-346): `FormulaField` offers
 * them as they are typed and shows the ones it knows in `positive`.
 */
export function DerivedQuestions({
  derived,
  type,
  names,
  problems,
  onChange,
  onRemove,
}: {
  derived: DerivedDraft
  /** Every name the formula may use (`formulaNames`). */
  names: readonly FormulaName[]
  /** What it comes out as, when the expression reads. */
  type: DerivedType | undefined
  problems: readonly DraftProblem[]
  onChange: (derived: DerivedDraft) => void
  onRemove: () => void
}) {
  const wrong = problems.length > 0
  const typed = derived.expression.trim() !== ''
  return (
    <div
      className={`fc-pop-enter rounded-lg border bg-elevated p-4 ${wrong && typed ? 'border-negative' : 'border-hairline-strong'}`}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-label text-ink-tertiary uppercase">Name</span>
          <input
            className={`${FIELD} w-56 font-mono`}
            value={derived.name}
            spellCheck={false}
            autoFocus={derived.name === ''}
            onChange={(event) => onChange({ ...derived, name: event.target.value })}
          />
        </label>
        <span className="pb-1 text-ink-secondary">computed: the app works it out, nobody types it</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onRemove}>
          Remove
        </Button>
      </div>

      <label className="mt-3 flex flex-col gap-1">
        <span className="text-label text-ink-tertiary uppercase">Computed</span>
        <FormulaField
          className="max-w-xl"
          value={derived.expression}
          names={names}
          label="Computed"
          autoFocus={derived.name !== ''}
          placeholder="end - start"
          onChange={(expression) => onChange({ ...derived, expression })}
        />
        <span className="max-w-prose text-caption text-ink-tertiary">
          Other columns by name, numbers, + − × ÷ and brackets; a linked entry’s column as{' '}
          <span className="font-mono">link.column</span>, a total by its name, and{' '}
          <span className="font-mono">weight in g</span> to convert;{' '}
          <span className="font-mono">end - start</span> of two times is hours, past midnight too,
          and of two dates is days; <span className="font-mono">due - 3 days</span> or{' '}
          <span className="font-mono">start + 2 weeks</span> is a date. Empty wherever an input is. To check an hours somebody types
          instead, make it a claim under <span className="font-medium">Claims</span>.
        </span>
      </label>

      <label className="mt-3 flex flex-col gap-1">
        <span className="text-label text-ink-tertiary uppercase">Why</span>
        <input
          className={`${FIELD} w-full max-w-xl`}
          value={derived.note}
          onChange={(event) => onChange({ ...derived, note: event.target.value })}
        />
      </label>

      <div className="mt-3 space-y-1">
        {typed &&
          problems.map((each) => (
            <p key={each.message} className="text-caption text-negative">
              <Bidi>{each.message}</Bidi>
            </p>
          ))}
        {!wrong && type !== undefined && (
          <p className="text-caption text-ink-secondary" data-derived-type>
            Comes out as {typeWords(type)}.
          </p>
        )}
      </div>
    </div>
  )
}

/** `money`, `a number in g`, `a number`. */
export function typeWords(type: DerivedType): string {
  if (type.kind === 'MONEY') return 'money'
  if (type.kind === 'DATE') return 'a date'
  return type.unit === undefined ? 'a number' : `a number in ${type.unit}`
}
