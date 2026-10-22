import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Database } from 'sql.js'

import { listFormats } from '@/data/repositories/formatRepository.ts'
import { countRows } from '@/data/repositories/formatRowRepository.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { deleteSavedView, renameSavedView } from '@/data/repositories/formatViewRepository.ts'
import type { SavedView } from '@/domain/format/view.ts'
import { filterAddress, sameAddress } from '@/ui/formats/addressFilter.ts'
import { useSavedViews } from '@/ui/formats/savedView.ts'
import { FOLDER_SIZE, folderOf } from '@/ui/formats/folder.ts'
import { toneOf } from '@/ui/formats/tone.ts'
import { entryPath, formatPath, NEW_ENTRY, savedViewPath, type NavChild } from '@/ui/nav.ts'
import { folderIsOpen, toggleFolder, useOpenFolders } from '@/ui/railFolders.ts'

/**
 * **A format in the rail, as a folder of its entries** — M37 U2 (D-475, 1B and
 * 1C; `docs/mockups/m37/finding.html`).
 *
 * Its arrow opens it, several at once, and which are open is the viewer's
 * (`railFolders.ts`); the format you are in opens by itself. Pressing the name
 * still opens the format. Open, it draws the first twelve entries by the name
 * the entry's header uses, a filter line once there are more than twelve —
 * the Table's own search — and *All n*, which opens the entry's list holding
 * it, on the first entry it holds (M37 U2b).
 *
 * **Its saved views are listed under it, open or not** (M53 U5, D-520): each
 * opens its address, is lit while the address is it, and is renamed or
 * deleted where it stands.
 */

/** The document's declarations, read once per change for every folder in the rail. */
export function useDeclarations(): { readonly db: Database | undefined; readonly declarations: readonly FormatDeclaration[] } {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const declarations = useMemo(() => (db === undefined ? [] : listFormats(db)), [db, revision])
  return { db, declarations }
}

/** The entry a path is on in this format, or nothing — the table, a board, a new entry. */
export function entryAt(name: string, pathname: string): string | undefined {
  const prefix = `${formatPath(name)}/entry/`
  if (!pathname.startsWith(prefix)) return undefined
  const id = decodeURIComponent(pathname.slice(prefix.length).split('/')[0] ?? '')
  return id === '' || id === NEW_ENTRY ? undefined : id
}

export function RailFolder({
  child,
  name,
  lit,
  pathname,
  db,
  declarations,
}: {
  child: NavChild
  name: string
  /** Whether the rail lights this format — it is the deepest place the path is in. */
  lit: boolean
  pathname: string
  db: Database | undefined
  declarations: readonly FormatDeclaration[]
}) {
  const revision = useDocumentStore((state) => state.revision)
  // In the format already, an entry keeps the list's search; one the search
  // does not hold lets it go when it opens (M37 U2b).
  const kept = useLocation().search
  const saved = useSavedViews(name)
  const held = useOpenFolders()
  const [filter, setFilter] = useState('')
  const declaration = declarations.find((each) => each.name === name)
  const current = lit ? entryAt(name, pathname) : undefined
  const open = folderIsOpen(held, name, current !== undefined)
  const grouped = child.group !== undefined

  const total = useMemo(
    () => (db === undefined || declaration === undefined ? undefined : countRows(db, declaration, {})),
    // `revision` is the dependency that matters: every write bumps it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, declaration, revision],
  )
  const folder = useMemo(
    () =>
      !open || db === undefined || declaration === undefined
        ? undefined
        : folderOf(db, declaration, declarations, filter, current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, db, declaration, declarations, filter, current, revision],
  )

  const indent = grouped ? 16 : 0
  // The saved view the address is, when it is one: it carries the marker, as an entry does.
  const savedHere = (view: SavedView): boolean =>
    lit && pathname === savedViewPath(name, view.kind, '') && sameAddress(kept, view.address)
  const onSaved = saved.some(savedHere)
  const q = filter.trim()
  return (
    <>
      <div
        // The format's row: lit on its own screens, ink while one of its entries is (the entry carries the marker).
        className={`fc-row-enter relative flex h-7 items-center text-[13px] transition-colors duration-[var(--duration-micro)] ${
          lit && current === undefined && !onSaved
            ? 'bg-accent-soft text-ink before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent'
            : lit
              ? 'text-ink'
              : 'text-ink-secondary hover:text-ink'
        }`}
      >
        <button
          type="button"
          onClick={() => toggleFolder(name, current !== undefined)}
          aria-expanded={open}
          aria-label={`${open ? 'Close' : 'Open'} ${child.label}`}
          className="inline-flex h-7 w-5 flex-none items-center justify-center text-ink-tertiary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
          style={{ marginLeft: 20 + indent }}
        >
          <span
            className="inline-flex transition-transform duration-[var(--duration-micro)] ease-[var(--ease-out)]"
            style={{ transform: open ? 'rotate(90deg)' : undefined }}
          >
            <ActionGlyph name="right" size={12} />
          </span>
        </button>
        <Link
          to={child.to}
          // The tour's anchor (M33 U2): `nav-formats-receipt`, as a section's is `nav-formats`.
          data-tour={`nav${child.to.replace(/\//g, '-')}`}
          className="flex h-7 min-w-0 flex-1 items-center gap-2 pr-3.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        >
          <span className="truncate">{child.label}</span>
          {total !== undefined && (
            <span className="ml-auto text-[11px] text-ink-tertiary tabular-nums">{total}</span>
          )}
        </Link>
      </div>

      {saved.map((view) => (
        <SavedRow
          key={view.name}
          view={view}
          here={savedHere(view)}
          indent={indent}
        />
      ))}

      {open && folder !== undefined && (
        <>
          {folder.total > FOLDER_SIZE && (
            <label
              className="my-0.5 mr-3 flex h-[26px] items-center gap-1.5 border-b border-hairline-strong text-ink-tertiary"
              style={{ marginLeft: 46 + indent }}
            >
              <ActionGlyph name="search" size={12} />
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' && filter !== '') {
                    event.stopPropagation()
                    setFilter('')
                  }
                }}
                placeholder={`Filter ${folder.total}`}
                aria-label={`Filter ${child.label}`}
                className="w-full min-w-0 border-0 bg-transparent p-0 text-[12px] text-ink outline-none placeholder:text-ink-tertiary"
              />
            </label>
          )}
          {folder.found === 0 && (
            <div className="pt-0.5 pr-2.5 pb-1 text-[12px] text-ink-tertiary" style={{ paddingLeft: 46 + indent }}>
              {q === '' ? 'Nothing in it yet' : <>Nothing holds “<Bidi>{q}</Bidi>”</>}
            </div>
          )}
          {folder.entries.map((entry) => {
            const here = entry.id === current
            return (
              <Link
                key={entry.id}
                to={entryPath(name, entry.id) + (lit ? kept : '')}
                title={entry.title}
                aria-current={here ? 'page' : undefined}
                className={`fc-row-enter relative flex h-6 w-full items-center pr-2.5 text-left text-[12.5px] transition-colors duration-[var(--duration-micro)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                  here
                    ? 'bg-accent-soft text-ink before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent'
                    : 'text-ink-secondary hover:text-ink'
                }`}
                style={{ paddingLeft: 46 + indent }}
              >
                {folder.stated && (
                  <span
                    className="fc-dot"
                    data-tone={toneOf(entry.state)}
                    aria-hidden
                    style={{ width: 6, height: 6, marginRight: 7 }}
                  />
                )}
                <Bidi className="min-w-0 truncate">{entry.title}</Bidi>
              </Link>
            )
          })}
          {(folder.found > FOLDER_SIZE || q !== '') && folder.found > 0 && (
            <Link
              // The list, not the Table (M37 U2b, the mockup's `openAll`): the
              // first entry it holds, with the filter line's text as its search.
              to={entryPath(name, folder.entries[0]?.id ?? '') + filterAddress(q === '' ? {} : { search: q })}
              className="flex h-6 w-full items-center pr-2.5 text-left text-[12px] text-accent hover:underline hover:underline-offset-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
              style={{ paddingLeft: 46 + indent }}
            >
              All {folder.found}
              {q !== '' && ' holding it'} →
            </Link>
          )}
        </>
      )}
    </>
  )
}

/**
 * **One saved view in the rail** (M53 U5): its name opens its address; the
 * pencil renames it in place — Enter writes, Escape lets it go — and the bin
 * asks once, where it stands, before it deletes. A refusal (a name already
 * taken) is said under the field and nothing is written.
 */
function SavedRow({ view, here, indent }: { view: SavedView; here: boolean; indent: number }) {
  const mutate = useDocumentStore((state) => state.mutate)
  const [renaming, setRenaming] = useState<string | undefined>(undefined)
  const [deleting, setDeleting] = useState(false)
  const [refusal, setRefusal] = useState<string | undefined>(undefined)
  const left = { paddingLeft: 46 + indent }
  const quiet =
    'text-ink-tertiary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'

  if (renaming !== undefined) {
    const rename = (): void => {
      try {
        mutate((db) => renameSavedView(db, view.format, view.name, renaming.trim()))
      } catch (error) {
        setRefusal(error instanceof Error ? error.message : String(error))
        return
      }
      setRenaming(undefined)
      setRefusal(undefined)
    }
    return (
      <div className="pr-2.5 text-[12.5px]" style={left}>
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
          className="h-6 w-full min-w-0 border-0 border-b border-accent bg-transparent p-0 text-[12.5px] text-ink outline-none"
        />
        {refusal !== undefined && (
          <div className="pb-1 text-[11px] text-negative" role="alert">
            {refusal}
          </div>
        )}
      </div>
    )
  }

  if (deleting) {
    return (
      <div className="flex h-6 items-center gap-2 pr-2.5 text-[12px] text-ink-secondary" style={left}>
        <span className="min-w-0 truncate">
          Delete <Bidi>{view.name}</Bidi>?
        </span>
        <button
          type="button"
          className="text-negative hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          onClick={() => mutate((db) => deleteSavedView(db, view.format, view.name))}
        >
          Delete
        </button>
        <button type="button" className={quiet} onClick={() => setDeleting(false)}>
          Keep
        </button>
      </div>
    )
  }

  return (
    <div
      className={`group relative flex h-6 items-center pr-1.5 text-[12.5px] transition-colors duration-[var(--duration-micro)] ${
        here
          ? 'bg-accent-soft text-ink before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent'
          : 'text-ink-secondary hover:text-ink'
      }`}
    >
      <Link
        to={savedViewPath(view.format, view.kind, view.address)}
        aria-current={here ? 'page' : undefined}
        title={`${view.name} — a saved ${view.kind}`}
        className="flex h-6 min-w-0 flex-1 items-center gap-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        style={left}
      >
        <span className="flex-none text-ink-tertiary">
          <ActionGlyph name="filter" size={11} />
        </span>
        <Bidi className="min-w-0 truncate">{view.name}</Bidi>
      </Link>
      <span className="flex flex-none items-center gap-0.5 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          aria-label={`Rename ${view.name}`}
          title="Rename"
          className={`inline-flex h-5 w-5 items-center justify-center ${quiet}`}
          onClick={() => setRenaming(view.name)}
        >
          <ActionGlyph name="edit" size={11} />
        </button>
        <button
          type="button"
          aria-label={`Delete ${view.name}`}
          title="Delete"
          className={`inline-flex h-5 w-5 items-center justify-center ${quiet}`}
          onClick={() => setDeleting(true)}
        >
          <ActionGlyph name="trash" size={11} />
        </button>
      </span>
    </div>
  )
}
