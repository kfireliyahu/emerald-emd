import { useId, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Database } from 'sql.js'

import type { Result } from '@/core/result.ts'
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
import { changeRollup, rollupDeleted, rollupRenamed, type RollupChange } from '@/ui/formats/rollupInPlace.ts'
import { toneOf } from '@/ui/formats/tone.ts'
import { entryPath, formatPath, inputPath, NEW_ENTRY, savedViewPath, type NavChild } from '@/ui/nav.ts'
import { folderIsOpen, toggleFolder, useOpenFolders } from '@/ui/railFolders.ts'
import { rollupWords } from '@/ui/formats/dashboard.ts'

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
 * deleted where it stands. **Its charts beside them** (M53 F3): each rollup
 * the format declares, opening its tab, renamed and deleted the same way.
 * **Its input views first** (M55 U3, D-535), the one used for Add first of
 * them and captioned *Add*, each opening its form.
 */

/**
 * **Where a folder's parts start**, as classes (M54 F5): the arrow, a 24px
 * target, ends at the name's start — 40px, as a plain page's `ps-10`, or 56px
 * under a pack's name, as its `ps-14` — and what is inside the folder (its
 * filter, its entries, its saved views and charts) starts one step further in.
 */
const PLAIN = { arrow: 'ms-4', entry: 'ps-12', field: 'ms-12' } as const
const GROUPED = { arrow: 'ms-8', entry: 'ps-16', field: 'ms-16' } as const

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
  // Input views first, the one Add opens first of them; then the views of rows.
  const views = useSavedViews(name)
  const saved = useMemo(
    () => [
      ...views.filter((each) => each.kind === 'input' && each.isDefault === true),
      ...views.filter((each) => each.kind === 'input' && each.isDefault !== true),
      ...views.filter((each) => each.kind !== 'input'),
    ],
    [views],
  )
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

  // Under a pack's name a format sits one step further in (M33 F3). The steps
  // are classes, not pixels (M54 F5): the arrow's 24px target ends where a plain
  // page's name starts (`ps-10`, `ps-14`), and the entries start one step past it.
  const step = grouped ? GROUPED : PLAIN
  const countId = useId()
  // The saved view the address is, when it is one: it carries the marker, as an entry does.
  const savedHere = (view: SavedView): boolean =>
    lit &&
    (view.kind === 'input'
      ? pathname === inputPath(name, view.name)
      : pathname === savedViewPath(name, view.kind, '') && sameAddress(kept, view.address))
  const onSaved = saved.some(savedHere)
  const q = filter.trim()
  return (
    <>
      <div
        // The format's row: lit on its own screens, ink while one of its entries is (the entry carries the marker).
        className={`fc-row-enter relative flex h-7 items-center text-body transition-colors duration-[var(--duration-micro)] ${
          lit && current === undefined && !onSaved
            ? 'bg-accent-soft text-ink before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-accent'
            : lit
              ? 'text-ink'
              : 'text-ink-secondary hover:text-ink'
        }`}
      >
        <button
          type="button"
          onClick={() => toggleFolder(name, current !== undefined)}
          // A stable name, the state in `aria-expanded` (M54 F5).
          aria-expanded={open}
          aria-label={`${child.label} entries`}
          title={open ? 'Close' : 'Open'}
          className={`inline-flex h-7 w-6 flex-none items-center justify-center text-ink-secondary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${step.arrow}`}
        >
          <span
            className={`inline-flex transition-transform duration-[var(--duration-micro)] ease-[var(--ease-out)] ${open ? 'rotate-90 rtl:-rotate-90' : ''}`}
          >
            <ActionGlyph name="right" size={12} />
          </span>
        </button>
        <Link
          to={child.to}
          // The tour's anchor (M33 U2): `nav-formats-receipt`, as a section's is `nav-formats`.
          data-tour={`nav${child.to.replace(/\//g, '-')}`}
          // The format's name, and its count apart from it (M54 F5): read
          // "Decision", described "4 entries" — never "Decision4".
          aria-label={child.label}
          aria-current={lit && current === undefined && !onSaved ? 'page' : undefined}
          {...(total === undefined ? {} : { 'aria-describedby': countId })}
          className="flex h-7 min-w-0 flex-1 items-center gap-2 pe-3.5 text-start focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        >
          <Bidi className="truncate">{child.label}</Bidi>
          {total !== undefined && (
            <span id={countId} className="ms-auto text-caption text-ink-secondary tabular-nums">
              {total}
              <span className="sr-only"> {total === 1 ? 'entry' : 'entries'}</span>
            </span>
          )}
        </Link>
      </div>

      {saved.map((view) => (
        <SavedRow
          key={view.name}
          view={view}
          here={savedHere(view)}
          left={step.entry}
        />
      ))}
      {(declaration?.rollups ?? []).map((rollup) => (
        <RollupRow key={`rollup ${rollup.name}`} format={name} name={rollup.name} left={step.entry} />
      ))}

      {open && folder !== undefined && (
        <>
          {folder.total > FOLDER_SIZE && (
            <label
              className={`my-0.5 me-3 flex h-6 items-center gap-1.5 border-b border-hairline-strong text-ink-secondary focus-within:border-accent ${step.field}`}
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
                className="w-full min-w-0 border-0 bg-transparent p-0 text-caption text-ink outline-none placeholder:text-ink-secondary"
              />
            </label>
          )}
          {folder.found === 0 && (
            <div className={`pt-0.5 pe-2.5 pb-1 text-caption text-ink-secondary ${step.entry}`}>
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
                className={`fc-row-enter relative flex h-6 w-full items-center pe-2.5 text-start text-caption transition-colors duration-[var(--duration-micro)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${
                  here
                    ? 'bg-accent-soft text-ink before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-accent'
                    : 'text-ink-secondary hover:text-ink'
                } ${step.entry}`}
              >
                {folder.stated && (
                  <span className="fc-dot me-2 flex-none" data-tone={toneOf(entry.state)} aria-hidden />
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
              className={`flex h-6 w-full items-center pe-2.5 text-start text-caption text-accent hover:underline hover:underline-offset-[3px] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${step.entry}`}
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
 * pencil renames it in place and the bin deletes it, both where it stands.
 */
function SavedRow({ view, here, left }: { view: SavedView; here: boolean; left: string }) {
  const mutate = useDocumentStore((state) => state.mutate)
  const input = view.kind === 'input'
  const forAdd = input && view.isDefault === true
  return (
    <RailRow
      name={view.name}
      to={savedViewPath(view.format, view.kind, view.address, view.name)}
      glyph={input ? 'input' : 'filter'}
      title={input ? `${view.name} — an input view` : `${view.name} — a saved ${view.kind}`}
      // The one Add opens says so where a format's row has its count (M55 U3).
      caption={forAdd ? 'Add' : undefined}
      deleteNote={forAdd ? 'Add opens the entry form again.' : undefined}
      here={here}
      left={left}
      onRename={(to) => mutate((db) => renameSavedView(db, view.format, view.name, to.trim()))}
      onDelete={() => mutate((db) => deleteSavedView(db, view.format, view.name))}
    />
  )
}

/**
 * **One chart in the rail** (M53 F3): a rollup of the format, beside its saved
 * views. Its name opens its tab on the format; renaming it and deleting it
 * change the format's declaration, as `extend_format rename` and `remove` do,
 * and a dashboard's chart of it follows the rename or goes with it.
 */
function RollupRow({ format, name, left }: { format: string; name: string; left: string }) {
  const mutate = useDocumentStore((state) => state.mutate)
  const change = (judge: (db: Database) => Result<RollupChange | undefined, string>): void =>
    mutate((db) => {
      const judged = judge(db)
      if (!judged.ok) throw new Error(judged.error)
      if (judged.value !== undefined) changeRollup(db, judged.value)
    })
  return (
    <RailRow
      // In words (M55 U7); renaming starts from them and folds them back into a name.
      name={rollupWords(name)}
      to={formatPath(format)}
      state={{ rollup: name }}
      glyph="chart"
      title={`${rollupWords(name)} — a chart`}
      here={false}
      left={left}
      onRename={(to) => change((db) => rollupRenamed(db, listFormats(db), format, name, to))}
      onDelete={() => change((db) => rollupDeleted(db, listFormats(db), format, name))}
    />
  )
}

/**
 * **A named row under a format in the rail** — a saved view or a chart: its
 * name opens it; the pencil renames it in place — Enter writes, Escape lets it
 * go — and the bin asks once, where it stands, before it deletes. A refusal (a
 * name already taken, a pack's own) is said under it and nothing is written.
 */
function RailRow({
  name,
  to,
  state,
  glyph,
  title,
  caption,
  deleteNote,
  here,
  left,
  onRename,
  onDelete,
}: {
  name: string
  to: string
  state?: unknown
  glyph: 'filter' | 'chart' | 'input'
  title: string
  /** Said at its end, where a format's row has its count: *Add*. */
  caption?: string | undefined
  /** What deleting it changes beyond itself, said with the question. */
  deleteNote?: string | undefined
  here: boolean
  /** Its inset from the rail's edge: a class, `PLAIN.entry` or `GROUPED.entry`. */
  left: string
  /** Writes the new name, or throws the refusal. */
  onRename: (to: string) => void
  /** Deletes it, or throws the refusal. */
  onDelete: () => void
}) {
  const [renaming, setRenaming] = useState<string | undefined>(undefined)
  const [deleting, setDeleting] = useState(false)
  const [refusal, setRefusal] = useState<string | undefined>(undefined)
  const quiet =
    'text-ink-secondary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent'
  const said =
    refusal === undefined ? null : (
      <div className="pb-1 text-caption text-negative" role="alert">
        {refusal}
      </div>
    )

  if (renaming !== undefined) {
    const rename = (): void => {
      try {
        onRename(renaming)
      } catch (error) {
        setRefusal(error instanceof Error ? error.message : String(error))
        return
      }
      setRenaming(undefined)
      setRefusal(undefined)
    }
    return (
      <div className={`pe-2.5 text-caption ${left}`}>
        <input
          autoFocus
          value={renaming}
          maxLength={60}
          aria-label={`Rename ${name}`}
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
          className="h-6 w-full min-w-0 border-0 border-b border-accent bg-transparent p-0 text-caption text-ink outline-none"
        />
        {said}
      </div>
    )
  }

  if (deleting) {
    return (
      <div className={`pe-2.5 ${left}`}>
        <div className="flex h-6 items-center gap-2 text-caption text-ink-secondary">
          {/* The ellipsis on the Bidi span, so a Hebrew name keeps its start (M54 F6). */}
          <span className="flex min-w-0 gap-1">
            <span className="shrink-0">Delete</span>
            <Bidi className="min-w-0 truncate">{name}</Bidi>
            <span className="shrink-0">?</span>
          </span>
          <button
            type="button"
            className="text-negative hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            onClick={() => {
              try {
                onDelete()
              } catch (error) {
                setRefusal(error instanceof Error ? error.message : String(error))
              }
            }}
          >
            Delete
          </button>
          <button
            type="button"
            className={quiet}
            onClick={() => {
              setDeleting(false)
              setRefusal(undefined)
            }}
          >
            Keep
          </button>
        </div>
        {deleteNote !== undefined && <div className="pb-1 text-caption text-ink-secondary">{deleteNote}</div>}
        {said}
      </div>
    )
  }

  return (
    <div
      className={`group relative flex h-6 items-center pe-1 text-caption transition-colors duration-[var(--duration-micro)] ${
        here
          ? 'bg-accent-soft text-ink before:absolute before:inset-y-0 before:start-0 before:w-0.5 before:bg-accent'
          : 'text-ink-secondary hover:text-ink'
      }`}
    >
      <Link
        to={to}
        state={state}
        aria-current={here ? 'page' : undefined}
        title={title}
        className={`flex h-6 min-w-0 flex-1 items-center gap-1.5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent ${left}`}
      >
        <span className="flex-none text-ink-secondary">
          <ActionGlyph name={glyph} size={11} />
        </span>
        <Bidi className="min-w-0 truncate">{name}</Bidi>
        {caption !== undefined && (
          <span className="ms-auto pe-1 text-caption text-ink-secondary group-focus-within:hidden group-hover:hidden">{caption}</span>
        )}
      </Link>
      <span className="flex flex-none items-center opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          aria-label={`Rename ${name}`}
          title="Rename"
          className={`inline-flex h-6 w-6 items-center justify-center ${quiet}`}
          onClick={() => setRenaming(name)}
        >
          <ActionGlyph name="edit" size={11} />
        </button>
        <button
          type="button"
          aria-label={`Delete ${name}`}
          title="Delete"
          className={`inline-flex h-6 w-6 items-center justify-center ${quiet}`}
          onClick={() => setDeleting(true)}
        >
          <ActionGlyph name="trash" size={11} />
        </button>
      </span>
    </div>
  )
}
