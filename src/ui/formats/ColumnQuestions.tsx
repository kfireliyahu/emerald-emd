import { useEffect, useState } from 'react'

import { COLUMN_TYPES, isListType, type ColumnType } from '@/domain/format/declaration.ts'
import { currencyOf } from '@/domain/format/currency.ts'
import {
  acceptsBounds,
  acceptsRatio,
  acceptsUnique,
  acceptsUnit,
  type ColumnDraft,
  type DraftProblem,
} from '@/domain/format/draft.ts'
import { DIMENSIONS, type UnitTable } from '@/domain/format/unit.ts'
import { TYPE_WORDS } from '@/domain/format/vocabulary.ts'
import { Button } from '@/ui/components/Button.tsx'
import { ChoiceField } from '@/ui/components/ChoiceField.tsx'
import { Field } from '@/ui/components/Field.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { TypeGlyph } from '@/ui/formats/TypeGlyph.tsx'
import { CurrencyField } from '@/ui/formats/TypedField.tsx'
import { formatsByPack, useKeptPacks } from '@/ui/packs.ts'

/**
 * The document's currency and the way to choose it (M29 F3, D-344): asked on a
 * money column, because that is where a currency first matters.
 */
export interface DocumentCurrency {
  readonly code: string | undefined
  readonly onChange: (code: string) => void
}

/**
 * **One column, asked as a sub-walk** — M20 T1, D-237.
 *
 * The editor drew every column as a row of eight controls, and the
 * verdict on it was *"defining a column is heavy, and full of context not
 * really needed and confusing. what is the unit? per what?"*. Both halves of
 * that are one fault: the row asked its eight questions at once, so the ones
 * this column could never use sat beside the ones it needed.
 *
 * So a column is two beats rather than a row:
 *
 * 1. **What it is called, and what it holds** — the name, and the nine types as
 *    tiles.
 * 2. **Only what that type needs** — a link's target, an enum's members, a
 *    number's unit and bounds. Nothing else exists.
 *
 * Asking the type first is what makes the second beat small, and it is where
 * most of T3 falls out for free: `acceptsUnit`, `acceptsRatio` and
 * `acceptsBounds` already knew which questions a type can use, and the row was
 * showing all the ones that survived them at once.
 *
 * **`per` waits for a unit.** It is the other half of a ratio — this column is
 * `g` per `ml` — so it is a question that does not exist until the first half
 * is answered. That is the sub-walk's own rule one level down, and it is the
 * exact pair the review named.
 */
export function ColumnQuestions({
  column,
  chosen,
  targets,
  problems,
  refusals,
  units,
  currency,
  onChange,
  onChoose,
  onRemove,
  onDerive,
  underived,
}: {
  column: ColumnDraft
  /** Whether the type has been picked yet, or the tiles are still the question. */
  chosen: boolean
  /** The formats a link may point at — every other one, and this one. */
  targets: readonly string[]
  problems: readonly DraftProblem[]
  refusals: readonly string[]
  /** The document's units, offered beside a unit and explained beside a quantity (M26 U3). */
  units?: UnitTable | undefined
  /** The document's currency, asked beside a money column (M29 F3, D-344). */
  currency?: DocumentCurrency | undefined
  onChange: (column: ColumnDraft) => void
  onChoose: (type: ColumnType) => void
  onRemove: () => void
  /**
   * Make it a derived column instead (M29 U3b, D-334) — offered beside the
   * types on a column the format does not hold yet.
   */
  onDerive?: (() => void) | undefined
  /**
   * Why it cannot be (M29 F4, D-345): the tile is still drawn, greyed with the
   * reason on it, rather than missing — nobody could work out why a
   * column already saved would not become one.
   */
  underived?: string | undefined
}) {
  const wrong = problems.length > 0 || refusals.length > 0
  // A person's own formats first, then each pack's under its name (M33 F3).
  const grouped = formatsByPack(targets, useKeptPacks(), (each) => each)
  const pointable = [
    ...grouped.own.map((each) => ({ value: each, label: each })),
    ...grouped.packs.flatMap((pack) => pack.formats.map((each) => ({ value: each, label: each, group: pack.title }))),
  ]

  return (
    <div
      className={`fc-pop-enter rounded-lg border bg-elevated p-4 ${wrong ? 'border-negative' : 'border-hairline-strong'}`}
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-label text-ink-tertiary uppercase">Name</span>
          <input
            className={`${FIELD} w-56 font-mono`}
            value={column.name}
            spellCheck={false}
            autoFocus
            data-tour="column-name"
            onChange={(event) => onChange({ ...column, name: event.target.value })}
          />
        </label>

        {chosen && (
          <span className="flex items-center gap-2 pb-1">
            <TypeGlyph type={column.type} className="h-4 w-4 shrink-0 text-ink-secondary" />
            <span className="font-mono">{column.type}</span>
            <Button size="sm" variant="ghost" onClick={() => onChoose(column.type)}>
              Change
            </Button>
          </span>
        )}

        <Button size="sm" variant="ghost" className="ml-auto" onClick={onRemove}>
          Remove
        </Button>
      </div>

      {!chosen ? (
        <div key="tiles" className="fc-view-enter mt-4">
          <p className="text-label text-ink-tertiary uppercase">Type</p>
          {/* **U3's tiles, in the flow rather than behind a popover.** The
              picker they were in existed because a row of eight controls had no
              room for a 34rem grid, and it went with the row: a step has the
              room, and a question you have to open a menu to answer is a
              question the walk did not really ask. The glyph, the word and the
              gloss are untouched — `TYPE_WORDS` is still the one vocabulary. */}
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {COLUMN_TYPES.map((each) => (
              <button
                key={each}
                type="button"
                data-tour={`type-${each}`}
                onClick={() => onChoose(each)}
                className="flex flex-col gap-1 rounded-md border border-hairline p-2 text-left transition-colors duration-[var(--duration-micro)] hover:border-hairline-strong hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              >
                <span className="flex items-center gap-2">
                  <TypeGlyph type={each} className="h-4 w-4 shrink-0 text-ink-secondary" />
                  <span className="font-mono">{each}</span>
                </span>
                <span className="text-caption text-ink-secondary">{TYPE_WORDS[each].gloss}</span>
              </button>
            ))}
            {(onDerive !== undefined || underived !== undefined) && (
              <button
                type="button"
                onClick={onDerive}
                disabled={onDerive === undefined}
                title={underived}
                className="flex flex-col gap-1 rounded-md border border-dashed border-hairline-strong p-2 text-left transition-colors duration-[var(--duration-micro)] enabled:hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              >
                <span className="flex items-center gap-2">
                  <span aria-hidden className="w-4 shrink-0 text-center font-mono text-ink-secondary">
                    =
                  </span>
                  <span className="font-mono">computed</span>
                </span>
                <span className="text-caption text-ink-secondary">
                  {onDerive === undefined && underived !== undefined
                    ? underived
                    : 'From other columns, like a formula — never typed'}
                </span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div key="details" className="fc-view-enter mt-3 flex flex-wrap items-end gap-3">
          {TYPE_WORDS[column.type].catch !== undefined && (
            <p className="w-full text-caption text-ink-tertiary">{TYPE_WORDS[column.type].catch}</p>
          )}

          {column.type === 'link' && (
            <Field label="Links to">
              {/* Blank until somebody picks: a link that defaulted to whichever
                  format was listed first would point somewhere nobody chose,
                  and every id in it would resolve. */}
              <ChoiceField
                className={`${FIELD} w-48`}
                readOnly
                filter={false}
                data-tour="points-at"
                placeholder="…"
                text={column.target}
                choices={pointable}
                onText={() => undefined}
                onPick={(choice) => onChange({ ...column, target: choice.value })}
              />
            </Field>
          )}

          {(column.type === 'enum' || column.type === 'enums') && (
            <Field label="Values" hint="Separated by commas.">
              <input
                className={`${FIELD} w-96 max-w-full`}
                value={column.values}
                dir="auto"
                onChange={(event) => onChange({ ...column, values: event.target.value })}
              />
            </Field>
          )}

          {acceptsUnit(column.type) && (
            <Field label="Unit" hint="What it is measured in, if anything.">
              <ChoiceField
                className={`${FIELD} w-24`}
                filter
                spellCheck={false}
                text={column.unit}
                choices={(units ?? []).map((unit) => ({ value: unit.symbol, label: unit.symbol }))}
                onText={(text) => onChange({ ...column, unit: text })}
                onPick={(choice) => onChange({ ...column, unit: choice.value })}
              />
            </Field>
          )}

          {column.type === 'quantity' && units !== undefined && <UnitsKnown units={units} />}

          {column.type === 'money' && currency !== undefined && <CurrencyQuestion currency={currency} />}

          {acceptsRatio(column.type) && column.unit.trim() !== '' && (
            <Field label="Per" hint="Only if it is a rate — one unit per another.">
              <input
                className={`${FIELD} w-24`}
                value={column.per}
                spellCheck={false}
                onChange={(event) => onChange({ ...column, per: event.target.value })}
              />
            </Field>
          )}

          {acceptsBounds(column.type) && (
            <>
              <Field label="Minimum">
                <input
                  className={`${FIELD} w-24 text-right tabular-nums`}
                  inputMode="decimal"
                  data-tour="column-min"
                  value={column.minimum}
                  onChange={(event) => onChange({ ...column, minimum: event.target.value })}
                />
              </Field>
              <Field label="Maximum">
                <input
                  className={`${FIELD} w-24 text-right tabular-nums`}
                  inputMode="decimal"
                  data-tour="column-max"
                  value={column.maximum}
                  onChange={(event) => onChange({ ...column, maximum: event.target.value })}
                />
              </Field>
            </>
          )}

          {column.type === 'decimal' && (
            <Field label="Places">
              <input
                className={`${FIELD} w-16 text-right tabular-nums`}
                inputMode="numeric"
                value={column.scale}
                onChange={(event) => onChange({ ...column, scale: event.target.value })}
              />
            </Field>
          )}

          {/* A list cannot be required — none is a real answer (D-300, D-398). */}
          {!isListType(column.type) && (
            <label className="flex h-8 items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={column.required}
                onChange={(event) => onChange({ ...column, required: event.target.checked })}
              />
              <span className="text-caption">Required</span>
            </label>
          )}

          {/* No longer carried-and-not-shown (D-255): the sheet is where a
              column's checks are changed now. */}
          {acceptsUnique(column.type) && (
            <label className="flex h-8 items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={column.unique}
                onChange={(event) => onChange({ ...column, unique: event.target.checked })}
              />
              <span className="text-caption">No two the same</span>
            </label>
          )}

          <Field label="Note" hint="In your words. Kept with the declaration.">
            <input
              className={`${FIELD} w-full max-w-prose`}
              value={column.note}
              dir="auto"
              onChange={(event) => onChange({ ...column, note: event.target.value })}
            />
          </Field>
        </div>
      )}

      {problems.map((problem) => (
        <p key={problem.message} className="mt-2 text-caption text-negative">
          {problem.message}
        </p>
      ))}
      {refusals.map((detail) => (
        <p key={detail} className="mt-2 text-caption text-negative">
          {detail}
        </p>
      ))}
    </div>
  )
}

/**
 * **What a quantity's unit is, said beside the column it means something for**
 * (M26 U3). The formats list had a panel of every unit the document knows, a
 * list with no column to be about (D-288 took it away). Here it answers the
 * question the type raises: each entry carries its own unit, and these are the
 * ones this document can convert between — inside a line, never across one.
 */
function UnitsKnown({ units }: { units: UnitTable }) {
  const groups = DIMENSIONS.map((dimension) => ({
    dimension,
    symbols: units.filter((unit) => unit.dimension === dimension).map((unit) => unit.symbol),
  })).filter((group) => group.symbols.length > 0)
  return (
    <div className="fc-pop-enter w-full text-caption text-ink-secondary">
      <p className="max-w-prose">
        Each entry says its own unit &mdash; 150 g on one, 2 kg on the next &mdash; and a total
        converts between units of one kind. Across kinds, ml to g, it needs a column saying how
        much one weighs.
      </p>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        {groups.map((group) => (
          <div key={group.dimension} className="contents">
            <dt className="text-ink-tertiary lowercase">{group.dimension}</dt>
            <dd className="font-mono">{group.symbols.join('  ')}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * **The document's currency, asked where it first matters** (M29 F3, D-344).
 * Each entry still says its own; this is what a new one starts in. Chosen the
 * first time a money column is made, and changed from any money column after.
 * It is the document's, never the machine's (D-115), and it is written the
 * moment it is picked: it belongs to the document, not to this column's draft.
 */
function CurrencyQuestion({ currency }: { currency: DocumentCurrency }) {
  const [text, setText] = useState(currency.code ?? '')
  useEffect(() => setText(currency.code ?? ''), [currency.code])
  const choose = (code: string): void => {
    if (/^[A-Z]{3}$/.test(code) && code !== currency.code) currency.onChange(code)
  }
  return (
    <Field
      label="Currency"
      hint={
        currency.code === undefined
          ? 'The document’s: what a new amount starts in. Each entry can still say its own.'
          : 'The document’s: what a new amount starts in. Changing it moves no amount already kept.'
      }
    >
      <CurrencyField
        className={`${FIELD} w-28 font-mono`}
        value={text}
        label="The document’s currency"
        placeholder="—"
        onChange={setText}
        // A pick is chosen at once; a code typed is chosen on Enter, or on
        // leaving when it is one the list has — so a search for `she` left
        // half-typed never becomes a currency called SHE.
        onPick={(code) => {
          setText(code)
          choose(code)
        }}
        onEnter={() => choose(text)}
        onBlur={() => {
          if (currencyOf(text) !== undefined) choose(text)
        }}
      />
    </Field>
  )
}
