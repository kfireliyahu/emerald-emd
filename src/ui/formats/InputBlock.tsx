import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Database } from 'sql.js'

import { indexOf } from '@/data/repositories/formatJoinRepository.ts'
import { describeTableError, deleteRows, readRow } from '@/data/repositories/formatRowRepository.ts'
import { documentCurrency, listUnits } from '@/data/repositories/unitRepository.ts'
import { labelColumn, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { dayOfDefault } from '@/domain/format/inputView.ts'
import { withField, type RowDraft } from '@/domain/format/rowDraft.ts'
import { entryWayOf, type SavedView } from '@/domain/format/view.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { IconAction } from '@/ui/components/IconAction.tsx'
import { Flip } from '@/ui/motion/Flip.tsx'
import { dashboardEntry } from '@/ui/nav.ts'

import { inputShapeOf } from './addressFilter.ts'
import { valueText } from './entryList.ts'
import { Field, NO_LINKED } from './EntryView.tsx'
import { inputStart, stageInput, undoRefusal, writeInput, type BlockProblem } from './inputBlock.ts'
import { dayWordOf, inputFormOf } from './inputForm.ts'
import { FOCUSABLE, NARROW } from './InputView.tsx'
import { linkChoices } from './linkTargets.ts'

/** A row of *Just added*, as a block's list draws a line. */
const LINE = 32

/** At a block's own height — no height given — the rows just added it shows. */
const FEW = 3

/** One column wide, each field is a 40px row with its label at the left (U1 §6). */
const STACKED =
  '[&>section]:min-h-10 [&>section]:flex-row [&>section]:flex-wrap [&>section]:items-center [&>section]:gap-x-3 [&>section>span:first-child]:w-20 [&>section>span:first-child]:shrink-0 [&>section>*:nth-child(2)]:min-w-0 [&>section>*:nth-child(2)]:flex-1 [&>section>p]:basis-full [&>section>*:nth-child(2)_input]:min-w-0 [&>section>*:nth-child(2)_input:first-child]:w-0 [&>section>*:nth-child(2)_input:first-child]:flex-1 [&>section>*:nth-child(2)_input:not(:first-child)]:w-12'

/**
 * **An input view as a dashboard block** — M55 U4, D-533, D-535, U1's brief
 * (`docs/mockups/m55-u1/brief.md` §6, *On a dashboard*). The block is the
 * form, live: its fields laid out for its size (D-527) — one column wide,
 * stacked one per row with the label at the left; two to four, wrapping in
 * one row as on the page — then *Add*, a secondary button (one primary per
 * screen, and a dashboard is one screen), Enter adding as on the page. Under
 * it the rows just added, newest first with Undo, filling the height left;
 * those that do not fit are not drawn — they are in the format. A block
 * shorter than its fields scrolls inside itself with Add held at its foot.
 *
 * The block's title (the view's name) opens the full form, and the sentence
 * under it — *Adds a card charge as account Visa · date today* — is the
 * block's line (`blockWhat`). Read-only, its fields are drawn and nothing is
 * added.
 */
export function InputBlock({
  db,
  declaration,
  declarations,
  view,
  dashboard,
  day,
  locked,
  fill,
  width,
}: {
  readonly db: Database
  readonly declaration: FormatDeclaration
  readonly declarations: readonly FormatDeclaration[]
  readonly view: SavedView
  readonly dashboard: string | undefined
  readonly day: string
  /** Nothing is added: the frame, a locked copy, or a format a pack writes. */
  readonly locked: boolean
  /** Given a height: the rows just added fill what is left, and the fields scroll inside it. */
  readonly fill: boolean
  readonly width: number
}) {
  const mutate = useDocumentStore((state) => state.mutate)
  const revision = useDocumentStore((state) => state.revision)
  const shape = useMemo(() => inputShapeOf(view.address, declaration.name), [view.address, declaration.name])
  const form = inputFormOf(declaration, shape)
  const drawn = [...form.asked, ...form.lacking]
  const startsAt = useMemo(
    () => inputStart(declaration, shape, day, undefined, documentCurrency(db)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, declaration, shape, day],
  )
  const { units, links } = useMemo(
    () => ({ units: listUnits(db), links: linkChoices(db, declaration, indexOf(declarations)) }),
    // `revision` is the dependency that matters: a row added elsewhere is a link's choice here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, declaration, declarations, revision],
  )
  const [draft, setDraft] = useState<RowDraft>(startsAt)
  const [problems, setProblems] = useState<readonly BlockProblem[]>([])
  const [added, setAdded] = useState<readonly string[]>([])
  const [kept, setKept] = useState<Readonly<Record<string, string>>>({})
  // Focus goes back to the first field after an Add — never on a dashboard's first paint.
  const [round, setRound] = useState(0)
  const fields = useRef<HTMLDivElement>(null)
  const room = useRef<HTMLDivElement>(null)
  const [fits, setFits] = useState(FEW)

  // What the view asks or sets changed elsewhere — its page, a conversation: start again.
  useEffect(() => {
    setDraft(startsAt)
    setProblems([])
  }, [startsAt])
  useEffect(() => {
    if (round === 0) return
    fields.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
  }, [round])
  // **The rows just added fill the height left** (U1 §6): as many whole lines as it holds.
  useEffect(() => {
    const box = room.current
    if (!fill || box === null) {
      setFits(FEW)
      return
    }
    const measure = (): void => setFits(Math.max(0, Math.floor(box.clientHeight / LINE)))
    measure()
    const watching = new ResizeObserver(measure)
    watching.observe(box)
    return () => watching.disconnect()
  }, [fill])

  const at = (column: string): string | undefined => problems.find((each) => each.column === column)?.reason
  const aboutRow = problems.filter((each) => each.column === undefined || !drawn.some((column) => column.name === each.column))
  const atFields = problems.length - aboutRow.length

  const add = (): void => {
    if (locked) return
    const staged = stageInput(db, declaration, draft, startsAt, day, declarations)
    if ('problems' in staged) {
      setProblems(staged.problems)
      // Focus goes to the first refused field, once it is drawn as refused.
      window.requestAnimationFrame(() => fields.current?.querySelector('.fc-problem')?.querySelector<HTMLElement>(FOCUSABLE)?.focus())
      return
    }
    try {
      mutate((database) => writeInput(database, declaration, staged.row))
    } catch (error) {
      setProblems([{ column: undefined, reason: describeTableError(declaration, error).reason }])
      return
    }
    setAdded((ids) => [staged.row.id, ...ids])
    setDraft(startsAt)
    setProblems([])
    setRound((was) => was + 1)
  }

  const undo = (id: string): void => {
    const refused = undoRefusal(db, declaration, id, declarations)
    if (refused !== undefined) {
      setKept((was) => ({ ...was, [id]: refused }))
      return
    }
    try {
      mutate((database) => deleteRows(database, declaration, [id], declarations))
    } catch (error) {
      setKept((was) => ({ ...was, [id]: describeTableError(declaration, error).reason }))
      return
    }
    setAdded((ids) => ids.filter((each) => each !== id))
  }

  const one = declaration.title.toLowerCase()
  const label = labelColumn(declaration)
  const shown = added
    .slice(0, fits)
    .flatMap((id) => {
      const row = readRow(db, declaration, id)
      return row === undefined ? [] : [{ id, title: (label === undefined ? '' : valueText(label, row, new Map())) || declaration.title }]
    })
    // Keyed by what a row is called, never its id (the rule), made unique.
    .map((each, index, all) => ({ ...each, key: `${each.title}#${String(all.slice(index + 1).filter((other) => other.title === each.title).length)}` }))

  const stacked = width === 1
  const body = (
    <>
      <div
        ref={fields}
        role="group"
        aria-label={`Add ${one === '' ? 'a row' : `a ${one}`}`}
        className={stacked ? 'flex shrink-0 flex-col' : 'flex shrink-0 flex-wrap items-start gap-x-4 gap-y-3 pt-1'}
        onKeyDown={(event) => {
          // **Enter adds** from a one-line field, Ctrl+Enter from any (U1 §6): what a list took first is its.
          if (event.key !== 'Enter' || event.defaultPrevented || event.shiftKey || event.altKey || locked) return
          const target = event.target
          if (target instanceof HTMLElement && target.closest('[data-new-link]') !== null) return
          const oneLine = target instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(target.type)
          if (!oneLine && !(event.ctrlKey || event.metaKey)) return
          event.preventDefault()
          add()
        }}
      >
        {drawn.length === 0 ? (
          <p className="text-caption text-ink-secondary">It asks nothing.</p>
        ) : (
          drawn.map((column) => {
            const way = entryWayOf(column, undefined, false)
            const word = dayWordOf(column, shape.defaults[column.name])
            const showsWord = word !== undefined && draft[column.name] === dayOfDefault(word, day)
            return (
              <div
                key={column.name}
                className={stacked ? 'flex items-center' : `flex items-end gap-2 ${NARROW.has(column.type) ? 'w-40' : 'w-60'} max-w-full`}
              >
                <div className={stacked ? `min-w-0 flex-1 ${STACKED}` : 'min-w-0 flex-1'}>
                  <Field
                    column={column}
                    part="text"
                    way={way === 'markdown' ? 'line' : way}
                    offered={[way]}
                    one={one}
                    draft={draft}
                    units={units}
                    top={undefined}
                    oneUnit={undefined}
                    linked={NO_LINKED}
                    today={day}
                    choices={column.target === undefined ? [] : (links.get(column.target) ?? [])}
                    labels={new Map()}
                    readOnly={locked}
                    fresh
                    hint={false}
                    marked={false}
                    refused={at(column.name)}
                    mover={undefined}
                    dimmed={false}
                    onChange={(key, text) => setDraft((was) => withField(was, key, text))}
                    onPick={(key, text) => setDraft((was) => withField(was, key, text))}
                    onFocus={() => undefined}
                    onLeave={() => undefined}
                    onSubmit={add}
                    onRevert={() => undefined}
                    onChoose={() => undefined}
                    onOpen={() => undefined}
                  />
                </div>
                {showsWord && !stacked && <span className="pb-1.5 text-caption whitespace-nowrap text-ink-secondary">· {word}</span>}
              </div>
            )
          })
        )}
      </div>
      {!locked && (
        <section
          ref={room}
          aria-label="Just added"
          className={fill ? 'mt-3 min-h-0 flex-1 overflow-hidden' : shown.length > 0 ? 'mt-3' : ''}
        >
          {shown.length > 0 && (
            <Flip as="div" role="list" flipKey={shown.map((each) => each.key).join('|')}>
              {shown.map(({ id, title, key }) => {
                const to = dashboardEntry(declaration.name, id, '', dashboard)
                return (
                  <div key={key} data-motion-key={key} role="listitem" className="flex h-8 items-center gap-2 border-t border-hairline text-body">
                    <Link
                      to={to.to}
                      state={to.state}
                      draggable={false}
                      className="flex min-w-0 flex-1 decoration-hairline-strong underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
                    >
                      <Bidi className="min-w-0 truncate">{title}</Bidi>
                    </Link>
                    {kept[id] !== undefined && (
                      <span className="truncate text-caption text-negative" role="alert" title={kept[id]}>
                        {kept[id]}
                      </span>
                    )}
                    <IconAction label={`Undo adding ${title}`} onClick={() => undo(id)}>
                      <path d="M7.5 4.5 3.75 8.25 7.5 12" />
                      <path d="M3.75 8.25h10.5a5.25 5.25 0 0 1 0 10.5H9" />
                    </IconAction>
                  </div>
                )
              })}
            </Flip>
          )}
        </section>
      )}
    </>
  )

  return (
    <div className={fill ? 'flex min-h-0 flex-1 flex-col' : 'flex flex-col'}>
      <div className={fill ? '-mx-2 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-2' : 'flex flex-col'}>{body}</div>
      {!locked && (
        <div className="mt-3 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-hairline pt-2.5">
          <Button variant="secondary" size="sm" icon="add" onClick={add}>
            Add
          </Button>
          {problems.length > 0 && (
            <span className="text-caption text-negative" role="alert">
              {[
                ...(atFields === 0 ? [] : [`Not added: ${atFields === 1 ? 'one field to put right' : `${String(atFields)} fields to put right`}.`]),
                ...aboutRow.map((each) => each.reason),
              ].join(' ')}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
