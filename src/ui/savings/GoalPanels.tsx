import { formatMoney } from '@/core/money.ts'
import type { Suggestion } from '@/domain/goalRhythm.ts'
import { useT } from '@/i18n/current.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'

/**
 * The goals' amounts Plan would be given, before anything is written (S3): the
 * goals by nearest date. On Plan since M28 F10: a split is Plan's.
 */
export function SuggestionPanel({
  suggestion,
  onApply,
  onClose,
}: {
  suggestion: Suggestion | undefined
  onApply: () => void
  onClose: () => void
}) {
  const t = useT()
  if (suggestion === undefined) {
    return (
      <div className="fc-pop-enter flex items-center gap-4 border border-hairline bg-surface px-4 py-2">
        <span>{t('plan.suggestion.nothing')}</span>
        <Button variant="ghost" size="sm" className="ms-auto" onClick={onClose}>
          {t('plan.suggestion.close')}
        </Button>
      </div>
    )
  }
  return (
    <section aria-label={t('plan.suggestion.title')} className="fc-pop-enter flex flex-col gap-2 border border-hairline bg-surface px-4 py-3">
      <div>
        <h2 className="m-0 text-[16px] font-medium">{t('plan.suggestion.title')}</h2>
        <p className="m-0 mt-0.5 text-caption text-ink-secondary">
          {t('plan.suggestion.within', { pool: formatMoney(suggestion.pool) })}
        </p>
      </div>
      <table className="w-full border-collapse text-start">
        <tbody>
          {suggestion.amounts.map((one) => (
            <tr key={one.goalId} className="border-t border-hairline">
              <td className="py-1.5 pe-3">
                <Bidi>{one.name}</Bidi>
              </td>
              <td className="py-1.5 pe-3 text-end tabular-nums">{formatMoney(one.amount)}</td>
              <td className="py-1.5 text-caption text-ink-secondary">
                {t(`plan.suggestion.reasons.${one.reason}`)}
                {one.wanted.minor > one.amount.minor && t('plan.suggestion.needs', { amount: formatMoney(one.wanted) })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="sm" icon="check" onClick={onApply}>
          {t('plan.suggestion.use')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('plan.suggestion.notNow')}
        </Button>
        <span className="text-caption text-ink-secondary">{t('plan.suggestion.leaves', { amount: formatMoney(suggestion.left) })}</span>
      </div>
    </section>
  )
}
