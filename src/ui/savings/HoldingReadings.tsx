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
import { useT, type Translate } from '@/i18n/current.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Button } from '@/ui/components/Button.tsx'
import { Tag } from '@/ui/wealth/parts.tsx'
import { uncheckedSaid } from '@/ui/wealth/words.ts'

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
  const t = useT()
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
    if (when === undefined) return setProblem(t('wealth.holdingReadings.badDate'))
    if (value === undefined) return setProblem(t('wealth.holdingReadings.badWorth'))
    if (cost.trim() !== '' && paid === undefined) return setProblem(t('wealth.holdingReadings.badCost'))
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
      <b className="font-medium">{t('wealth.holdingReadings.title')}</b>
      {readings.length === 0 ? (
        <p className="m-0 text-caption text-ink-secondary">{t('wealth.holdingReadings.empty')}</p>
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
                  <Check name={t('wealth.holdingReadings.check.account')} check={checks.cash} t={t} />
                ) : (
                  <>
                    <Check name={t('wealth.holdingReadings.check.cost')} check={checks.cost} t={t} />
                    <Check name={t('wealth.holdingReadings.check.quantity')} check={checks.quantity} t={t} />
                    <Check name={t('wealth.holdingReadings.check.price')} check={checks.price} t={t} />
                  </>
                )}
                <button
                  type="button"
                  onClick={() => remove(reading.id)}
                  className="ms-auto text-ink-tertiary hover:text-negative"
                  aria-label={t('wealth.holdingReadings.removeOf', { day: reading.asOf })}
                >
                  {t('wealth.holdingReadings.remove')}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {readings.length > SHOWN && (
        <p className="m-0 text-caption text-ink-secondary">
          {t('wealth.holdingReadings.earlier', { count: readings.length - SHOWN })}
        </p>
      )}
      {!open ? (
        <div>
          <Button variant="ghost" size="sm" icon="add" onClick={() => setOpen(true)}>
            {t('wealth.holdingReadings.record')}
          </Button>
        </div>
      ) : (
        <div className="fc-pop-enter grid grid-cols-[90px_minmax(0,1fr)] items-center gap-x-3 gap-y-2">
          <label htmlFor="reading-day">{t('wealth.holdingReadings.on')}</label>
          <input id="reading-day" value={day} onChange={(event) => setDay(event.target.value)} className={FIELD} />
          <label htmlFor="reading-worth">{t('wealth.holdingReadings.worth')}</label>
          <input
            id="reading-worth"
            inputMode="decimal"
            value={worth}
            onChange={(event) => setWorth(event.target.value)}
            className={`${FIELD} text-end`}
          />
          <label htmlFor="reading-cost">{t('wealth.holdingReadings.cost')}</label>
          <input
            id="reading-cost"
            inputMode="decimal"
            placeholder={t('wealth.holdingReadings.ifPrinted')}
            value={cost}
            onChange={(event) => setCost(event.target.value)}
            className={`${FIELD} text-end`}
          />
          <label htmlFor="reading-quantity">{t('wealth.holdingReadings.quantity')}</label>
          <input
            id="reading-quantity"
            inputMode="decimal"
            placeholder={t('wealth.holdingReadings.ifPrinted')}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
            className={`${FIELD} text-end`}
          />
          <span />
          <div className="flex flex-wrap gap-3">
            <Button variant="primary" size="sm" icon="check" onClick={save}>
              {t('wealth.reading.save')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t('wealth.common.cancel')}
            </Button>
          </div>
        </div>
      )}
      {problem !== undefined && (
        <div className="flex flex-wrap items-center gap-2.5">
          <p className="m-0 text-negative">{problem}</p>
          {clash !== undefined && (
            <Button variant="secondary" size="sm" onClick={() => write(clash, true)}>
              {t('wealth.holdingReadings.replace')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

/** One check as a tag, its figures or its reason on hover: proved, off, or unchecked (D-149). */
function Check({ name, check, t }: { name: string; check: CostBasisCheck | ReadingCheck<unknown>; t: Translate }) {
  const title = check.kind === 'UNCHECKED' ? uncheckedSaid(check.why, t) : check.kind === 'FAILED' ? failedTitle(check, t) : undefined
  return (
    <span title={title}>
      <Tag tone={check.kind === 'PROVED' ? 'good' : check.kind === 'FAILED' ? 'bad' : 'dash'}>
        {check.kind === 'PROVED'
          ? t('wealth.holdingReadings.matches', { name })
          : check.kind === 'FAILED'
            ? t('wealth.holdingReadings.off', { name })
            : t('wealth.holdingReadings.unchecked', { name })}
      </Tag>
    </span>
  )
}

function failedTitle(check: CostBasisCheck | ReadingCheck<unknown>, t: Translate): string | undefined {
  if (check.kind !== 'FAILED') return undefined
  if ('difference' in check) {
    return t('wealth.holdingReadings.apart', { printed: formatMoney(check.printed), difference: formatMoney(check.difference) })
  }
  const show = (value: unknown): string =>
    typeof value === 'number'
      ? quantityText(value)
      : typeof value === 'object' && value !== null && 'minor' in value
        ? formatMoney(value as Parameters<typeof formatMoney>[0])
        : String(value)
  return t('wealth.holdingReadings.rowsSay', { printed: show(check.printed), ours: show(check.ours) })
}
