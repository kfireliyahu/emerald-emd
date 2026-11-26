import { useState } from 'react'
import { Link } from 'react-router-dom'

import { installLedgerPack } from '@/data/packs/ledger/pack.ts'
import { countKey } from '@/i18n/count.ts'
import { currentLanguage, useT } from '@/i18n/current.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'

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
 *
 * **The report** (M64 U12, D-624): the answer first — that this document keeps
 * no ledger, and what keeping it does — in the catalogue's words, set where
 * every screen sets its title rather than centred in the window, with the one
 * primary beside the title.
 */
export function NoLedger({
  waiting,
}: {
  /** Files dropped on this document, held until it keeps a ledger or is told not to. */
  waiting?: { readonly files: readonly File[]; readonly read: () => void; readonly leave: () => void }
} = {}) {
  const t = useT()
  const mutate = useDocumentStore((state) => state.mutate)
  const [problem, setProblem] = useState<string | undefined>(undefined)

  const keep = (): void => {
    setProblem(undefined)
    try {
      mutate((db) => {
        const installed = installLedgerPack(db, Date.now(), currentLanguage())
        if (!installed.ok) throw new Error(installed.error)
      })
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
      return
    }
    waiting?.read()
  }

  // One name for the act, as Packs says it (M54 F13): Keep the ledger here.
  const keepButton = (
    <Button variant="primary" onClick={keep}>
      {t('chrome.noLedger.keep')}
    </Button>
  )
  const failed = problem !== undefined && (
    <p role="alert" className="m-0 text-negative">
      {problem}
    </p>
  )

  if (waiting !== undefined) {
    const first = waiting.files[0]?.name ?? ''
    return (
      <Page
        title={
          waiting.files.length === 1 ? (
            <Phrase text={t('chrome.noLedger.waitingOne')} parts={{ file: <Bidi>{first}</Bidi> }} />
          ) : (
            t('chrome.noLedger.waitingMany', { n: waiting.files.length })
          )
        }
        answer={t(countKey('chrome.noLedger.waitingAnswer', waiting.files.length), { count: waiting.files.length })}
      >
        <div className="flex items-center gap-3">
          {keepButton}
          <Button variant="ghost" onClick={waiting.leave}>
            {t('chrome.noLedger.notNow')}
          </Button>
        </div>
        {failed}
      </Page>
    )
  }

  return (
    <Page title={t('chrome.noLedger.title')} answer={t('chrome.noLedger.answer')}>
      <div className="flex items-center gap-3">
        {keepButton}
        <Link to="/formats" className="fc-text-action">
          {t('chrome.noLedger.formats')}
        </Link>
      </div>
      {failed}
    </Page>
  )
}

/** The page: its title, the answer in one sentence at the lede step, and what to do. */
function Page({ title, answer, children }: { readonly title: React.ReactNode; readonly answer: string; readonly children: React.ReactNode }) {
  return (
    <div className="h-full overflow-auto">
      <div className="fc-view-enter flex flex-col gap-6 px-8 pt-6 pb-12">
        <h1 className="m-0 text-title leading-tight font-medium">{title}</h1>
        <p className="m-0 max-w-[40ch] text-lede [text-wrap:balance]">{answer}</p>
        {children}
      </div>
    </div>
  )
}
