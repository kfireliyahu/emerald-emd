import { useEffect, useRef, useState } from 'react'

import { ORPHANED_COPIES_DAYS, type AboutFacts } from '../../electron/bridge.ts'
import { shellApp, shellBridge, shellUpdates } from '@/data/storage/desktop.ts'
import { formatBytes } from '@/domain/provider.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Working } from '@/ui/components/Working.tsx'
import { openDialog, useModalDialog } from '@/ui/useModalDialog.ts'
import { answer, useUpdateState } from '@/ui/useUpdates.ts'

/**
 * **Help › About Emerald** (M45 F3, D-457) — the page's, no longer the native
 * panel, because it shows one thing the panel cannot hold: Emerald's own folder
 * of earlier copies, where it is and how large, with a button that opens it.
 * A person who asked whether those copies pile up on their computer can see
 * the answer here, and the folder is not hidden from them.
 *
 * What the panel said — the version, the licence, that Emerald computes rather
 * than advises, where the source is — comes from `electron/about.ts` through the
 * bridge, so the two never say different things.
 *
 * **It holds the one setting the app has** (M42 U8, D-502): updates, off by
 * default, beside the version they are about, with Check now — and the rule
 * they change, said where the person switches it.
 *
 * **The shell only.** The static site has no folder of copies and no Help menu;
 * nothing reaches this there, and the palette offers it only when the bridge
 * has the call.
 *
 * **A modal that holds focus** (M54 F6): Tab stays inside, and closing it
 * gives focus back; opening it closes Earlier copies, so one dialog is open at
 * a time (`useModalDialog`). The license and the notices are buttons here,
 * since Help sits behind Alt on Windows (D-458).
 */

/** Help › About and the palette. */
export function openAbout(): void {
  openDialog.set('about')
}

/** Whether this window has an About of its own — the shell, new enough to answer one. */
export function canShowAbout(): boolean {
  return shellApp() !== undefined
}

type Facts =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'facts'; readonly facts: AboutFacts }

export function About() {
  const isOpen = openDialog.use() === 'about'
  return isOpen ? <AboutDialog /> : null
}

function AboutDialog() {
  const [facts, setFacts] = useState<Facts>({ kind: 'loading' })
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const panel = useRef<HTMLDivElement>(null)
  const close = (): void => openDialog.set(undefined)
  const onKeyDown = useModalDialog(panel, close)

  useEffect(() => {
    const app = shellApp()
    if (app === undefined) {
      setFacts({ kind: 'failed', reason: 'This window has no About of its own.' })
      return
    }
    app.about().then(
      (answer) => setFacts({ kind: 'facts', facts: answer }),
      (error: unknown) => setFacts({ kind: 'failed', reason: error instanceof Error ? error.message : String(error) }),
    )
  }, [])

  const openFolder = async (): Promise<void> => {
    setFailure(undefined)
    try {
      await shellApp()?.openBackupsFolder()
    } catch {
      // The shell's reason is in its words; the way forward is the path above.
      setFailure('The folder could not be opened from here. Its path is above, to open from your file manager.')
    }
  }
  const openText = shellApp()?.openText

  // The uninstaller is Windows' (electron-builder's NSIS); a Mac has none to take the folder.
  const uninstaller = shellBridge()?.platform === 'win32'

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 px-6 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="About Emerald"
        tabIndex={-1}
        className="fc-pop-enter flex max-h-[76vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-hairline-strong bg-elevated shadow-pop outline-none"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2.5 border-b border-hairline py-2 pe-2 ps-3.5">
          <span className="fc-label flex-1">About Emerald</span>
          <button type="button" aria-label="Close" title="Close (Esc)" onClick={close} className="fc-icon-action">
            <ActionGlyph name="close" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pt-3 pb-3.5">
          {facts.kind === 'loading' && (
            <div className="py-3">
              <Working size={20} label="Reading what to say" />
            </div>
          )}
          {facts.kind === 'failed' && (
            <p className="m-0 py-3 text-negative" role="alert">
              Could not read it: {facts.reason}
            </p>
          )}
          {facts.kind === 'facts' && (
            <>
              <p className="m-0 font-medium text-ink">
                {facts.facts.applicationName}{' '}
                <span className="font-mono font-normal text-ink-secondary tabular-nums">{facts.facts.version}</span>
              </p>
              <p className="m-0 pt-0.5 text-ink-secondary">{facts.facts.copyright}</p>
              <div className="pt-3 text-ink-secondary">
                {facts.facts.credits.split('\n').map((line, index) =>
                  line === '' ? <div key={index} className="h-2" /> : <p key={index} className="m-0">{line}</p>,
                )}
              </div>
              {openText !== undefined && (
                <div className="flex flex-wrap gap-2 pt-3">
                  <Button size="sm" onClick={() => void openText('license')}>
                    License
                  </Button>
                  <Button size="sm" onClick={() => void openText('notices')}>
                    Third-party notices
                  </Button>
                </div>
              )}

              <UpdatesSection />

              <section aria-label="Earlier copies" className="mt-4 border-t border-hairline pt-3">
                <p className="fc-label m-0">Earlier copies</p>
                <p className="m-0 pt-1.5 text-ink-secondary">
                  A copy is taken before an assistant writes to a document, and the last five of each are kept here.
                  When a document is moved or deleted, its copies go once the newest is more than{' '}
                  {ORPHANED_COPIES_DAYS} days old{uninstaller ? '; uninstalling Emerald removes the folder.' : '.'}
                </p>
                <p className="m-0 pt-2 font-mono text-caption break-all text-ink" data-testid="backups-path">
                  <Bidi>{facts.facts.backups.path}</Bidi>
                </p>
                <div className="flex items-center gap-3 pt-2">
                  <span className="flex-1 text-ink-secondary" data-testid="backups-size">
                    {facts.facts.backups.documents === 0
                      ? 'Empty.'
                      : `${formatBytes(facts.facts.backups.bytes)}, for ${String(facts.facts.backups.documents)} ` +
                        (facts.facts.backups.documents === 1 ? 'document.' : 'documents.')}
                  </span>
                  <Button size="sm" onClick={() => void openFolder()}>
                    Open folder
                  </Button>
                </div>
                {failure !== undefined && (
                  <p className="m-0 pt-2 text-negative" role="alert">
                    {failure}
                  </p>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * **Updates, if you turn them on** (M42 U8, D-502). The words say exactly what the switch does on
 * this platform: on Windows it downloads too, and installs on Install and restart (M42 U9, D-503);
 * on macOS it only says so, until the installers are signed.
 */
function UpdatesSection() {
  const state = useUpdateState()
  const updates = shellUpdates()
  if (state === undefined || updates === undefined) return null
  const checking = state.notice?.kind === 'checking'

  return (
    <section aria-label="Updates" className="mt-4 border-t border-hairline pt-3">
      <p className="fc-label m-0">Updates</p>
      {state.downloads ? (
        <p className="m-0 pt-1.5 text-ink-secondary">
          Emerald reaches the internet for one thing only, and only if you ask: GitHub’s answer for its newest version,
          which sees your IP address and this version number. With the box ticked, a newer version also downloads in the
          background from that release on GitHub, is checked against the checksum published with it, and installs only
          when you press Install and restart. Your documents are never touched. Check now with the box clear only tells
          you.
        </p>
      ) : (
        <p className="m-0 pt-1.5 text-ink-secondary">
          Emerald reaches the internet for one thing only, and only if you ask: GitHub’s answer for its newest version,
          which sees your IP address and this version number. Nothing is downloaded or installed — a newer version is a
          note at the top of the window, and Download opens its page in your browser.
        </p>
      )}
      <div className="flex items-center gap-3 pt-2">
        <label className="flex flex-1 items-center gap-2 text-ink select-none">
          <input
            type="checkbox"
            checked={state.automatic}
            onChange={(event) => void answer(updates.setAutomatic(event.target.checked))}
          />
          {state.downloads ? 'Check at start and once a day, and download' : 'Check at start and once a day'}
        </label>
        <Button size="sm" onClick={() => void answer(updates.checkNow())} disabled={checking}>
          {checking ? 'Checking…' : 'Check now'}
        </Button>
      </div>
    </section>
  )
}
