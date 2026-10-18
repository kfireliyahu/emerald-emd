import { currencySymbol } from '@/core/money.ts'
import type { Account } from '@/data/repositories/accountRepository.ts'
import type { Category } from '@/data/repositories/categoryRepository.ts'
import { Button } from '@/ui/components/Button.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'

/**
 * What the user has typed, as opposed to what it means.
 *
 * Kept as strings because that is what a half-typed amount is: `12.` is not a
 * number yet and must not be rounded into one behind the typing hand. The
 * screen turns this into a `TransactionFilter` once, where the parse can fail
 * quietly.
 */
export interface FilterFields {
  /** `YYYY-MM`, or undefined for every month. */
  readonly period: string | undefined
  readonly search: string
  /** An account id, or '' for all of them. */
  readonly accountId: string
  /** A category id, `UNCATEGORIZED`, or '' for all. */
  readonly category: string
  /**
   * Read `category` as a parent, subcategories included.
   *
   * Only ever set by arriving from the monthly summary's rolled-up row (D-088),
   * and cleared the moment the user picks a category by hand — a flag that
   * survived a manual change would silently widen a filter nothing on screen
   * said was wide.
   */
  readonly withSubcategories: boolean
  readonly min: string
  readonly max: string
}

export const NO_FILTERS: FilterFields = {
  period: undefined,
  search: '',
  accountId: '',
  category: '',
  withSubcategories: false,
  min: '',
  max: '',
}

export const UNCATEGORIZED_OPTION = 'UNCATEGORIZED'

export function isFiltered(fields: FilterFields): boolean {
  return (
    fields.period !== undefined ||
    fields.search !== '' ||
    fields.accountId !== '' ||
    fields.category !== '' ||
    fields.min !== '' ||
    fields.max !== ''
  )
}

/**
 * The filter bar of docs/06: date range, account, category, uncategorized-only,
 * amount range, text search.
 *
 * One row of quiet controls rather than a panel that opens — filtering a ledger
 * is something you do continuously while reading it, and a filter you have to
 * open is one you stop using. The month chips are the date range: statements
 * arrive by month, and every date in this app is already discussed as one.
 */
export function FilterBar({
  fields,
  onChange,
  accounts,
  categories,
  currency,
  unparseable,
}: {
  fields: FilterFields
  onChange: (fields: FilterFields) => void
  accounts: readonly Account[]
  categories: readonly Category[]
  /** The currency the amount bounds are read in — the ledger's most common one. */
  currency: string
  unparseable: { readonly min: boolean; readonly max: boolean }
}) {
  const set = <K extends keyof FilterFields>(key: K, value: FilterFields[K]): void => {
    onChange({ ...fields, [key]: value })
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b border-hairline px-6 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        <input
          value={fields.search}
          onChange={(event) => set('search', event.target.value)}
          placeholder="Search merchants…"
          aria-label="Search merchants"
          // A merchant name is the thing most likely to be pasted in here, and
          // most of them are Hebrew.
          dir="auto"
          className={`${FIELD} w-64`}
        />

        {accounts.length > 1 && (
          <select
            value={fields.accountId}
            onChange={(event) => set('accountId', event.target.value)}
            aria-label={everyAccountIsACard(accounts) ? 'Card' : 'Account'}
            className={SELECT}
          >
            {/* "Account" is the schema's word and has to stay there, but on
                screen it invites two wrong readings — a login, or the file the
                rows came from. Until a bank account exists in the document,
                these are all cards, so the label says card. */}
            <option value="">
              {everyAccountIsACard(accounts) ? 'All cards' : 'All accounts'}
            </option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        )}

        <select
          value={fields.category}
          onChange={(event) => {
            // Picking by hand narrows to exactly what was picked: the option
            // list offers the parent and each child separately, so a rolled-up
            // reading here would be answering a question nobody asked.
            onChange({
              ...fields,
              category: event.target.value,
              withSubcategories: false,
            })
          }}
          aria-label="Category"
          className={SELECT}
        >
          <option value="">All categories</option>
          <option value={UNCATEGORIZED_OPTION}>Uncategorized</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.path}
            </option>
          ))}
        </select>

        {/* Magnitude, so the labels say so — "at least" reads on a refund as
            well as on a charge, where "from −₪500" would not. */}
        <AmountBound
          label={`At least, in ${currency}`}
          prefix={`${currencySymbol(currency)} at least`}
          value={fields.min}
          invalid={unparseable.min}
          onChange={(value) => set('min', value)}
        />
        <AmountBound
          label={`At most, in ${currency}`}
          prefix="at most"
          value={fields.max}
          invalid={unparseable.max}
          onChange={(value) => set('max', value)}
        />

        {isFiltered(fields) && (
          <Button variant="ghost" size="sm" onClick={() => onChange(NO_FILTERS)}>
            Clear filters
          </Button>
        )}
      </div>
    </div>
  )
}

function AmountBound({
  label,
  prefix,
  value,
  invalid,
  onChange,
}: {
  label: string
  prefix: string
  value: string
  invalid: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="flex items-center gap-1.5 whitespace-nowrap text-caption text-ink-tertiary">
      {prefix}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label={label}
        inputMode="decimal"
        // Unparseable text is ignored rather than guessed at, so the field says
        // it is being ignored instead of leaving the list quietly wrong.
        className={`${FIELD} w-24 text-body tabular-nums ${invalid ? 'text-negative' : 'text-ink'}`}
      />
    </label>
  )
}

function everyAccountIsACard(accounts: readonly Account[]): boolean {
  return accounts.every((account) => account.kind === 'CREDIT_CARD')
}
