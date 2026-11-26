import { useEffect, useMemo, useRef, useState } from 'react'
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
import type { MessageKey } from '@/i18n/catalogue.ts'
import { countKey } from '@/i18n/count.ts'
import { useT, type Translate } from '@/i18n/current.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { PageMenu } from '@/ui/components/PageMenu.tsx'
import { Chip } from '@/ui/components/Chip.tsx'
import { ChoiceMenu } from '@/ui/components/ChoiceField.tsx'
import { ConfirmAtButton } from '@/ui/components/ConfirmAtButton.tsx'
import { Field } from '@/ui/components/Field.tsx'
import { SidePanel } from '@/ui/components/SidePanel.tsx'
import { WaitingList, type Waiting } from '@/ui/components/WaitingList.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { decideForCard } from '@/data/repositories/cardSettlementRepository.ts'
import { rescanSettlements } from '@/data/importer/settlementScan.ts'
import { suggestTransfers } from '@/data/repositories/transferPairRepository.ts'
import { Flip } from '@/ui/motion/Flip.tsx'
import { SettingsPage } from '@/ui/settings/SettingsPage.tsx'

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
 *
 * **The report** (M64 U12, D-624): the answer first — how many cards and
 * accounts, in words — then a card with no number as one line of what waits,
 * and the accounts read as rows, never a row of fields. A row's one value a
 * person changes often — what its card payment does in the bank — is changed
 * in place; the account itself (its name, kind, number, institution) opens as
 * a form beside the page, with Merge, Archive and Delete at its foot. A delete
 * cannot be undone (it unbinds readers and frees plan buckets), so it asks at
 * its button. The settlement and transfer queues that sat above the list are
 * Home's waiting list's, where they were already answered.
 */
export function Accounts() {
  const t = useT()
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)

  const [showArchived, setShowArchived] = useState(false)
  const [panel, setPanel] = useState<AccountPanel | undefined>()
  const [problem, setProblem] = useState<string | undefined>()

  const data = useMemo(() => {
    if (db === undefined) return undefined
    // Every account, the archived too: the panel stays on one just archived.
    const every = listAccounts(db, { includeArchived: true })
    return {
      every,
      accounts: showArchived ? every : every.filter((account) => !account.isArchived),
      institutions: listInstitutions(db),
      usage: new Map(every.map((account) => [account.id, accountUsage(db, account.id)])),
    }
  }, [db, revision, showArchived])

  if (db === undefined || data === undefined) {
    return <SettingsPage title={t('rail.accounts')} answer={t('settings.accounts.noDocument')} />
  }

  const write = (work: (database: Database, now: number) => void): boolean => {
    setProblem(undefined)
    try {
      mutate((database) => work(database, Date.now()))
      return true
    } catch (error) {
      // A refusal is information: it is how the user finds out that the account
      // they tried to remove is holding four years of statements.
      setProblem(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  // Which rows are bank rows, and which card a bank charge pays, have just
  // changed: the settlement reading that depends on them is derived rather than
  // stored, so it is re-derived (D-060, D-070, D-160).
  const rescan = (database: Database, now: number): void => {
    rescanSettlements(database, now)
    suggestTransfers(database)
  }
  const setSettlement = (account: Account, exclude: boolean | undefined): void => {
    write((database, now) => {
      setExcludeSettlementsFromStats(database, account.id, exclude, now)
      // The answer says what this card's charge *does*, so it moves the charges
      // as well as the memory (D-064).
      decideForCard(database, account.id, exclude === undefined ? 'PENDING' : exclude ? 'EXCLUDED' : 'KEPT', now)
    })
  }

  const groups = GROUPS.map((group) => ({
    ...group,
    members: data.accounts.filter((account) => account.kind === group.kind),
  })).filter((group) => group.members.length > 0)
  const cards = groups.some((group) => group.kind === 'CREDIT_CARD')

  const counted = GROUPS.map((group) => ({
    key: group.count,
    n: data.every.filter((account) => !account.isArchived && account.kind === group.kind).length,
  }))
    .filter((each) => each.n > 0)
    .map((each) => t(countKey(each.key, each.n), { count: each.n }))
  const answer = counted.length === 0 ? t('settings.accounts.none') : t('settings.accounts.answer', { accounts: listWords(counted, t) })

  // A card with no number cannot be matched to its statements or its bank
  // payments: the one thing here that waits on the person.
  const waiting: Waiting[] = data.accounts
    .filter((account) => account.kind === 'CREDIT_CARD' && account.last4 === undefined && !account.isArchived)
    .map((account) => ({
      key: account.id,
      say: t('settings.accounts.noNumber', { name: account.name }),
      why: t('settings.accounts.noNumberWhy'),
      verb: t('settings.accounts.addNumber'),
      onDo: () => setPanel({ kind: 'account', id: account.id, focus: 'last4' }),
    }))

  const open = panel?.kind === 'account' || panel?.kind === 'merge' ? data.every.find((account) => account.id === panel.id) : undefined
  const institutionsFor = (kind: AccountKind): readonly Institution[] =>
    data.institutions.filter((institution) => institution.kind === INSTITUTION_KIND[kind])

  const aside =
    panel?.kind === 'new' ? (
      <SidePanel title={t('settings.accounts.newTitle')} onClose={() => setPanel(undefined)}>
        <NewAccountForm
          problem={problem}
          onCancel={() => setPanel(undefined)}
          onCreate={(account) => {
            let id: string | undefined
            // Rescanned too: a card added *after* its statements were imported
            // is the ordinary case, and until this runs there is no settlement
            // link for anything to prompt about (D-160).
            const ok = write((database, now) => {
              id = createAccount(database, account, now).id
              rescan(database, now)
            })
            if (ok && id !== undefined) setPanel({ kind: 'account', id })
          }}
        />
      </SidePanel>
    ) : open !== undefined && panel?.kind === 'merge' ? (
      <SidePanel kicker={open.name} title={t('settings.accounts.mergeTitle')} onClose={() => setPanel(undefined)}>
        <MergeForm
          db={db}
          source={open}
          targets={data.every.filter((candidate) => candidate.id !== open.id && candidate.kind === open.kind && !candidate.isArchived)}
          onCancel={() => setPanel({ kind: 'account', id: open.id })}
          onMerge={(intoId) => {
            if (write((database, now) => mergeAccounts(database, open.id, intoId, now))) setPanel({ kind: 'account', id: intoId })
          }}
        />
      </SidePanel>
    ) : open !== undefined && panel?.kind === 'account' ? (
      <SidePanel title={<Bidi>{open.name}</Bidi>} onClose={() => setPanel(undefined)}>
        <AccountForm
          key={open.id}
          account={open}
          usage={data.usage.get(open.id)}
          institutions={institutionsFor(open.kind)}
          focus={panel.focus}
          problem={problem}
          onRename={(name) => write((database, now) => renameAccount(database, open.id, name, now))}
          onSetKind={(kind) =>
            write((database, now) => {
              setAccountKind(database, open.id, kind, now)
              rescan(database, now)
            })
          }
          // **The last 4 is what settlement matching keys on**, so changing it
          // changes the answer as much as changing the kind does (D-160).
          onSetLast4={(last4) =>
            write((database, now) => {
              setAccountLast4(database, open.id, last4, now)
              rescan(database, now)
            })
          }
          onSetInstitution={(institutionId) => write((database, now) => setAccountInstitution(database, open.id, institutionId, now))}
          onSetSettlement={(exclude) => setSettlement(open, exclude)}
          // Archive is undone by the same button, which stays where it was.
          onArchive={() => write((database, now) => setAccountArchived(database, open.id, !open.isArchived, now))}
          onMerge={() => setPanel({ kind: 'merge', id: open.id })}
          onDelete={() => {
            if (write((database, now) => deleteAccount(database, open.id, now))) setPanel(undefined)
          }}
        />
      </SidePanel>
    ) : undefined

  return (
    <SettingsPage
      title={t('rail.accounts')}
      answer={answer}
      action={
        <span className="flex items-center gap-2">
          <Button variant="primary" icon="add" onClick={() => setPanel({ kind: 'new' })}>
            {t('settings.accounts.addAccount')}
          </Button>
          <PageMenu
            title={t('rail.accounts')}
            items={[
              {
                label: showArchived ? t('settings.accounts.hideArchived') : t('settings.accounts.showArchived'),
                onChoose: () => setShowArchived(!showArchived),
              },
            ]}
          />
        </span>
      }
      aside={aside}
    >
      {problem !== undefined && panel === undefined && (
        <p className="fc-pop-enter m-0 mb-4 flex flex-wrap items-baseline gap-x-3 text-ink-secondary">
          <span aria-hidden className="inline-block size-2 rounded-full bg-negative" />
          <span className="text-ink">{problem}</span>
          <button type="button" className="fc-text-action" onClick={() => setProblem(undefined)}>
            {t('settings.accounts.dismiss')}
          </button>
        </p>
      )}

      {waiting.length > 0 && (
        <div className="mb-6">
          <WaitingList items={waiting} label={t('settings.accounts.waitingLabel')} />
        </div>
      )}

      {groups.length > 0 && (
        // One table, so the counts and the cards' answers line up down every
        // group; each group a body headed by its name (M64 U12).
        <table className="w-full border-collapse">
          {/* Only a card's answer needs its column named: a name and a count say what they are. */}
          <thead>
            <tr>
              <th className="p-0">
                <span className="sr-only">{t('settings.accounts.columns.name')}</span>
              </th>
              <th className="p-0">
                <span className="sr-only">{t('settings.accounts.columns.holds')}</span>
              </th>
              <th className="h-8 w-56 ps-5 text-start align-bottom text-caption font-medium text-ink-secondary">
                {cards ? t('settings.accounts.columns.payment') : <span className="sr-only">{t('settings.accounts.columns.payment')}</span>}
              </th>
            </tr>
          </thead>
          {groups.map((group) => (
            // An account added, merged away or moved to another kind (M39).
            <Flip key={group.kind} as="tbody" flipKey={group.members.map((account) => account.id).join(',')}>
              <tr>
                <th colSpan={3} scope="rowgroup" className="px-0 pt-6 pb-2 text-start text-heading font-medium">
                  {t(group.label)}
                </th>
              </tr>
              {group.members.map((account, index) => (
                <Row
                  key={account.id}
                  account={account}
                  institution={data.institutions.find((each) => each.id === account.institutionId)}
                  usage={data.usage.get(account.id)}
                  on={open?.id === account.id}
                  stop={open === undefined ? group === groups[0] && index === 0 : open.id === account.id}
                  onOpen={() => setPanel({ kind: 'account', id: account.id })}
                  onSetSettlement={(exclude) => setSettlement(account, exclude)}
                />
              ))}
            </Flip>
          ))}
        </table>
      )}
    </SettingsPage>
  )
}

/** What the panel holds: a new account's form, an account's, or its merge. */
type AccountPanel =
  | { readonly kind: 'new' }
  | { readonly kind: 'account'; readonly id: string; readonly focus?: 'last4' | undefined }
  | { readonly kind: 'merge'; readonly id: string }

const GROUPS: readonly { readonly kind: AccountKind; readonly label: MessageKey; readonly count: Parameters<typeof countKey>[0] }[] = [
  { kind: 'CREDIT_CARD', label: 'settings.accounts.groups.cards', count: 'settings.accounts.count.cards' },
  { kind: 'BANK', label: 'settings.accounts.groups.banks', count: 'settings.accounts.count.banks' },
  { kind: 'CASH', label: 'settings.accounts.groups.cash', count: 'settings.accounts.count.cash' },
  { kind: 'HOLDINGS', label: 'settings.accounts.groups.holdings', count: 'settings.accounts.count.holdings' },
]

const KINDS: readonly { readonly kind: AccountKind; readonly label: MessageKey }[] = [
  { kind: 'CREDIT_CARD', label: 'settings.accounts.kinds.card' },
  { kind: 'BANK', label: 'settings.accounts.kinds.bankAccount' },
  { kind: 'CASH', label: 'settings.accounts.kinds.cash' },
  { kind: 'HOLDINGS', label: 'settings.accounts.kinds.holdings' },
]

/** Which institutions can sit behind which kind of account. Cash is with nobody. */
const INSTITUTION_KIND: Readonly<Record<AccountKind, InstitutionKind | undefined>> = {
  CREDIT_CARD: 'CARD_ISSUER',
  BANK: 'BANK',
  CASH: undefined,
  HOLDINGS: 'INVESTMENT_PLATFORM',
}

/** A choice at rest is its word, a field only on hover and focus (as Plan's bills, M64 U9). */
const QUIET_CHOICE =
  'h-8 cursor-pointer border border-transparent bg-transparent px-2 hover:border-hairline-strong focus-visible:border-accent'

/** `2 cards and 1 bank account`, `a, b and c`. */
function listWords(items: readonly string[], t: Translate): string {
  if (items.length <= 1) return items[0] ?? ''
  return t('settings.accounts.and', { first: items.slice(0, -1).join(', '), last: items[items.length - 1] ?? '' })
}

/** A card's payment in the bank, as the three answers a person can give (D-061). */
function settlementChoices(t: Translate) {
  return [
    { value: '', label: t('settings.accounts.askMe') },
    { value: 'exclude', label: t('settings.accounts.leftOut') },
    { value: 'keep', label: t('settings.accounts.counted') },
  ] as const
}
function settlementWord(value: boolean | undefined, t: Translate): string {
  return value === undefined ? t('settings.accounts.askMe') : value ? t('settings.accounts.leftOut') : t('settings.accounts.counted')
}
function settlementOf(value: string): boolean | undefined {
  return value === '' ? undefined : value === 'exclude'
}

/**
 * An account, read: its name, its card number and institution under it, what
 * it holds, and — for a card — what its payment in the bank does, changed in
 * place. The row opens the account beside the page; Enter too, and the arrows
 * walk the rows.
 */
function Row({
  account,
  institution,
  usage,
  on,
  stop,
  onOpen,
  onSetSettlement,
}: {
  readonly account: Account
  readonly institution: Institution | undefined
  readonly usage: AccountUsage | undefined
  readonly on: boolean
  /** The table's one stop in the tab order; the arrows walk the rest. */
  readonly stop: boolean
  readonly onOpen: () => void
  readonly onSetSettlement: (exclude: boolean | undefined) => void
}) {
  const t = useT()
  const card = account.kind === 'CREDIT_CARD'
  return (
    <tr
      data-motion-key={account.id}
      tabIndex={stop ? 0 : -1}
      aria-current={on ? 'true' : undefined}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest('button, a, input') === null) onOpen()
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const next = event.key === 'ArrowDown' ? event.currentTarget.nextElementSibling : event.currentTarget.previousElementSibling
          if (next instanceof HTMLElement) {
            event.preventDefault()
            next.focus()
          }
        }
        if (event.key === 'Enter') onOpen()
      }}
      className={`h-10 cursor-pointer border-b border-hairline transition-colors duration-[var(--duration-micro)] [tr:first-child+&]:border-t ${on ? 'fc-row-on' : 'hover:bg-surface'}`}
    >
      <td className="px-3 py-1.5">
        <span className="flex flex-wrap items-baseline gap-x-3">
          <Bidi>{account.name}</Bidi>
          {card && account.last4 !== undefined && !account.name.trimEnd().endsWith(account.last4) && (
            <span className="text-ink-secondary tabular-nums">·{account.last4}</span>
          )}
          {card && account.last4 === undefined && <Chip problem>{t('settings.accounts.noCardNumber')}</Chip>}
          {institution !== undefined && <Bidi className="text-caption text-ink-secondary">{institution.name}</Bidi>}
          {account.isArchived && <Chip>{t('settings.accounts.archived')}</Chip>}
        </span>
      </td>
      <td className="px-3 text-end text-ink-secondary tabular-nums">{holds(usage, t)}</td>
      {!card && <td className="w-56" />}
      {card && (
        <td className="w-56 py-1 ps-3">
          <ChoiceMenu
            text={settlementWord(account.excludeSettlementsFromStats, t)}
            choices={settlementChoices(t)}
            onPick={(choice) => onSetSettlement(settlementOf(choice.value))}
            aria-label={t('settings.accounts.settlementOf', { name: account.name })}
            title={t('settings.accounts.settlement')}
            className={QUIET_CHOICE}
          />
        </td>
      )}
    </tr>
  )
}

/** What the account holds, briefly: its transactions, or that nothing is read into it yet. */
function holds(usage: AccountUsage | undefined, t: Translate): string {
  if (usage === undefined) return ''
  if (usage.transactions === 0) return t('settings.accounts.nothingYet')
  return t(usage.transactions === 1 ? 'settings.accounts.transactionOne' : 'settings.accounts.transactionMany', {
    n: usage.transactions.toLocaleString('en-US'),
  })
}

/** What the account holds, in the order it matters, for its form. "Nothing yet" is worth saying. */
function describe(usage: AccountUsage | undefined, t: Translate): string {
  if (usage === undefined) return ''
  if (usage.transactions === 0 && usage.importSessions === 0) return t('settings.accounts.nothingImported')

  const parts = [
    usage.transactions === 1 ? t('settings.accounts.transactionOne') : t('settings.accounts.transactionMany', { n: usage.transactions.toLocaleString('en-US') }),
    usage.importSessions === 1 ? t('settings.accounts.importOne') : t('settings.accounts.importMany', { n: usage.importSessions }),
  ]
  if (usage.mappings > 0) {
    parts.push(usage.mappings === 1 ? t('settings.accounts.readerOne') : t('settings.accounts.readerMany', { n: usage.mappings }))
  }
  return parts.join(' · ')
}

/** A problem a write ran into, said in the panel where it was asked. */
function Problem({ text }: { readonly text: string | undefined }) {
  if (text === undefined) return null
  return (
    <p className="fc-pop-enter m-0 flex items-baseline gap-2 text-ink" role="alert">
      <span aria-hidden className="inline-block size-2 shrink-0 rounded-full bg-negative" />
      <span>{text}</span>
    </p>
  )
}

/**
 * An account, as a form beside the page: each field saves when it is left (or
 * on Enter), the way the row's own choice does. Merge, Archive and Delete at
 * the foot; Archive is undone by pressing it again, and Delete — which cannot
 * be — asks at its button.
 */
function AccountForm({
  account,
  usage,
  institutions,
  focus,
  problem,
  onRename,
  onSetKind,
  onSetLast4,
  onSetInstitution,
  onSetSettlement,
  onArchive,
  onMerge,
  onDelete,
}: {
  readonly account: Account
  readonly usage: AccountUsage | undefined
  readonly institutions: readonly Institution[]
  readonly focus?: 'last4' | undefined
  readonly problem: string | undefined
  readonly onRename: (name: string) => void
  readonly onSetKind: (kind: AccountKind) => void
  readonly onSetLast4: (last4: string | undefined) => void
  readonly onSetInstitution: (institutionId: string | undefined) => void
  readonly onSetSettlement: (exclude: boolean | undefined) => void
  readonly onArchive: () => void
  readonly onMerge: () => void
  readonly onDelete: () => void
}) {
  const t = useT()
  const [name, setName] = useState(account.name)
  const [last4, setLast4] = useState(account.last4 ?? '')
  const card = account.kind === 'CREDIT_CARD'
  const held = usage?.transactions ?? 0
  const last4Field = useRef<HTMLInputElement>(null)
  const kind = KINDS.find((each) => each.kind === account.kind)

  return (
    <div
      className="flex flex-col gap-4"
      ref={(element) => {
        // Opened from *Add its number*: the number's field, ready to type in.
        if (element !== null && focus === 'last4') window.setTimeout(() => last4Field.current?.focus({ preventScroll: true }), 0)
      }}
    >
      <p className="m-0 text-ink-secondary tabular-nums">{describe(usage, t)}</p>

      <Field label={t('settings.accounts.columns.name')}>
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
          // A nickname is often Hebrew, and "ויזה 4321" scrambles unisolated.
          dir="auto"
          className={FIELD}
        />
      </Field>

      {/* Editable for the same reason the last-4 is: getting it wrong is
          silent, and everything downstream turns on it. A bank statement on an
          account marked as a card is invisible to settlement matching, so its
          card charges are never found and the month is counted twice (D-070). */}
      <Field label={t('settings.accounts.columns.kind')}>
        <ChoiceMenu
          text={kind === undefined ? '' : t(kind.label)}
          choices={KINDS.map((each) => ({ value: each.kind, label: t(each.label) }))}
          onPick={(choice) => onSetKind(choice.value as AccountKind)}
          aria-label={t('settings.accounts.kindOf', { name: account.name })}
        />
      </Field>

      {card && (
        <Field label={t('settings.accounts.last4Digits')} hint={t('settings.accounts.last4Hint')}>
          <input
            ref={last4Field}
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
            className={`${FIELD} w-24 tabular-nums`}
          />
        </Field>
      )}

      {institutions.length > 0 && (
        <Field label={t('settings.accounts.columns.with')}>
          <ChoiceMenu
            text={institutions.find((each) => each.id === account.institutionId)?.name ?? t('settings.accounts.noInstitution')}
            choices={[
              { value: '', label: t('settings.accounts.noInstitution') },
              ...institutions.map((institution) => ({ value: institution.id, label: institution.name })),
            ]}
            onPick={(choice) => onSetInstitution(choice.value === '' ? undefined : choice.value)}
            aria-label={t('settings.accounts.institutionOf', { name: account.name })}
          />
        </Field>
      )}

      {/* A select of three, not a checkbox: "not asked yet" prompts on the next
          import and "counted" never does (D-061). Setting it back to ask me is
          the way to be asked again, which makes the answer reversible. */}
      {card && (
        <Field label={t('settings.accounts.settlement')}>
          <ChoiceMenu
            text={settlementWord(account.excludeSettlementsFromStats, t)}
            choices={settlementChoices(t)}
            onPick={(choice) => onSetSettlement(settlementOf(choice.value))}
            aria-label={t('settings.accounts.settlementOf', { name: account.name })}
          />
        </Field>
      )}

      <Problem text={problem} />

      <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
        <Button variant="secondary" size="sm" onClick={onMerge}>
          {t('settings.accounts.merge')}
        </Button>
        <Button variant="secondary" size="sm" onClick={onArchive}>
          {account.isArchived ? t('settings.accounts.unarchive') : t('settings.accounts.archive')}
        </Button>
        <span className="flex-1" />
        {held === 0 && (
          <ConfirmAtButton
            label={t('settings.accounts.deleteLabel', { name: account.name })}
            question={<Phrase text={t('settings.accounts.deleteQuestion')} parts={{ name: <Bidi>{account.name}</Bidi> }} />}
            cost={t('settings.accounts.deleteCost')}
            confirm={t('settings.accounts.delete')}
            cancel={t('settings.accounts.cancel')}
            onConfirm={onDelete}
          />
        )}
      </div>
      {held > 0 && <p className="m-0 text-caption text-ink-secondary">{t('settings.accounts.cannotDelete')}</p>}
      {account.isArchived && <p className="m-0 text-caption text-ink-secondary">{t('settings.accounts.archivedText')}</p>}
    </div>
  )
}

/**
 * Merging, with the number of rows it will drop stated before it happens.
 *
 * The duplicates are the reason to be careful and the reason to do it: they are
 * the overlapping months a split card ended up holding twice. Soft-deleted, so
 * the file keeps them. The form is the confirmation: what moves and what is
 * dropped is said before Merge is pressed.
 */
function MergeForm({
  db,
  source,
  targets,
  onCancel,
  onMerge,
}: {
  readonly db: Database
  readonly source: Account
  readonly targets: readonly Account[]
  readonly onCancel: () => void
  readonly onMerge: (intoId: string) => void
}) {
  const t = useT()
  const [intoId, setIntoId] = useState('')
  const preview = intoId === '' ? undefined : mergePreview(db, source.id, intoId)
  const target = targets.find((candidate) => candidate.id === intoId)
  const label = (account: Account): string =>
    `${account.name}${account.last4 === undefined || account.name.trimEnd().endsWith(account.last4) ? '' : ` ·${account.last4}`}`

  if (targets.length === 0) {
    return (
      <>
        <p className="m-0">
          <Phrase text={t('settings.accounts.mergeNothing')} parts={{ name: <Bidi className="font-medium">{source.name}</Bidi> }} />
        </p>
        <span>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('settings.accounts.back')}
          </Button>
        </span>
      </>
    )
  }

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        if (intoId !== '') onMerge(intoId)
      }}
    >
      <Field label={t('settings.accounts.whichAccount')}>
        <ChoiceMenu
          autoFocus
          text={target === undefined ? t('settings.accounts.chooseAccount') : label(target)}
          choices={targets.map((candidate) => ({ value: candidate.id, label: label(candidate) }))}
          onPick={(choice) => setIntoId(choice.value)}
          aria-label={t('settings.accounts.whichAccount')}
        />
      </Field>

      <p className="m-0 text-ink-secondary">
        {preview === undefined || target === undefined ? (
          <Phrase text={t('settings.accounts.mergeExplain')} parts={{ name: <Bidi>{source.name}</Bidi> }} />
        ) : (
          <>
            <Phrase
              text={t(preview.moved === 1 ? 'settings.accounts.movesOne' : 'settings.accounts.movesMany')}
              parts={{
                n: <span className="text-ink tabular-nums">{preview.moved}</span>,
                name: <Bidi className="text-ink">{target.name}</Bidi>,
              }}
            />
            {preview.duplicates > 0 && (
              <Phrase
                text={t(preview.duplicates === 1 ? 'settings.accounts.duplicateOne' : 'settings.accounts.duplicateMany')}
                parts={{ n: <span className="text-ink tabular-nums">{preview.duplicates}</span> }}
              />
            )}
            {t('settings.accounts.follow')}
            {target.last4 === undefined && source.last4 !== undefined && <>{t('settings.accounts.cardComes', { last4: source.last4 })}</>}
          </>
        )}
      </p>

      <span className="flex gap-2">
        <Button type="submit" variant="secondary" size="sm" disabled={intoId === ''}>
          {t('settings.accounts.mergeButton')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('settings.accounts.cancel')}
        </Button>
      </span>
    </form>
  )
}

/** Add a card or a bank account by hand — the other way in, beside reading a statement. */
function NewAccountForm({
  problem,
  onCreate,
  onCancel,
}: {
  readonly problem: string | undefined
  readonly onCreate: (account: { name: string; kind: AccountKind; last4?: string | undefined }) => void
  readonly onCancel: () => void
}) {
  const t = useT()
  const [name, setName] = useState('')
  const [kind, setKind] = useState<AccountKind>('CREDIT_CARD')
  const [last4, setLast4] = useState('')
  const kindWord = KINDS.find((each) => each.kind === kind)
  // The name, ready to type in: after the panel has put focus on its Close.
  const nameField = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const timer = window.setTimeout(() => nameField.current?.focus({ preventScroll: true }), 0)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        const trimmed = name.trim()
        if (trimmed === '') return
        onCreate({ name: trimmed, kind, last4: last4 === '' ? undefined : last4 })
      }}
    >
      <Field label={t('settings.accounts.columns.name')}>
        <input ref={nameField} value={name} onChange={(event) => setName(event.target.value)} dir="auto" className={FIELD} />
      </Field>
      <Field label={t('settings.accounts.columns.kind')}>
        <ChoiceMenu
          text={kindWord === undefined ? '' : t(kindWord.label)}
          choices={KINDS.map((each) => ({ value: each.kind, label: t(each.label) }))}
          onPick={(choice) => setKind(choice.value as AccountKind)}
          aria-label={t('settings.accounts.whatKind')}
        />
      </Field>
      {kind === 'CREDIT_CARD' && (
        <Field label={t('settings.accounts.last4Digits')} hint={t('settings.accounts.last4Hint')}>
          <input
            value={last4}
            onChange={(event) => setLast4(event.target.value.replace(/\D/g, '').slice(0, 4))}
            inputMode="numeric"
            className={`${FIELD} w-24 tabular-nums`}
          />
        </Field>
      )}
      <Problem text={problem} />
      <span className="flex gap-2">
        <Button type="submit" variant="secondary" size="sm" disabled={name.trim() === ''}>
          {t('settings.accounts.add')}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {t('settings.accounts.cancel')}
        </Button>
      </span>
    </form>
  )
}
