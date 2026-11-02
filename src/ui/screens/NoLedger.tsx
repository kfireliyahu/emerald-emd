import { useState } from 'react'
import { Link } from 'react-router-dom'

import { installLedgerPack } from '@/data/packs/ledger/pack.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'

/**
 * **What a ledger screen shows in a document that keeps no ledger** — M25 U2.
 *
 * The ledger is per document (D-266): its tables are in the file, and a
 * document that never kept one — a new one, `docs/memory.emd` — has none for
 * a ledger screen to read. Until U2 every document had the old tables whether
 * it wanted them or not, so the screens never had to ask; now they would throw.
 *
 * Adding it is a person's choice about *this* file, so it is a button here
 * rather than something the rail switch does to whatever is open.
 *
 * **And what a statement dropped on such a document is shown** (M31 U2): the
 * same offer, naming the files that are waiting, and keeping the ledger reads
 * them — rather than the drop doing nothing at all.
 */
export function NoLedger({
  waiting,
}: {
  /** Files dropped on this document, held until it keeps a ledger or is told not to. */
  waiting?: { readonly files: readonly File[]; readonly read: () => void; readonly leave: () => void }
} = {}) {
  const mutate = useDocumentStore((state) => state.mutate)
  const [problem, setProblem] = useState<string | undefined>(undefined)

  const keep = (): void => {
    setProblem(undefined)
    try {
      mutate((db) => {
        const installed = installLedgerPack(db, Date.now())
        if (!installed.ok) throw new Error(installed.error)
      })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
      return
    }
    waiting?.read()
  }

  // One name for the act, as Packs says it (M54 F13): Keep the ledger here.
  if (waiting !== undefined) {
    const first = waiting.files[0]?.name ?? ''
    return (
      <div className="fc-view-enter mx-auto flex h-full max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
        <h1 className="m-0 text-title">
          {waiting.files.length === 1 ? (
            <>
              No format here to read <Bidi>{first}</Bidi> onto
            </>
          ) : (
            `No format here to read these ${String(waiting.files.length)} files onto`
          )}
        </h1>
        <p className="m-0 text-ink-secondary">
          The ledger reads card and bank statements, paychecks and fund reports into accounts, months and
          categories, kept as tables in this document. Keep it here and{' '}
          {waiting.files.length === 1 ? 'the file is' : 'the files are'} read into it.
        </p>
        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={keep}>
            Keep the ledger here
          </Button>
          <Button variant="ghost" onClick={waiting.leave}>
            Not now
          </Button>
        </div>
        {problem !== undefined && (
          <p role="alert" className="m-0 text-negative">
            {problem}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="fc-view-enter mx-auto flex h-full max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      <h1 className="m-0 text-title">This document keeps no ledger</h1>
      <p className="m-0 text-ink-secondary">
        The ledger is a pack: its accounts, categories and rules are tables in the document that
        keeps it. Keep it in this one, or go back to its formats.
      </p>
      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={keep}>
          Keep the ledger here
        </Button>
        <Link to="/formats" className="text-ink-secondary hover:text-ink">
          Formats
        </Link>
      </div>
      {problem !== undefined && (
        <p role="alert" className="m-0 text-negative">
          {problem}
        </p>
      )}
    </div>
  )
}
