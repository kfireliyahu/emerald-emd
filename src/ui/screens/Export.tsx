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
import { SettingRow, SettingsPage } from '@/ui/settings/SettingsPage.tsx'
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
 *
 * **The report** (M64 U12, D-624): the answer first — what can go out, and
 * how many rows of it — then one row a file, its button at the row's end.
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

  const answer = ledger
    ? t('settings.export.answer', {
        months: t(months.length === 1 ? 'settings.export.monthCount' : 'settings.export.monthsCount', { n: months.length }),
        rows: t(rows === 1 ? 'settings.export.rowCount' : 'settings.export.rowsCount', { n: rows.toLocaleString('en-US') }),
      })
    : t('settings.export.answerWhole')

  return (
    <SettingsPage title={t('rail.export')} answer={answer}>
          {ledger && (
            <>
              <SettingRow
                label={t('settings.export.months')}
                hint={t('settings.export.monthsText')}
              >
                <Button
                  variant="secondary"
                  disabled={months.length === 0}
                  onClick={() => downloadCsv(exportFileName('months'), monthlySummaryCsv(months))}
                >
                  {t(months.length === 1 ? 'settings.export.exportMonth' : 'settings.export.exportMonths', { n: months.length })}
                </Button>
              </SettingRow>
              <SettingRow
                label={t('rail.transactions')}
                hint={t('settings.export.transactionsText')}
              >
                <Button
                  variant="secondary"
                  disabled={rows === 0}
                  onClick={() => downloadCsv(exportFileName('transactions'), transactionsCsv(db))}
                >
                  {t(rows === 1 ? 'settings.export.exportTransaction' : 'settings.export.exportTransactions', { n: rows.toLocaleString('en-US') })}
                </Button>
              </SettingRow>
            </>
          )}
          {exportsBridge !== undefined && <SavedExports bridge={exportsBridge} />}
          <SettingRow
            label={t('settings.export.whole')}
            hint={
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
          </SettingRow>
    </SettingsPage>
  )
}
