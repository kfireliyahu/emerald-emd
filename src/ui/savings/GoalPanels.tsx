import { formatMoney } from '@/core/money.ts'
import { SUGGESTION_WORDS, type Suggestion } from '@/domain/goalRhythm.ts'
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
  if (suggestion === undefined) {
    return (
      <div className="fc-pop-enter flex items-center gap-4 border border-hairline bg-surface px-4 py-2">
        <span>Nothing to suggest: no open goal has a bucket in this plan.</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onClose}>
          Close
        </Button>
      </div>
    )
  }
  return (
    <section aria-label="Suggested goal amounts" className="fc-pop-enter flex flex-col gap-2 border border-hairline bg-surface px-4 py-3">
      <div>
        <h2 className="m-0 text-[16px] font-medium">Suggested goal amounts</h2>
        <p className="m-0 mt-0.5 text-caption text-ink-secondary">
          Goals by nearest date, within {formatMoney(suggestion.pool)}.
        </p>
      </div>
      <table className="w-full border-collapse text-left">
        <tbody>
          {suggestion.amounts.map((one) => (
            <tr key={one.goalId} className="border-t border-hairline">
              <td className="py-1.5 pr-3">
                <Bidi>{one.name}</Bidi>
              </td>
              <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(one.amount)}</td>
              <td className="py-1.5 text-caption text-ink-secondary">
                {SUGGESTION_WORDS[one.reason]}
                {one.wanted.minor > one.amount.minor && ` (needs ${formatMoney(one.wanted)})`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" size="sm" icon="check" onClick={onApply}>
          Use these amounts
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Not now
        </Button>
        <span className="text-caption text-ink-secondary">Leaves {formatMoney(suggestion.left)} for Everything else.</span>
      </div>
    </section>
  )
}
