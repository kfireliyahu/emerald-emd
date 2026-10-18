import { useMemo, useState } from 'react'

import { headerCellsFromSignature } from '@/data/importer/signature.ts'
import { listAccounts, type Account } from '@/data/repositories/accountRepository.ts'
import {
  deleteMapping,
  duplicateMapping,
  listMappings,
  renameMapping,
  setMappingAccount,
  type SavedMapping,
} from '@/data/repositories/importMappingRepository.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Button } from '@/ui/components/Button.tsx'
import { Chip } from '@/ui/components/Chip.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'
import { labelFor, ROLE_LABEL } from '@/ui/import/roleLabel.ts'
import { instantDay } from '@/core/instant.ts'
import { Bidi } from '@/ui/Bidi.tsx'

/**
 * The saved mappings, and the operations of docs/f01 on them: rename,
 * duplicate, delete, and see what each one reads and when it was last used.
 *
 * Nothing is created here. A mapping is made in the mapper, against a real file,
 * because that is the only place its columns mean anything — this screen is
 * where they are kept, not where they are written. Editing the columns is the
 * same argument, so "re-map" is an instruction to import a file of that format
 * again rather than a button.
 *
 * **Delete is the wide door here**, the opposite of the taxonomy screen. A
 * category holds history; a mapping only holds a convenience, and f01 is
 * explicit that deleting one costs the next import of that format a trip
 * through the mapper. The panel says exactly that instead of refusing.
 *
 * See D-031 for why saving from the mapper still upserts on the signature even
 * though this screen exists, and why duplicate is allowed to break that.
 *
 * **The statement half of one Readers list** (M36 U10): `Readers` draws these
 * rows above the payslip and fund-report readers, under one count and one empty
 * state, where four tabs and buttons used to draw them apart.
 */
export function StatementReaders() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)

  const [editing, setEditing] = useState<string | undefined>()
  const [deleting, setDeleting] = useState<SavedMapping | undefined>()

  const data = useMemo(() => {
    if (db === undefined) return undefined
    const mappings = listMappings(db)
    return {
      mappings,
      // Archived ones included: a mapping may be bound to a card that has been
      // put away, and rendering that as "ask each time" would be a lie.
      accounts: listAccounts(db, { includeArchived: true }),
      // Two rows may claim one format — `duplicateMapping` makes exactly that.
      // Counted here so a row can say so rather than leaving the user to
      // discover it the next time a file is matched.
      perSignature: countBySignature(mappings),
    }
  }, [db, revision])

  if (data === undefined || data.mappings.length === 0) return null

  return (
    <>
      <ul>
        {data.mappings.map((mapping) => (
          <Row
            key={mapping.id}
            mapping={mapping}
            accounts={data.accounts}
            onBind={(accountId) =>
              mutate((database) => setMappingAccount(database, mapping.id, accountId, Date.now()))
            }
            sharedFormat={(data.perSignature.get(mapping.headerSignature) ?? 1) > 1}
            isEditing={editing === mapping.id}
            onEdit={() => setEditing(mapping.id)}
            onRename={(name) => {
              setEditing(undefined)
              if (name !== '' && name !== mapping.name) {
                mutate((database) => renameMapping(database, mapping.id, name, Date.now()))
              }
            }}
            onDuplicate={() => {
              let copyId: string | undefined
              mutate((database) => {
                copyId = duplicateMapping(database, mapping.id, Date.now())?.id
              })
              // Straight into the name field: a copy called "Cal (copy)" is a
              // placeholder, and the reason to make one is to call it
              // something else.
              setEditing(copyId)
            }}
            onDelete={() => setDeleting(mapping)}
          />
        ))}
      </ul>

      {deleting !== undefined && (
        <DeletePanel
          mapping={deleting}
          onCancel={() => setDeleting(undefined)}
          onDelete={() => {
            const id = deleting.id
            setDeleting(undefined)
            mutate((database) => deleteMapping(database, id, Date.now()))
          }}
        />
      )}
    </>
  )
}

function Row({
  mapping,
  accounts,
  onBind,
  sharedFormat,
  isEditing,
  onEdit,
  onRename,
  onDuplicate,
  onDelete,
}: {
  mapping: SavedMapping
  accounts: readonly Account[]
  onBind: (accountId: string | undefined) => void
  sharedFormat: boolean
  isEditing: boolean
  onEdit: () => void
  onRename: (name: string) => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  return (
    <li className="group border-b border-hairline px-6 py-3 transition-colors duration-[var(--duration-micro)] hover:bg-surface">
      <div className="flex items-center gap-x-3">
        {isEditing ? (
          <input
            autoFocus
            defaultValue={mapping.name}
            aria-label={`Rename ${mapping.name}`}
            onFocus={(event) => event.target.select()}
            onBlur={(event) => onRename(event.target.value.trim())}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') onRename(mapping.name)
            }}
            // A mapping may well be named in Hebrew, so the field follows what
            // is typed into it rather than the English layout around it.
            dir="auto"
            className={`${FIELD} h-7 w-72`}
          />
        ) : (
          <button type="button" onClick={onEdit} title="Rename" className="hover:underline">
            {/* "כאל ויזה 4321" is exactly the digits-inside-RTL shape that
                visibly scrambles unisolated. */}
            <Bidi className="font-medium">{mapping.name}</Bidi>
          </button>
        )}

        <Chip>statement</Chip>
        <AccountBinding mapping={mapping} accounts={accounts} onBind={onBind} />
        {/* The one thing on this screen worth acting on, so the one thing
            wearing a colour. */}
        {sharedFormat && <Chip problem>shares this format</Chip>}

        {/* Quiet until the row is hovered or something in it has focus, and
            kept in the DOM so keyboard focus still reaches them. */}
        <span className="ml-auto flex items-center gap-x-3 text-caption text-ink-secondary opacity-0 transition-opacity duration-[var(--duration-micro)] group-hover:opacity-100 focus-within:opacity-100">
          <button type="button" onClick={onDuplicate} className="hover:text-ink">
            Duplicate
          </button>
          <button type="button" onClick={onDelete} className="hover:text-negative">
            Delete
          </button>
        </span>
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-caption">
        <ColumnSummary mapping={mapping} />
        <span className="ml-auto whitespace-nowrap text-ink-tertiary tabular-nums">{usage(mapping)}</span>
      </div>
    </li>
  )
}

/**
 * Which account this format's files belong to — `ImportMapping.accountId`, which
 * nothing set until F12 and which this screen therefore rendered as "ask each
 * time" for every row.
 *
 * It is a fallback rather than an override: the card number a file states about
 * itself still decides, because that is a fact about the file and this is a fact
 * about the format (D-033). What it fixes is the hole that leaves — a statement
 * that names no card anywhere, which would otherwise be identified by the
 * mapping's *name*.
 *
 * A select rather than a chip that opens something, because the whole
 * interaction is picking one of a handful of accounts. Unbinding is in the list
 * as "ask each time", which is what unbound means.
 */
function AccountBinding({
  mapping,
  accounts,
  onBind,
}: {
  mapping: SavedMapping
  accounts: readonly Account[]
  onBind: (accountId: string | undefined) => void
}) {
  // Nothing to bind to yet. The chip states the behaviour rather than offering an
  // empty select — accounts come from onboarding or from the first import.
  if (accounts.length === 0) return <Chip>ask each time</Chip>

  return (
    <select
      value={mapping.accountId ?? ''}
      onChange={(event) => onBind(event.target.value === '' ? undefined : event.target.value)}
      aria-label={`Which account ${mapping.name} imports into`}
      className={`${SELECT} h-7 max-w-56 border-transparent bg-transparent text-caption text-ink-tertiary hover:border-hairline-strong`}
    >
      <option value="">ask each time</option>
      {accounts.map((account) => (
        <option key={account.id} value={account.id}>
          {account.name}
          {account.last4 === undefined ? '' : ` ·${account.last4}`}
        </option>
      ))}
    </select>
  )
}

/**
 * What this mapping reads, in the file's own words.
 *
 * The header cells come back out of the signature — it round-trips by design
 * (D-027) — so the summary is the header row the user saw in the mapper rather
 * than a list of column numbers. In sheet order, so it reads the way the file
 * does. A signature written by an older normalization no longer decodes, and
 * the column index is the honest thing to show in its place.
 *
 * A header that already says what its role is says it once. Hebrew files are
 * the interesting case and every pair there carries information; an English
 * one otherwise reads "date date · reference reference".
 */
function ColumnSummary({ mapping }: { mapping: SavedMapping }) {
  const cells = headerCellsFromSignature(mapping.headerSignature)
  const columns = [...mapping.mapping.columnRoles].sort(([a], [b]) => a - b)

  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      {columns.map(([column, role], index) => {
        const label = labelFor(ROLE_LABEL, role)
        const cell = cells?.[column]
        const header = cell === undefined || cell === '' || cell === label ? undefined : cell

        return (
          <span key={column} className="whitespace-nowrap">
            {index > 0 && <span className="mr-2 text-ink-tertiary/60">·</span>}
            {header !== undefined && (
              <>
                <Bidi className="text-ink-secondary">{header}</Bidi>{' '}
              </>
            )}
            {cells === undefined && (
              <span className="text-ink-secondary tabular-nums">column {column + 1} </span>
            )}
            <span className="text-ink-tertiary">{label}</span>
          </span>
        )
      })}
    </span>
  )
}

/**
 * Deleting a mapping is safe, and the panel's job is to say what it costs
 * rather than to warn. f01: the next import of the format falls back to
 * guessing, which is what the first one did.
 */
function DeletePanel({
  mapping,
  onCancel,
  onDelete,
}: {
  mapping: SavedMapping
  onCancel: () => void
  onDelete: () => void
}) {
  return (
    <div className="fc-pop-enter shrink-0 border-t border-hairline bg-surface px-6 py-4">
      <p>
        Forget <Bidi className="font-medium">{mapping.name}</Bidi>. The next file with these columns
        opens the mapper again — the app guesses the columns and you confirm them, exactly as you
        did the first time.
      </p>
      <p className="mt-1 text-ink-secondary">
        Nothing already imported changes: transactions keep their amounts, dates and categories.
        {mapping.useCount > 0 && ' The imports this reader did still say it was the one that did them.'}
      </p>

      <div className="mt-3 flex items-center gap-2">
        <Button variant="primary" size="sm" onClick={onDelete}>
          Delete reader
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

/** When it last did any work, and how much. Never used is worth saying out loud. */
function usage(mapping: SavedMapping): string {
  if (mapping.lastUsedAt === undefined) return 'never used'
  const times = mapping.useCount === 1 ? 'once' : `${mapping.useCount} times`
  return `used ${times} · last ${instantDay(mapping.lastUsedAt)}`
}

function countBySignature(mappings: readonly SavedMapping[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>()
  for (const mapping of mappings) {
    counts.set(mapping.headerSignature, (counts.get(mapping.headerSignature) ?? 0) + 1)
  }
  return counts
}
