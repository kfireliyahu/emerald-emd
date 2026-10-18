import { useCallback, useEffect, useRef, useState } from 'react'

import type { EarlierCopy } from '../../electron/bridge.ts'
import { instantDay } from '@/core/instant.ts'
import { shellDocuments } from '@/data/storage/desktop.ts'
import { formatBytes } from '@/domain/provider.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { createStore } from '@/state/store.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { Button } from '@/ui/components/Button.tsx'

/**
 * **File › Earlier copies of this document** (M45 U4, D-455).
 *
 * The copies an assistant's write takes first live in Emerald's own folder, not
 * beside the document — and D-098's reason for putting them beside it, *a backup
 * the user cannot find is not a backup*, is answered here instead: the shell
 * lists them, newest first, with when and how large, and Restore puts one back.
 *
 * **The shell only.** The static site has no folder of copies to list, so
 * nothing reaches this there: the File menu is the shell's, and the palette
 * offers it only when the bridge has the call.
 *
 * **Named copies are listed among them** (M48 U4, D-470): the copy kept before
 * a large write, a first write or *Back up now* sits in the same folder, so the
 * list marks it with what it came before and Restore puts it back alike.
 *
 * **Restore is a person's, on this screen** (D-455): a copy of the file as it is
 * now is taken first, into the same folder, then the earlier one replaces it and
 * the document is read again. Not while this window has unsaved work, which the
 * file does not hold and the reopen would throw away.
 */

const open = createStore(false)

/** The File menu and the palette: show the list for the open document. */
export function openEarlierCopies(): void {
  open.set(true)
}

/** Whether this window can list earlier copies at all — the shell, with a document open from a file. */
export function canListEarlierCopies(): boolean {
  return shellDocuments()?.earlierCopies !== undefined && openPath() !== undefined
}

function openPath(): string | undefined {
  const { adapter, db } = useDocumentStore.getState()
  return db === undefined || adapter.id !== 'desktop' ? undefined : adapter.location?.()
}

/** `2026-10-09 14:05`: the day as every date on screen is (D-023), and the minute, here. */
function moment(at: number): string {
  const date = new Date(at)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${instantDay(at)} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

type Listing =
  | { readonly kind: 'loading' }
  | { readonly kind: 'nothing-open' }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'copies'; readonly copies: readonly EarlierCopy[] }

export function EarlierCopies() {
  const isOpen = open.use()
  return isOpen ? <EarlierCopiesDialog /> : null
}

function EarlierCopiesDialog() {
  const documentName = useDocumentStore((state) => state.documentName)
  const isDirty = useDocumentStore((state) => state.isDirty)
  const [listing, setListing] = useState<Listing>({ kind: 'loading' })
  const [restoring, setRestoring] = useState<string | undefined>(undefined)
  const [restored, setRestored] = useState<{ readonly from: number } | undefined>(undefined)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const panel = useRef<HTMLDivElement>(null)

  const load = useCallback(async (): Promise<void> => {
    const shell = shellDocuments()
    const path = openPath()
    if (shell === undefined || path === undefined) {
      setListing({ kind: 'nothing-open' })
      return
    }
    try {
      setListing({ kind: 'copies', copies: await shell.earlierCopies(path) })
    } catch (error) {
      setListing({ kind: 'failed', reason: error instanceof Error ? error.message : String(error) })
    }
  }, [])

  useEffect(() => {
    void load()
    panel.current?.focus()
  }, [load])

  const close = (): void => open.set(false)

  const restore = async (copy: EarlierCopy): Promise<void> => {
    const shell = shellDocuments()
    const path = openPath()
    if (shell === undefined || path === undefined) return
    setRestoring(copy.name)
    setFailure(undefined)
    try {
      await shell.restoreEarlierCopy(path, copy.name)
      // The file changed under the store by our own hand: read it again, which
      // also takes the new mark, so no conflict bar asks about it.
      await useDocumentStore.getState().reloadFromDisk()
      setRestored({ from: copy.at })
      await load()
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      setRestoring(undefined)
    }
  }

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
        aria-label="Earlier copies of this document"
        tabIndex={-1}
        className="fc-pop-enter flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-hairline-strong bg-elevated shadow-pop outline-none"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            close()
          }
        }}
      >
        <div className="flex items-center gap-2.5 border-b border-hairline py-2 pr-2 pl-3.5">
          <span className="fc-label flex-1">
            Earlier copies of <Bidi>{documentName}</Bidi>
          </span>
          <button
            type="button"
            aria-label="Close"
            title="Close (Esc)"
            onClick={close}
            className="inline-flex size-7 items-center justify-center border border-transparent text-ink-tertiary transition-colors duration-[var(--duration-micro)] hover:border-hairline-strong hover:text-ink"
          >
            <ActionGlyph name="close" />
          </button>
        </div>

        <p className="m-0 px-3.5 pt-3 text-[13px] text-ink-secondary">
          A copy is taken before an assistant writes to this document, and the last five are kept in Emerald’s own folder.
          Named copies, kept before a large write or when asked, are kept apart, the last three. Restoring one keeps a
          copy of the document as it is now first, so it can be undone from here.
        </p>
        {isDirty && (
          <p className="m-0 px-3.5 pt-2 text-[13px] text-ink">
            Save first — restoring replaces the file and opens it again, and the changes in this window are not in it yet.
          </p>
        )}
        {restored !== undefined && (
          <p className="m-0 px-3.5 pt-2 text-[13px] text-ink" role="status">
            Restored the copy from {moment(restored.from)}. The document as it was just before is the newest copy below.
          </p>
        )}
        {failure !== undefined && (
          <p className="m-0 px-3.5 pt-2 text-[13px] text-negative" role="alert">
            Could not restore it: {failure}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-3.5 pt-2 pb-3">
          {listing.kind === 'loading' && <p className="m-0 py-3 text-ink-tertiary">Looking…</p>}
          {listing.kind === 'nothing-open' && (
            <p className="m-0 py-3 text-ink-tertiary">Open a document from a file to see its earlier copies.</p>
          )}
          {listing.kind === 'failed' && (
            <p className="m-0 py-3 text-negative" role="alert">
              Could not list them: {listing.reason}
            </p>
          )}
          {listing.kind === 'copies' && listing.copies.length === 0 && (
            <p className="m-0 py-3 text-ink-tertiary">None yet. One is taken the first time an assistant writes to it.</p>
          )}
          {listing.kind === 'copies' && listing.copies.length > 0 && (
            <ul className="m-0 flex list-none flex-col p-0">
              {listing.copies.map((copy) => (
                <li key={copy.name} className="flex items-center gap-3 border-b border-hairline py-2 last:border-b-0">
                  <span className="flex min-w-0 flex-1 items-baseline gap-2">
                    <span className="font-mono text-[13px] tabular-nums">{moment(copy.at)}</span>
                    {copy.before !== undefined && (
                      <span className="truncate text-[12px] text-ink-secondary">
                        {copy.before === '' ? 'named' : <>named · before <Bidi>{copy.before}</Bidi></>}
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-[12px] text-ink-tertiary tabular-nums">{formatBytes(copy.size)}</span>
                  <Button
                    size="sm"
                    disabled={isDirty || (restoring !== undefined && restoring !== copy.name)}
                    busy={restoring === copy.name ? 'Restoring…' : undefined}
                    onClick={() => void restore(copy)}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
