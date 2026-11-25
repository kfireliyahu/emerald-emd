import { useState } from 'react'

import type { Account } from '@/data/repositories/accountRepository.ts'
import type { Category } from '@/data/repositories/categoryRepository.ts'
import { offeredDraft, type LearningOffer as Offer } from '@/domain/learning.ts'
import { asRule, draftProblems, type RuleDraft } from '@/domain/ruleEditing.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { CategoryPicker } from '@/ui/components/CategoryPicker.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { Why } from '@/ui/rules/Why.tsx'
import { countKey } from '@/i18n/count.ts'
import { useT } from '@/i18n/current.ts'
import { Phrase } from '@/ui/components/Phrase.tsx'

/**
 * "Always categorize this as that?" — **the one place a rule is made from a row**
 * (D-373): from the suggestion a correction leaves on the line under the
 * sentence, and from the row menu or the detail panel when somebody asks for
 * one. By merchant's tick writes the same rule without asking.
 *
 * **A form in the side panel** (M64 U6, D-617, D-618): a rule has several
 * fields, so it opens beside the rows, never above them where it pushed the row
 * that prompted it down. The panel's Close is the way out; nothing is written
 * until Make the rule.
 *
 * **One kind of match: the field is contained in the merchant.** The full name
 * by default; shortened to the part that stays the same when the rest does not.
 * The category is a picker, so a rule asked for on a row with none can still be
 * made here, and `+ New…` makes one in place (D-372).
 *
 * **The rows already here are filed too, by default**, whenever there are any:
 * the count is the plan the write makes, and it moves as the field is typed in.
 */
export function LearningOffer({
  offer,
  merchantRaw,
  categories,
  accounts,
  pastFor,
  onCreate,
}: {
  offer: Offer
  merchantRaw: string
  categories: readonly Category[]
  accounts: readonly Account[]
  /** How many rows already here the draft would file, as `pastRows` counts them. */
  pastFor: (draft: RuleDraft) => number
  onCreate: (draft: RuleDraft, alsoPast: boolean) => void
}) {
  const t = useT()
  // Local, because they belong to the question being asked rather than to the
  // row it came from — the parent is keyed on the offer, so a new one starts over.
  const [pattern, setPattern] = useState(offer.draft.pattern)
  const [categoryId, setCategoryId] = useState(offer.categoryId === '' ? undefined : offer.categoryId)
  const [past, setPast] = useState(true)

  const draft = offeredDraft(offer, { pattern, categoryId })
  const problems = draftProblems(draft)
  const earlier = pastFor(draft)
  const categoryPath = categories.find((one) => one.id === categoryId)?.path

  return (
    <form
      aria-label={t('transactions.offer.label')}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (problems.length === 0) onCreate(draft, past && earlier > 0)
      }}
    >
      {/* The third time is the one worth saying out loud: the user has now
          done by hand, three times, what one click would have stopped. */}
      {offer.insistent && (
        <p className="m-0 text-ink-secondary">
          <Phrase text={t('transactions.offer.insistent')} parts={{
            merchant: <Bidi className="text-ink">{merchantRaw}</Bidi>,
            category: <span className="text-ink">{categoryPath ?? t('transactions.offer.thisCategory')}</span>,
            count: <span className="tabular-nums">{offer.corrections}</span>,
          }} />
        </p>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-caption text-ink-secondary">{t('transactions.offer.containing')}</span>
        <input
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          dir="auto"
          aria-label={t('transactions.offer.matchesOn')}
          placeholder={offer.merchantNormalized}
          className={`${FIELD} w-full text-body`}
        />
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-caption text-ink-secondary">{t('transactions.offer.categoryLabel')}</span>
        <CategoryPicker
          categories={categories}
          value={categoryId}
          onChange={setCategoryId}
          label={t('transactions.offer.picker')}
          placeholder={t('transactions.offer.choose')}
          outlined
        />
      </div>

      {/* Said even when it is nothing, so the button is known to be about the
          next import only before it is pressed rather than after. */}
      {problems.length === 0 &&
        (earlier > 0 ? (
          <label className="flex items-center gap-2 select-none">
            <input type="checkbox" checked={past} onChange={(event) => setPast(event.target.checked)} />
            <span>
              <Phrase text={t(countKey('transactions.offer.alsoPast', earlier))} parts={{
                count: <span className="tabular-nums">{earlier}</span>,
              }} />
            </span>
          </label>
        ) : (
          <p className="m-0 text-ink-secondary">{t('transactions.offer.nothingPast')}</p>
        ))}

      {/* What the button would actually write, in the words the rules screen
          will list it with. */}
      {problems.length > 0 ? (
        <p className="m-0 text-negative">{problems[0]?.message}</p>
      ) : (
        <p className="m-0 text-caption text-ink-secondary">
          <Phrase text={t('transactions.offer.writes')} parts={{
            why: <Why rule={asRule(draft)} accounts={accounts} />,
            category: <span className="text-ink">{categoryPath ?? t('transactions.offer.thisCategory')}</span>,
          }} />
        </p>
      )}

      <p className="m-0 text-caption text-ink-secondary">{t('transactions.offer.never')}</p>

      <div>
        <Button type="submit" variant="primary" disabled={problems.length > 0}>
          {t('transactions.offer.make')}
        </Button>
      </div>
    </form>
  )
}
