import { useMemo, useState } from 'react'
import type { Database } from 'sql.js'

import {
  accountUsage,
  createAccount,
  deleteAccount,
  listAccounts,
  mergeAccounts,
  mergePreview,
  renameAccount,
  setAccountArchived,
  setAccountKind,
  setAccountInstitution,
  setAccountLast4,
  setExcludeSettlementsFromStats,
  type Account,
  type AccountKind,
  type AccountUsage,
} from '@/data/repositories/accountRepository.ts'
import {
  listInstitutions,
  type Institution,
  type InstitutionKind,
} from '@/data/repositories/institutionRepository.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { PageMenu } from '@/ui/components/PageMenu.tsx'
import { Chip } from '@/ui/components/Chip.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'
import { decideForCard } from '@/data/repositories/cardSettlementRepository.ts'
import { rescanSettlements } from '@/data/importer/settlementScan.ts'
import { suggestTransfers } from '@/data/repositories/transferPairRepository.ts'
import { SettlementPrompt } from '@/ui/import/SettlementPrompt.tsx'
import { TransferPrompt } from '@/ui/import/TransferPrompt.tsx'
import { Flip } from '@/ui/motion/Flip.tsx'

/**
 * The cards and bank accounts a document knows about — docs/06's Accounts
 * section, and where the records onboarding created live afterwards.
 *
 * The last 4 digits are the working part of this screen rather than a label. They
 * are what matches a statement file to the right card (D-033) and a bank's
 * monthly card charge to the card that ran it up (D-014), so "last-4 entered
 * wrong" in docs/f12 has to be a correction anyone can make here.
 *
 * **Merge is the operation this screen exists for.** A document written before
 * D-033 holds one card as two accounts, because identity came from the statement's
 * file name and a second download of one month is `" (1)"`. Splitting a card that
 * way also breaks idempotence — the unique index is `(account_id, natural_key)` —
 * so until this existed the only repair was starting a new document.
 */
export function Accounts() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)

  const [showArchived, setShowArchived] = useState(false)
  const [merging, setMerging] = useState<Account | undefined>()
  const [problem, setProblem] = useState<string | undefined>()

  const data = useMemo(() => {
    if (db === undefined) return undefined
    const accounts = listAccounts(db, { includeArchived: showArchived })
    return {
      accounts,
      institutions: listInstitutions(db),
      usage: new Map(accounts.map((account) => [account.id, accountUsage(db, account.id)])),
    }
  }, [db, revision, showArchived])

  if (db === undefined || data === undefined) {
    return <Centered>Open a document, or create one, to see the accounts in it.</Centered>
  }

  const write = (work: (database: Database, now: number) => void): void => {
    setProblem(undefined)
    try {
      mutate((database) => work(database, Date.now()))
    } catch (error) {
      // A refusal is information: it is how the user finds out that the account
      // they tried to remove is holding four years of statements.
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  const groups = GROUPS.map((group) => ({
    ...group,
    members: data.accounts.filter((account) => account.kind === group.kind),
  })).filter((group) => group.members.length > 0)

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-2 border-b border-hairline px-6 py-2">
        <span className="text-ink-secondary tabular-nums">
          {data.accounts.length === 1 ? '1 account' : `${data.accounts.length} accounts`}
        </span>

        <NewAccountForm
          // Rescanned, for the reason `onSetKind` is (D-060, D-070) and one
          // that matters more: a card added *after* its statements were
          // imported is the ordinary case, and until this runs there is no
          // settlement link for anything to prompt about (D-160).
          onCreate={(account) =>
            write((database, now) => {
              createAccount(database, account, now)
              rescanSettlements(database, now)
              suggestTransfers(database)
            })
          }
        />
        <PageMenu
          title="Accounts"
          items={[
            {
              label: showArchived ? 'Hide archived accounts' : 'Show archived accounts',
              onChoose: () => setShowArchived(!showArchived),
            },
          ]}
        />
      </div>

      {problem !== undefined && (
        <div className="fc-pop-enter flex shrink-0 items-center gap-4 border-b border-hairline bg-surface px-6 py-2">
          <span className="text-negative">{problem}</span>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setProblem(undefined)}>
            Dismiss
          </Button>
        </div>
      )}

      {/* docs/f06's prompt, here rather than on the review screen: the other
          direction — a card statement that turns an old bank row into a
          settlement — has no review screen open to put it on (D-064). */}
      <SettlementPrompt />
      {/* M30 U3 (D-356): the same queue for a transfer between two of your own accounts. */}
      <TransferPrompt />

      <div className="min-h-0 flex-1 overflow-auto">
        {data.accounts.length === 0 ? (
          <Centered>
            No accounts yet. One is created the first time you import a statement — or add the card
            you use above, and its last 4 digits will match the file to it.
          </Centered>
        ) : (
          groups.map((group) => (
            <section key={group.kind}>
              <h2 className="sticky top-0 z-10 border-b border-hairline bg-background/90 px-6 py-2 text-label text-ink-tertiary uppercase backdrop-blur">
                {group.label}
              </h2>
              {/* An account added, merged away or moved to another kind (M39). */}
              <Flip as="ul" flipKey={group.members.map((account) => account.id).join(',')}>
                {group.members.map((account) => (
                  <Row
                    key={account.id}
                    account={account}
                    institutions={data.institutions.filter(
                      (institution) => institution.kind === INSTITUTION_KIND[account.kind],
                    )}
                    usage={data.usage.get(account.id)}
                    onRename={(name) =>
                      write((database, now) => renameAccount(database, account.id, name, now))
                    }
                    // Which rows are bank rows has just changed, and the
                    // settlement reading that depends on it is derived rather
                    // than stored — so it is re-derived here (D-060, D-070).
                    onSetKind={(kind) =>
                      write((database, now) => {
                        setAccountKind(database, account.id, kind, now)
                        rescanSettlements(database, now)
                        suggestTransfers(database)
                      })
                    }
                    // **The last 4 is what settlement matching keys on**, so
                    // changing it changes the answer as much as changing the
                    // kind does — and this did not rescan until D-160. Typing
                    // the digits in after an import, which is exactly what
                    // onboarding's skip leaves you doing, produced no prompt at
                    // all: the machinery was complete and had never been asked.
                    onSetLast4={(last4) =>
                      write((database, now) => {
                        setAccountLast4(database, account.id, last4, now)
                        rescanSettlements(database, now)
                        suggestTransfers(database)
                      })
                    }
                    onSetInstitution={(institutionId) =>
                      write((database, now) =>
                        setAccountInstitution(database, account.id, institutionId, now),
                      )
                    }
                    onArchive={() =>
                      write((database, now) =>
                        setAccountArchived(database, account.id, !account.isArchived, now),
                      )
                    }
                    onMerge={() => setMerging(account)}
                    onDelete={() => write((database, now) => deleteAccount(database, account.id, now))}
                    onSetExcludeSettlements={(exclude) =>
                      write((database, now) => {
                        setExcludeSettlementsFromStats(database, account.id, exclude, now)
                        // The control says what this card's charge *does*, so it
                        // has to move the charges as well as the memory —
                        // otherwise picking "never counts as spending" leaves
                        // the prompt above sitting there having done nothing.
                        // Found by driving the screen, not by a test (D-064).
                        decideForCard(
                          database,
                          account.id,
                          exclude === undefined ? 'PENDING' : exclude ? 'EXCLUDED' : 'KEPT',
                          now,
                        )
                      })
                    }
                  />
                ))}
              </Flip>
            </section>
          ))
        )}
      </div>

      {merging !== undefined && (
        <MergePanel
          db={db}
          source={merging}
          targets={data.accounts.filter(
            (candidate) => candidate.id !== merging.id && candidate.kind === merging.kind,
          )}
          onCancel={() => setMerging(undefined)}
          onMerge={(intoId) => {
            const fromId = merging.id
            setMerging(undefined)
            write((database, now) => mergeAccounts(database, fromId, intoId, now))
          }}
        />
      )}
    </div>
  )
}

const GROUPS: readonly { readonly kind: AccountKind; readonly label: string }[] = [
  { kind: 'CREDIT_CARD', label: 'Cards' },
  { kind: 'BANK', label: 'Bank accounts' },
  { kind: 'CASH', label: 'Cash' },
  { kind: 'HOLDINGS', label: 'Accounts with holdings' },
]

/** Which institutions can sit behind which kind of account. Cash is with nobody. */
const INSTITUTION_KIND: Readonly<Record<AccountKind, InstitutionKind | undefined>> = {
  CREDIT_CARD: 'CARD_ISSUER',
  BANK: 'BANK',
  CASH: undefined,
  HOLDINGS: 'INVESTMENT_PLATFORM',
}

function Row({
  account,
  institutions,
  usage,
  onRename,
  onSetKind,
  onSetLast4,
  onSetInstitution,
  onArchive,
  onMerge,
  onDelete,
  onSetExcludeSettlements,
}: {
  account: Account
  institutions: readonly Institution[]
  usage: AccountUsage | undefined
  onRename: (name: string) => void
  onSetKind: (kind: AccountKind) => void
  onSetLast4: (last4: string | undefined) => void
  onSetInstitution: (institutionId: string | undefined) => void
  onArchive: () => void
  onMerge: () => void
  onDelete: () => void
  onSetExcludeSettlements: (exclude: boolean | undefined) => void
}) {
  const [name, setName] = useState(account.name)
  const [last4, setLast4] = useState(account.last4 ?? '')

  return (
    <li data-motion-key={account.id} className="group border-b border-hairline px-6 py-3 transition-colors duration-[var(--duration-micro)] hover:bg-surface">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            const trimmed = name.trim()
            if (trimmed === '') setName(account.name)
            else if (trimmed !== account.name) onRename(trimmed)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          aria-label={`Name of ${account.name}`}
          // A nickname is often Hebrew, and "ויזה 4321" scrambles unisolated.
          dir="auto"
          className={`${FIELD} h-7 w-64`}
        />

        {/* Editable for the same reason the last-4 is: getting it wrong is
            silent, and everything downstream turns on it. A bank statement on
            an account marked as a card is invisible to settlement matching, so
            its card charges are never found and the month is counted twice
            (D-070). */}
        <select
          value={account.kind}
          onChange={(event) => onSetKind(event.target.value as AccountKind)}
          aria-label={`What kind of account ${account.name} is`}
          className={`${SELECT} h-7`}
        >
          <option value="CREDIT_CARD">Card</option>
          <option value="BANK">Bank account</option>
          <option value="CASH">Cash</option>
          <option value="HOLDINGS">Account with holdings</option>
        </select>

        {account.kind === 'CREDIT_CARD' && (
          <input
            value={last4}
            onChange={(event) => setLast4(event.target.value.replace(/\D/g, '').slice(0, 4))}
            onBlur={() => {
              const next = last4 === '' ? undefined : last4
              if (next !== account.last4) onSetLast4(next)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            }}
            inputMode="numeric"
            placeholder="last 4"
            aria-label={`Last 4 digits of ${account.name}`}
            className={`${FIELD} h-7 w-20 tabular-nums`}
          />
        )}

        {institutions.length > 0 && (
          <select
            value={account.institutionId ?? ''}
            onChange={(event) =>
              onSetInstitution(event.target.value === '' ? undefined : event.target.value)
            }
            aria-label={`Who ${account.name} is with`}
            className={`${SELECT} h-7`}
          >
            <option value="">No institution</option>
            {institutions.map((institution) => (
              <option key={institution.id} value={institution.id}>
                {institution.name}
              </option>
            ))}
          </select>
        )}

        {account.isArchived && <Chip>archived</Chip>}
        {account.kind === 'CREDIT_CARD' && account.last4 === undefined && (
          // The one thing on this screen worth acting on, so the one thing
          // wearing a colour: without it, a statement for this card cannot be
          // matched to it and a settlement row cannot be matched at all.
          <Chip problem>no card number</Chip>
        )}

        <span className="ml-auto flex items-center gap-x-3 text-caption text-ink-secondary opacity-0 transition-opacity duration-[var(--duration-micro)] group-hover:opacity-100 focus-within:opacity-100">
          <button type="button" onClick={onMerge} className="hover:text-ink">
            Merge…
          </button>
          <button type="button" onClick={onArchive} className="hover:text-ink">
            {account.isArchived ? 'Unarchive' : 'Archive'}
          </button>
          <button type="button" onClick={onDelete} className="hover:text-negative">
            Remove
          </button>
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 text-caption text-ink-tertiary tabular-nums">
        <span>{describe(usage)}</span>
        {account.kind === 'CREDIT_CARD' && (
          <SettlementAnswer value={account.excludeSettlementsFromStats} onChange={onSetExcludeSettlements} />
        )}
      </div>
    </li>
  )
}

/**
 * What this card's monthly charge does in the bank statement — docs/f06's
 * "reversible from the account screen".
 *
 * **A select of three, not a checkbox**, because the third state is real: "not
 * asked yet" prompts on the next import and "keep them" never does, and a
 * checkbox has nowhere to put the difference (D-061). Setting it back to
 * unanswered is the way to be asked again, which is what makes the whole thing
 * reversible rather than a one-way door.
 *
 * It moves this card's settlements as well as the memory, because that is what
 * the sentence says it does. Setting it back to "ask me" puts them into the
 * prompt above and un-excludes them, which is what makes the answer reversible
 * rather than a one-way door.
 */
function SettlementAnswer({
  value,
  onChange,
}: {
  value: boolean | undefined
  onChange: (exclude: boolean | undefined) => void
}) {
  return (
    <label className="flex items-baseline gap-1.5">
      This card&rsquo;s payment in the bank statement
      <select
        value={value === undefined ? '' : value ? 'exclude' : 'keep'}
        onChange={(event) =>
          onChange(event.target.value === '' ? undefined : event.target.value === 'exclude')
        }
        aria-label="What to do with this card's monthly payment in the bank statement"
        className={`${SELECT} h-6`}
      >
        <option value="">ask me</option>
        <option value="exclude">left out of totals</option>
        <option value="keep">counted</option>
      </select>
    </label>
  )
}

/**
 * Merging, with the number of rows it will drop stated before it happens.
 *
 * The duplicates are the reason to be careful and the reason to do it: they are
 * the overlapping months a split card ended up holding twice. Soft-deleted, so
 * the file keeps them.
 */
function MergePanel({
  db,
  source,
  targets,
  onCancel,
  onMerge,
}: {
  db: Database
  source: Account
  targets: readonly Account[]
  onCancel: () => void
  onMerge: (intoId: string) => void
}) {
  const [intoId, setIntoId] = useState('')
  const preview = intoId === '' ? undefined : mergePreview(db, source.id, intoId)
  const target = targets.find((candidate) => candidate.id === intoId)

  return (
    <div className="fc-pop-enter shrink-0 border-t border-hairline bg-surface px-6 py-4">
      {targets.length === 0 ? (
        <p>
          There is nothing to merge <Bidi className="font-medium">{source.name}</Bidi> into. Only two
          cards, or two bank accounts, can be merged.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span>
              Merge <Bidi className="font-medium">{source.name}</Bidi> into
            </span>
            <select
              autoFocus
              value={intoId}
              onChange={(event) => setIntoId(event.target.value)}
              aria-label="Which account it becomes"
              className={SELECT}
            >
              <option value="">Choose an account…</option>
              {targets.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                  {candidate.last4 === undefined ? '' : ` ·${candidate.last4}`}
                </option>
              ))}
            </select>
          </div>

          <p className="mt-2 text-ink-secondary">
            {preview === undefined || target === undefined ? (
              <>
                Everything moves across and <Bidi>{source.name}</Bidi> goes away. Use this when one
                card ended up as two accounts — a second download of the same month is enough to do
                it.
              </>
            ) : (
              <>
                <span className="text-ink tabular-nums">{preview.moved}</span>{' '}
                {preview.moved === 1 ? 'transaction moves' : 'transactions move'} into{' '}
                <Bidi className="text-ink">{target.name}</Bidi>
                {preview.duplicates > 0 && (
                  <>
                    , and <span className="text-ink tabular-nums">{preview.duplicates}</span>{' '}
                    {preview.duplicates === 1 ? 'row that is' : 'rows that are'} already there
                    {preview.duplicates === 1 ? ' is' : ' are'} dropped — the same charge, recorded
                    twice
                  </>
                )}
                . Imports and readers follow.
                {target.last4 === undefined && source.last4 !== undefined && (
                  <> The card number {source.last4} comes across too.</>
                )}
              </>
            )}
          </p>
        </>
      )}

      <div className="mt-3 flex items-center gap-2">
        {targets.length > 0 && (
          <Button variant="primary" size="sm" disabled={intoId === ''} onClick={() => onMerge(intoId)}>
            Merge
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** Add a card or a bank account by hand — the other way in, beside an import. */
function NewAccountForm({
  onCreate,
}: {
  onCreate: (account: { name: string; kind: AccountKind; last4?: string | undefined }) => void
}) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AccountKind>('CREDIT_CARD')
  const [last4, setLast4] = useState('')

  const submit = (): void => {
    const trimmed = name.trim()
    if (trimmed === '') return
    onCreate({ name: trimmed, kind, last4: last4 === '' ? undefined : last4 })
    setName('')
    setLast4('')
  }

  return (
    <form
      className="ml-auto flex flex-wrap items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Add an account"
        aria-label="New account name"
        dir="auto"
        className={`${FIELD} h-7 w-48`}
      />
      <select
        value={kind}
        onChange={(event) => setKind(event.target.value as AccountKind)}
        aria-label="What kind of account"
        className={`${SELECT} h-7`}
      >
        <option value="CREDIT_CARD">Card</option>
        <option value="BANK">Bank</option>
        <option value="CASH">Cash</option>
        <option value="HOLDINGS">Account with holdings</option>
      </select>
      {kind === 'CREDIT_CARD' && (
        <input
          value={last4}
          onChange={(event) => setLast4(event.target.value.replace(/\D/g, '').slice(0, 4))}
          placeholder="last 4"
          aria-label="Last 4 digits"
          inputMode="numeric"
          className={`${FIELD} h-7 w-20 tabular-nums`}
        />
      )}
      <Button type="submit" size="sm" disabled={name.trim() === ''}>
        Add
      </Button>
    </form>
  )
}

/** What the account holds, in the order it matters. "Nothing yet" is worth saying. */
function describe(usage: AccountUsage | undefined): string {
  if (usage === undefined) return ''
  if (usage.transactions === 0 && usage.importSessions === 0) return 'nothing imported yet'

  const parts = [
    usage.transactions === 1 ? '1 transaction' : `${usage.transactions} transactions`,
    usage.importSessions === 1 ? '1 import' : `${usage.importSessions} imports`,
  ]
  if (usage.mappings > 0) {
    parts.push(usage.mappings === 1 ? '1 reader' : `${usage.mappings} readers`)
  }
  return parts.join(' · ')
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
