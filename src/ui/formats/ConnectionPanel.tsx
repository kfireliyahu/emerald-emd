import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { capitalize } from '@/core/text.ts'
import { countKey } from '@/i18n/count.ts'
import { useDates, useT, type Translate } from '@/i18n/current.ts'
import type { DateWords } from '@/i18n/dates.ts'
import { isOrdered, type AggregateKind, type AggregateSource } from '@/domain/format/aggregate.ts'
import {
  edgeHeadlineSaid,
  foldNames,
  foldType,
  foldsOver,
  freeColumnName,
  headlineSaid,
  nounOf,
  pluralOf,
  suggestedFigureName,
  titleIn,
  type Answers,
  type Edge,
  type Proposal,
} from '@/domain/format/connections.ts'
import { ORDER_TYPES, type FormatDeclaration } from '@/domain/format/declaration.ts'
import {
  draftOf,
  newAggregate,
  newColumn,
  retype,
  type FormatDraft,
} from '@/domain/format/draft.ts'
import { parseYearMonth } from '@/core/time.ts'
import { matchedOn, type FindPlan, type FoundBy, type FoundGrain, type Unplaced } from '@/domain/format/foundBy.ts'
import type { Refusal, ReconcilePlan } from '@/domain/format/reconcile.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { spoken } from '@/ui/formats/spoken.ts'
import { Button } from '@/ui/components/Button.tsx'
import { IconAction } from '@/ui/components/IconAction.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { BLANK, FIELD, FIELD_MULTILINE } from '@/ui/components/fieldLook.ts'
import { FormulaField } from '@/ui/formats/FormulaField.tsx'

/**
 * **The window a connection is made in** — M20 U5 (D-233); said in plain words
 * since M29 F10 (D-352), ported from the approved mockup
 * (`docs/mockups/m29-f10/connection.html`).
 *
 * A drag says *these two are connected*; this says what the connection is, the
 * way a person would say it out loud: **each work day belongs to one paycheck**.
 * One headline, built from the answers so it always says what will be true; a
 * few short questions; the name and note folded away. It docks under the graph,
 * so the two bubbles you just joined stay on the screen while you answer.
 *
 * ## It writes declarations and nothing else
 *
 * Every answer ends up in a `ColumnDeclaration` of type `link` or in an
 * `AggregateDeclaration` — the same two things the editor and `connect_formats`
 * write. The window builds a `FormatDraft` per affected format and hands it back
 * whole, so validation is `draftProblems` and the dry run is `planFor`: the same
 * two answers the editor gets, not a second opinion (D-138).
 *
 * ## A refusal is said plainly, and kept word for word underneath
 *
 * A link is a column and a column is SQL, so a connection can be refused — a
 * retype on a column with data in it is the reconciler's most dangerous refusal
 * (D-216). The window writes a plain headline for each kind of refusal, and the
 * reconciler's own sentence stays word for word under *Exactly why*: nothing
 * here decides on its own that a change is safe.
 *
 * ## Taking one away is the same machinery
 *
 * Delete rebuilds the drafts with the column or the total left out and asks the
 * plan again. The one thing the reconciler cannot see — a total somewhere else
 * that adds up **through** this link — is `foldsOver`, and it is asked before the
 * delete is even offered, so the window never says *Paycheck doesn't change*
 * while Paycheck's total depends on the link.
 *
 * ## Matching by date fills the rows already there only when asked
 *
 * A link found by a date fills itself when a row is saved (D-350), so the work
 * days entered before the rule stay empty. Beside *Match by date* the window
 * says how many — *8 work days have no paycheck yet — Apply* — and Apply says
 * what it will do before it does it (M29 F11, D-353): how many get one, and
 * every one that cannot, with why. A link already set is never asked about.
 * Right after the rule is first saved the screen opens the window straight on
 * that question.
 */
export function ConnectionPanel({
  proposal: asked,
  existing,
  declarations,
  judge,
  onSave,
  onCancel,
  onPropose,
  findPlan,
  onApplyFound,
  offerApply = false,
}: {
  proposal: Proposal
  /** The connection this was opened from, when it already exists. */
  existing: Edge | undefined
  declarations: readonly FormatDeclaration[]
  /** The problems and the dry run, from the screen, which is where the document is. */
  judge: (drafts: readonly FormatDraft[]) => {
    readonly problems: readonly string[]
    readonly plans: readonly ReconcilePlan[]
  }
  onSave: (drafts: readonly FormatDraft[]) => void
  onCancel: () => void
  /** Open the window on another gesture — a total along this link, or a total it names. */
  onPropose?: ((proposal: Proposal, existing?: Edge) => void) | undefined
  /**
   * What filling a link's empty cells by its date would do, from the screen —
   * undefined when there is nothing it may fill (M29 F11, D-353).
   */
  findPlan?: ((format: string, column: string) => FindPlan | undefined) | undefined
  onApplyFound?: ((format: string, column: string) => void) | undefined
  /** Opened right after the link was first set to match by date: ask about the rows there first. */
  offerApply?: boolean | undefined
}) {
  const t = useT()
  const calendar = useDates()
  const index = new Map(declarations.map((each) => [each.name, each]))
  const title = titleIn(declarations)
  const [initial] = useState<Fields>(() => opening(asked, existing, declarations))
  const [fields, setFieldsNow] = useState<Fields>(initial)
  /** Something was typed or picked: until then, nothing is refused out loud. */
  const [touched, setTouched] = useState(false)
  const setFields = (next: Fields): void => {
    setFieldsNow(next)
    setTouched(true)
  }
  const [deleting, setDeleting] = useState(false)
  /** A new link, from either end (M29 F9): whether its one side adds the many up. */
  const fresh =
    (asked.kind === 'LINK' && asked.column === undefined && existing === undefined) ||
    asked.kind === 'LINK_AND_FIGURE'
  const [withTotal, setWithTotal] = useState(asked.kind === 'LINK_AND_FIGURE')
  /**
   * *has many…* dropped on a format that names nothing here (M34 U4, D-397):
   * the rows that will belong to it, through a new link — or every row of it,
   * through none. A degree's average is over every course, and no course
   * belongs to a degree.
   */
  const offersEvery = asked.kind === 'LINK_AND_FIGURE'
  const [every, setEvery] = useState(false)
  /** Asking whether to fill the rows already there (M29 F11). */
  const [confirming, setConfirming] = useState(offerApply)
  /** What the last Apply did, said once beside the rule. */
  const [applied, setApplied] = useState<FindPlan | undefined>(undefined)

  if (asked.kind === 'NOTHING') {
    return (
      <Frame key="nothing">
        <p className={HEADLINE}>{emphasised(spoken(t, asked.said), t('connections.belongsTo'))}</p>
        {asked.detailSaid !== undefined && <p className="m-0 text-caption text-ink-secondary">{spoken(t, asked.detailSaid)}</p>}
        <Actions>
          <Button variant="secondary" onClick={onCancel}>
            {t('connections.panel.ok')}
          </Button>
        </Actions>
      </Frame>
    )
  }

  const pair = endsOf(asked)
  const proposal: Proposal = offersEvery && every
    ? { kind: 'FIGURE', format: pair.one, over: { format: pair.many } }
    : fresh
    ? withTotal
      ? { kind: 'LINK_AND_FIGURE', format: pair.one, from: pair.many }
      : { kind: 'LINK', from: pair.many, to: pair.one, column: undefined, retyping: false }
    : asked
  const Many = title(pair.many)
  const One = title(pair.one)
  /** The two formats, as the catalogue's sentences name them: as text, and each in its `Bidi`. */
  const words = sideWords(Many, One)
  const sides = sideParts(Many, One)

  const drafts = buildDrafts(proposal, existing, fieldsWritten(fields, proposal, declarations), declarations, deleting)
  const { problems, plans } = judge(drafts)
  const refused = plans.flatMap((plan) => plan.refusals)
  const linking = proposal.kind === 'LINK' || proposal.kind === 'LINK_AND_FIGURE'
  const figuring = proposal.kind === 'FIGURE' || proposal.kind === 'LINK_AND_FIGURE'
  const linkColumn = proposal.kind === 'LINK' ? proposal.column : undefined
  /** The totals that add up through the link being deleted. Not the reconciler's to see. */
  const through = linkColumn === undefined ? [] : foldsOver(declarations, pair.many, linkColumn)
  const changed = existing === undefined || JSON.stringify(fields) !== JSON.stringify(initial)
  const ready = problems.length === 0 && refused.length === 0 && changed
  /**
   * The saved link's date rule over the rows already there — asked only while
   * the rule on screen is the one saved, since Apply runs what is saved.
   */
  const savedFind =
    existing?.kind === 'LINK' &&
    !existing.dangling &&
    fields.foundFrom !== '' &&
    fields.foundFrom === initial.foundFrom &&
    fields.foundIn === initial.foundIn &&
    fields.foundGrain === initial.foundGrain
      ? findPlan?.(existing.format, existing.column)
      : undefined

  /* ----------------------------------------------------------- deleting */

  if (deleting && existing !== undefined) {
    if (existing.kind === 'LINK' && through.length > 0) {
      const first = through[0]
      const names = through.map((each) => each.aggregate.name)
      return (
        <Frame key="blocked">
          <p className={HEADLINE}>
            <Phrase
              text={t(countKey('connections.panel.blocked', names.length))}
              parts={{
                names: <Bidi>{andList(t, names)}</Bidi>,
                title: <Bidi>{title(first?.format ?? pair.one)}</Bidi>,
              }}
            />
          </p>
          <p className="m-0 text-caption text-ink-secondary">{t('connections.panel.nothingDeleted')}</p>
          <Actions>
            {first !== undefined && (
              <Button
                variant="secondary"
                onClick={() =>
                  onPropose?.(
                    { kind: 'FIGURE', format: first.format, over: first.aggregate.over },
                    figureEdge(first.format, first.aggregate.name, first.aggregate.over),
                  )
                }
              >
                <Phrase text={t('connections.panel.open')} parts={{ name: <Bidi>{first.aggregate.name}</Bidi> }} />
              </Button>
            )}
            <Button variant="ghost" onClick={() => setDeleting(false)}>
              {t('connections.panel.cancel')}
            </Button>
          </Actions>
        </Frame>
      )
    }
    const dropped = refused.find((each) => each.reason === 'DROP_WITH_DATA')
    if (dropped !== undefined && existing.kind === 'LINK') {
      const count = rowsIn(dropped)
      return (
        <Frame key="refused">
          <p className={HEADLINE}>
            <Phrase
              text={t(countKey('connections.panel.cantDelete', count ?? 0))}
              parts={{ column: <Bidi>{existing.column}</Bidi>, who: <Bidi>{whoText(t, count, Many)}</Bidi> }}
            />
          </p>
          <p className="m-0 text-caption text-ink-secondary">{t('connections.panel.emptyFirst')}</p>
          <ExactlyWhy refusals={refused} />
          <Actions>
            <Button variant="ghost" onClick={() => setDeleting(false)}>
              {t('connections.panel.keepIt')}
            </Button>
          </Actions>
        </Frame>
      )
    }
    return (
      <Frame key="delete">
        <p className={HEADLINE}>
          {existing.kind === 'LINK' ? (
            t('connections.panel.deleteLink')
          ) : (
            <Phrase
              text={t('connections.panel.stopFigure')}
              parts={{ figure: <Bidi>{existing.figure}</Bidi>, title: <Bidi>{title(existing.format)}</Bidi> }}
            />
          )}
        </p>
        <p className="m-0 text-caption text-ink-secondary">
          {existing.kind === 'LINK' ? (
            <Phrase
              text={t('connections.panel.loses')}
              parts={{
                ...sides,
                column: (
                  <b className="font-medium text-ink">
                    <Bidi>{existing.column}</Bidi>
                  </b>
                ),
              }}
            />
          ) : (
            t('connections.panel.nothingLost')
          )}
        </p>
        {problems.map((problem) => (
          <p key={problem} className={BAD}>
            {problem}
          </p>
        ))}
        <ExactlyWhy refusals={refused} />
        <Actions>
          <Button
            variant="secondary"
            className="hover:text-negative"
            disabled={problems.length > 0 || refused.length > 0}
            onClick={() => onSave(drafts)}
          >
            {t('connections.panel.delete')}
          </Button>
          <Button variant="ghost" onClick={() => setDeleting(false)}>
            {t('connections.panel.keepIt')}
          </Button>
        </Actions>
      </Frame>
    )
  }

  /* -------------------------------------------- filling the rows already there */

  if (confirming && savedFind !== undefined && existing?.kind === 'LINK') {
    const placing = savedFind.placements.length
    const left = savedFind.unplaced
    const back = (): void => setConfirming(false)
    return (
      <Frame key="apply">
        <Relation many={Many} one={One} />
        <p className={HEADLINE}>
          {placing === 0 ? (
            <Phrase
              text={t(countKey('connections.panel.noneCan', savedFind.empty), { count: savedFind.empty })}
              parts={sides}
            />
          ) : (
            <Phrase
              text={t(countKey(offerApply ? 'connections.panel.getsHere' : 'connections.panel.gets', placing), {
                count: placing,
              })}
              parts={sides}
            />
          )}
        </p>
        <p className="m-0 text-caption text-ink-secondary">
          <Phrase
            text={t(savedFind.foundBy.grain === 'DAY' ? 'connections.panel.eachGetsDay' : 'connections.panel.eachGetsMonth')}
            parts={sides}
          />
        </p>
        {left.length > 0 && (
          <div className="mt-3 max-w-[62ch]">
            <p className="m-0 text-caption text-ink-secondary">
              <Phrase
                text={t(countKey('connections.panel.staysEmpty', left.length), { count: left.length })}
                parts={sides}
              />
            </p>
            <ul className="m-0 mt-1 list-disc ps-5 text-caption">
              {left.slice(0, UNPLACED_SHOWN).map((each) => (
                <li key={each.id}>
                  <Bidi>{each.name ?? (each.kind === 'NO_DATE' ? t('connections.panel.aRow', words) : each.date)}</Bidi>
                  <span className="text-ink-secondary"> — {unplacedReason(t, calendar, each, savedFind, One)}</span>
                </li>
              ))}
              {left.length > UNPLACED_SHOWN && (
                <li className="text-ink-secondary">
                  {t('connections.panel.andMore', { count: left.length - UNPLACED_SHOWN })}
                </li>
              )}
            </ul>
          </div>
        )}
        <Actions>
          {placing > 0 && (
            <Button
              variant="primary"
              onClick={() => {
                onApplyFound?.(existing.format, existing.column)
                setApplied(savedFind)
                back()
              }}
            >
              {t('connections.panel.apply')}
            </Button>
          )}
          <Button variant={placing > 0 ? 'ghost' : 'secondary'} onClick={offerApply ? onCancel : back}>
            {t(placing > 0 ? 'connections.panel.notNow' : 'connections.panel.ok')}
          </Button>
        </Actions>
      </Frame>
    )
  }

  /* ------------------------------------------- the drag the document refuses */

  // A column dragged onto a format, when it already holds figures: the drag
  // itself is what cannot happen, so the whole window says so (state 7b).
  const retyped =
    proposal.kind === 'LINK' && proposal.column !== undefined && existing === undefined
      ? refused.find(
          (each) =>
            each.column === proposal.column && (each.reason === 'TYPE_CHANGED' || each.reason === 'TARGET_CHANGED'),
        )
      : undefined
  if (retyped !== undefined && proposal.kind === 'LINK' && proposal.column !== undefined) {
    const count = rowsIn(retyped)
    const was = index.get(pair.many)?.columns.find((each) => each.name === proposal.column)?.target
    return (
      <Frame key="retype">
        <Relation many={Many} one={One} />
        <p className={HEADLINE}>
          <Phrase
            text={t(countKey(proposal.retyping ? 'connections.panel.cantBecome' : 'connections.panel.cantPoint', count ?? 0))}
            parts={{
              ...sides,
              column: <Bidi>{proposal.column}</Bidi>,
              who: <Bidi>{whoText(t, count, Many)}</Bidi>,
              was: <Bidi>{nounOf(title(was ?? ''))}</Bidi>,
            }}
          />
        </p>
        <p className="m-0 text-caption text-ink-secondary">
          {proposal.retyping ? <Phrase text={t('connections.panel.turning')} parts={sides} /> : t('connections.panel.wrongThing')}
        </p>
        <ExactlyWhy refusals={refused} />
        <Actions>
          <Button
            variant="primary"
            onClick={() =>
              onPropose?.({ kind: 'LINK', from: pair.many, to: pair.one, column: undefined, retyping: false })
            }
          >
            {t('connections.panel.useNew')}
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            {t('connections.panel.cancel')}
          </Button>
        </Actions>
      </Frame>
    )
  }

  /* ------------------------------------------------------------ the answers */

  const source = figuring ? index.get(pair.many) : undefined
  const keeper = figuring ? index.get(pair.one) : undefined
  const orders = (source?.columns ?? []).filter((each) => ORDER_TYPES.has(each.type))
  // **How the link fills itself** (M29 F8, D-350): one of the many side's
  // dates, and the date or month of the one side it falls in.
  const dates = linking ? (index.get(pair.many)?.columns ?? []).filter((each) => each.type === 'date') : []
  const periods = linking
    ? (index.get(pair.one)?.columns ?? []).filter((each) => each.type === 'date' || each.type === 'month')
    : []
  const periodType = periods.find((each) => each.name === fields.foundIn)?.type
  const byDate = fields.foundFrom !== ''
  // **A total of money is in its rows' currency** (M29 F9): it asks for no unit.
  const comesOut = source === undefined ? undefined : foldType(fields.expression, source, declarations)
  const money = comesOut?.kind === 'MONEY'
  const existingLink = existing?.kind === 'LINK' && !existing.dangling ? existing : undefined
  const alongExisting = existingLink === undefined ? [] : foldsOver(declarations, pair.many, existingLink.column)

  const answers: Answers = {
    found: byDate ? (periodType === 'month' ? 'MONTH' : fields.foundGrain) : undefined,
    total: figuring ? { kind: fields.kind, name: fields.figure } : undefined,
  }
  const headline =
    existing !== undefined && existing.dangling
      ? spoken(t, edgeHeadlineSaid(existing, declarations))
      : spoken(t, headlineSaid(proposal, declarations, answers))

  /** A new kind or a new line: the name follows it, until somebody names it. */
  const totalChanged = (next: Partial<Fields>): void => {
    const merged = { ...fields, ...next }
    setFields({
      ...merged,
      figure: merged.figureNamed
        ? merged.figure
        : suggestedFigureName(merged.kind, pair.many, keeper, merged.kind === 'COUNT' ? '' : merged.expression),
    })
  }

  const total = figuring && (
    <TotalSentence
      one={One}
      many={Many}
      every={proposal.kind === 'FIGURE' && proposal.over.column === undefined}
      fields={fields}
      money={money}
      unit={comesOut?.kind === 'NUMBER' ? comesOut.unit : undefined}
      source={source}
      declarations={declarations}
      orders={orders.map((each) => each.name)}
      onKind={(kind) =>
        totalChanged({
          kind,
          // Blanked off a pick, and started on the source's first date — the
          // one a person nearly always means.
          by: isOrdered(kind) ? fields.by || (orders[0]?.name ?? '') : '',
        })
      }
      onExpression={(expression) => totalChanged({ expression })}
      onBy={(by) => setFields({ ...fields, by })}
      onName={(figure) => setFields({ ...fields, figure, figureNamed: true })}
      onUnit={(unit) => setFields({ ...fields, unit })}
    />
  )

  // **No refusal of a blank nobody has filled yet** (M29 F10): while one is
  // empty the button stays off quietly, and the blank is what says why.
  const blankLeft =
    (linking && fields.column.trim() === '') ||
    (figuring &&
      (fields.figure.trim() === '' ||
        (fields.kind !== 'COUNT' && fields.expression.trim() === '') ||
        (isOrdered(fields.kind) && fields.by === '')))
  const will = willSay(t, proposal, existing, fields, Many, One, pair, declarations)

  return (
    <Frame key="main">
      <Relation many={Many} one={One} />
      <p className={HEADLINE}>
        <Bidi>{headline}</Bidi>
      </p>

      <div className={ROWS}>
        {offersEvery && (
          <>
            <div className={Q}>
              <Phrase text={t('connections.panel.whichRows')} parts={sides} />
            </div>
            <div className={A}>
              <div className="inline-flex flex-wrap self-start" data-which-rows>
                <ChoiceButton
                  on={!every}
                  onClick={() => {
                    setEvery(false)
                    setTouched(true)
                  }}
                >
                  {t('connections.panel.belongingOnes')}
                </ChoiceButton>
                <ChoiceButton
                  on={every}
                  onClick={() => {
                    setEvery(true)
                    setTouched(true)
                  }}
                >
                  <Phrase text={t('connections.panel.everyOne')} parts={sides} />
                </ChoiceButton>
              </div>
              {every && (
                <span className={CAPTION}>
                  <Phrase text={t('connections.panel.everyCaption')} parts={sides} />
                </span>
              )}
            </div>
          </>
        )}

        {linking && (
          <>
            <div className={Q}>
              <Phrase text={t('connections.panel.whichOne')} parts={sides} />
            </div>
            <div className={A}>
              <div className="inline-flex flex-wrap self-start">
                <ChoiceButton
                  on={!byDate}
                  onClick={() => setFields({ ...fields, foundFrom: '', foundIn: '' })}
                >
                  {t('connections.panel.pickIt')}
                </ChoiceButton>
                <ChoiceButton
                  on={byDate}
                  disabled={dates.length === 0 || periods.length === 0}
                  title={
                    dates.length === 0
                      ? t('connections.panel.noDate', words)
                      : periods.length === 0
                        ? t('connections.panel.noPeriod', words)
                        : undefined
                  }
                  onClick={() =>
                    setFields({
                      ...fields,
                      foundFrom: fields.foundFrom || (dates[0]?.name ?? ''),
                      foundIn: fields.foundIn || (periods[0]?.name ?? ''),
                    })
                  }
                >
                  {t('connections.panel.matchByDate')}
                </ChoiceButton>
              </div>
              {byDate && (
                <div className="fc-pop-enter">
                  <p className={SAY}>
                    <Phrase
                      text={t(periodType === 'month' ? 'connections.panel.fallsIn' : 'connections.panel.sameAs')}
                      parts={{
                        ...sides,
                        from: (
                          <Pick
                            label={t('connections.panel.dateLabel', words)}
                            value={fields.foundFrom}
                            options={dates.map((each) => ({ value: each.name, label: each.name }))}
                            onPick={(foundFrom) => setFields({ ...fields, foundFrom })}
                          />
                        ),
                        grain: (
                          <Pick
                            label={t('connections.panel.grainLabel')}
                            value={fields.foundGrain}
                            options={[
                              { value: 'MONTH', label: t('connections.panel.month') },
                              { value: 'DAY', label: t('connections.panel.day') },
                            ]}
                            onPick={(grain) => setFields({ ...fields, foundGrain: grain as FoundGrain })}
                          />
                        ),
                        in: (
                          <Pick
                            label={t('connections.panel.periodLabel', words)}
                            value={fields.foundIn}
                            options={periods.map((each) => ({ value: each.name, label: each.name }))}
                            onPick={(foundIn) => setFields({ ...fields, foundIn })}
                          />
                        ),
                      }}
                    />
                  </p>
                  <span className={CAPTION}>
                    <Phrase text={t('connections.panel.fills')} parts={sides} />
                  </span>
                  {(applied !== undefined || (savedFind !== undefined && savedFind.empty > 0)) && (
                    <p className="m-0 mt-1.5 text-caption" data-found-apply>
                      {applied !== undefined && (
                        <span className="text-ink-secondary">
                          <Phrase
                            text={t(countKey('connections.panel.got', applied.placements.length), {
                              count: applied.placements.length,
                            })}
                            parts={sides}
                          />{' '}
                        </span>
                      )}
                      {savedFind !== undefined && savedFind.empty > 0 && (
                        <>
                          <Phrase
                            text={t(countKey('connections.panel.haveNone', savedFind.empty), { count: savedFind.empty })}
                            parts={sides}
                          />{' '}
                          <button
                            type="button"
                            onClick={() => setConfirming(true)}
                            className="cursor-pointer border-0 bg-transparent p-0 text-caption text-accent hover:underline"
                          >
                            {t('connections.panel.apply')}
                          </button>
                        </>
                      )}
                    </p>
                  )}
                </div>
              )}
              <label className={CHECK}>
                <input
                  type="checkbox"
                  checked={fields.required}
                  onChange={(event) => setFields({ ...fields, required: event.target.checked })}
                  className="m-0 size-4 accent-[var(--color-accent)]"
                />
                <Phrase text={t('connections.panel.mustHave')} parts={sides} />
              </label>
            </div>
          </>
        )}

        {fresh && !(offersEvery && every) && (
          <>
            <div className={Q}>{t('connections.panel.addUp')}</div>
            <div className={A}>
              <label className={CHECK}>
                <input
                  type="checkbox"
                  checked={withTotal}
                  onChange={(event) => {
                    setWithTotal(event.target.checked)
                    setTouched(true)
                  }}
                  className="m-0 size-4 accent-[var(--color-accent)]"
                />
                <Phrase text={t('connections.panel.eachAddsUp')} parts={sides} />
              </label>
              {withTotal && <div className="fc-pop-enter flex flex-col gap-0.5 border-s-2 border-hairline-strong py-0.5 ps-3">{total}</div>}
            </div>
          </>
        )}

        {proposal.kind === 'FIGURE' && (
          <>
            <div className={Q}>{t('connections.panel.addUp')}</div>
            <div className={A}>{total}</div>
          </>
        )}

        {alongExisting.length > 0 && (
          <>
            <div className={Q}>{t('connections.panel.addsUp')}</div>
            <div className={A}>
              {alongExisting.map((each) => (
                <span key={`${each.format}.${each.aggregate.name}`} className={`${CAPTION} pt-1.5`}>
                  <Phrase
                    text={t('connections.panel.alongCaption')}
                    parts={{
                      ...sides,
                      title: <Bidi>{title(each.format)}</Bidi>,
                      name: (
                        <b className="font-medium text-ink">
                          <Bidi>{each.aggregate.name}</Bidi>
                        </b>
                      ),
                    }}
                  />
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      <details className="group mt-3 max-w-[760px]">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-caption text-accent [&::-webkit-details-marker]:hidden">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="transition-transform duration-[var(--duration-base)] group-open:rotate-90 rtl:-scale-x-100 group-open:rtl:-rotate-90">
            <path d="M4.5 3L7.5 6L4.5 9" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
          {t(linking ? 'connections.panel.nameAndNote' : 'connections.panel.note')}
        </summary>
        <div className={`${ROWS} mt-2.5`}>
          {linking && (
            <>
              <div className={Q}>
                <Phrase text={t('connections.panel.columnOn')} parts={sides} />
              </div>
              <div className={A}>
                <input
                  value={fields.column}
                  readOnly={linkColumn !== undefined}
                  dir="auto"
                  aria-label={t('connections.panel.newColumnOn', words)}
                  onChange={(event) => setFields({ ...fields, column: event.target.value })}
                  className={`${FIELD} w-[200px] max-w-full ${linkColumn === undefined ? '' : 'text-ink-secondary'}`}
                />
                {linkColumn !== undefined && (
                  <span className={CAPTION}>
                    <Phrase text={t('connections.panel.renameIn')} parts={sides} />
                  </span>
                )}
              </div>
            </>
          )}
          <div className={Q}>{t('connections.panel.note')}</div>
          <div className={A}>
            <textarea
              value={linking ? fields.linkNote : fields.figureNote}
              rows={2}
              dir="auto"
              placeholder={t('connections.panel.whyWorth')}
              onChange={(event) =>
                setFields(
                  linking ? { ...fields, linkNote: event.target.value } : { ...fields, figureNote: event.target.value },
                )
              }
              className={`${FIELD_MULTILINE} w-full max-w-[56ch] resize-y text-caption`}
            />
          </div>
        </div>
      </details>

      {existingLink !== undefined && (
        <p className={`${CAPTION} mt-3`}>
          <Phrase
            text={t('connections.panel.dragPort')}
            parts={{
              column: (
                <i>
                  <Bidi>{existingLink.column}</Bidi>
                </i>
              ),
            }}
          />
        </p>
      )}

      {touched &&
        !blankLeft &&
        problems.map((problem) => (
          <p key={problem} className={BAD}>
            {problem}
          </p>
        ))}

      {refused.map((refusal) => (
        <p key={`${refusal.reason}-${refusal.column}`} className={BAD}>
          {plainRefusal(t, refusal, Many, One)}
        </p>
      ))}
      <ExactlyWhy refusals={refused} />

      {will !== undefined && <p className="mt-3.5 mb-0 text-caption text-ink-secondary">{will}</p>}

      <Actions>
        <Button variant="primary" disabled={!ready} onClick={() => onSave(drafts)} data-tour="connection-save">
          {t(
            existing !== undefined
              ? 'connections.panel.save'
              : proposal.kind === 'FIGURE'
                ? 'connections.panel.add'
                : 'connections.panel.connect',
          )}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          {t('connections.panel.cancel')}
        </Button>
        {existingLink !== undefined && onPropose !== undefined && (
          <Button
            variant="ghost"
            onClick={() =>
              onPropose({ kind: 'FIGURE', format: pair.one, over: { format: pair.many, column: existingLink.column } })
            }
          >
            <Phrase text={t('connections.panel.addUpOn')} parts={sides} />
          </Button>
        )}
        {existing !== undefined && (
          <span className="ms-auto">
            <IconAction
              label={t(existing.kind === 'LINK' ? 'connections.panel.deleteConnection' : 'connections.panel.deleteTotal')}
              tone="negative"
              onClick={() => setDeleting(true)}
            >
              <path d="M4 6h16M9 6V4h6v2M6.5 6l1 14h9l1-14" />
            </IconAction>
          </span>
        )}
      </Actions>
    </Frame>
  )
}

/* ------------------------------------------------------------ the total */

/**
 * The total, as one sentence with its blanks in it: *Paycheck shows the [sum ▾]
 * of [hours * rate] from its work days, called [earnings], in [h].* A count
 * reads *…the count of its work days*; latest and earliest read *…the latest
 * [rate] of its work days, by [day ▾]*.
 */
function TotalSentence({
  one,
  many,
  every = false,
  fields,
  money,
  unit,
  source,
  declarations,
  orders,
  onKind,
  onExpression,
  onBy,
  onName,
  onUnit,
}: {
  one: string
  many: string
  /** Every row of the many side, not the ones that name this one (D-397). */
  every?: boolean
  fields: Fields
  money: boolean
  unit: string | undefined
  source: FormatDeclaration | undefined
  declarations: readonly FormatDeclaration[]
  orders: readonly string[]
  onKind: (kind: AggregateKind) => void
  onExpression: (expression: string) => void
  onBy: (by: string) => void
  onName: (name: string) => void
  onUnit: (unit: string) => void
}) {
  const t = useT()
  // `one` and `many` here are the two formats' titles.
  const words = sideWords(many, one)
  const rows = t(every ? 'connections.total.every' : 'connections.total.its', words)
  const counting = fields.kind === 'COUNT'
  const ordered = isOrdered(fields.kind)
  const names =
    source === undefined
      ? []
      : foldNames(source, declarations).map((each) => {
          const [link, column] = each.name.split('.')
          return {
            name: each.name,
            says:
              column !== undefined
                ? t('connections.total.linkColumn', { link: link ?? '', column })
                : each.says === 'computed'
                  ? t('connections.total.computedOn', words)
                  : t('connections.total.on', words),
          }
        })
  const links = (source?.columns ?? [])
    .filter((each) => each.type === 'link')
    .map((each) => t('connections.total.linkOf', { name: each.name }))
  const formula = (aria: string): ReactNode => (
    <FormulaField
      look="blank"
      value={fields.expression}
      names={names}
      label={aria}
      tour="total-of"
      placeholder={t(ordered ? 'connections.total.rateExample' : 'connections.total.formulaExample')}
      onChange={onExpression}
    />
  )
  // The sentence's blanks, which the catalogue's sentence puts where its grammar does.
  const blanks: Record<string, ReactNode> = {
    One: <Bidi>{one}</Bidi>,
    kind: (
      <Pick
        label={t('connections.total.kindLabel')}
        tour="total-kind"
        value={fields.kind}
        options={kindsOf(t)}
        onPick={(kind) => onKind(kind as AggregateKind)}
      />
    ),
    rows: <Bidi>{rows}</Bidi>,
    formula: counting
      ? undefined
      : formula(ordered ? t('connections.total.whichValue') : t('connections.total.formulaLabel', words)),
    by: ordered ? (
      <Pick
        label={t('connections.total.pickedBy')}
        value={fields.by}
        options={orders.map((each) => ({ value: each, label: each }))}
        onPick={onBy}
      />
    ) : undefined,
    name: (
      <input
        className={BLANK}
        value={fields.figure}
        size={Math.max(8, fields.figure.length + 1)}
        dir="auto"
        aria-label={t('connections.total.nameLabel')}
        onChange={(event) => onName(event.target.value)}
      />
    ),
    unit:
      !counting && !money ? (
        <Phrase
          text={t('connections.total.unit')}
          parts={{
            unit: (
              <input
                className={BLANK}
                value={fields.unit}
                placeholder={unit ?? ''}
                size={Math.max(4, fields.unit.length + 1, (unit ?? '').length + 1)}
                aria-label={t('connections.total.unitLabel')}
                onChange={(event) => onUnit(event.target.value)}
              />
            ),
          }}
        />
      ) : undefined,
  }
  return (
    <>
      <p className={SAY}>
        <Phrase
          text={t(counting ? 'connections.total.count' : ordered ? 'connections.total.ordered' : 'connections.total.of')}
          parts={blanks}
        />
      </p>
      {!counting && !money && (
        <span className={CAPTION}>
          {names.length === 0
            ? t('connections.total.noNumbers', words)
            : links.length === 0
              ? t('connections.total.useColumns')
              : t('connections.total.useColumnsAnd', { links: andList(t, links) })}
          {unit !== undefined && <> {t('connections.total.comesOut', { rows, unit })}</>}
        </span>
      )}
      {!counting && money && <span className={CAPTION}>{t('connections.total.money', { rows })}</span>}
    </>
  )
}

/** The kinds of total, in the window's words: *smallest* and *largest*, where the declaration says `minimum` and `maximum`. */
function kindsOf(t: Translate): readonly PickOption[] {
  return [
    { value: 'SUM', label: t('connections.total.kinds.sum'), detail: t('connections.total.addsThemUp') },
    { value: 'COUNT', label: t('connections.total.kinds.count'), detail: t('connections.total.howMany') },
    { value: 'AVERAGE', label: t('connections.total.kinds.average') },
    { value: 'MINIMUM', label: t('connections.total.kinds.smallest') },
    { value: 'MAXIMUM', label: t('connections.total.kinds.largest') },
    { value: 'LATEST', label: t('connections.total.kinds.latest'), detail: t('connections.total.oneRow') },
    { value: 'EARLIEST', label: t('connections.total.kinds.earliest'), detail: t('connections.total.oneRow') },
  ]
}

/* ------------------------------------------------------------- the menus */

interface PickOption {
  readonly value: string
  readonly label: string
  readonly detail?: string | undefined
}

/**
 * **A word in a sentence that opens the app's own list** — D-290's rule: no
 * platform select element, which draws dark, in a font and a shape that are not
 * this app's. The look is `ChoiceField`'s list, fixed to the viewport so a
 * window that scrolls cannot cut it off.
 */
function Pick({
  label,
  tour,
  value,
  options,
  onPick,
}: {
  label: string
  /** The demo tour's anchor (M33 U2). */
  tour?: string | undefined
  value: string
  options: readonly PickOption[]
  onPick: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [place, setPlace] = useState<{ top: number; left: number } | undefined>(undefined)
  const button = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const shown = options.find((each) => each.value === value)

  useLayoutEffect(() => {
    if (!open || button.current === null) return
    const box = button.current.getBoundingClientRect()
    setPlace({ top: box.bottom + 4, left: box.left })
    setActive(Math.max(0, options.findIndex((each) => each.value === value)))
    // Placed once, when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const close = (event: Event): void => {
      if (event.target instanceof Node && (list.current?.contains(event.target) ?? false)) return
      if (event.target instanceof Node && (button.current?.contains(event.target) ?? false)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', close, true)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  const take = (option: PickOption | undefined): void => {
    if (option !== undefined) onPick(option.value)
    setOpen(false)
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        data-tour={tour}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={options.length === 0}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (!open) {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setOpen(true)
            }
            return
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            const step = event.key === 'ArrowDown' ? 1 : -1
            setActive((at) => Math.min(Math.max(at + step, 0), options.length - 1))
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            take(options[active])
          } else if (event.key === 'Escape') {
            // The list goes, and the window underneath stays.
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
          }
        }}
        className="inline-flex h-6 items-center gap-1 border-b border-hairline-strong px-0.5 leading-6 text-ink hover:border-accent disabled:text-ink-tertiary"
      >
        {shown?.label ?? '—'}
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="text-ink-secondary">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {open && place !== undefined && (
        <ul
          ref={list}
          role="listbox"
          aria-label={label}
          className="fc-pop-enter fixed z-50 max-h-64 min-w-[150px] overflow-auto border border-hairline-strong bg-elevated py-1 text-body leading-normal text-ink shadow-pop"
          style={{ top: place.top, left: place.left }}
        >
          {options.map((option, at) => (
            <li
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              className={`flex cursor-pointer justify-between gap-4 px-3 py-1 whitespace-nowrap ${
                at === active || option.value === value ? 'bg-accent-soft' : 'hover:bg-accent-soft'
              }`}
              onMouseDown={(event) => {
                event.preventDefault()
                take(option)
              }}
              onMouseEnter={() => setActive(at)}
            >
              {option.label}
              {option.detail !== undefined && <span className="text-caption text-ink-secondary">{option.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** One half of a two-way choice: *I pick it* / *Match by date*. */
function ChoiceButton({
  on,
  disabled,
  title,
  onClick,
  children,
}: {
  on: boolean
  disabled?: boolean | undefined
  title?: string | undefined
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={`-ms-px h-8 border px-3 text-body first:ms-0 disabled:cursor-default disabled:opacity-40 ${
        on
          ? 'relative z-[1] border-accent bg-accent-soft text-ink'
          : 'border-hairline-strong bg-elevated text-ink-secondary'
      }`}
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------- the fields */

interface Fields {
  /** The link column's name. */
  readonly column: string
  readonly required: boolean
  readonly linkNote: string
  /** The total's name. */
  readonly figure: string
  /** Somebody typed the name: it stops following what is added up. */
  readonly figureNamed: boolean
  readonly kind: AggregateKind
  readonly expression: string
  readonly unit: string
  readonly figureNote: string
  /** What a latest or earliest picks by; empty for a fold. */
  readonly by: string
  /** The many side's date a link is found by (D-350); empty when picked by hand. */
  readonly foundFrom: string
  /** The one side's date or month that date falls in. */
  readonly foundIn: string
  /** Against a date: the same month or the same day. A month is always the month. */
  readonly foundGrain: FoundGrain
}

/** The two ends of a connection: the format there are many of, and the one they belong to. */
function endsOf(proposal: Exclude<Proposal, { kind: 'NOTHING' }>): { readonly many: string; readonly one: string } {
  switch (proposal.kind) {
    case 'LINK':
      return { many: proposal.from, one: proposal.to }
    case 'LINK_AND_FIGURE':
      return { many: proposal.from, one: proposal.format }
    case 'FIGURE':
      return { many: proposal.over.format, one: proposal.format }
  }
}

/**
 * What the fields start as.
 *
 * **A new link is named after the format it points at** — `paycheck`, which is
 * what every one of these is called by hand. **A new total starts as a count**,
 * the one kind that needs nothing else, and with a name already suggested — so
 * the window opens on something that could be saved, and never on a refusal
 * of a name nobody has typed yet (M29 F10).
 */
function opening(
  proposal: Proposal,
  existing: Edge | undefined,
  declarations: readonly FormatDeclaration[],
): Fields {
  const index = new Map(declarations.map((each) => [each.name, each]))
  const blank: Fields = {
    column: '',
    required: false,
    linkNote: '',
    figure: '',
    figureNamed: false,
    kind: 'COUNT',
    expression: '',
    unit: '',
    figureNote: '',
    by: '',
    foundFrom: '',
    foundIn: '',
    foundGrain: 'MONTH',
  }

  if (proposal.kind === 'LINK') {
    const owner = index.get(proposal.from)
    const column = owner?.columns.find((each) => each.name === proposal.column)
    const counted = { ...blank, figure: suggestedFigureName('COUNT', proposal.from, index.get(proposal.to)) }
    if (column !== undefined) {
      return {
        ...counted,
        column: column.name,
        required: column.required,
        linkNote: column.note,
        foundFrom: column.foundBy?.from ?? '',
        foundIn: column.foundBy?.in ?? '',
        foundGrain: column.foundBy?.grain ?? 'MONTH',
      }
    }
    return { ...counted, column: freeColumnName(owner, proposal.to) }
  }

  if (proposal.kind === 'LINK_AND_FIGURE') {
    return {
      ...blank,
      column: freeColumnName(index.get(proposal.from), proposal.format),
      figure: suggestedFigureName('COUNT', proposal.from, index.get(proposal.format)),
    }
  }

  if (proposal.kind === 'FIGURE') {
    const owner = index.get(proposal.format)
    const held =
      existing?.kind === 'FIGURE' ? owner?.aggregates.find((each) => each.name === existing.figure) : undefined
    if (held !== undefined) {
      return {
        ...blank,
        figure: held.name,
        figureNamed: true,
        kind: held.kind,
        expression: held.expression,
        unit: held.unit ?? '',
        figureNote: held.note,
        by: held.by ?? '',
      }
    }
    return { ...blank, figure: suggestedFigureName('COUNT', proposal.over.format, owner) }
  }

  return blank
}

/**
 * The drafts this window would save, in the order they have to be saved in.
 *
 * **The link comes first when there are two**, because the total's own
 * validation asks whether a column aimed here exists.
 */
function buildDrafts(
  proposal: Proposal,
  existing: Edge | undefined,
  fields: Fields,
  declarations: readonly FormatDeclaration[],
  removing: boolean,
): readonly FormatDraft[] {
  const index = new Map(declarations.map((each) => [each.name, each]))
  const drafts: FormatDraft[] = []

  const linkInto = (owner: string, target: string, held: string | undefined): void => {
    const declaration = index.get(owner)
    if (declaration === undefined) return
    const foundBy = foundByOf(fields, index.get(target))
    const draft = draftOf(declaration)
    if (removing && held !== undefined) {
      drafts.push({ ...draft, columns: draft.columns.filter((each) => each.name !== held) })
      return
    }
    const there = draft.columns.find((each) => each.name === held)
    if (there === undefined) {
      drafts.push({
        ...draft,
        columns: [
          ...draft.columns,
          {
            ...newColumn(),
            name: fields.column.trim(),
            type: 'link',
            target,
            required: fields.required,
            note: fields.linkNote,
            foundBy,
          },
        ],
      })
      return
    }
    drafts.push({
      ...draft,
      columns: draft.columns.map((each) =>
        each.name === held
          ? { ...retype(each, 'link'), target, required: fields.required, note: fields.linkNote, foundBy }
          : each,
      ),
    })
  }

  const figureInto = (owner: string, over: AggregateSource): void => {
    const declaration = index.get(owner)
    if (declaration === undefined) return
    // A second edit of the draft already in the list when it is the same
    // format — a self-link with a total over it, which is legal and would
    // otherwise lose the column that was just added.
    const started = drafts.findIndex((each) => each.revising === owner)
    const draft = started === -1 ? draftOf(declaration) : drafts[started]
    if (draft === undefined) return
    const held = existing?.kind === 'FIGURE' ? existing.figure : undefined
    const next =
      removing && held !== undefined
        ? { ...draft, aggregates: draft.aggregates.filter((each) => each.name !== held) }
        : draft.aggregates.some((each) => each.name === held)
          ? {
              ...draft,
              aggregates: draft.aggregates.map((each) =>
                each.name === held ? { ...each, ...written(fields, over) } : each,
              ),
            }
          : { ...draft, aggregates: [...draft.aggregates, { ...newAggregate(), ...written(fields, over) }] }
    if (started === -1) drafts.push(next)
    else drafts[started] = next
  }

  switch (proposal.kind) {
    case 'LINK':
      linkInto(proposal.from, proposal.to, proposal.column)
      break
    case 'FIGURE':
      figureInto(proposal.format, proposal.over)
      break
    case 'LINK_AND_FIGURE':
      linkInto(proposal.from, proposal.format, undefined)
      figureInto(proposal.format, { format: proposal.from, column: fields.column.trim() })
      break
    case 'NOTHING':
      break
  }

  return drafts
}

/**
 * The fields as they are written: a total of money carries no unit (M29 F9),
 * since its rows' currency travels with it and the blank for one is not shown.
 */
function fieldsWritten(fields: Fields, proposal: Proposal, declarations: readonly FormatDeclaration[]): Fields {
  if (fields.unit === '' || fields.kind === 'COUNT') return fields
  const over =
    proposal.kind === 'FIGURE' ? proposal.over.format : proposal.kind === 'LINK_AND_FIGURE' ? proposal.from : undefined
  const source = declarations.find((each) => each.name === over)
  if (source === undefined) return fields
  return foldType(fields.expression, source, declarations)?.kind === 'MONEY' ? { ...fields, unit: '' } : fields
}

/** The link's `found by`, from the fields — none while it is picked by hand. */
function foundByOf(fields: Fields, target: FormatDeclaration | undefined): FoundBy | undefined {
  if (fields.foundFrom === '' || fields.foundIn === '') return undefined
  const month = target?.columns.find((each) => each.name === fields.foundIn)?.type === 'month'
  return { from: fields.foundFrom, in: fields.foundIn, grain: month ? 'MONTH' : fields.foundGrain }
}

function written(
  fields: Fields,
  over: AggregateSource,
): {
  name: string
  kind: AggregateKind
  overFormat: string
  overColumn: string
  expression: string
  unit: string
  note: string
  by: string
} {
  return {
    name: fields.figure.trim(),
    kind: fields.kind,
    overFormat: over.format,
    // Empty for every row of the source (M34 U4, D-397).
    overColumn: over.column ?? '',
    // A `COUNT` asks about the rows rather than about a figure on them, so it
    // carries no expression — and one left behind by a change of kind would be
    // stored text nothing reads.
    expression: fields.kind === 'COUNT' ? '' : fields.expression,
    unit: fields.kind === 'COUNT' ? '' : fields.unit,
    note: fields.figureNote,
    by: isOrdered(fields.kind) ? fields.by : '',
  }
}

/* ------------------------------------------------------------- the words */

/**
 * What will change, said rather than printed as a plan: *Adds a paycheck column
 * to Work day.* The old window printed `Add fmt_work_day.paycheck`, which is the
 * table's name and not a thing anybody declared.
 */
function willSay(
  t: Translate,
  proposal: Proposal,
  existing: Edge | undefined,
  fields: Fields,
  Many: string,
  One: string,
  pair: { readonly many: string; readonly one: string },
  declarations: readonly FormatDeclaration[],
): ReactNode | undefined {
  const b = (text: string): ReactNode => (
    <b className="font-medium text-ink">
      <Bidi>{text}</Bidi>
    </b>
  )
  const sides = sideParts(Many, One)
  const column = b(fields.column.trim())
  const figure = b(fields.figure.trim())
  switch (proposal.kind) {
    case 'LINK': {
      if (proposal.column === undefined) {
        return <Phrase text={t('connections.will.addsColumn')} parts={{ ...sides, column }} />
      }
      if (existing !== undefined) return undefined
      if (proposal.retyping) {
        return <Phrase text={t('connections.will.turns')} parts={{ ...sides, column: b(proposal.column) }} />
      }
      const was = declarations
        .find((each) => each.name === pair.many)
        ?.columns.find((each) => each.name === proposal.column)?.target
      return was === proposal.to ? undefined : (
        <Phrase text={t('connections.will.points')} parts={{ ...sides, column: b(proposal.column) }} />
      )
    }
    case 'LINK_AND_FIGURE':
      return <Phrase text={t('connections.will.addsBoth')} parts={{ ...sides, column, figure }} />
    case 'FIGURE':
      return existing === undefined ? (
        <Phrase text={t('connections.will.addsFigure')} parts={{ ...sides, figure }} />
      ) : (
        t('connections.will.computed')
      )
    case 'NOTHING':
      return undefined
  }
}

/** A refusal the window shows under its answers, said plainly for its kind. */
function plainRefusal(t: Translate, refusal: Refusal, Many: string, One: string): string {
  const count = rowsIn(refusal)
  const parts = {
    ...sideWords(Many, One),
    who: whoText(t, count, Many),
    Who: whoText(t, count, Many, true),
    column: refusal.column ?? '',
  }
  switch (refusal.reason) {
    case 'REQUIRED_ON_ROWS':
      return t(countKey('connections.refusal.required', count ?? 0), parts)
    case 'CONSTRAINT_CHANGED':
      return t(countKey('connections.refusal.constraint', count ?? 0), parts)
    case 'DROP_WITH_DATA':
      return t(countKey('connections.refusal.drop', count ?? 0), parts)
    default:
      return t('connections.refusal.cantTake')
  }
}

/** The two formats' parts of a catalogue sentence (see `connections` in `src/i18n/en/`): titles, nouns and the plural. */
function sideWords(Many: string, One: string): Readonly<Record<'Many' | 'One' | 'many' | 'manyRows' | 'one', string>> {
  return { Many, One, many: nounOf(Many), manyRows: pluralOf(Many), one: nounOf(One) }
}

/** The same parts, each in its `Bidi`: they are the document's words inside the screen's sentence. */
function sideParts(Many: string, One: string): Readonly<Record<string, ReactNode>> {
  return Object.fromEntries(
    Object.entries(sideWords(Many, One)).map(([name, text]) => [name, <Bidi key={name}>{text}</Bidi>]),
  )
}

/**
 * The rows a sentence is about — *3 work days*, or *work days* when the count
 * is not known — capitalised when it starts the sentence.
 */
function whoText(t: Translate, count: number | undefined, Many: string, start = false): string {
  const words = sideWords(Many, '')
  const said =
    count === undefined
      ? t('connections.panel.whoAll', words)
      : t(countKey('connections.panel.who', count), { ...words, count })
  return start ? capitalize(said) : said
}

/** *a, b and c*, in the screen's language. */
function andList(t: Translate, items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return t('views.and', { rest: items.slice(0, -1).join(', '), last: items.at(-1) ?? '' })
}

/** How many rows a refusal is about, read from its own sentence: *12 rows in…*. */
function rowsIn(refusal: Refusal): number | undefined {
  const found = /(\d[\d,]*) rows?\b/.exec(refusal.detail)
  return found?.[1] === undefined ? undefined : Number(found[1].replace(/,/g, ''))
}

/** How many that cannot be placed are listed before the rest is a count (M29 F11). */
const UNPLACED_SHOWN = 12

/** Why one row stays empty, in the window's words: *no paycheck for March 2026*. */
function unplacedReason(t: Translate, calendar: DateWords, each: Unplaced, plan: FindPlan, One: string): string {
  if (each.kind === 'NO_DATE') return t('connections.unplaced.noDate', { column: plan.foundBy.from })
  const at = matchedOn(plan.foundBy, each.date)
  const month = plan.foundBy.grain === 'MONTH' ? parseYearMonth(at) : undefined
  const when =
    month === undefined
      ? t('connections.unplaced.on', { date: at })
      : t('connections.unplaced.for', { month: calendar.yearMonth(month) })
  const words = { One, one: nounOf(One), ones: pluralOf(One), when }
  if (each.kind === 'NONE') return t('connections.unplaced.none', words)
  const count = each.names.length
  const key =
    count === 2 ? 'connections.unplaced.two' : count === 3 ? 'connections.unplaced.three' : 'connections.unplaced.several'
  return t(key, { ...words, count, names: each.names.join(', ') })
}

/** The two port words in a sentence are the port's words, so they are set as such. */
function emphasised(text: string, words: string): ReactNode {
  const at = text.indexOf(words)
  if (at === -1) return text
  return (
    <>
      {text.slice(0, at)}
      <i className="font-semibold">{words}</i>
      {text.slice(at + words.length)}
    </>
  )
}

/** A total, as the edge the graph would hand the window for it. */
function figureEdge(format: string, figure: string, over: AggregateSource): Edge {
  return {
    kind: 'FIGURE',
    from: { kind: 'FIGURE', format, figure },
    to:
      over.column === undefined
        ? { kind: 'ROW', format: over.format }
        : { kind: 'COLUMN', format: over.format, column: over.column },
    format,
    figure,
    over,
    dangling: false,
  }
}

/* -------------------------------------------------------------- the frame */

const HEADLINE = 'm-0 mb-3.5 max-w-[60ch] text-heading'
const ROWS = 'grid grid-cols-1 items-start gap-y-1'
const Q = 'pt-2 text-caption text-ink-secondary'
const A = 'flex min-w-0 flex-col gap-1.5'
const SAY = 'm-0 max-w-[62ch] text-body leading-loose'
const CAPTION = 'max-w-[56ch] text-caption text-ink-secondary'
const CHECK = 'flex items-center gap-2 pt-1 text-body'
const BAD = 'mt-1.5 mb-0 max-w-[62ch] text-caption text-negative'


/** The reconciler's own sentences, word for word, folded under the plain one (D-138). */
function ExactlyWhy({ refusals }: { refusals: readonly Refusal[] }) {
  const t = useT()
  if (refusals.length === 0) return undefined
  return (
    <details className="mt-1.5 max-w-[70ch] text-caption text-ink-secondary">
      <summary className="cursor-pointer list-none text-ink-secondary [&::-webkit-details-marker]:hidden">
        {t('connections.panel.exactlyWhy')}
      </summary>
      {refusals.map((refusal) => (
        <p key={`${refusal.reason}-${refusal.column}`} className="m-0">
          {refusal.detail}
        </p>
      ))}
    </details>
  )
}

/** *Many work days —< one paycheck*: the relationship, before the sentence. */
function Relation({ many, one }: { many: string; one: string }) {
  const t = useT()
  return (
    <div className="mb-1 flex flex-wrap items-center gap-2 text-caption text-ink-secondary" data-relation>
      <span>
        <b className="font-medium text-ink">{t('connections.panel.relationMany')}</b> <Bidi>{pluralOf(many)}</Bidi>
      </span>
      <svg width="64" height="16" viewBox="0 0 64 16" aria-hidden className="shrink-0">
        <path d="M0 8H64" stroke="currentColor" strokeWidth="1.5" />
        <path d="M0 1.5L10 8L0 14.5M0 8H10" stroke="currentColor" strokeWidth="1.5" fill="none" />
        <path d="M57 2V14" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span>
        <b className="font-medium text-ink">{t('connections.panel.relationOne')}</b> <Bidi>{nounOf(one)}</Bidi>
      </span>
    </div>
  )
}

/**
 * The form's plane, inside the screen's side panel (M64 U14, D-626, after
 * D-617): it was a band across the foot of the graph (M29 F10), and is now the
 * panel's body, beside the bubbles it is about. Each state passes its own
 * `key`, so a confirm arriving in place of the form pops in as the form itself
 * did (M39 F1) — in the same panel, where its Delete was pressed.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div data-connection-window className="fc-pop-enter">
      {children}
    </div>
  )
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-3.5 flex flex-wrap items-center gap-2">{children}</div>
}
