import { useMemo, useState } from 'react'

import { formatMoney, fromMajorUnits, type CurrencyCode } from '@/core/money.ts'
import { parseISODate, toISODate, type LocalDate } from '@/core/time.ts'
import { parseAmountText } from '@/data/importer/normalize.ts'
import {
  deleteHoldingReading,
  HoldingReadingError,
  listHoldingReadings,
  readingChecks,
  recordHoldingReading,
  type NewHoldingReading,
} from '@/data/repositories/holdingReadingRepository.ts'
import { parseQuantity, quantityText } from '@/data/repositories/transactionRepository.ts'
import type { ReadingCheck } from '@/domain/holdingReadings.ts'
import type { CostBasisCheck } from '@/domain/goalDeposits.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Button } from '@/ui/components/Button.tsx'
import { Tag } from '@/ui/wealth/parts.tsx'

const FIELD = 'h-[30px] min-w-0 border border-hairline-strong bg-background px-2 tabular-nums'
const SHOWN = 4

/**
 * **What the holding is worth, by the statements that said so** (M30 U5, D-358):
 * its readings, newest first, each with what it proves about the rows — and the
 * screen half of `record_holding_readings`, a reading typed by hand. Nothing is
 * fetched; a reading is what a statement printed.
 */
export function HoldingReadings({
  holdingId,
  currency,
  asOf,
  startOpen = false,
}: {
  holdingId: string
  currency: CurrencyCode
  asOf: LocalDate
  /** The form for a new reading is open from the start — where New figure lands (M36 U01). */
  startOpen?: boolean
}) {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const readings = useMemo(
    () => (db === undefined ? [] : [...listHoldingReadings(db, holdingId)].reverse()),
    [db, revision, holdingId],
  )
  const [open, setOpen] = useState(startOpen)
  const [day, setDay] = useState(toISODate(asOf))
  const [worth, setWorth] = useState('')
  const [cost, setCost] = useState('')
  const [quantity, setQuantity] = useState('')
  const [problem, setProblem] = useState<string | undefined>()
  const [clash, setClash] = useState<NewHoldingReading | undefined>()
  if (db === undefined) return null

  const write = (input: NewHoldingReading, correct: boolean): void => {
    setProblem(undefined)
    setClash(undefined)
    try {
      mutate((database) => void recordHoldingReading(database, input, { correct }, Date.now()))
      setOpen(false)
      setWorth('')
      setCost('')
      setQuantity('')
    } catch (error) {
      if (error instanceof HoldingReadingError && error.message.startsWith('There is already a reading')) setClash(input)
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  const save = (): void => {
    const when = parseISODate(day)
    const value = parseAmountText(worth)
    const paid = cost.trim() === '' ? undefined : parseAmountText(cost)
    const count = quantity.trim() === '' ? undefined : parseQuantity(quantity)
    if (when === undefined) return setProblem('Give the date as 2026-10-03.')
    if (value === undefined) return setProblem('Type what the statement says it was worth.')
    if (cost.trim() !== '' && paid === undefined) return setProblem('Type the cost as an amount, or leave it empty.')
    if (count !== undefined && !count.ok) return setProblem(count.error)
    write(
      {
        holdingId,
        asOf: when,
        value: fromMajorUnits(value, currency),
        costBasis: paid === undefined ? undefined : fromMajorUnits(paid, currency),
        quantityMicro: count?.ok === true ? count.value : undefined,
      },
      false,
    )
  }

  const remove = (id: string): void => {
    setProblem(undefined)
    try {
      mutate((database) => deleteHoldingReading(database, id, Date.now()))
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <div className="flex flex-col gap-1.5 border-t border-hairline pt-2">
      <b className="font-medium">What the statements say it is worth</b>
      {readings.length === 0 ? (
        <p className="m-0 text-caption text-ink-secondary">
          No reading yet, so it counts at what went in. A statement’s worth, cost and quantity go here, read by a
          conversation or typed below.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {readings.slice(0, SHOWN).map((reading) => {
            const checks = readingChecks(db, reading)
            return (
              <li key={reading.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-caption">
                <span className="font-mono text-[12px] text-ink-secondary">{reading.asOf}</span>
                <b className="font-medium tabular-nums">{formatMoney(reading.value)}</b>
                {reading.quantityMicro !== undefined && (
                  <span className="text-ink-secondary tabular-nums">× {quantityText(reading.quantityMicro)}</span>
                )}
                {checks.cash !== undefined ? (
                  <Check name="Account balance" check={checks.cash} />
                ) : (
                  <>
                    <Check name="Cost" check={checks.cost} />
                    <Check name="Quantity" check={checks.quantity} />
                    <Check name="Price" check={checks.price} />
                  </>
                )}
                <button
                  type="button"
                  onClick={() => remove(reading.id)}
                  className="ml-auto text-ink-tertiary hover:text-negative"
                  aria-label={`Remove the reading of ${reading.asOf}`}
                >
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {readings.length > SHOWN && (
        <p className="m-0 text-caption text-ink-secondary">and {String(readings.length - SHOWN)} earlier</p>
      )}
      {!open ? (
        <div>
          <Button variant="ghost" size="sm" icon="add" onClick={() => setOpen(true)}>
            Record a reading
          </Button>
        </div>
      ) : (
        <div className="fc-pop-enter grid grid-cols-[90px_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
          <label htmlFor="reading-day">On</label>
          <input id="reading-day" value={day} onChange={(event) => setDay(event.target.value)} className={FIELD} />
          <label htmlFor="reading-worth">Worth</label>
          <input
            id="reading-worth"
            inputMode="decimal"
            value={worth}
            onChange={(event) => setWorth(event.target.value)}
            className={`${FIELD} text-right`}
          />
          <label htmlFor="reading-cost">Cost</label>
          <input
            id="reading-cost"
            inputMode="decimal"
            placeholder="if printed"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
            className={`${FIELD} text-right`}
          />
          <label htmlFor="reading-quantity">Quantity</label>
          <input
            id="reading-quantity"
            inputMode="decimal"
            placeholder="if printed"
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className={`${FIELD} text-right`}
          />
          <span />
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" size="sm" icon="check" onClick={save}>
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {problem !== undefined && (
        <div className="flex flex-wrap items-center gap-2.5">
          <p className="m-0 text-negative">{problem}</p>
          {clash !== undefined && (
            <Button variant="secondary" size="sm" onClick={() => write(clash, true)}>
              Replace it
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/** One check as a tag, its figures or its reason on hover: proved, off, or unchecked (D-149). */
function Check({ name, check }: { name: string; check: CostBasisCheck | ReadingCheck<unknown> }) {
  const title = check.kind === 'UNCHECKED' ? check.reason : check.kind === 'FAILED' ? failedTitle(check) : undefined
  return (
    <span title={title}>
      <Tag tone={check.kind === 'PROVED' ? 'good' : check.kind === 'FAILED' ? 'bad' : 'dash'}>
        {name} {check.kind === 'PROVED' ? 'matches' : check.kind === 'FAILED' ? 'is off' : 'unchecked'}
      </Tag>
    </span>
  )
}

function failedTitle(check: CostBasisCheck | ReadingCheck<unknown>): string | undefined {
  if (check.kind !== 'FAILED') return undefined
  if ('difference' in check) return `Printed ${formatMoney(check.printed)}; the rows are ${formatMoney(check.difference)} apart.`
  const show = (value: unknown): string =>
    typeof value === 'number'
      ? quantityText(value)
      : typeof value === 'object' && value !== null && 'minor' in value
        ? formatMoney(value as Parameters<typeof formatMoney>[0])
        : String(value)
  return `Printed ${show(check.printed)}; the rows say ${show(check.ours)}.`
}
