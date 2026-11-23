import { useMemo } from 'react'

import { monthlySummaryCsv, transactionsCsv } from '@/data/export/csv.ts'
import { downloadCsv, exportFileName } from '@/data/export/download.ts'
import { documentCurrency, monthlySummaries } from '@/data/repositories/statisticsRepository.ts'
import { countTransactions } from '@/data/repositories/transactionRepository.ts'
import { shellExports } from '@/data/storage/desktop.ts'
import { useT } from '@/i18n/current.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Button } from '@/ui/components/Button.tsx'
import { SavedExports } from '@/ui/export/SavedExports.tsx'
import { Kbd } from '@/ui/components/Kbd.tsx'
import { isDemo } from '@/ui/edition.ts'
import { useKeepsLedger } from '@/ui/packs.ts'
import { modifierKey } from '@/ui/platform.ts'
import { today } from '@/ui/today.ts'

/**
 * **Settings › Export** — M28 U5. A spreadsheet of what this document holds.
 *
 * The months' CSV was a button above the month on Home; it was asked for
 * here, and a setting is where a person looks for *get my data out*. The
 * transactions' export is here too, of every row — Transactions keeps its own,
 * of whatever it is showing. Both are the same functions they always were.
 *
 * **The whole document is Save as…** (M54 F6, D-531): a button that does it,
 * with the keys that do it too — never a File menu a browser tab has not got.
 * One heading, as Packs has, and no eyebrow over it.
 *
 * **The app's, not only the ledger's, since M63 U4** (D-605): the months' and
 * the transactions' rows are there where the document keeps a ledger, and in
 * the desktop shell a document's **saved exports** — the exports pack's rows —
 * are written from here (`ui/export/SavedExports.tsx`). The rail offers the
 * place to a document keeping either pack.
 */
export function Export() {
  const t = useT()
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const ledger = useKeepsLedger()
  const months = useMemo(
    () => (db === undefined || !ledger ? [] : monthlySummaries(db, today(), { currency: documentCurrency(db) })),
    [db, revision, ledger],
  )
  const rows = useMemo(() => (db === undefined || !ledger ? 0 : countTransactions(db)), [db, revision, ledger])
  // The shell's, and only the shell's: a browser tab has no folder to write a file into.
  const exportsBridge = shellExports()
  const saveCopyAs = useDocumentStore((state) => state.saveCopyAs)
  if (db === undefined) return null
  const mod = modifierKey()
  const keys = !isDemo()

  return (
    <div className="h-full overflow-auto">
      <div className="fc-view-enter flex max-w-4xl flex-col gap-6 px-8 pt-6 pb-12">
        <header className="flex flex-col gap-2 border-b border-hairline pb-4">
          <h1 className="m-0 text-title">{t('rail.export')}</h1>
          <span className="text-ink-secondary">{t('settings.export.lead')}</span>
        </header>
        <div>
          {ledger && (
            <>
              <Row
                title={t('settings.export.months')}
                text={t('settings.export.monthsText')}
              >
                <Button
                  variant="secondary"
                  disabled={months.length === 0}
                  onClick={() => downloadCsv(exportFileName('months'), monthlySummaryCsv(months))}
                >
                  {t(months.length === 1 ? 'settings.export.exportMonth' : 'settings.export.exportMonths', { n: months.length })}
                </Button>
              </Row>
              <Row
                title={t('rail.transactions')}
                text={t('settings.export.transactionsText')}
              >
                <Button
                  variant="secondary"
                  disabled={rows === 0}
                  onClick={() => downloadCsv(exportFileName('transactions'), transactionsCsv(db))}
                >
                  {t(rows === 1 ? 'settings.export.exportTransaction' : 'settings.export.exportTransactions', { n: rows.toLocaleString('en-US') })}
                </Button>
              </Row>
            </>
          )}
          {exportsBridge !== undefined && <SavedExports bridge={exportsBridge} />}
          <Row
            title={t('settings.export.whole')}
            text={
              <>
                {t('settings.export.wholeText')}
                {/* The keys only where they are listened for: the demo has no file to save (D-413). */}
                {keys && (
                  <>
                    {' '}
                    <span className="whitespace-nowrap">
                      {mod === '⌘' ? (
                        <>
                          <Kbd>⌘</Kbd>
                          <Kbd>⇧</Kbd>
                          <Kbd>S</Kbd>
                        </>
                      ) : (
                        <>
                          <Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>S</Kbd>
                        </>
                      )}
                    </span>
                  </>
                )}
              </>
            }
          >
            <Button
              variant="secondary"
              {...(keys ? { 'aria-keyshortcuts': mod === '⌘' ? 'Meta+Shift+S' : 'Control+Shift+S' } : {})}
              onClick={() => void saveCopyAs()}
            >
              {t('settings.export.saveAs')}
            </Button>
          </Row>
        </div>
      </div>
    </div>
  )
}

function Row({ title, text, children }: { title: string; text: React.ReactNode; children: React.ReactNode }) {
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
