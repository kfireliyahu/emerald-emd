import { useEffect, useRef, useState } from 'react'

import { formatYearMonth, toISODate } from '@/core/time.ts'
import type { Account } from '@/data/repositories/accountRepository.ts'
import type { Category } from '@/data/repositories/categoryRepository.ts'
import type { HoldingQuantity, TransactionHolding } from '@/data/repositories/savingsRepository.ts'
import {
  parseQuantity,
  quantityText,
  type TransactionDetail,
} from '@/data/repositories/transactionRepository.ts'
import type { Holding } from '@/domain/model/savings.ts'
import type { TransferDecision, TransferPair } from '@/data/repositories/transferPairRepository.ts'
import { explain } from '@/domain/categorization.ts'
import type { CategoryRule } from '@/domain/model/rules.ts'
import { Why } from '@/ui/rules/Why.tsx'
import { Amount } from '@/ui/components/Amount.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { CategoryPicker } from '@/ui/components/CategoryPicker.tsx'
import { FIELD, FIELD_MULTILINE, SELECT } from '@/ui/components/fieldLook.ts'
import { instantDay } from '@/core/instant.ts'
import { Bidi } from '@/ui/Bidi.tsx'

/**
 * One transaction, in full, beside the table rather than instead of it
 * (docs/06) — the row you came from stays visible, which is what makes it
 * possible to compare two of them.
 *
 * The panel's real job is provenance. Every number in this app came out of a
 * file the user recognises, and "row 47 of cal-2026-07.xlsx" is the sentence
 * that makes a figure checkable rather than merely believable. The dedupe key
 * is here for the same reason: it is the answer to "why did re-importing that
 * file not double this".
 */
export function DetailPanel({
  transaction,
  categories,
  rules,
  accounts,
  settlementAlias,
  onClose,
  onAssign,
  onNote,
  onExclude,
  onCreateRule,
  onCreateProviderRule,
  onSetSettlementAlias,
  onDecideCard,
  holdings = [],
  heldNow,
  holdingProblem = () => undefined,
  onHolding = () => undefined,
  transfer,
  onTransfer = () => undefined,
}: {
  transaction: TransactionDetail
  categories: readonly Category[]
  rules: readonly CategoryRule[]
  accounts: readonly Account[]
  /** Which card this merchant's rows pay, if the user has said. D-069. */
  settlementAlias: string | undefined
  onClose: () => void
  onAssign: (categoryId: string | undefined) => void
  onNote: (note: string) => void
  onExclude: (excluded: boolean) => void
  onCreateRule: () => void
  /** Only reachable on a row the provider filed under a category of its own. */
  onCreateProviderRule: () => void
  onSetSettlementAlias: (cardAccountId: string | undefined) => void
  onDecideCard: (cardAccountId: string, exclude: boolean) => void
  /**
   * The holdings this row could name (M30 U2) — those at the place that names
   * its account. Empty, and the section says nothing, for every other row.
   */
  holdings?: readonly Holding[]
  /** What the holding this row names adds up to now, across all its rows. */
  heldNow?: HoldingQuantity | undefined
  holdingProblem?: (choice: TransactionHolding) => string | undefined
  onHolding?: (choice: TransactionHolding | undefined) => void
  /** The transfer between two of the person's accounts this row is an end of (M30 U3). */
  transfer?: TransferPair | undefined
  onTransfer?: (pairId: string, decision: TransferDecision) => void
}) {
  const noteRef = useRef<HTMLTextAreaElement>(null)

  // Escape closes, from anywhere in the panel or the table beside it. Captured
  // on the document rather than the panel because the point is to close it
  // without having to reach for it first.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // The note is uncontrolled and committed on blur, so typing in it does not
  // re-run the ledger's queries on every keystroke. Keyed on the id by the
  // parent, so switching rows remounts it with the right text.
  const commitNote = (): void => {
    const value = noteRef.current?.value ?? ''
    if (value.trim() !== (transaction.note ?? '')) onNote(value)
  }

  const { installment, foreign, provenance } = transaction

  // Only a bank row can pay a card, and only an outflow can. The control is
  // absent rather than disabled on anything else: a card statement's own rows
  // are the money being settled, not the settlement.
  const isBankOutflow =
    accounts.find((account) => account.id === transaction.accountId)?.kind === 'BANK' &&
    transaction.amount.minor < 0
  const cards = accounts.filter((account) => account.kind === 'CREDIT_CARD')
  const aliasedCard = cards.find((account) => account.id === settlementAlias)

  return (
    <aside
      aria-label="Transaction detail"
      className="fc-pop-enter flex w-[23rem] shrink-0 flex-col overflow-y-auto border-l border-hairline bg-background"
    >
      <div className="flex items-start gap-2 border-b border-hairline px-5 py-4">
        <div className="min-w-0">
          <Bidi className="text-heading">{transaction.merchantRaw}</Bidi>
          <div className="mt-1 text-secondary-number">
            <Amount value={transaction.amount} />
          </div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          aria-label="Close detail"
          className="ml-auto"
        >
          Close
        </Button>
      </div>

      <div className="border-b border-hairline px-5 py-3">
        <Label>Category</Label>
        <div className="-ml-2 mt-1">
          <CategoryPicker
            categories={categories}
            value={transaction.categoryId}
            onChange={onAssign}
            label={`Category for ${transaction.merchantRaw}`}
          />
        </div>
        {transaction.categorySource === 'MANUAL' && (
          <p className="mt-1 text-caption text-ink-tertiary">
            You chose this one. Nothing automatic will overwrite it.
          </p>
        )}

        <Explanation transaction={transaction} rules={rules} accounts={accounts} />

        {/* The usual way a rule gets written (F03): from a row that is already
            in front of the user, categorized the way they want the next one to
            be. The merchant one opens the same offer a correction makes, above
            the rows (D-373); neither saves anything on its own. */}
        <div className="mt-3 flex flex-col items-start gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={onCreateRule}
            title="Offer a rule for this merchant above the rows"
          >
            Make a rule for this merchant
          </Button>

          {/* The other thing this row already knows about itself. A merchant
              rule claims one shop; this one claims everything the issuer files
              under a heading, which is why the breadth is stated rather than
              left to be discovered — and why it lives here, in front of the
              editor, rather than in the one-click correction offer. */}
          {transaction.providerCategory !== undefined && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={onCreateProviderRule}
                title="Open the rules screen with a rule pre-filled from the provider's own category"
              >
                Create a rule from the provider's category
              </Button>
              <p className="text-caption text-ink-tertiary">
                Covers every row the provider categorizes under{' '}
                <Bidi className="text-ink-secondary">{transaction.providerCategory}</Bidi>, on this
                statement and the next one.
              </p>
            </>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 border-b border-hairline px-5 py-3">
        <Fact label="Account">{transaction.accountName}</Fact>
        <Fact label="Purchased">{toISODate(transaction.transactionDate)}</Fact>
        {transaction.chargeDate !== undefined && (
          <Fact label="Charged">{toISODate(transaction.chargeDate)}</Fact>
        )}
        {transaction.billingPeriod !== undefined && (
          <Fact label="Billed in">{formatYearMonth(transaction.billingPeriod)}</Fact>
        )}
        {transaction.cardLast4 !== undefined && (
          <Fact label="Card">···· {transaction.cardLast4}</Fact>
        )}
        {installment !== undefined && (
          <Fact label="Installment">
            {installment.sequence} of {installment.total}
            {/* D-007 makes the slice the number that counts, so the purchase it
                came out of has to be visible somewhere or a ₪1,200 sofa looks
                like a ₪100 one forever. */}
            {installment.originalTotal !== undefined && (
              <span className="text-ink-tertiary">
                {' · '}
                <Amount value={installment.originalTotal} /> in total
              </span>
            )}
          </Fact>
        )}
        {foreign !== undefined && (
          <Fact label="Originally">
            <Amount value={foreign.amount} />
            {foreign.exchangeRate !== undefined && (
              <span className="text-ink-tertiary"> at {foreign.exchangeRate}</span>
            )}
          </Fact>
        )}
        {transaction.providerCategory !== undefined && (
          <Fact label="Provider said">
            <Bidi>{transaction.providerCategory}</Bidi>
          </Fact>
        )}
        {transaction.reference !== undefined && (
          <Fact label="Reference">
            <Bidi>{transaction.reference}</Bidi>
          </Fact>
        )}
      </dl>

      {holdings.length > 0 && (
        <HoldingField
          transaction={transaction}
          holdings={holdings}
          heldNow={heldNow}
          problemOf={holdingProblem}
          onSave={onHolding}
        />
      )}

      {transfer !== undefined && (
        <TransferField transactionId={transaction.id} pair={transfer} onAnswer={onTransfer} />
      )}

      <div className="border-b border-hairline px-5 py-3">
        <Label>Note</Label>
        <textarea
          ref={noteRef}
          defaultValue={transaction.note ?? ''}
          onBlur={commitNote}
          rows={2}
          aria-label="Note"
          dir="auto"
          placeholder="Anything worth remembering about this one…"
          className={`${FIELD_MULTILINE} mt-1 w-full resize-y`}
        />
      </div>

      {isBankOutflow && cards.length > 0 && (
        <div className="border-b border-hairline px-5 py-3">
          <Label>This pays a card</Label>
          <select
            className={`${SELECT} mt-1 w-full`}
            value={settlementAlias ?? ''}
            aria-label="The card this merchant pays"
            onChange={(event) =>
              onSetSettlementAlias(event.target.value === '' ? undefined : event.target.value)
            }
          >
            <option value="">Not a card payment</option>
            {cards.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
                {account.last4 !== undefined && ` ····${account.last4}`}
              </option>
            ))}
          </select>

          {aliasedCard === undefined ? (
            <p className="mt-1 text-caption text-ink-tertiary">
              Say so when the app has not worked it out — a bank that words its card payment
              unusually, or a row with no card number in it. The answer covers{' '}
              <Bidi>{transaction.merchantNormalized}</Bidi> everywhere it appears, before and after
              today.
            </p>
          ) : aliasedCard.excludeSettlementsFromStats === undefined ? (
            <div className="mt-2">
              {/* The alias names the card; whether that card's charges count is a
                  separate question and the app never answers it on the user's
                  behalf (D-061). Asked here because this is the moment they have
                  the row in front of them — the accounts queue asks the same
                  question of whoever gets there first. */}
              <p className="text-caption text-ink-tertiary">
                Do this card's payments belong in your totals? They are the same money as the card
                statement's own rows, so counting both doubles the month.
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onDecideCard(aliasedCard.id, true)}
                >
                  Leave them out
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onDecideCard(aliasedCard.id, false)}>
                  Keep them
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-1 text-caption text-ink-tertiary">
              {aliasedCard.excludeSettlementsFromStats
                ? `Payments to ${aliasedCard.name} are left out of totals, so this row does not double the month.`
                : `Payments to ${aliasedCard.name} are counted, and that card's own transactions are what to leave out instead.`}
            </p>
          )}
        </div>
      )}

      <div className="border-b border-hairline px-5 py-3">
        <label className="flex items-start gap-2 select-none">
          <input
            type="checkbox"
            checked={transaction.isExcludedFromStats}
            onChange={(event) => onExclude(event.target.checked)}
            className="mt-1"
          />
          <span>
            Leave out of totals
            <span className="mt-0.5 block text-caption text-ink-tertiary">
              The row stays in the ledger and keeps its category — it just stops counting toward
              any total. For a one-off; a card payment that repeats is better answered above, which
              covers every month of it at once.
            </span>
          </span>
        </label>
      </div>

      <div className="px-5 py-3">
        <Label>Where this came from</Label>
        {provenance === undefined ? (
          <p className="mt-1 text-ink-secondary">
            No import recorded — this row was written directly into the document.
          </p>
        ) : (
          <p className="mt-1 text-ink-secondary">
            {transaction.sourceRowRef !== undefined && <>{transaction.sourceRowRef} of </>}
            <Bidi className="text-ink">{provenance.fileName}</Bidi>
            {provenance.sheetName !== undefined && (
              <>
                {' · sheet '}
                <Bidi>{provenance.sheetName}</Bidi>
              </>
            )}
            {provenance.mappingName !== undefined && (
              <>
                {' · read by '}
                <Bidi>{provenance.mappingName}</Bidi>
              </>
            )}
            {provenance.importedAt !== undefined && (
              <span className="tabular-nums"> · imported {instantDay(provenance.importedAt)}</span>
            )}
          </p>
        )}

        {/* Small, quiet, and last — but present, because it is the whole
            explanation of why importing the same file twice changed nothing. */}
        <p className="mt-2 text-caption text-ink-tertiary">
          Recognised on re-import as{' '}
          <Bidi className="font-mono break-all">{transaction.naturalKey}</Bidi>
        </p>
      </div>
    </aside>
  )
}

/**
 * Which rule assigned this category, and what it beat — F03's provenance view.
 *
 * Two different facts live here and they must not be confused. `matchedRuleId`
 * is **history**: the rule that actually assigned the category, at import time.
 * `explain` is **today**: what the current rule set would make of the same row.
 * They agree until the user edits a rule, and when they stop agreeing the
 * honest thing is to say so rather than to show today's losers underneath
 * yesterday's winner as though they were one story.
 */
function Explanation({
  transaction,
  rules,
  accounts,
}: {
  transaction: TransactionDetail
  rules: readonly CategoryRule[]
  accounts: readonly Account[]
}) {
  // Only a rule-assigned category has a rule to explain. A manual one says its
  // own piece just above, and D-009 keeps the engine away from it entirely.
  if (transaction.categorySource !== 'RULE') return null

  const today = explain(rules, {
    merchantNormalized: transaction.merchantNormalized,
    providerCategory: transaction.providerCategory,
    amount: transaction.amount,
    accountId: transaction.accountId,
  })
  const stillAgrees = today.winner?.id === transaction.matchedRuleId

  // The stored name comes from a join against `category_rule`, which leaves a
  // built-in's out: its row is named by its rule-pack id (M25 U2). Falling back
  // to the rule set in hand, which reads the pack's own name, is what keeps
  // "categorized by פז ילו" from reading as "categorized by il.fuel.paz".
  const ruleName =
    transaction.matchedRuleName ??
    rules.find((rule) => rule.id === transaction.matchedRuleId)?.name

  return (
    <div className="mt-2 text-caption text-ink-tertiary">
      <p>
        Categorized by{' '}
        {ruleName === undefined ? (
          <span className="text-ink-secondary">a rule that has since been deleted</span>
        ) : (
          <Bidi className="text-ink">{ruleName}</Bidi>
        )}
      </p>

      {stillAgrees && today.shadowed.length > 0 && (
        <p className="mt-1">
          It beat{' '}
          {today.shadowed.map((rule, index) => (
            <span key={rule.id}>
              {index > 0 && ', '}
              <Bidi className="text-ink-secondary">{rule.name}</Bidi> (<Why rule={rule} accounts={accounts} />)
            </span>
          ))}
        </p>
      )}

      {!stillAgrees && (
        <p className="mt-1">
          Your rules have changed since. Today they would assign{' '}
          <span className="text-ink-secondary">
            {today.winner === undefined
              ? 'nothing'
              : (categoryNameOf(today.winner.targetCategoryId, transaction) ?? 'another category')}
          </span>
          {today.winner !== undefined && (
            <>
              , by <Bidi className="text-ink-secondary">{today.winner.name}</Bidi>
            </>
          )}
          . This row keeps what it was given — nothing is recategorized behind your back.
        </p>
      )}
    </div>
  )
}

/**
 * The winner's category, when it happens to be the one this row already has.
 *
 * The panel is given the transaction, not the taxonomy keyed by id, and a
 * lookup table threaded through for one line of hypothetical text is not worth
 * the prop. When it is a different category, saying "another category" and
 * naming the rule is enough to send the user to the rules screen, which is
 * where the question actually gets answered.
 */
function categoryNameOf(categoryId: string, transaction: TransactionDetail): string | undefined {
  return categoryId === transaction.categoryId ? transaction.categoryPath : undefined
}

/**
 * **What this row's cash turned into** (M30 U2): a holding and how much of it,
 * for a row on an account a place names. Such a row is a buy or a sale inside
 * the account, and is neither in nor out of the month. Saved with a button
 * rather than on change, because a holding with no quantity is not a choice
 * this app can keep.
 */
function HoldingField({
  transaction,
  holdings,
  heldNow,
  problemOf,
  onSave,
}: {
  transaction: TransactionDetail
  holdings: readonly Holding[]
  heldNow: HoldingQuantity | undefined
  problemOf: (choice: TransactionHolding) => string | undefined
  onSave: (choice: TransactionHolding | undefined) => void
}) {
  const [holdingId, setHoldingId] = useState(transaction.holdingId ?? '')
  const [quantity, setQuantity] = useState(
    transaction.quantityMicro === undefined ? '' : quantityText(transaction.quantityMicro),
  )

  const parsed = quantity.trim() === '' ? undefined : parseQuantity(quantity)
  const choice: TransactionHolding | undefined =
    holdingId === '' || parsed === undefined || !parsed.ok ? undefined : { holdingId, quantityMicro: parsed.value }
  const problem =
    holdingId === ''
      ? undefined
      : parsed === undefined
        ? 'Say how much: what was bought is positive, what was sold negative.'
        : !parsed.ok
          ? parsed.error
          : choice === undefined
            ? undefined
            : problemOf(choice)
  const changed =
    holdingId !== (transaction.holdingId ?? '') ||
    (holdingId !== '' && choice?.quantityMicro !== transaction.quantityMicro)
  const named = holdings.find((one) => one.id === transaction.holdingId)

  return (
    <div className="border-b border-hairline px-5 py-3">
      <Label>Bought or sold</Label>
      <div className="mt-1 flex gap-2">
        <select
          className={`${SELECT} min-w-0 flex-1`}
          value={holdingId}
          aria-label="The holding this row bought or sold"
          onChange={(event) => setHoldingId(event.target.value)}
        >
          <option value="">Nothing — spent or received</option>
          {holdings.map((one) => (
            <option key={one.id} value={one.id}>
              {one.name}
            </option>
          ))}
        </select>
        {holdingId !== '' && (
          <input
            className={`${FIELD} w-24 text-right tabular-nums`}
            value={quantity}
            inputMode="decimal"
            aria-label="How much of it"
            placeholder="Quantity"
            onChange={(event) => setQuantity(event.target.value)}
          />
        )}
      </div>
      {problem !== undefined && <p className="mt-1 text-caption text-negative">{problem}</p>}
      {changed && problem === undefined && (
        <Button variant="secondary" size="sm" className="mt-2" onClick={() => onSave(choice)}>
          {holdingId === '' ? 'Clear it' : 'Save'}
        </Button>
      )}
      <p className="mt-1 text-caption text-ink-tertiary">
        {named === undefined
          ? 'When this row is a buy or a sale inside the account, name what it bought: it then counts in neither came in nor went out.'
          : heldNow?.kind === 'VALUE'
            ? `Cash turned into ${named.name} inside ${transaction.accountName}, so it is neither in nor out of the month. ${named.name} holds ${quantityText(heldNow.quantityMicro)} across ${heldNow.rows} ${heldNow.rows === 1 ? 'row' : 'rows'}.`
            : `Cash turned into ${named.name} inside ${transaction.accountName}, so it is neither in nor out of the month.${heldNow === undefined ? '' : ` What ${named.name} holds is unchecked: ${heldNow.reason}`}`}
      </p>
    </div>
  )
}

/**
 * The other end of a transfer between two of the person's accounts (M30 U3,
 * D-356), and the answer — given here or in the accounts screen's queue, and
 * changed here.
 */
function TransferField({
  transactionId,
  pair,
  onAnswer,
}: {
  transactionId: string
  pair: TransferPair
  onAnswer: (pairId: string, decision: TransferDecision) => void
}) {
  const other = pair.out.transactionId === transactionId ? pair.in : pair.out
  const leftHere = pair.out.transactionId === transactionId
  return (
    <div className="border-b border-hairline px-5 py-3">
      <Label>Transfer</Label>
      <p className="mt-1 text-ink-secondary">
        {leftHere ? 'Arrived in ' : 'Left '}
        <Bidi>{other.accountName}</Bidi> on <span className="tabular-nums">{other.date}</span>
        {pair.decision === 'PAIRED'
          ? ': one transfer between your accounts, so neither income nor spending.'
          : pair.decision === 'NOT_PAIRED'
            ? ', the same amount — and you said it is not a transfer.'
            : ', the same amount. Is it one transfer between your accounts?'}
      </p>
      <div className="mt-2 flex gap-2">
        {pair.decision !== 'PAIRED' && (
          <Button variant="secondary" size="sm" onClick={() => onAnswer(pair.id, 'PAIRED')}>
            One transfer
          </Button>
        )}
        {pair.decision !== 'NOT_PAIRED' && (
          <Button variant="ghost" size="sm" onClick={() => onAnswer(pair.id, 'NOT_PAIRED')}>
            Not a transfer
          </Button>
        )}
      </div>
    </div>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-label uppercase text-ink-tertiary">{label}</dt>
      <dd className="tabular-nums">{children}</dd>
    </>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-label uppercase text-ink-tertiary">{children}</span>
}
