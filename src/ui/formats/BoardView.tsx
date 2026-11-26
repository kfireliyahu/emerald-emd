import { useContext, useEffect, useState } from 'react'

import type { ColumnDeclaration, FormatDeclaration } from '@/domain/format/declaration.ts'
import { readValue, type StoredRow } from '@/domain/format/row.ts'
import { entryLabel, lanesOf, type BoardShape } from '@/domain/format/view.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { ChoiceField } from '@/ui/components/ChoiceField.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { cellText } from '@/ui/formats/EntryView.tsx'
import type { ColumnChoice } from '@/ui/formats/addressFilter.ts'
import { ColumnsChoice } from '@/ui/formats/ColumnsChoice.tsx'
import { Conversation, selects } from '@/ui/formats/conversation.ts'
import { cardChoosable, chosenCards, namedByRow } from '@/ui/formats/lineColumns.ts'
import { memberText, toneOf } from '@/ui/formats/tone.ts'
import { Flip } from '@/ui/motion/Flip.tsx'
import { arrowStep } from '@/ui/direction.ts'
import { useT, type Translate } from '@/i18n/current.ts'
import { boardAnswer } from '@/ui/formats/viewAnswers.ts'

/** A card just moved, kept for its Undo: what it is called, and the lane it left. */
interface Moved {
  readonly key: string
  readonly name: string
  readonly from: string
  readonly to: string
}

/**
 * **A board** — M27 U3, D-301.
 *
 * One format's rows as cards in lanes, one lane per member of an enum column:
 * the first view a pack declares as data rather than a screen written for it,
 * and drawn the same for any format with an enum. **A lane with no rows is
 * still drawn**, because it is somewhere a card can go.
 *
 * A card is the row's name and the columns the board says `card` about, and
 * nothing else (D-294's line). Dragging one to another lane — or Left and
 * Right on a focused card — is `onMove`, which the screen writes through the
 * same checks and the same `updateRow` as `update_format_rows`: moving a card
 * is correcting one column of one row, which a conversation could always do.
 *
 * Drawn in M27 U8's theme (D-306): lanes on `surface`, square cards, an
 * empty lane saying "Nothing <member>", a live card wearing the accent rule.
 * **A card that changes lane glides from where it was to where it went**,
 * whoever moved it (this screen, or a session through the disk watch), and the
 * cards it leaves and joins make room — M39's layout motion (`Flip`, U2), which
 * replaced the slide in from the side (D-306) because it shows the card's
 * whole path; nothing moves on first paint, and a search snaps.
 *
 * **Which columns a card draws is the address's too** (M37 U5, D-478):
 * `columns:unit=title`, chosen under *Columns* beside *Lanes by*. The name
 * heads every card, and the lane is the state.
 */
export function BoardView({
  board,
  enums,
  rows,
  labels,
  capped,
  locked,
  refusal,
  onLanes,
  onMove,
  onOpen,
  format,
  columns = {},
  onColumns,
}: {
  board: BoardShape<ColumnDeclaration>
  /** Every enum column, for the picker of which one the lanes are. */
  enums: readonly ColumnDeclaration[]
  rows: readonly StoredRow[]
  labels: ReadonlyMap<string, string>
  /** How many rows there were when the board shows fewer. */
  capped: number | undefined
  /** Why the rows cannot be moved here (D-269), or nothing. */
  locked: string | undefined
  /** What the last move was refused with, or nothing. */
  refusal: string | undefined
  onLanes: (column: string) => void
  onMove: (row: StoredRow, member: string) => void
  onOpen: (row: StoredRow) => void
  /** The format the cards are rows of, which *Columns* offers the columns of. */
  format?: FormatDeclaration | undefined
  columns?: ColumnChoice
  onColumns?: ((next: ColumnChoice) => void) | undefined
}) {
  const t = useT()
  const chose = format === undefined ? undefined : columns[format.name]
  const cards = format === undefined ? board.cards : chosenCards(format, board, chose)
  const [moved, setMoved] = useState<Moved | undefined>(undefined)
  const conversation = useContext(Conversation)
  const selection = format === undefined ? undefined : conversation.selection
  const [dragging, setDragging] = useState<string | undefined>(undefined)
  const [over, setOver] = useState<string | undefined>(undefined)
  const members = board.lanes.values
  const lanes = lanesOf(members, rows, (row) => memberOf(board.lanes, row))
  const movable = locked === undefined

  const drop = (member: string | undefined): void => {
    const row = rows.find((each) => each.id === dragging)
    setDragging(undefined)
    setOver(undefined)
    if (row === undefined || member === undefined || memberOf(board.lanes, row) === member) return
    moveCard(row, member)
  }

  // Keyed by what a card is called, never its id: a text document renews ids
  // on every write (D-247), and a card keyed by one would land again each save.
  const keys = uniqueCardKeys(rows.map((row) => (board.name === undefined ? row.id : cardText(board.name, row, labels, t))))
  const keyOf = new Map(rows.map((row, index) => [row.id, keys[index] ?? row.id]))
  /**
   * **A move is made at once, with an Undo beside it** (M64 U14, D-626, after
   * D-617): *Moved M2 U3 to built · Undo* stands in the bar above the lanes,
   * where it never pushes a card under the pointer, and Undo (Ctrl+Z too) moves
   * the card back by the same write. A refused move says why in the same place.
   */
  const moveCard = (row: StoredRow, member: string): void => {
    const from = memberOf(board.lanes, row)
    const key = keyOf.get(row.id) ?? row.id
    onMove(row, member)
    setMoved(from === undefined ? undefined : { key, name: board.name === undefined ? row.id : cardText(board.name, row, labels, t), from, to: member })
  }
  const undoMove = (): void => {
    if (moved === undefined) return
    // Found again by what it is called: a text document renews ids on every write (D-247).
    const row = rows.find((each) => (keyOf.get(each.id) ?? each.id) === moved.key)
    setMoved(undefined)
    if (row !== undefined) onMove(row, moved.from)
  }
  useEffect(() => {
    if (moved === undefined) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z' || event.shiftKey) return
      const target = event.target as HTMLElement | null
      if (target !== null && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      event.preventDefault()
      undoMove()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const step = (row: StoredRow, by: -1 | 1): string | undefined => {
    const at = members.indexOf(memberOf(board.lanes, row) ?? '')
    const next = members[at === -1 ? 0 : at + by]
    return next === undefined || at === members.indexOf(next) ? undefined : next
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={VIEW_STRIP}>
        {enums.length > 1 ? (
          <label className="flex items-center gap-2">
            {t('views.board.lanesBy')}
            <ChoiceField
              className={`${FIELD} w-40`}
              readOnly
              filter={false}
              aria-label={t('views.board.lanesBy')}
              text={entryLabel(board.lanes)}
              choices={enums.map((each) => ({ value: each.name, label: entryLabel(each) }))}
              onText={() => undefined}
              onPick={(choice) => onLanes(choice.value)}
            />
          </label>
        ) : (
          <span>
            <Phrase text={t('views.board.lanesByColumn')} parts={{ column: <Bidi>{entryLabel(board.lanes)}</Bidi> }} />
          </span>
        )}
        {capped !== undefined && (
          <span className="tabular-nums">{t('views.board.showing', { shown: rows.length, total: capped })}</span>
        )}
        {refusal !== undefined ? (
          <span className="text-negative" role="status">
            <span className="font-medium">{t('views.board.notMoved')}</span> <Bidi>{refusal}</Bidi>
          </span>
        ) : (
          moved !== undefined && (
            <span className="inline-flex items-baseline gap-3" role="status">
              <span className="text-ink">
                <Phrase text={t('views.board.moved')} parts={{ name: <Bidi>{moved.name}</Bidi>, member: <Bidi>{memberText(moved.to)}</Bidi> }} />
              </span>
              <button type="button" className="fc-text-action" onClick={undoMove} title={t('views.undoHint')}>
                {t('views.undo')}
              </button>
            </span>
          )
        )}
        {format !== undefined && onColumns !== undefined && (
          <span className="ms-auto">
            <ColumnsChoice formats={[cardChoosable(format, board)]} chosen={columns} onChange={onColumns} />
          </span>
        )}
      </div>
      <Flip
        as="div"
        className="flex min-h-0 flex-1 gap-4 overflow-x-auto px-6 py-6"
        role="list"
        aria-label={t('views.board.lanes')}
        // Which card is in which lane, in order: a move, an arrival or a card
        // gone changes it, and the cards glide (M39, src/ui/motion/).
        flipKey={lanes.map((lane) => `${lane.member ?? ''}:${lane.rows.map((row) => keyOf.get(row.id) ?? row.id).join(',')}`).join('|')}
      >
        {lanes.map((lane) => {
          const key = lane.member ?? ''
          return (
            <section
              key={key}
              role="listitem"
              aria-label={lane.member ?? t('views.board.noValue')}
              className={`flex min-w-[200px] flex-1 basis-0 flex-col gap-2 bg-surface p-3 ${
                over === key && lane.member !== undefined ? 'outline outline-2 -outline-offset-2 outline-accent' : ''
              }`}
              onDragOver={(event) => {
                if (dragging === undefined || lane.member === undefined) return
                event.preventDefault()
                setOver(key)
              }}
              onDragLeave={() => setOver((was) => (was === key ? undefined : was))}
              onDrop={(event) => {
                event.preventDefault()
                drop(lane.member)
              }}
            >
              <header className="flex items-center gap-2 px-1 pt-1 pb-2">
                <span className="fc-dot" data-tone={toneOf(lane.member)} aria-hidden />
                <span className="fc-label text-ink">{lane.member === undefined ? t('views.board.noValue') : memberText(lane.member)}</span>
                <span className="ms-auto font-mono text-caption text-ink-secondary tabular-nums">
                  {String(lane.rows.length)}
                </span>
              </header>
              {lane.rows.length === 0 ? (
                <div className="border border-dashed border-hairline-strong px-3 py-4 text-center text-caption text-ink-secondary">
                  {lane.member === undefined ? (
                    t('views.board.emptyNone')
                  ) : (
                    <Phrase text={t('views.board.emptyLane')} parts={{ member: <Bidi>{memberText(lane.member)}</Bidi> }} />
                  )}
                </div>
              ) : (
                <ol className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                  {lane.rows.map((row) => {
                    const cardKey = keyOf.get(row.id) ?? row.id
                    const name = board.name === undefined ? row.id : cardText(board.name, row, labels, t)
                    // A link is a chip and text is the title: the first card column that
                    // is not a link, so a unit's `title` heads it and its milestone does not.
                    const title = cards.find((column) => column.type !== 'link' && column.type !== 'links')
                    // A link the card's name already says (its milestone under its ref) is
                    // left out unless it was chosen under Columns (M64 F19, D-632).
                    const rest = cards.filter(
                      (column) => column !== title && (chose !== undefined || !namedByRow(column, cardText(column, row, labels, t), name)),
                    )
                    const titleText = title === undefined ? '' : cardText(title, row, labels, t)
                    return (
                      <li key={cardKey} data-motion-key={cardKey}>
                        {/* **A board card is one link** (M54 F2, D-531, A card is one link):
                            the title's button is stretched over the card, so a click
                            anywhere opens the entry, the arrows raised above it stay
                            buttons, and the card still drags. */}
                        <article
                          draggable={movable}
                          aria-selected={selection === undefined ? undefined : selection.has(row.id)}
                          className={`fc-board-card relative flex cursor-pointer flex-col gap-2 p-3 ${dragging === row.id ? 'opacity-60' : ''} ${selection?.has(row.id) === true ? 'outline outline-2 outline-accent' : ''}`}
                          data-tone={toneOf(memberOf(board.lanes, row))}
                          onDragStart={(event) => {
                            event.dataTransfer.effectAllowed = 'move'
                            event.dataTransfer.setData('text/plain', row.id)
                            setDragging(row.id)
                          }}
                          onDragEnd={() => {
                            setDragging(undefined)
                            setOver(undefined)
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="flex min-w-0 font-mono text-caption text-ink-secondary">
                              <Bidi className="min-w-0 truncate">{name}</Bidi>
                            </span>
                            {movable && (
                              <span className="relative z-10 ms-auto flex gap-1">
                                <MoveButton side="left" name={name} to={step(row, -1)} onMove={(member) => moveCard(row, member)} />
                                <MoveButton side="right" name={name} to={step(row, 1)} onMove={(member) => moveCard(row, member)} />
                              </span>
                            )}
                          </div>
                          <button
                            type="button"
                            data-row={row.id}
                            // The demo tour's anchor (M33 U6): `card-M2 U3`.
                            data-tour={`card-${name}`}
                            className="fc-card-title line-clamp-3 text-start leading-snug font-medium after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                            onClick={(event) => {
                              // Ctrl-click selects the card for the conversation (M51 U7).
                              if (format !== undefined && selects(event, conversation)) selection?.toggle(format, row)
                              else onOpen(row)
                            }}
                            onKeyDown={(event) => {
                              if (!movable || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return
                              const next = step(row, arrowStep(event.key) === 1 ? 1 : -1)
                              if (next === undefined) return
                              event.preventDefault()
                              moveCard(row, next)
                            }}
                          >
                            <Bidi>{titleText === '' ? name : titleText}</Bidi>
                          </button>
                          {rest.length > 0 && (
                            <div className="flex flex-wrap items-center gap-2">
                              {rest.map((column) => {
                                const text = cardText(column, row, labels, t)
                                if (text === '') return null
                                return text.length <= 24 ? (
                                  <span key={column.name} className="fc-state">
                                    <Bidi>{text}</Bidi>
                                  </span>
                                ) : (
                                  <span key={column.name} className="line-clamp-2 text-caption text-ink-secondary">
                                    <Bidi>{text}</Bidi>
                                  </span>
                                )
                              })}
                            </div>
                          )}
                        </article>
                      </li>
                    )
                  })}
                </ol>
              )}
            </section>
          )
        })}
      </Flip>
    </div>
  )
}

/** The arrows on a card: a move to the lane beside, the same write a drag makes. */
function MoveButton({
  side,
  name,
  to,
  onMove,
}: {
  side: 'left' | 'right'
  name: string
  to: string | undefined
  onMove: (member: string) => void
}) {
  const t = useT()
  return (
    <button
      type="button"
      className="inline-flex size-7 items-center justify-center border border-transparent text-ink-secondary transition-colors hover:border-hairline-strong hover:text-ink disabled:cursor-default disabled:opacity-30"
      disabled={to === undefined}
      aria-label={
        to === undefined
          ? t(side === 'left' ? 'views.board.moveLeft' : 'views.board.moveRight', { name })
          : t('views.board.moveTo', { name, member: memberText(to) })
      }
      onClick={() => {
        if (to !== undefined) onMove(to)
      }}
    >
      {side === 'left' ? '‹' : '›'}
    </button>
  )
}

/** Card keys made unique when two cards share a name. */
function uniqueCardKeys(names: readonly string[]): readonly string[] {
  const seen = new Map<string, number>()
  return names.map((name) => {
    const times = seen.get(name) ?? 0
    seen.set(name, times + 1)
    return times === 0 ? name : `${name}\u0000${String(times)}`
  })
}

/** The member a row is in, or nothing. */
function memberOf(column: ColumnDeclaration, row: StoredRow): string | undefined {
  const value = readValue(column, row)
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * **The views' one strip of controls** (M64 F17, D-632): under the tab strip,
 * the board's *Lanes by* and *Columns*, the roadmap's filters for what it folds,
 * *In the order of*, *Columns* and *Fold all*, and the ready list's *Columns* —
 * one row of the same classes on all three, so switching views moves nothing.
 */
export const VIEW_STRIP =
  'flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline px-6 py-1 text-caption text-ink-secondary'

/** A cell as a card prints it: a link by what it names, as the sheet does; a yes or a no in the language now. */
export function cardText(column: ColumnDeclaration, row: StoredRow, labels: ReadonlyMap<string, string>, t: Translate): string {
  const value = readValue(column, row)
  if (column.type === 'link' && typeof value === 'string') return labels.get(value) ?? value
  if (Array.isArray(value)) return value.map((id: string) => labels.get(id) ?? id).join(', ')
  return cellText(value, t)
}

/** **Where each thing stands**, the board's answer (M64 U14, D-626): how many cards in each lane. */
export function boardAnswerOf(t: Translate, board: BoardShape<ColumnDeclaration>, rows: readonly StoredRow[]): string {
  return boardAnswer(t, lanesOf(board.lanes.values, rows, (row) => memberOf(board.lanes, row)))
}
