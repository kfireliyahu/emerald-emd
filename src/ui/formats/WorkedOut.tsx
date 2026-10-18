import { createContext, Fragment, useContext, useState, type ReactNode } from 'react'

import {
  closenessOf,
  freehandIdentities,
  identityIsBlank,
  identityNameFor,
  newIdentity,
  problemsOfIdentity,
  withCloseness,
  type Closeness,
  type DraftProblem,
  type FormatDraft,
  type IdentityDraft,
} from '@/domain/format/draft.ts'
import { formulaPieces, type FormulaName } from '@/domain/format/formula.ts'
import { figureText } from '@/domain/format/identity.ts'
import {
  partOf,
  textOfWorkedOut,
  workedOutColumn,
  workedOutOfText,
  type Part,
  type WorkedOut,
} from '@/domain/format/workedOut.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'
import { FormulaField } from '@/ui/formats/FormulaField.tsx'

/**
 * **What has to add up, asked one column at a time** — M20 T4, D-236.
 *
 * M19 asked for an equation in a box. M20 drew it as a balance. Both were
 * driven and called counterintuitive both times, and the split
 * the second review found says why: **the balance is a good way to read a
 * verdict and a bad way to write one.** Two empty pans ask you to assemble
 * algebra. The question you actually have is about one column.
 *
 * So this asks three, from the answering column's side:
 *
 * 1. *Is `kcal` worked out from your other columns?*
 * 2. The parts, one at a time — a multiplier and a column, the multiplier at 1.
 * 3. *How close does it have to be* — exactly, an amount, or a percent.
 *
 * Nothing to assemble, no sides, and no section to find: it is a question about
 * a column, asked while somebody is thinking about that column. `workedOut.ts`
 * carries the argument and the arithmetic; this is the form over it.
 *
 * ## Three things it is careful about
 *
 * **The expression is still the only storage.** Every answer here is written
 * back through `textOfWorkedOut`, which writes through `balance.ts`, so one
 * piece of code still turns a picture into characters and a conversation still
 * writes the same line (D-232, M20's parity rule).
 *
 * **Every identity is drawn exactly once.** The questions show the ones they
 * can ask about; `freehandIdentities` is defined as everything they leave over,
 * so an identity naming a column that has since been renamed is visible rather
 * than silently carried. D-138's ninth instance was an edit form that showed
 * six fields and wrote two, and this is the shape that avoids the tenth.
 *
 * **Nothing having to add up is not a step.** It was a checkbox, then a
 * sentence with a *Nothing does* button, and the verdict on the
 * button was *"just let the user continue"* (M29 F4, D-345): a format with no
 * identity is one where nothing has to, and Create or Save is the saying.
 *
 * ## Two kinds, under two headings (M29 F5, D-346; M33 U3a)
 *
 * From M29's review: *"i dont get how i add one thats automatically
 * derived and one that has to be checked?"* — and this section asked *"is
 * `kcal` worked out from your other columns?"*, in the very words the column
 * tile uses for a column nobody types. So it opens on the two, each with a
 * line and the same time example: **worked out**, the app computes it and
 * nobody types it (D-334); **must add up**, a person types every figure and the
 * app proves they agree (an identity). `hours = end − start` is either, and
 * which one is the question. The column-by-column questions now ask whether a
 * column *has to add up*, and may name a time on either side of `end − start`
 * (D-335).
 *
 * **Since M33 U3a they are two sections, nouns** — *Claims* here, a verdict;
 * *Computed* in `AddsUp`, a value — after the one heading over both was found
 * confusing. An identity is a *claim* everywhere a person or a model meets
 * it; `identity` stays the code's word.
 */
/**
 * **A total is said as the total it is** (M29 F9). A real paycheck had a
 * part that was the sum of its work days, and the question around it asked
 * whether gross *"has to add up from the other columns"* — which a total from
 * another format is not. Each of this format's totals, by name, as the format
 * its rows come from; read wherever a part is named.
 */
const Totals = createContext<ReadonlyMap<string, string>>(new Map())

export function WhatAddsUp({
  draft,
  numbers,
  answerable,
  points,
  names,
  totals = new Map(),
  problems,
  onChange,
}: {
  draft: FormatDraft
  /** Every number a part may name: this format's, its times, one hop out, and its folds. */
  numbers: readonly string[]
  /** This format's own numeric columns — the ones the question is asked about. */
  answerable: readonly string[]
  /** The dates, times and instants among `numbers`, by name, as their type. */
  points: ReadonlyMap<string, string>
  /** Every name a written-out check may use (`formulaNames`). */
  names: readonly FormulaName[]
  /** This format's totals, by name, as the title of the format whose rows they add up. */
  totals?: ReadonlyMap<string, string> | undefined
  problems: readonly DraftProblem[]
  onChange: (draft: FormatDraft) => void
}) {
  const subject = draft.title.trim() || draft.name.trim() || 'one of these'
  // **A check being written stays where it is being written.** Typing
  // `hours = end - start` would otherwise jump, mid-word, into hours'
  // question card the moment it read as one.
  const [writing, setWriting] = useState<ReadonlySet<string>>(new Set())
  const settled = { ...draft, identities: draft.identities.filter((each) => !writing.has(each.key)) }
  const leftOver = freehandIdentities(settled, answerable)
  const freehand = draft.identities.filter((each) => writing.has(each.key) || leftOver.includes(each))
  const answering = (column: string): IdentityDraft | undefined =>
    settled.identities.find((each) => workedOutColumn(each.expression) === column)

  const setIdentity = (key: string, next: IdentityDraft): void =>
    onChange({
      ...draft,
      identities: draft.identities.map((each) => (each.key === key ? next : each)),
    })

  const removeIdentity = (key: string): void =>
    onChange({ ...draft, identities: draft.identities.filter((each) => each.key !== key) })

  const addIdentity = (identity: IdentityDraft): void =>
    onChange({ ...draft, identities: [...draft.identities, identity] })

  return (
    // **No heading of its own since T1** (D-237): whatever opens it asks the
    // question — the shape panel's heading since the walk went (D-331). A
    // section heading under the question it repeats is the prose the whole tail is being judged on.
    <Totals.Provider value={totals}>
    {/* **Claims under a heading of their own** (M33 U3a): a claim produces a
        verdict, a computed column a value, and the two shared one heading
        until the verdict that it was confusing. Computed is
        `AddsUp`'s second section. */}
    <section data-claims>
      <h2 className="mb-1 font-medium">Claims</h2>
      <div className="mb-5 flex max-w-4xl flex-wrap items-start gap-x-6 gap-y-2">
        <p className="max-w-prose text-caption text-ink-secondary">
          You type every figure, and the app proves the claim — or says which entry it fails on.{' '}
          <code className="text-ink">hours = end − start</code> — type all three; an hours that is
          off is reported, never refused.
        </p>
        <Button
          size="sm"
          data-tour="add-claim"
          onClick={() => {
            const fresh = newIdentity()
            setWriting(new Set([...writing, fresh.key]))
            addIdentity(fresh)
          }}
        >
          + A claim
        </Button>
      </div>

      {answerable.length > 0 && numbers.length >= 2 && (
        <>
          <h3 className="mb-1 text-caption font-medium">Column by column</h3>
          <ul className="space-y-2">
            {answerable.map((column) => (
              <ColumnQuestion
                key={column}
                column={column}
                subject={subject}
                numbers={numbers}
                points={points}
                identity={answering(column)}
                problems={problems}
                onStart={() => addIdentity(startWorkingOut(column, numbers, points, totals))}
                onChange={setIdentity}
                onStop={removeIdentity}
              />
            ))}
          </ul>
        </>
      )}

      {freehand.length > 0 && (
        <div className="fc-pop-enter mt-6">
          <h3 className="mb-1 text-caption font-medium">Written out</h3>
          <p className="mb-2 max-w-prose text-caption text-ink-secondary">
            Any line with an <span className="font-mono">=</span> — a span of two times, a divisor,
            a conversion, a bracket. It is read and checked exactly the same way.
          </p>
          <ul className="space-y-2">
            {freehand.map((each) => (
              <FreehandIdentity
                key={each.key}
                identity={each}
                names={names}
                problems={identityIsBlank(each) ? [] : problemsOfIdentity(problems, each.key)}
                onChange={(next) => setIdentity(each.key, next)}
                onRemove={() => removeIdentity(each.key)}
              />
            ))}
          </ul>
        </div>
      )}

      {draft.identities.length === 0 && (
        <p className="mt-4 text-caption text-ink-tertiary">
          Optional: with none, {subject} makes no claim.
        </p>
      )}
    </section>
    </Totals.Provider>
  )
}

/**
 * The first part of a new answer.
 *
 * A column has to be picked or there is no equation to store, and the answering
 * column cannot work itself out — so it is whatever number comes first that is
 * not this one. A guess, visible in a select, one click from being the right
 * one. `WhatAddsUp` only offers the question when there is one to pick.
 *
 * **A total of other rows comes first** (M33 U2): a receipt's total asked
 * whether it adds up, beside the sum of its lines, means the lines — not the
 * card charge one hop away, which the plain order offered.
 */
function startWorkingOut(
  column: string,
  numbers: readonly string[],
  points: ReadonlyMap<string, string>,
  totals: ReadonlyMap<string, string> = new Map(),
): IdentityDraft {
  // A figure if there is one; otherwise the span of the first two points of
  // one kind — `hours = end - start` — since a time alone is not a figure.
  const figure = (each: string): boolean => each !== column && !points.has(each)
  const first = numbers.find((each) => figure(each) && totals.has(each)) ?? numbers.find(figure)
  const part = first !== undefined ? partOf(first) : spanPart(numbers, points)
  return {
    ...newIdentity(),
    name: identityNameFor(column),
    expression: textOfWorkedOut({ column, parts: [part ?? partOf(numbers.find((each) => each !== column) ?? '')] }),
  }
}

/** `later - earlier` of the first two points of one kind, as declared. */
function spanPart(numbers: readonly string[], points: ReadonlyMap<string, string>): Part | undefined {
  for (const [at, earlier] of numbers.entries()) {
    const kind = points.get(earlier)
    if (kind === undefined) continue
    const later = numbers.slice(at + 1).find((each) => points.get(each) === kind)
    if (later !== undefined) return { multiplier: 1, columns: [later], less: earlier }
  }
  return undefined
}

/* ------------------------------------------------------ one column's answer */

function ColumnQuestion({
  column,
  subject,
  numbers,
  points,
  identity,
  problems,
  onStart,
  onChange,
  onStop,
}: {
  column: string
  subject: string
  numbers: readonly string[]
  points: ReadonlyMap<string, string>
  identity: IdentityDraft | undefined
  problems: readonly DraftProblem[]
  onStart: () => void
  onChange: (key: string, identity: IdentityDraft) => void
  onStop: (key: string) => void
}) {
  const worked = identity === undefined ? undefined : workedOutOfText(identity.expression)
  const totals = useContext(Totals)
  // The totals this answer names, each as the rows it adds up.
  const named = [
    ...new Set((worked?.parts ?? []).flatMap((each) => [...each.columns, each.less ?? ''])),
  ].filter((each) => totals.has(each))
  const from = totals.size === 0 ? 'from the other columns' : 'from the other columns, or a total'

  const write = (next: WorkedOut): void => {
    if (identity === undefined) return
    // The last part going means the answer is no. Half an equation is not
    // something an identity can hold, and leaving one behind would be a row
    // nothing on the screen could explain.
    if (next.parts.length === 0) {
      onStop(identity.key)
      return
    }
    onChange(identity.key, { ...identity, expression: textOfWorkedOut(next) })
  }

  return (
    <li
      className={`rounded-lg border bg-elevated p-3 ${
        identity !== undefined && problemsOfIdentity(problems, identity.key).length > 0
          ? 'border-negative'
          : 'border-hairline-strong'
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <code className="text-ink">{column}</code>
        <span className="text-caption text-ink-secondary">adds up {from}?</span>
        <span className="ml-auto">
          <YesNo
            label={`Claim that ${column} adds up ${from} of ${subject}?`}
            tour={`claim-${column}`}
            yes={worked !== undefined}
            onYes={onStart}
            onNo={() => identity !== undefined && onStop(identity.key)}
          />
        </span>
      </div>

      {identity !== undefined && worked !== undefined && (
        <div className="fc-pop-enter mt-3 space-y-2 border-t border-hairline pt-3">
          <Parts
            worked={worked}
            numbers={numbers.filter((each) => each !== column)}
            points={points}
            onChange={write}
          />

          {named.map((each) => (
            <p key={each} className="text-caption text-ink-secondary" data-total-part={each}>
              <code className="text-ink">{each}</code> is a total of{' '}
              <Bidi>{totals.get(each) ?? ''}</Bidi> rows, added up on every read — not a column
              anybody types.
            </p>
          ))}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <HowClose identity={identity} onChange={(next) => onChange(identity.key, next)} />
            <span className="text-caption text-ink-tertiary">
              reported as <code>{identity.name}</code>
            </span>
          </div>

          {problemsOfIdentity(problems, identity.key).map((problem) => (
            <p key={problem.message} className="text-caption text-negative">
              {problem.message}
            </p>
          ))}
        </div>
      )}
    </li>
  )
}

/** The parts, one at a time, added together. */
function Parts({
  worked,
  numbers,
  points,
  onChange,
}: {
  worked: WorkedOut
  numbers: readonly string[]
  points: ReadonlyMap<string, string>
  onChange: (worked: WorkedOut) => void
}) {
  const replace = (at: number, part: Part): void =>
    onChange({ ...worked, parts: worked.parts.map((each, index) => (index === at ? part : each)) })

  // A new part starts on a number the answer does not already name, because
  // `a + a` is a guess nobody would have made on purpose.
  const named = worked.parts.flatMap((each) => [...each.columns, each.less ?? ''])
  const next =
    numbers.find((each) => !named.includes(each) && !points.has(each)) ??
    numbers.find((each) => !named.includes(each)) ??
    numbers[0] ??
    ''

  return (
    <div className="flex flex-col items-start gap-2">
      {worked.parts.map((part, at) => (
        <PartRow
          key={at}
          part={part}
          first={at === 0}
          numbers={numbers}
          points={points}
          onChange={(next) => replace(at, next)}
          onRemove={() =>
            onChange({ ...worked, parts: worked.parts.filter((_each, index) => index !== at) })
          }
        />
      ))}

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChange({ ...worked, parts: [...worked.parts, partOf(next)] })}
      >
        + another part
      </Button>
    </div>
  )
}

/**
 * One part: a multiplier and a column, and the two things it may also be.
 *
 * `× another column` is `unit_price * quantity`, and `− a column` is Atwater's
 * `4 * (carbs_g - fiber_g)`, `carbs_g` being USDA-style and including the
 * fibre. They are mutually exclusive because `m * (a * b - c)` is not
 * `m * a * b - m * c`, and arithmetic this shape cannot say belongs in the text
 * box rather than in a control that writes something else.
 */
function PartRow({
  part,
  first,
  numbers,
  points,
  onChange,
  onRemove,
}: {
  part: Part
  first: boolean
  numbers: readonly string[]
  points: ReadonlyMap<string, string>
  onChange: (part: Part) => void
  onRemove: () => void
}) {
  const single = part.columns.length === 1
  // **A time is one side of `end − start` and nothing else** (D-335): what is
  // taken off it is another point of its kind, and it is never multiplied.
  const point = single ? points.get(part.columns[0] ?? '') : undefined
  // **A different column from the ones already on this part.** Seeding either
  // control with a column the part already names writes `a - a`, which is
  // nothing at all, or `a * a`, which is a square nobody asked for — and the
  // first of those comes back as two parts rather than as the control that was
  // just pressed. `undefined` means there is nothing left to offer.
  const another = numbers.find(
    (each) =>
      !part.columns.includes(each) &&
      each !== part.less &&
      (point === undefined ? !points.has(each) : points.get(each) === point),
  )
  const setColumn = (at: number, column: string): void => {
    // `nothing` is only offered past the first column, so clearing one drops
    // that factor rather than leaving a product with a hole in it.
    if (column === '') {
      onChange({ ...part, columns: part.columns.filter((_each, index) => index !== at) })
      return
    }
    onChange({
      ...part,
      columns: part.columns.map((each, index) => (index === at ? column : each)),
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span aria-hidden className={`w-3 text-ink-tertiary ${first ? 'opacity-0' : ''}`}>
        +
      </span>

      <Multiplier
        value={part.multiplier}
        onChange={(multiplier) => onChange({ ...part, multiplier })}
      />

      {part.columns.map((column, at) => (
        <Fragment key={at}>
          <span aria-hidden className="text-ink-tertiary">
            ×
          </span>
          <ColumnSelect
            value={column}
            columns={numbers}
            label="a column"
            clearable={at > 0}
            onChange={(next) => setColumn(at, next)}
          />
        </Fragment>
      ))}

      {part.less !== undefined && (
        <>
          <span aria-hidden className="text-ink-tertiary">
            −
          </span>
          <ColumnSelect
            value={part.less}
            columns={numbers}
            label="taken off"
            clearable
            onChange={(next) => onChange({ ...part, less: next === '' ? undefined : next })}
          />
        </>
      )}

      <span className="ml-2 flex flex-wrap items-center gap-2">
        {part.less === undefined && point === undefined && another !== undefined && (
          <Small onClick={() => onChange({ ...part, columns: [...part.columns, another] })}>
            × another column
          </Small>
        )}
        {single && part.less === undefined && another !== undefined && (
          <Small onClick={() => onChange({ ...part, less: another })}>− a column</Small>
        )}
        <Small onClick={onRemove}>remove</Small>
      </span>
    </div>
  )
}

/** How close it has to come: exactly, an amount, or a percent. */
function HowClose({
  identity,
  onChange,
}: {
  identity: IdentityDraft
  onChange: (identity: IdentityDraft) => void
}) {
  const closeness = closenessOf(identity)

  return (
    <span className="flex flex-wrap items-center gap-1">
      <span className="text-caption text-ink-secondary">how close</span>
      <select
        className={`${SELECT} h-7 text-caption`}
        value={closeness}
        aria-label="how close it has to come"
        onChange={(event) => onChange(withCloseness(identity, event.target.value as Closeness))}
      >
        <option value="EXACT">exactly</option>
        <option value="AMOUNT">± an amount</option>
        <option value="PERCENT">± a percent</option>
      </select>
      {closeness !== 'EXACT' && (
        <>
          <input
            className={`${FIELD} h-7 w-16 text-center tabular-nums`}
            value={identity.amount}
            inputMode="decimal"
            aria-label="how far apart they may be"
            onChange={(event) => onChange({ ...identity, amount: event.target.value })}
          />
          {closeness === 'PERCENT' && (
            <span aria-hidden className="text-caption text-ink-tertiary">
              %
            </span>
          )}
        </>
      )}
    </span>
  )
}

/* --------------------------------------------------------- the escape hatch */

/**
 * An identity said as a line, unchanged from U4.
 *
 * A divisor with a sum in it, a conversion over a bracket, a product of two
 * sums: real identities, checked identically, and more than three questions can
 * ask. **It is not a fallback that apologises** — it is where the algebra that
 * deserves algebra is written, and it is the reason the questions above are
 * allowed to refuse so much.
 */
function FreehandIdentity({
  identity,
  names,
  problems,
  onChange,
  onRemove,
}: {
  identity: IdentityDraft
  names: readonly FormulaName[]
  problems: readonly DraftProblem[]
  onChange: (identity: IdentityDraft) => void
  onRemove: () => void
}) {
  return (
    <li
      className={`fc-pop-enter rounded-lg border bg-elevated p-3 ${
        problems.length > 0 ? 'border-negative' : 'border-hairline-strong'
      }`}
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Called">
          <input
            className={`${FIELD} w-40`}
            value={identity.name}
            onChange={(event) => onChange({ ...identity, name: event.target.value })}
            data-tour="claim-name"
            placeholder="what_adds_up"
          />
        </Field>

        <label className="flex w-[28rem] max-w-full flex-col gap-1">
          <span className="text-label uppercase text-ink-tertiary">Holds</span>
          <FormulaField
            value={identity.expression}
            names={names}
            label="Holds"
            tour="claim-holds"
            autoFocus={identityIsBlank(identity)}
            placeholder="hours = end - start"
            onChange={(expression) => {
              // Named after what it is about until somebody names it.
              const was = nameOf(identity.expression)
              const name = identity.name === '' || identity.name === was ? nameOf(expression) : identity.name
              onChange({ ...identity, expression, name })
            }}
          />
        </label>

        <HowClose identity={identity} onChange={onChange} />

        <Button variant="ghost" size="sm" className="ml-auto" onClick={onRemove}>
          Remove
        </Button>
      </div>

      <div className="mt-3">
        <Field label="Why">
          <input
            className={`${FIELD} w-[28rem] max-w-full`}
            value={identity.note}
            dir="auto"
            onChange={(event) => onChange({ ...identity, note: event.target.value })}
            placeholder="what makes this true, in your words"
          />
        </Field>
      </div>


      {problems.map((problem) => (
        <p key={problem.message} className="mt-1 text-caption text-negative">
          {problem.message}
        </p>
      ))}
    </li>
  )
}

/** `hours_adds_up` for `hours = end - start`: the first name a line uses, or nothing. */
function nameOf(expression: string): string {
  const first = formulaPieces(expression).find((each) => each.kind === 'NAME')
  return first === undefined ? '' : identityNameFor(first.text.replace('.', '_'))
}

/* -------------------------------------------------------------- the pieces */

function YesNo({
  label,
  tour,
  yes,
  onYes,
  onNo,
}: {
  label: string
  /** The demo tour's anchor (M33 U2), on Yes. */
  tour?: string | undefined
  yes: boolean
  onYes: () => void
  onNo: () => void
}) {
  const look = (on: boolean): string =>
    `h-7 px-3 text-caption transition-colors duration-[var(--duration-micro)] ` +
    `focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ` +
    (on ? 'bg-surface font-medium text-ink' : 'text-ink-tertiary hover:text-ink')

  return (
    <span
      role="group"
      aria-label={label}
      className="inline-flex overflow-hidden rounded-md border border-hairline-strong"
    >
      <button type="button" aria-pressed={!yes} className={look(!yes)} onClick={onNo}>
        No
      </button>
      <button
        type="button"
        aria-pressed={yes}
        className={`${look(yes)} border-l border-hairline-strong`}
        data-tour={tour}
        onClick={onYes}
      >
        Yes
      </button>
    </span>
  )
}

/**
 * The multiplier, being typed.
 *
 * What is shown is the prop until somebody is in the box, and what they typed
 * while they are — so `4.` and a lone `-` survive a keystroke, and removing the
 * part above this one does not leave a stale number behind. A blank or a zero
 * is not written back: a part weighed by nothing is a part that is not there,
 * and *remove* beside it is how that is said.
 */
function Multiplier({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [typing, setTyping] = useState<string | undefined>(undefined)

  return (
    <input
      className={`${FIELD} h-7 w-14 text-center tabular-nums`}
      value={typing ?? figureText(value)}
      inputMode="decimal"
      aria-label="how much of it"
      onChange={(event) => {
        setTyping(event.target.value)
        const size = Number(event.target.value)
        if (event.target.value.trim() !== '' && Number.isFinite(size) && size !== 0) onChange(size)
      }}
      onBlur={() => setTyping(undefined)}
    />
  )
}

function ColumnSelect({
  value,
  columns,
  label,
  clearable,
  onChange,
}: {
  value: string
  columns: readonly string[]
  label: string
  clearable: boolean
  onChange: (column: string) => void
}) {
  // A column the declaration has since lost still has to be shown, or the
  // select would silently re-point the identity at whatever is first.
  const offered = columns.includes(value) || value === '' ? columns : [value, ...columns]
  const totals = useContext(Totals)

  return (
    <select
      className={`${SELECT} h-7 max-w-52 font-mono text-caption`}
      value={value}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
    >
      {value === '' && <option value="">{label}…</option>}
      {clearable && value !== '' && <option value="">nothing</option>}
      {offered.map((each) => (
        <option key={each} value={each}>
          {totals.has(each) ? `${each} — total of ${totals.get(each) ?? ''}` : each}
        </option>
      ))}
    </select>
  )
}

function Small({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      className="rounded text-caption text-ink-tertiary underline-offset-2 hover:text-ink hover:underline"
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-label uppercase text-ink-tertiary">{label}</span>
      {children}
    </label>
  )
}
