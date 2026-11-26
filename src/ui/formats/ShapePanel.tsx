import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import type { ColumnType, FormatDeclaration, OrderChange } from '@/domain/format/declaration.ts'
import {
  columnIsBlank,
  identityIsBlank,
  problemsOfColumn,
  type ColumnDraft,
  type DraftProblem,
  type FormatDraft,
} from '@/domain/format/draft.ts'
import { planIsSettled, type ReconcilePlan } from '@/domain/format/reconcile.ts'
import type { UnitTable } from '@/domain/format/unit.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { ColumnQuestions, type DocumentCurrency } from '@/ui/formats/ColumnQuestions.tsx'
import { AddsUp } from '@/ui/formats/AddsUp.tsx'
import { addDerived, chooseType, deriveInstead, type Shape, type ShapeFocus } from '@/ui/formats/shape.ts'
import { DerivedQuestions } from '@/ui/formats/DerivedQuestions.tsx'
import { compileDerived } from '@/domain/format/derived.ts'
import { formulaNames } from '@/domain/format/formula.ts'
import { declarationOf, type DerivedDraft } from '@/domain/format/draft.ts'
import { CONNECTIONS_PATH } from '@/ui/nav.ts'
import { useT } from '@/i18n/current.ts'
import { countKey, type CountKey } from '@/i18n/count.ts'
import { Phrase } from '@/ui/components/Phrase.tsx'

export type { ShapeFocus } from '@/ui/formats/shape.ts'

/**
 * **A format changed where its entries are** — M26 U3.
 *
 * Asked of the declaration panel: *"the declaration is what? what does it
 * do, why is it all over the place and why do we need it?"* — and then, on the
 * separate Edit screen the brief planned: *"won't the user edit directly on the
 * sheet? … perhaps no need for a separate edit."* So there is neither. A
 * column's header opens this beside the sheet on that column (M64 U13; a new format's editor still has it under); the `+` after
 * the last header opens it on a new one; the *Claims* band opens it on the claims (M29 U1, M33 U3a).
 *
 * **It writes nothing until Save, and says first what Save would do to the
 * entries already there** (D-140): the reconciler's plan, in sentences that
 * count them, and its refusals in its own words. A rename keeps every value —
 * it reaches the reconciler as a rename, asked for, rather than as a column
 * dropped beside a new one (`renamesOf`). `accent` marks the actions and no
 * figure (D-125).
 *
 * **And it is where a format is made, since M29 U1** (D-331). The walk and the
 * blank sheet went: a new format is this panel under an empty sheet, with the
 * same questions in the same places, and Save is *Create the format*. What a
 * new format still waits on is said in ordinary ink rather than in `negative`
 * (`creationOf`), because nobody has caused it yet.
 */
export function ShapePanel({
  draft,
  focus,
  origin,
  others,
  units,
  currency,
  entries,
  problems,
  plan,
  changed,
  followed,
  order,
  creating,
  onShape,
  onSave,
  onCancel,
  onCopy,
  docked,
}: {
  draft: FormatDraft
  focus: ShapeFocus
  /** Each column's name when the panel opened, by key. */
  origin: ReadonlyMap<string, string>
  /** Every other format — what a link may point at, and what an identity may reach. */
  others: readonly FormatDeclaration[]
  units: UnitTable
  /** The document's currency, asked beside a money column (M29 F3, D-344). */
  currency?: DocumentCurrency | undefined
  /** How many entries the format holds now. */
  entries: number
  problems: readonly DraftProblem[]
  plan: ReconcilePlan | undefined
  /** Whether the declaration differs from the one the document holds. */
  changed: boolean
  /** The identities a rename rewrote to use the new name. */
  followed: readonly string[]
  /** What the change does to the columns' order, and to what the entries are called by (D-332). */
  order?: OrderChange | undefined
  /**
   * Set while the format does not exist yet (M29 U1): what Create still waits
   * on. Save becomes Create, and Cancel leaves the format unmade.
   */
  creating?: { readonly waiting: readonly string[] } | undefined
  /** The draft and the focus, always handed back together (M26 F3). */
  onShape: (shape: Shape) => void
  onSave: () => void
  onCancel: () => void
  /** Copy the declaration as a `.format.md`, for a diff or a conversation. */
  onCopy?: (() => void) | undefined
  /**
   * Drawn inside the `SidePanel` beside a format's rows (M64 U13, D-625), which
   * is its frame — no band of its own at the foot of the screen. A new format's
   * editor still draws it under its sheet.
   */
  docked?: boolean | undefined
}) {
  const t = useT()
  const column =
    focus.kind === 'COLUMN' ? draft.columns.find((each) => each.key === focus.key) : undefined
  const removed = focus.kind === 'COLUMN' && column === undefined ? origin.get(focus.key) : undefined
  const derived =
    focus.kind === 'DERIVED' ? draft.derived?.find((each) => each.key === focus.key) : undefined
  // A column's own problems are drawn on its card, and an identity's on its
  // own while the panel is on them and something is typed in it (M29 F5);
  // everything else is here.
  const drawnOnCard = new Set(
    focus.kind === 'ADDS_UP' ? draft.identities.filter((each) => !identityIsBlank(each)).map((each) => each.key) : [],
  )
  const elsewhere = problems.filter(
    (each) =>
      !(column !== undefined && each.where.kind === 'COLUMN' && each.where.key === column.key) &&
      !(derived !== undefined && each.where.kind === 'DERIVED' && each.where.key === derived.key) &&
      !(each.where.kind === 'IDENTITY' && drawnOnCard.has(each.where.key)),
  )
  // What a derived column comes out as, said back once it reads (D-334).
  const derivedType =
    derived === undefined
      ? undefined
      : compileDerived(declarationOf(draft), others, units).compiled.find(
          (each) => each.declaration.name === derived.name.trim(),
        )?.type
  const setDerived = (next: DerivedDraft): void =>
    onShape({
      draft: { ...draft, derived: (draft.derived ?? []).map((each) => (each.key === next.key ? next : each)) },
      focus,
    })
  const blank = column !== undefined && columnIsBlank(column)
  // A new format declares its draft without the blank columns, so one still
  // empty under the cursor does not hold Create back the way it holds Save.
  const waiting = creating?.waiting ?? []
  const disabled =
    creating === undefined
      ? blank || problems.length > 0 || plan === undefined || plan.refusals.length > 0 || !changed
      : waiting.length > 0 || problems.length > 0 || plan === undefined || plan.refusals.length > 0

  const set = (next: ColumnDraft): void =>
    onShape({
      draft: { ...draft, columns: draft.columns.map((each) => (each.key === next.key ? next : each)) },
      focus,
    })

  return (
    <div
      className={docked === true ? '' : 'max-h-[60vh] shrink-0 overflow-auto border-t border-hairline bg-elevated px-6 py-4'}
      onKeyDown={(event) => {
        // Not while making one: Escape would throw the whole format away.
        if (event.key === 'Escape' && creating === undefined) {
          event.stopPropagation()
          onCancel()
        }
      }}
    >
      {column !== undefined && focus.kind === 'COLUMN' && (
        <ColumnQuestions
          key={column.key}
          column={column}
          chosen={focus.chosen}
          targets={[...others.map((each) => each.name), draft.name]}
          problems={blank ? [] : problemsOfColumn(problems, column.key)}
          refusals={[]}
          units={units}
          currency={currency}
          onChange={set}
          onChoose={(type: ColumnType) => onShape(chooseType({ draft, focus }, type))}
          onRemove={() =>
            onShape({
              draft: { ...draft, columns: draft.columns.filter((each) => each.key !== column.key) },
              focus,
            })
          }
          onDerive={origin.has(column.key) ? undefined : () => onShape(deriveInstead({ draft, focus }, origin))}
          // Why a saved column's tiles grey out *worked out* (M29 F4, D-345).
          underived={origin.has(column.key) ? t('formats.shape.underived') : undefined}
        />
      )}

      {derived !== undefined && (
        <DerivedQuestions
          key={derived.key}
          derived={derived}
          type={derivedType}
          names={formulaNames(draft, others)}
          problems={problems.filter((each) => each.where.kind === 'DERIVED' && each.where.key === derived.key)}
          onChange={setDerived}
          onRemove={() =>
            onShape({
              draft: { ...draft, derived: (draft.derived ?? []).filter((each) => each.key !== derived.key) },
              focus,
            })
          }
        />
      )}

      {focus.kind === 'DERIVED' && derived === undefined && (
        <p className="text-body">{t('formats.shape.derivedGoes')}</p>
      )}

      {removed !== undefined && (
        <p className="text-body">
          <Phrase
            text={t('formats.shape.columnGoes')}
            parts={{
              name: (
                <Bidi>
                  <span className="font-mono">{removed}</span>
                </Bidi>
              ),
            }}
          />
        </p>
      )}

      {focus.kind === 'ORDER' && (
        <div className="fc-pop-enter">
          <h2 className="mb-1 font-medium">{t('formats.shape.orderTitle')}</h2>
          <p className="max-w-prose text-caption text-ink-tertiary">{t('formats.shape.orderHow')}</p>
        </div>
      )}

      {focus.kind === 'ADDS_UP' && (
        <div className="fc-pop-enter">
          {/* Claims and Computed head their own sections (M33 U3a). */}
          <AddsUp
            draft={draft}
            others={others}
            problems={problems}
            onChange={(next) => onShape({ draft: next, focus })}
            onAddDerived={() => onShape(addDerived(draft))}
          />
          <p className="mt-3 max-w-prose text-caption text-ink-tertiary">
            <Phrase
              text={t('formats.shape.linkHow')}
              parts={{
                plus: <span className="font-mono">+</span>,
                // The type's own name, as its tile says it.
                link: (
                  <Bidi>
                    <code className="font-mono">link</code>
                  </Bidi>
                ),
                connections: (
                  <Link to={CONNECTIONS_PATH} className="text-accent">
                    {t('rail.connections')}
                  </Link>
                ),
              }}
            />
          </p>
        </div>
      )}

      <div className="mt-4 space-y-1">
        {elsewhere.map((each) => (
          <p key={each.message} className="text-caption text-negative">
            <Bidi>{each.message}</Bidi>
          </p>
        ))}
        {plan?.refusals.map((each) => (
          <p key={`${each.reason}-${each.column}`} className="text-caption text-negative">
            {each.detail}
          </p>
        ))}
        {creating === undefined && changed && plan !== undefined && plan.refusals.length === 0 && (
          <PlanSentences
            plan={plan}
            entries={entries}
            identities={focus.kind === 'ADDS_UP'}
            derived={focus.kind === 'DERIVED'}
            moved={order?.moved === true}
          />
        )}
        {order?.naming !== undefined && <NamingSentence naming={order.naming} creating={creating !== undefined} />}
        {followed.length > 0 && (
          <p className="text-caption text-ink-secondary">
            <Phrase
              text={t(countKey('formats.shape.followed', followed.length))}
              parts={{ names: <Bidi>{followed.join(', ')}</Bidi> }}
            />
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={disabled}
          data-tour={creating === undefined ? 'save-shape' : 'create-format'}
          onClick={onSave}
        >
          {creating === undefined ? t('formats.shape.save') : t('formats.shape.create')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('formats.shape.cancel')}
        </Button>
        <span className="text-caption text-ink-tertiary">
          {waiting.length > 0 ? (
            <Phrase text={t('formats.shape.stillToSay')} parts={{ things: <Bidi>{waiting.join(', ')}</Bidi> }} />
          ) : creating === undefined ? (
            t('formats.shape.untilSave')
          ) : (
            t('formats.shape.untilCreate')
          )}
        </span>
        {onCopy !== undefined && (
          <span className="ms-auto">
            <Button
              variant="ghost"
              size="sm"
              disabled={problems.length > 0 || waiting.length > 0}
              onClick={onCopy}
            >
              {t('formats.shape.copy')}
            </Button>
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * The plan, as what happens to the entries already there.
 *
 * Said in the count somebody minds (D-140) — *the 12 entries keep their
 * values* — rather than as the SQL the reconciler will run, which is what the
 * declaration panel this replaces used to print.
 */
function PlanSentences({
  plan,
  entries,
  identities,
  derived,
  moved,
}: {
  plan: ReconcilePlan
  entries: number
  identities: boolean
  /** Whether the change is to a computed column, which the table does not hold. */
  derived: boolean
  /** Whether the columns are in a new order (D-332). */
  moved: boolean
}) {
  const t = useT()
  const order = moved ? <p className="text-caption text-ink-secondary">{t('formats.shape.plan.moved')}</p> : null
  if (planIsSettled(plan)) {
    return (
      order ?? (
        <p className="text-caption text-ink-secondary">
          {identities
            ? t('formats.shape.plan.claimsSettled')
            : derived
              ? t('formats.shape.plan.derivedSettled')
              : t('formats.shape.plan.describedSettled')}
        </p>
      )
    )
  }
  const rebuilt = new Set(
    plan.steps
      .filter((step) => step.kind === 'ADD_COLUMN')
      .map((step) => step.column)
      .filter((name) => plan.steps.some((step) => step.kind === 'DROP_COLUMN' && step.column === name)),
  )
  const lines = plan.steps.flatMap((step, at): { readonly key: string; readonly line: ReactNode }[] => {
    const said = (text: string, from?: string): { readonly key: string; readonly line: ReactNode }[] => [
      {
        key: `${step.kind}-${String(at)}`,
        line: (
          <Phrase
            text={text}
            parts={{ column: <Bidi>{step.column}</Bidi>, ...(from === undefined ? {} : { from: <Bidi>{from}</Bidi> }) }}
          />
        ),
      },
    ]
    const kept = (key: CountKey): string => t(countKey(key, entries), { count: entries })
    switch (step.kind) {
      case 'RENAME_COLUMN':
        return said(entries === 0 ? t('formats.shape.plan.renamedEmpty') : kept('formats.shape.plan.renamed'), step.from)
      case 'ADD_COLUMN':
        if (rebuilt.has(step.column)) return said(t('formats.shape.plan.rebuilt'))
        return said(entries === 0 ? t('formats.shape.plan.addedEmpty') : kept('formats.shape.plan.added'))
      case 'DROP_COLUMN':
        return rebuilt.has(step.column) ? [] : said(t('formats.shape.plan.dropped'))
      case 'LOOSEN_COLUMN':
        return said(kept('formats.shape.plan.loosened'))
      case 'REBUILD_TABLE':
        return said(kept('formats.shape.plan.listChanged'))
      case 'ADD_INDEX':
        return said(t('formats.shape.plan.unique'))
      case 'DROP_INDEX':
        return said(t('formats.shape.plan.repeats'))
      // A constraint taken down and put back around a rebuild is held throughout (M48 U1).
      case 'ADD_CHECK':
        return step.kept === true ? [] : said(t('formats.shape.plan.held'))
      case 'DROP_CHECK':
        return step.kept === true ? [] : said(t('formats.shape.plan.notHeld'))
      case 'CREATE_TABLE':
        return []
    }
  })
  return (
    <>
      {order}
      {lines.map(({ key, line }) => (
        <p key={key} className="text-caption text-ink-secondary">
          {line}
        </p>
      ))}
    </>
  )
}

/**
 * **What the entries are called by, when a change moves it** (M29 U2, D-332).
 * The first `text` column names a format's entries wherever they are read
 * back — a link, a picker, a row's heading in a text document — so moving one
 * ahead of it, or retyping it, renames them all. Said in ordinary ink: it is
 * not wrong, and it is the kind of thing a person wants to know first.
 */
function NamingSentence({
  naming,
  creating,
}: {
  naming: NonNullable<OrderChange['naming']>
  creating: boolean
}) {
  const t = useT()
  if (creating) return null
  const { was, now } = naming
  const mono = (name: string | undefined): ReactNode => (
    <Bidi>
      <span className="font-mono">{name}</span>
    </Bidi>
  )
  return (
    <p className="text-caption text-ink-secondary">
      <Phrase
        text={t(
          now === undefined
            ? 'formats.shape.naming.lost'
            : was === undefined
              ? 'formats.shape.naming.first'
              : 'formats.shape.naming.moved',
        )}
        parts={{ was: mono(was), now: mono(now) }}
      />
    </p>
  )
}
