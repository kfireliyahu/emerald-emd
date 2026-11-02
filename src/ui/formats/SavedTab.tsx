import { useState } from 'react'

import { deleteSavedView, renameSavedView } from '@/data/repositories/formatViewRepository.ts'
import type { SavedView } from '@/domain/format/view.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'

/** A tab's label, as the format's tab strip draws every one of them (One level of tabs). */
export const TAB_LABEL =
  'text-body whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'
/** The open tab: `ink` over a 2px `accent` underline. */
export const TAB_ON = 'text-ink shadow-[inset_0_-2px_0_var(--color-accent)]'
/** Every other tab: `ink-secondary`, which a person reads to find the view (D-531). */
export const TAB_OFF = 'text-ink-secondary shadow-[inset_0_-2px_0_transparent] hover:text-ink'

const QUIET =
  'inline-flex h-6 w-6 items-center justify-center text-ink-secondary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'

/**
 * **A saved view is one of the format's tabs** — M54 F2, from M54 U2's row (One
 * level of tabs): its name in the strip, after the views every format has,
 * marked current while the address is the one it saved. The open one carries
 * its rename and delete where it stands, as the rail's row does — the band's
 * *Saved as …* says which it is, and this is where it is changed.
 */
export function SavedTab({ view, on, onGo }: { view: SavedView; on: boolean; onGo: () => void }) {
  const mutate = useDocumentStore((state) => state.mutate)
  const [renaming, setRenaming] = useState<string | undefined>(undefined)
  const [deleting, setDeleting] = useState(false)
  const [refusal, setRefusal] = useState<string | undefined>(undefined)

  const attempt = (write: () => void): boolean => {
    try {
      write()
    } catch (error) {
      setRefusal(error instanceof Error ? error.message : String(error))
      return false
    }
    setRefusal(undefined)
    return true
  }

  if (renaming !== undefined) {
    const rename = (): void => {
      if (attempt(() => mutate((db) => renameSavedView(db, view.format, view.name, renaming.trim())))) setRenaming(undefined)
    }
    return (
      <span className={`flex items-center gap-2 ${TAB_ON}`}>
        <input
          autoFocus
          value={renaming}
          maxLength={60}
          aria-label={`Rename ${view.name}`}
          onChange={(event) => {
            setRenaming(event.target.value)
            setRefusal(undefined)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              rename()
            } else if (event.key === 'Escape') {
              event.stopPropagation()
              setRenaming(undefined)
              setRefusal(undefined)
            }
          }}
          onBlur={() => {
            if (refusal === undefined) setRenaming(undefined)
          }}
          className="h-6 w-40 min-w-0 border-0 border-b border-accent bg-transparent p-0 text-body text-ink outline-none"
        />
        {refusal !== undefined && (
          <span className="text-caption whitespace-nowrap text-negative" role="alert">
            {refusal}
          </span>
        )}
      </span>
    )
  }

  if (deleting) {
    return (
      <span className="flex items-center gap-2 text-caption whitespace-nowrap text-ink-secondary">
        <span>
          Delete <Bidi>{view.name}</Bidi>? Its filter stays on screen.
        </span>
        <button
          type="button"
          className="text-negative hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => {
            if (attempt(() => mutate((db) => deleteSavedView(db, view.format, view.name)))) setDeleting(false)
          }}
        >
          Delete
        </button>
        <button
          type="button"
          className="text-ink-secondary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => {
            setDeleting(false)
            setRefusal(undefined)
          }}
        >
          Keep
        </button>
        {refusal !== undefined && (
          <span className="text-negative" role="alert">
            {refusal}
          </span>
        )}
      </span>
    )
  }

  return (
    <span className={`flex items-center gap-1 ${on ? TAB_ON : ''}`}>
      <button
        type="button"
        aria-current={on ? 'page' : undefined}
        title={`${view.name} — a saved ${view.kind}`}
        onClick={on ? undefined : onGo}
        className={`${TAB_LABEL} ${on ? 'text-ink' : TAB_OFF}`}
      >
        <Bidi>{view.name}</Bidi>
      </button>
      {on && (
        <>
          <button type="button" aria-label={`Rename ${view.name}`} title="Rename" className={QUIET} onClick={() => setRenaming(view.name)}>
            <ActionGlyph name="edit" size={12} />
          </button>
          <button type="button" aria-label={`Delete ${view.name}`} title="Delete" className={QUIET} onClick={() => setDeleting(true)}>
            <ActionGlyph name="trash" size={12} />
          </button>
        </>
      )}
    </span>
  )
}
