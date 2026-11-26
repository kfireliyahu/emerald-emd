import { useEffect, useRef, useState } from 'react'
import type { Database } from 'sql.js'

import { formatMoney, money, type CurrencyCode, type Money } from '@/core/money.ts'
import { goalFeeds } from '@/data/repositories/goalDepositRepository.ts'
import { closeGoal, deleteDeposit, goalHeld, setGoalClosed } from '@/data/repositories/savingsRepository.ts'
import type { SavingGoal } from '@/domain/model/savings.ts'
import { useT } from '@/i18n/current.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { useAskHere } from '@/ui/components/useDismiss.ts'
import { today } from '@/ui/today.ts'

/** A screen's write: runs the work inside `mutate`, and says whether it landed. */
export type GoalWrite = (work: (database: Database, now: number) => void) => boolean

/**
 * **What closing this goal asks about** (M64 F72, D-645): the money it still
 * holds, which a close asks whether was spent — or nothing to ask, when it holds
 * nothing or follows its holding's rows (D-357), whose sale is its money out.
 */
export function spentQuestionFor(db: Database, goal: SavingGoal, currency: CurrencyCode): Money | undefined {
  if (goal.isClosed || goalFeeds(db).get(goal.id)?.kind === 'HOLDING') return undefined
  const held = goalHeld(db, goal.id).filter((one) => one.amount.currency === currency)
  if (held.length === 0) return undefined
  return money(
    held.reduce((sum, one) => sum + one.amount.minor, 0),
    currency,
  )
}

interface Closed {
  readonly goalId: string
  readonly name: string
  /** Taken out as spent, when it was. */
  readonly spent: Money | undefined
  /** Left held, when it was not spent. */
  readonly kept: Money | undefined
  /** The withdrawals the close wrote, which its Undo deletes. */
  readonly withdrawals: readonly string[]
}

/** How long *closed · Undo* stays where the goal was closed. */
const UNDO_MS = 8000

/**
 * **Closing a goal, with its Undo** (M64 F72): `closeGoal` in one write — spent,
 * the withdrawal of what it holds and the close together — then a note where it
 * was done saying what happened, whose Undo (or Ctrl+Z) deletes those
 * withdrawals and opens the goal again. The note goes after a few seconds.
 */
export function useGoalClose(write: GoalWrite) {
  const t = useT()
  const [closed, setClosed] = useState<Closed | undefined>()

  const close = (goal: SavingGoal, spent: boolean, held: Money | undefined): void => {
    let withdrawals: readonly string[] = []
    const landed = write((database, now) => {
      withdrawals = closeGoal(database, goal.id, { spent, asOf: today(), note: t('wealth.goalDetail.spentNote', { goal: goal.name }) }, now).map(
        (one) => one.id,
      )
    })
    if (!landed) return
    setClosed({
      goalId: goal.id,
      name: goal.name,
      spent: spent ? held : undefined,
      kept: spent ? undefined : held,
      withdrawals,
    })
  }

  const undo = (): void => {
    if (closed === undefined) return
    const back = closed
    setClosed(undefined)
    write((database, now) => {
      for (const id of back.withdrawals) deleteDeposit(database, id, now)
      setGoalClosed(database, back.goalId, false, now)
    })
  }
  const undoRef = useRef(undo)
  undoRef.current = undo
  useEffect(() => {
    if (closed === undefined) return
    const fade = window.setTimeout(() => setClosed(undefined), UNDO_MS)
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, [contenteditable="true"]')) return
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undoRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(fade)
      window.removeEventListener('keydown', onKey)
    }
  }, [closed])

  return { closed, close, undo }
}

/** What a close did, and its Undo, said where it was done. */
export function ClosedNote({ closed, onUndo }: { readonly closed: Closed | undefined; readonly onUndo: () => void }) {
  const t = useT()
  if (closed === undefined) return null
  const text =
    closed.spent !== undefined
      ? t('wealth.goals.closedNote.spent', { amount: formatMoney(closed.spent) })
      : closed.kept !== undefined
        ? t('wealth.goals.closedNote.kept', { amount: formatMoney(closed.kept) })
        : t('wealth.goals.closedNote.empty')
  return (
    <p role="status" className="fc-pop-enter m-0 text-caption text-ink-secondary" data-closed-note={closed.goalId}>
      <span className="me-3">
        <Phrase text={text} parts={{ name: <Bidi>{closed.name}</Bidi> }} />
      </span>
      <button type="button" className="fc-text-action" onClick={onUndo} title={t('wealth.goals.closedNote.undoTitle')}>
        {t('wealth.common.undo')}
      </button>
    </p>
  )
}

/**
 * **The panel's Close goal, and its question at the button** (M64 F72): a goal
 * that holds nothing, or follows its holding, closes at once (with its Undo); one
 * that holds money asks, anchored under this button and never in a bar at the
 * bottom, whether that money was spent. It behaves as every question asked at
 * its button does (`useAskHere`, D-642): *Spent* has the focus, Esc or a press
 * outside takes the question back and leaves the goal open, focus returns here.
 */
export function CloseGoalButton({
  goal,
  held,
  onClose,
}: {
  readonly goal: SavingGoal
  /** What it holds, when closing has a question to ask. */
  readonly held: Money | undefined
  readonly onClose: (spent: boolean) => void
}) {
  const t = useT()
  const [asking, setAsking] = useState(false)
  const ask = useAskHere<HTMLSpanElement>(asking, () => setAsking(false))
  const answer = (spent: boolean): void => {
    setAsking(false)
    onClose(spent)
  }
  return (
    <span ref={ask.box} className="relative inline-flex" onKeyDown={ask.onKeyDown}>
      <Button ref={ask.back} variant="ghost" size="sm" aria-expanded={held === undefined ? undefined : asking} onClick={() => (held === undefined ? onClose(false) : setAsking(!asking))}>
        {t('wealth.goalDetail.closeGoal')}
      </Button>
      {asking && held !== undefined && (
        <span
          role="alertdialog"
          aria-label={t('wealth.goalDetail.closeGoal')}
          className="fc-pop-enter absolute end-0 top-full z-40 mt-1 flex w-80 flex-col gap-2 border border-hairline bg-elevated p-3 text-start text-body font-normal whitespace-normal shadow-pop"
        >
          <span className="font-medium">
            <Phrase text={t('wealth.goals.menu.spentQuestion', { amount: formatMoney(held) })} parts={{ name: <Bidi>{goal.name}</Bidi> }} />
          </span>
          <span className="text-caption text-ink-secondary">{t('wealth.goals.menu.spentWhy')}</span>
          <span className="flex flex-col items-start gap-1.5">
            {/* A question's confirming answer has the focus (D-642). */}
            <Button variant="secondary" size="sm" autoFocus onClick={() => answer(true)}>
              {t('wealth.goals.menu.spent')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => answer(false)}>
              {t('wealth.goals.menu.notSpent')}
            </Button>
            <Button variant="ghost" size="sm" onClick={ask.takeBack}>
              {t('wealth.common.cancel')}
            </Button>
          </span>
        </span>
      )}
    </span>
  )
}
