import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

import type { EmeraldExports, ExportFileState } from '../../../electron/bridge.ts'
import { toISODate } from '@/core/time.ts'
import { savedExportTexts, type SavedExportText } from '@/data/export/formatExport.ts'
import { EXPORT_FORMAT } from '@/data/packs/exports/pack.ts'
import { readFormat } from '@/data/repositories/formatRepository.ts'
import { countKey } from '@/i18n/count.ts'
import { useT } from '@/i18n/current.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { formatPath } from '@/ui/nav.ts'
import { useKeptPacks } from '@/ui/packs.ts'
import { today } from '@/ui/today.ts'

import { exportFiles, owedFiles, savedLines, type SavedLine } from './savedLines.ts'

/**
 * **A document's saved exports, from Settings › Export** (M63 U4, D-605): the
 * rows of the exports pack's `export` format, each worked out in the page by the
 * code the command line runs (`data/export/formatExport.ts`) and compared with
 * what is on disk by the shell, which answers with a word per file. One button
 * writes every stale or missing one.
 *
 * Only in the desktop shell (`Export.tsx` draws it only when the bridge has
 * `exports`): a browser tab has no folder to write into. Every file is held to
 * the open document's folder in the main process (`electron/exportFiles.ts`),
 * never only here. A document with changes not saved yet is exported from what
 * is open, and the section says so; one never saved has no folder yet.
 */
export function SavedExports({ bridge }: { readonly bridge: EmeraldExports }) {
  const t = useT()
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const isDirty = useDocumentStore((state) => state.isDirty)
  // Read on every draw: a save or Save as moves it, and both draw again.
  const path = useDocumentStore((state) => state.adapter.location?.())
  const kept = useKeptPacks().has('exports')

  const saved = useMemo((): readonly SavedExportText[] => {
    if (db === undefined) return []
    const worked = savedExportTexts(db, { on: toISODate(today()) })
    return worked.ok ? worked.value : []
  }, [db, revision])
  const files = useMemo(() => exportFiles(saved), [saved])
  const formatTitle = useMemo(() => (db === undefined ? undefined : readFormat(db, EXPORT_FORMAT)?.title), [db, revision])

  const [states, setStates] = useState<ReadonlyMap<string, ExportFileState>>(new Map())
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<ReactNode>(undefined)

  // Asked again whenever what the export would write changes, or where it goes.
  useEffect(() => {
    setStates(new Map())
    if (path === undefined || files.length === 0) return
    let current = true
    bridge
      .check(path, files)
      .then((outcomes) => {
        if (current) setStates(new Map(outcomes.map((each) => [each.file, each.state])))
      })
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [bridge, path, files])

  if (db === undefined) return null
  const owed = owedFiles(files, states)

  async function write(): Promise<void> {
    if (path === undefined || owed.length === 0) return
    setBusy(true)
    setAnswer(undefined)
    try {
      const outcomes = await bridge.write(path, owed)
      setStates((before) => new Map([...before, ...outcomes.map((each) => [each.file, each.state] as const)]))
      const wrote = outcomes.filter((each) => each.state === 'written').map((each) => each.file)
      setAnswer(
        wrote.length === 0 ? (
          t('settings.export.saved.allCurrent')
        ) : (
          <Phrase
            text={t(countKey('settings.export.saved.wrote', wrote.length), { n: wrote.length })}
            parts={{
              files: wrote.map((file, index) => (
                <span key={file}>
                  {index > 0 && ', '}
                  <Bidi>{file}</Bidi>
                </span>
              )),
            }}
          />
        ),
      )
    } catch (error) {
      setAnswer(t('settings.export.saved.failed', { why: error instanceof Error ? error.message : String(error) }))
    } finally {
      setBusy(false)
    }
  }

  const empty = saved.length === 0
  const lead = empty ? (
    kept ? (
      <Phrase
        text={t('settings.export.saved.none')}
        parts={{
          format: (
            <Link to={formatPath(EXPORT_FORMAT)} className="text-accent">
              <Bidi>{formatTitle ?? EXPORT_FORMAT}</Bidi>
            </Link>
          ),
        }}
      />
    ) : (
      <Phrase
        text={t('settings.export.saved.notKept')}
        parts={{
          pack: (
            <Link to="/settings/packs" className="text-accent">
              {t('settings.packs.titles.exports')}
            </Link>
          ),
        }}
      />
    )
  ) : (
    t('settings.export.saved.text')
  )

  return (
    <section aria-labelledby="saved-exports" className="border-b border-hairline py-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div>
          <h2 id="saved-exports" className="m-0 text-body font-medium">
            {t('settings.export.saved.title')}
          </h2>
          <p className="m-0 mt-0.5 max-w-[60ch] text-ink-secondary">{lead}</p>
          {!empty && path === undefined && <p className="m-0 mt-1 max-w-[60ch] text-ink-secondary">{t('settings.export.saved.untitled')}</p>}
          {!empty && path !== undefined && isDirty && <p className="m-0 mt-1 max-w-[60ch] text-ink-secondary">{t('settings.export.saved.unsaved')}</p>}
        </div>
        {!empty && (
          <Button
            variant="secondary"
            icon="write"
            disabled={path === undefined || owed.length === 0 || busy}
            busy={busy ? t('settings.export.saved.writing') : undefined}
            onClick={() => void write()}
          >
            {owed.length === 0 ? t('settings.export.saved.writeNothing') : t(countKey('settings.export.saved.write', owed.length), { n: owed.length })}
          </Button>
        )}
      </div>
      {!empty && (
        <ul className="m-0 mt-3 list-none p-0" aria-label={t('settings.export.saved.title')}>
          {savedLines(saved, states).map((line) => (
            <SavedFile key={line.file} line={line} />
          ))}
        </ul>
      )}
      {answer !== undefined && (
        <p className="m-0 mt-3 text-ink-secondary" role="status">
          {answer}
        </p>
      )}
    </section>
  )
}

/** One saved export: its file, what it holds, and whether the file on disk holds it. */
function SavedFile({ line }: { readonly line: SavedLine }) {
  const t = useT()
  const refusal = line.refusal === undefined ? undefined : line.refusal === 'outside' ? t('settings.export.saved.outside') : line.refusal.said
  return (
    <li className="grid min-h-10 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-hairline py-2">
      <div className="min-w-0">
        <Bidi className="font-mono">{line.file}</Bidi>
        {line.holds !== undefined && (
          <span className="ms-3 text-ink-secondary">
            <Phrase
              text={t(countKey('settings.export.saved.rows', line.holds.rows), { n: line.holds.rows })}
              parts={{ format: <Bidi>{line.holds.format}</Bidi> }}
            />
          </span>
        )}
        {refusal !== undefined && (
          <p className="m-0 mt-0.5 max-w-[60ch] text-ink-secondary">
            <Bidi>{refusal}</Bidi>
          </p>
        )}
      </div>
      {line.word !== undefined && (
        <span className={refusal === undefined ? 'fc-state' : 'fc-state !text-negative'} {...(line.tone === undefined ? {} : { 'data-tone': line.tone })}>
          {t(line.word)}
        </span>
      )}
    </li>
  )
}
