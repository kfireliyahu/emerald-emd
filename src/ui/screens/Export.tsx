import { useMemo } from 'react'

import { monthlySummaryCsv, transactionsCsv } from '@/data/export/csv.ts'
import { downloadCsv, exportFileName } from '@/data/export/download.ts'
import { documentCurrency, monthlySummaries } from '@/data/repositories/statisticsRepository.ts'
import { countTransactions } from '@/data/repositories/transactionRepository.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Button } from '@/ui/components/Button.tsx'
import { Kbd } from '@/ui/components/Kbd.tsx'
import { today } from '@/ui/today.ts'

/**
 * **Settings › Export** — M28 U5. A spreadsheet of what this document holds.
 *
 * The months' CSV was a button above the month on Home; it was asked for
 * here, and a setting is where a person looks for *get my data out*. The
 * transactions' export is here too, of every row — Transactions keeps its own,
 * of whatever it is showing. Both are the same functions they always were.
 */
export function Export() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const months = useMemo(
    () => (db === undefined ? [] : monthlySummaries(db, today(), { currency: documentCurrency(db) })),
    [db, revision],
  )
  const rows = useMemo(() => (db === undefined ? 0 : countTransactions(db)), [db, revision])
  if (db === undefined) return null

  return (
    <div className="h-full overflow-auto">
      <div className="fc-view-enter flex max-w-4xl flex-col gap-6 px-8 pt-6 pb-12">
        <header className="flex flex-col gap-1.5 border-b border-hairline pb-4">
          <span className="fc-label text-ink-secondary uppercase">Settings · Export</span>
          <h1 className="m-0 text-[24px] leading-tight font-medium tracking-[-0.01em]">Export</h1>
          <span className="text-ink-secondary">A spreadsheet of what this document holds.</span>
        </header>
        <div>
          <Row
            title="Months"
            text="One row a month: came in, went out, left over and saved, and how many rows each came from."
          >
            <Button
              variant="secondary"
              disabled={months.length === 0}
              onClick={() => downloadCsv(exportFileName('months'), monthlySummaryCsv(months))}
            >
              Export {months.length} {months.length === 1 ? 'month' : 'months'}
            </Button>
          </Row>
          <Row
            title="Transactions"
            text="Every transaction in every account, with its category. Transactions keeps its own export too, of whatever it is showing."
          >
            <Button
              variant="secondary"
              disabled={rows === 0}
              onClick={() => downloadCsv(exportFileName('transactions'), transactionsCsv(db))}
            >
              Export {rows.toLocaleString('en-US')} {rows === 1 ? 'transaction' : 'transactions'}
            </Button>
          </Row>
          <Row
            title="The whole document"
            text="Not a spreadsheet: File › Save a copy keeps everything, and it opens anywhere Emerald does."
          >
            <span className="font-mono text-caption text-ink-tertiary">
              <Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>S</Kbd>
            </span>
          </Row>
        </div>
      </div>
    </div>
  )
}

function Row({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-hairline py-4">
      <div>
        <b className="font-medium">{title}</b>
        <p className="m-0 mt-0.5 max-w-[60ch] text-ink-secondary">{text}</p>
      </div>
      {children}
    </div>
  )
}
