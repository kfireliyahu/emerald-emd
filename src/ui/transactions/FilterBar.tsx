import { useState } from 'react'

import { currencySymbol } from '@/core/money.ts'
import type { Account } from '@/data/repositories/accountRepository.ts'
import { UNCATEGORIZED_ID, type Category } from '@/data/repositories/categoryRepository.ts'
import { Button } from '@/ui/components/Button.tsx'
import { ChoiceField, ChoiceMenu, type Choice } from '@/ui/components/ChoiceField.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'
import { FilterButton, FilterRow } from '@/ui/components/FilterButton.tsx'

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

/** How many of the filters behind *Filter* are set: search and the month are in sight. */
export function filtersOn(fields: FilterFields): number {
  return [fields.accountId, fields.category, fields.min, fields.max].filter((value) => value !== '').length
}

/**
 * The filter bar of docs/06: search in sight, and the rest behind **Filter**
 * (M59 U6, D-582) — account, category, the amount range and Clear, each a
 * `ChoiceField` or a field, never the platform's `<select>`. It was a row of
 * quiet controls on the grounds that a filter you have to open is one you stop
 * using; for someone who has not read a statement yet it was five controls
 * between the figures and the first row. The button says how many are on, so
 * a narrowed list is not mistaken for the whole one. The month is the header's
 * pager, as it was.
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
  const on = filtersOn(fields)
  // "Account" is the schema's word and has to stay there, but on screen it
  // invites two wrong readings — a login, or the file the rows came from. Until
  // a bank account exists in the document, these are all cards, so it says card.
  const cards = everyAccountIsACard(accounts)
  const accountChoices: readonly Choice[] = [
    { value: '', label: cards ? 'All cards' : 'All accounts' },
    ...accounts.map((account) => ({ value: account.id, label: account.name })),
  ]
  // **Uncategorized once** (M54 U5's row): the option is the rows with no
  // category *and* the ones parked on the system category, so the system
  // category is not listed again beside it.
  const categoryChoices: readonly Choice[] = [
    { value: '', label: 'All categories' },
    { value: UNCATEGORIZED_OPTION, label: 'Uncategorized' },
    ...categories
      .filter((category) => category.id !== UNCATEGORIZED_ID)
      .map((category) => ({ value: category.id, label: category.path })),
  ]

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b border-hairline px-6 py-2.5">
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

      <FilterButton on={on}>
        {accounts.length > 1 && (
          <FilterRow label={cards ? 'Card' : 'Account'}>
            <ChoiceMenu
              className={`${SELECT} w-full`}
              aria-label={cards ? 'Card' : 'Account'}
              text={accountChoices.find((each) => each.value === fields.accountId)?.label ?? ''}
              choices={accountChoices}
              onPick={(choice) => set('accountId', choice.value)}
            />
          </FilterRow>
        )}

        <FilterRow label="Category">
          <CategoryChoice
            choices={categoryChoices}
            value={fields.category}
            // Picking by hand narrows to exactly what was picked: the list
            // offers the parent and each child separately, so a rolled-up
            // reading here would be answering a question nobody asked.
            onPick={(category) => onChange({ ...fields, category, withSubcategories: false })}
          />
        </FilterRow>

        {/* Magnitude, so the labels say so — "at least" reads on a refund as
            well as on a charge, where "from −₪500" would not. */}
        <div className="grid grid-cols-2 gap-3">
          <FilterRow label={`At least, ${currencySymbol(currency)}`}>
            <AmountBound
              label={`At least, in ${currency}`}
              value={fields.min}
              invalid={unparseable.min}
              onChange={(value) => set('min', value)}
            />
          </FilterRow>
          <FilterRow label={`At most, ${currencySymbol(currency)}`}>
            <AmountBound
              label={`At most, in ${currency}`}
              value={fields.max}
              invalid={unparseable.max}
              onChange={(value) => set('max', value)}
            />
          </FilterRow>
        </div>

        {on > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() =>
              onChange({ ...fields, accountId: '', category: '', withSubcategories: false, min: '', max: '' })
            }
          >
            Clear
          </Button>
        )}
      </FilterButton>
    </div>
  )
}

/** The category, an autocomplete: a list of forty is typed into, not scrolled. */
function CategoryChoice({
  choices,
  value,
  onPick,
}: {
  readonly choices: readonly Choice[]
  readonly value: string
  readonly onPick: (value: string) => void
}) {
  const labelOf = (wanted: string): string => choices.find((each) => each.value === wanted)?.label ?? ''
  const [text, setText] = useState(() => labelOf(value))
  // Text typed and not picked is put back the moment a pick, or Clear, changes
  // the value — without remounting the field, so focus stays where it is.
  const [shown, setShown] = useState(value)
  if (shown !== value) {
    setShown(value)
    setText(labelOf(value))
  }
  return (
    <ChoiceField
      className={`${FIELD} w-full`}
      aria-label="Category"
      dir="auto"
      filter
      openOnFocus
      text={text}
      choices={choices}
      onText={setText}
      onPick={(choice) => {
        setText(choice.label)
        onPick(choice.value)
      }}
    />
  )
}

function AmountBound({
  label,
  value,
  invalid,
  onChange,
}: {
  label: string
  value: string
  invalid: boolean
  onChange: (value: string) => void
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      inputMode="decimal"
      // Unparseable text is ignored rather than guessed at, so the field says
      // it is being ignored instead of leaving the list quietly wrong.
      className={`${FIELD} w-full text-end tabular-nums ${invalid ? 'text-negative' : 'text-ink'}`}
    />
  )
}

function everyAccountIsACard(accounts: readonly Account[]): boolean {
  return accounts.every((account) => account.kind === 'CREDIT_CARD')
}
