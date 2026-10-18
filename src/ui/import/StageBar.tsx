import { useMemo, useState } from 'react'

import { formatMoney } from '@/core/money.ts'
import { allParsed, type ParsedRow } from '@/data/importer/apply.ts'
import type { SheetTable } from '@/data/importer/sheetTable.ts'
import { guessKind, judgeBatch, placeRows, sheetFrom, type StatementSheet } from '@/data/importer/statementBatch.ts'
import { listAccounts, type AccountKind } from '@/data/repositories/accountRepository.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { SELECT } from '@/ui/components/fieldLook.ts'
import type { DraftMapping, DraftTransaction } from '@/domain/model/importing.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { batchFor, sheetsOf, useStatementBatch, writesSheet } from '@/state/statementBatch.ts'

/**
 * The end of the mapper: the file, read with the mapping on screen, handed back
 * as a sheet — **no transaction written** (M28 U5). The one thing Read it does
 * write is the reader, which the mapper keeps on the way out (M31 U2), so the
 * same columns next month are read without this screen.
 *
 * It staged the parse for the review screen until M28 U5 took that screen away.
 * Now the sheet goes where every other statement goes: judged, ticked when it
 * adds up, written with Write — and if it does not add up, shown the gap. The
 * account is a request until then, because resolving one can create it.
 */
export function StageBar({
  fileName,
  fileHash,
  sheetName,
  mappingId,
  mappingName,
  boundAccountId,
  accountName,
  cardLast4,
  table,
  mapping,
  rows,
  transactions,
  onRead,
}: {
  fileName: string
  fileHash: string | undefined
  sheetName: string
  /** The saved mapping that parsed this, when the mapping on screen is a stored one. */
  mappingId: string | undefined
  mappingName: string
  /** The account that mapping is bound to, if the user has bound one (F12). */
  boundAccountId: string | undefined
  accountName: string
  cardLast4: string | undefined
  table: SheetTable
  mapping: DraftMapping
  /** Every row the mapping produced, in sheet order — failures and skips included. */
  rows: readonly ParsedRow[]
  /** The subset that parsed, for the summary line. */
  transactions: readonly DraftTransaction[]
  onRead: (sheet: StatementSheet) => void
}) {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const batch = batchFor(useStatementBatch(), db)
  const [kind, setKind] = useState<AccountKind | undefined>()
  /**
   * An account's id, a pending account's key (`new:…`, one a file already in
   * the batch is about to make), `'new'`, or undefined for the default below.
   */
  const [choice, setChoice] = useState<string | undefined>()

  /**
   * **Which account, offered rather than assumed** (M28 F11). The bar used to
   * say *"<file name> is a [bank account]"* and nothing else, so a second export
   * of a bank the document already keeps could only become a second bank. Now
   * the accounts are offered first, and the default is the evidence: the account
   * that already holds rows of this file, else the one the import would find.
   *
   * **And the accounts the batch is about to make** (M28 F15): a file earlier
   * in the batch that will make *Everyday Bank* on Write makes it a choice here, and
   * rows this file shares with it are found there, so a second export of one
   * bank lands on the first in the same pass rather than the next one.
   */
  const where = useMemo(() => {
    if (db === undefined) return undefined
    const accounts = listAccounts(db)
    const pending = judgeBatch(db, sheetsOf(batch), (id, verdict) => writesSheet(batch, id, verdict)).pending
    const placed = placeRows(db, { boundAccountId, last4: cardLast4, fallbackName: accountName }, allParsed(rows), pending)
    const making = pending.filter((each) => each.accountId === undefined)
    const held = placed.elsewhere
    const fallback = held?.accountId ?? held?.key ?? placed.account?.id ?? placed.joins?.key ?? 'new'
    return { accounts, making, found: placed.account, joins: placed.joins, held, fallback }
    // `revision` is the document changing under the same `db`.
  }, [db, revision, rows, boundAccountId, cardLast4, accountName, batch.files, batch.ticks, batch.forced])

  if (db === undefined) {
    return (
      <Bar>
        <span className="text-ink-secondary">
          Open or create a document before importing, so there is somewhere to put this.
        </span>
      </Bar>
    )
  }

  if (transactions.length === 0) return null

  /**
   * What kind of account this file looks like it belongs to — **a running
   * balance is the tell** (D-070). The app guesses and the user decides.
   */
  const guessedKind: AccountKind = guessKind(rows)

  const chosen = choice ?? where?.fallback ?? 'new'
  const chosenAccount = where?.accounts.find((account) => account.id === chosen)
  const chosenMaking = where?.making.find((each) => each.key === chosen)
  const held = where?.held

  const read = (): void => {
    if (fileHash === undefined) return
    const sheet = sheetFrom({
      id: `${fileHash}:${sheetName}`,
      fileName,
      fileHash,
      table,
      mapping,
      mappingId,
      mappingName,
      boundAccountId,
      kind: kind ?? guessedKind,
    })
    // Named from the card's last-4 where the file supplies one, as it always was.
    // An account picked here is bound for this read; the commit teaches the
    // reader it, so the next export of this layout goes there on its own. A
    // choice made beside the overlap line is the person's say: not asked again.
    onRead({
      ...sheet,
      account:
        chosenMaking !== undefined
          ? // The request the file above makes it with, so both resolve to it.
            { ...chosenMaking.request, separate: held === undefined || held.key === chosenMaking.key ? undefined : true }
          : chosenAccount === undefined
          ? { ...sheet.account, last4: cardLast4, fallbackName: accountName, separate: held === undefined ? undefined : true }
          : {
              boundAccountId: chosenAccount.id,
              last4: cardLast4 ?? chosenAccount.last4,
              fallbackName: accountName,
              kind: chosenAccount.kind,
              separate: held === undefined || held.accountId === chosenAccount.id ? undefined : true,
            },
    })
  }

  return (
    <Bar>
      <span className="text-ink-secondary">
        {transactions.length} transactions ·{' '}
        {formatMoney(
          transactions.reduce(
            (total, transaction) => ({
              minor: total.minor + Math.abs(transaction.amount.minor),
              currency: total.currency,
            }),
            { minor: 0, currency: transactions[0]?.amount.currency ?? 'ILS' },
          ),
        )}
      </span>

      {/* Only when an account is about to be **created**. A file going into an
          account the user already bound is not the moment to ask what that
          account is (D-070). */}
      {boundAccountId === undefined && held !== undefined && (
        <span className="text-caption text-ink-secondary">
          {held.accountId === undefined && held.madeBy !== undefined ? (
            <>
              {held.rows} of its rows are also in <Bidi>{held.madeBy}</Bidi>
            </>
          ) : (
            <>
              {held.rows} of its rows are already in <Bidi>{held.accountName}</Bidi>
            </>
          )}
        </span>
      )}

      {boundAccountId === undefined && where !== undefined && (
        <label className="ml-auto flex items-center gap-2 text-caption text-ink-secondary">
          Into
          <select
            className={`${SELECT} h-7 max-w-[240px] text-body`}
            value={chosen}
            aria-label="Which account this file belongs to"
            onChange={(event) => setChoice(event.target.value)}
          >
            {where.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
            {where.making.map((each) => (
              <option key={each.key} value={each.key}>
                {each.name}, new with {each.madeBy}
              </option>
            ))}
            {where.found === undefined && where.joins === undefined && (
              <option value="new">a new account, {accountName}</option>
            )}
          </select>
        </label>
      )}

      {boundAccountId === undefined && chosenAccount === undefined && chosenMaking === undefined && (
        <label className="flex items-center gap-2 text-caption text-ink-secondary">
          as a
          <select
            className={`${SELECT} h-7 text-body`}
            value={kind ?? guessedKind}
            aria-label="What kind of account this file belongs to"
            onChange={(event) => setKind(event.target.value as AccountKind)}
          >
            <option value="CREDIT_CARD">card</option>
            <option value="BANK">bank account</option>
            <option value="CASH">cash</option>
          </select>
        </label>
      )}

      <Button
        variant="primary"
        icon="check"
        className={boundAccountId === undefined && where !== undefined ? '' : 'ml-auto'}
        onClick={read}
        disabled={fileHash === undefined}
      >
        Read it
      </Button>
    </Bar>
  )
}

function Bar({ children }: { children: React.ReactNode }) {
  return (
    <div className="fc-pop-enter flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline px-6 py-2">
      {children}
    </div>
  )
}
