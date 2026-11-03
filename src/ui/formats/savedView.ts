import { useContext, useMemo } from 'react'
import { useLocation } from 'react-router-dom'

import type { Database } from 'sql.js'

import type { RowFilter } from '@/data/repositories/formatFilterRepository.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { defaultInputView, savedViews, saveView } from '@/data/repositories/formatViewRepository.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { heldExactly, INPUT_KIND, inputDraft, inputViewRefusals } from '@/domain/format/inputView.ts'
import { offeredOf, type RowDraft } from '@/domain/format/rowDraft.ts'
import { entryDefaults, savedNameRefusal, type SavedKind, type SavedView } from '@/domain/format/view.ts'
import { useDocumentStore } from '@/state/documentStore.ts'

import { canonicalAddress, holdsAnything, inputShapeOf, sameAddress } from './addressFilter.ts'
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
  const db = useDocumentStore((state) => state.db)
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
      // An input view is refused by the function the tool asks too (M55 U2, D-536).
      const declaration = db === undefined ? undefined : listFormats(db).find((each) => each.name === format)
      if (kind === INPUT_KIND && declaration !== undefined) {
        const reasons = inputViewRefusals(declaration, inputShapeOf(search, format))
        if (reasons.length > 0) return reasons.join(' ')
      }
      try {
        mutate((db) => saveView(db, { format, name: said, kind, address: canonicalAddress(search) }))
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
      return undefined
    },
  }
}

/**
 * **The format's default input view's defaults, as a draft holds them** (M55
 * U2, D-536) — a date's word worked out on `day` — or nothing without one.
 */
export function inputDefaults(db: Database, declaration: FormatDeclaration, day: string): Readonly<Record<string, string>> {
  const view = defaultInputView(db, declaration.name)
  return view === undefined ? {} : inputDraft(declaration, inputShapeOf(view.address, declaration.name).defaults, day)
}

/**
 * **What a new row starts at on screen** — D-536's one defaults rule
 * (`entryDefaults`), read for the table's blank row, entry/new and quick add
 * alike: the default input view's defaults, then the address's exact values,
 * then a required enum's first member. `implied` is what quick add's group sets.
 */
export function newRowDefaults(
  db: Database,
  declaration: FormatDeclaration,
  filter: RowFilter,
  day: string,
  implied: ReadonlySet<string> = new Set(),
): Readonly<Record<string, string>> {
  return entryDefaults(declaration.columns, implied, {
    input: inputDefaults(db, declaration, day),
    address: heldExactly(declaration, filter.match, day),
  })
}

/**
 * **What a draft holds beyond what it started at** — the cells somebody
 * typed, as `offeredOf` offers them. A default drawn in its field from the
 * start is not typed (D-518), so a row holding only defaults is untouched.
 */
export function typedOf(
  declaration: FormatDeclaration,
  draft: RowDraft,
  startsAt: Readonly<Record<string, string>>,
): Readonly<Record<string, string | readonly string[]>> {
  const start = offeredOf(declaration, startsAt)
  return Object.fromEntries(
    Object.entries(offeredOf(declaration, draft)).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(start[key])),
  )
}
