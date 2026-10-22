import { useContext, useMemo } from 'react'
import { useLocation } from 'react-router-dom'

import { savedViews, saveView } from '@/data/repositories/formatViewRepository.ts'
import { savedNameRefusal, type SavedKind, type SavedView } from '@/domain/format/view.ts'
import { useDocumentStore } from '@/state/documentStore.ts'

import { canonicalAddress, holdsAnything, sameAddress } from './addressFilter.ts'
import { ReadOnly } from './readOnly.ts'

/**
 * **Saving the view on screen** — M53 U5, D-514, D-520.
 *
 * A saved view is what the address holds — the filter, the folds, the columns
 * chosen and the sort — and the kind of view it is drawn in, under a name. The
 * FilterBand offers *Save this view* while the address holds something, and
 * says *Saved as Due today* while it is one; the rail lists them and opens one
 * by going to its address (`savedViewPath`).
 */
export interface Saving {
  /** Whether the address holds anything a view could be saved with. */
  readonly held: boolean
  /** The saved view this address is, in this kind, by name — or nothing. */
  readonly current: string | undefined
  /** The format's saved views' names, so a name already taken is offered as a replace. */
  readonly names: readonly string[]
  /** Save the address under a name — replacing a view of that name — or the sentence why not. */
  readonly save: (name: string) => string | undefined
}

/** The saved view an address is in a kind of view: same kind, same address in one spelling. */
export function savedNow(views: readonly SavedView[], kind: SavedKind, address: string): SavedView | undefined {
  const wanted = canonicalAddress(address)
  return views.find((each) => each.kind === kind && sameAddress(each.address, wanted))
}

/** A format's saved views, read again on every write. */
export function useSavedViews(format: string | undefined): readonly SavedView[] {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  return useMemo(
    () => (db === undefined || format === undefined ? [] : savedViews(db, format)),
    // `revision` is the dependency that matters: every write bumps it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, format, revision],
  )
}

/**
 * The FilterBand's *Save this view*, for the view on screen — or nothing where
 * nothing is written (the frame, M41 U2), which saves no view either.
 */
export function useSaving(format: string | undefined, kind: SavedKind): Saving | undefined {
  const readOnly = useContext(ReadOnly)
  const mutate = useDocumentStore((state) => state.mutate)
  const { search } = useLocation()
  const views = useSavedViews(format)
  if (readOnly !== undefined || format === undefined) return undefined
  return {
    held: holdsAnything(search),
    current: savedNow(views, kind, search)?.name,
    names: views.map((each) => each.name),
    save: (name) => {
      const said = name.trim()
      const refusal = savedNameRefusal(said)
      if (refusal !== undefined) return refusal
      try {
        mutate((db) => saveView(db, { format, name: said, kind, address: canonicalAddress(search) }))
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
      return undefined
    },
  }
}
