import { useMemo } from 'react'
import { Link } from 'react-router-dom'

import { listMappings } from '@/data/repositories/importMappingRepository.ts'
import { listTemplates } from '@/data/repositories/documentTemplateRepository.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Button } from '@/ui/components/Button.tsx'
import { useFilePicker, useReadFiles } from '@/ui/home/parts.tsx'
import { DocumentReaders } from '@/ui/screens/Formats.tsx'
import { StatementReaders } from '@/ui/screens/Mappings.tsx'

/**
 * **Readers** — `#/read/readers`, M36 U10: every reader the document keeps, in
 * one list beside Read files, which reads every kind of file they read.
 *
 * It was four places: a tab of Transactions for a statement's, a tab of
 * Paychecks for a payslip's, a menu entry of Funds for a fund report's, and the
 * three were the same operations on three kinds of the same thing. A declared
 * format's readers stay on that format's own Read files (`#/formats/<name>/read`)
 * — those are the engine's, in every document, and this screen is the ledger's.
 */
export function Readers() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const picker = useFilePicker(useReadFiles())

  const count = useMemo(
    () => (db === undefined ? undefined : listMappings(db).length + listTemplates(db).length),
    [db, revision],
  )

  if (count === undefined) {
    return <Centered>Open a document, or create one, to see the readers saved in it.</Centered>
  }

  if (count === 0) {
    return (
      <Centered>
        <span className="flex flex-col items-center gap-4">
          <span>
            No readers yet. A reader is kept the first time a statement, paycheck or fund report of a new kind is
            read, and every later file like it is read with it.
          </span>
          <Button variant="primary" icon="add" onClick={picker.open}>
            Read a file
          </Button>
          {picker.input}
        </span>
      </Centered>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-hairline px-6 py-2">
        <span className="text-ink-secondary tabular-nums">{count === 1 ? '1 reader' : `${String(count)} readers`}</span>
        <span className="text-caption text-ink-tertiary">
          A reader is how one kind of file is read. To change what one reads, read a file of that kind again
          under{' '}
          <Link to="/read" className="text-accent hover:underline">
            Read files
          </Link>
          .
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <StatementReaders />
        <DocumentReaders />
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-md">{children}</p>
    </div>
  )
}
