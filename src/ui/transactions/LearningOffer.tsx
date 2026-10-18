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

/**
 * "Always categorize this as that?" — **the one place a rule is made from a row**
 * (D-373): after a correction, and from the row menu or the detail panel when
 * somebody asks for one. By merchant's tick writes the same rule without asking.
 *
 * Sits above the ledger, under the filters: the row that prompted it is a row or
 * two down, and a question parked at the bottom of a tall screen is a question
 * nobody answers (D-043). It is non-modal — ignoring it costs nothing.
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
  onDismiss,
  onCreate,
}: {
  offer: Offer
  merchantRaw: string
  categories: readonly Category[]
  accounts: readonly Account[]
  /** How many rows already here the draft would file, as `pastRows` counts them. */
  pastFor: (draft: RuleDraft) => number
  onDismiss: () => void
  onCreate: (draft: RuleDraft, alsoPast: boolean) => void
}) {
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
    <section
      aria-label="Rule suggestion"
      aria-live="polite"
      className="fc-pop-enter shrink-0 border-b border-hairline bg-surface px-6 py-3"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          {/* The third time is the one worth saying out loud: the user has now
              done by hand, three times, what one click would have stopped. */}
          {offer.insistent && (
            <p className="text-caption text-ink-secondary">
              You have put <Bidi className="text-ink">{merchantRaw}</Bidi> in{' '}
              <span className="text-ink">{categoryPath ?? 'this category'}</span> by hand{' '}
              <span className="tabular-nums">{offer.corrections}</span> times now.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-2">
            <span>
              Always categorize <Bidi className="font-medium">{merchantRaw}</Bidi> as
            </span>
            <CategoryPicker
              categories={categories}
              value={categoryId}
              onChange={setCategoryId}
              label="The rule's category"
              placeholder="Choose a category"
              outlined
            />
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            No rule
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onCreate(draft, past && earlier > 0)}
            disabled={problems.length > 0}
          >
            Make the rule
          </Button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-caption text-ink-tertiary">
        <label className="flex items-center gap-2">
          Any merchant containing
          <input
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            dir="auto"
            aria-label="What the rule matches on"
            placeholder={offer.merchantNormalized}
            className={`${FIELD} w-56 text-body`}
          />
        </label>

        {/* Said even when it is nothing, so the button is known to be about the
            next import only before it is pressed rather than after. */}
        {problems.length === 0 &&
          (earlier > 0 ? (
            <label className="flex items-center gap-2 select-none">
              <input type="checkbox" checked={past} onChange={(event) => setPast(event.target.checked)} />
              <span>
                {'Also categorize the '}
                <span className="tabular-nums text-ink">{earlier}</span>
                {earlier === 1 ? ' row already here' : ' rows already here'}
              </span>
            </label>
          ) : (
            <span>Nothing already here to categorize — it starts with the next import</span>
          ))}

        {/* What the button would actually write, in the words the rules screen
            will list it with. */}
        {problems.length > 0 ? (
          <span className="text-negative">{problems[0]?.message}</span>
        ) : (
          <span>
            {'Writes: '}
            <Why rule={asRule(draft)} accounts={accounts} />
            {' → '}
            <span className="text-ink-secondary">{categoryPath ?? 'this category'}</span>
          </span>
        )}
      </div>

      <p className="mt-1 text-caption text-ink-tertiary">
        Never a row you categorized by hand. The rows it categorizes can be put back; the rule is edited
        on the rules screen.
      </p>
    </section>
  )
}
