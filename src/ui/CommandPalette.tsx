import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { listFormats } from '@/data/repositories/formatRepository.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { Kbd } from '@/ui/components/Kbd.tsx'
import {
  ENTRIES_PER_FORMAT,
  ENTRY_SEARCH_MIN,
  entryAddress,
  moreAddress,
  paletteEntries,
  snippetOf,
  type PaletteEntry,
} from '@/ui/formats/paletteEntries.ts'
import {
  buildCommands,
  commandPaletteKey,
  filterCommands,
  loadRecents,
  openCommandPalette,
  setCommandPaletteOpen,
  useCommandPaletteOpen,
  type Command,
} from '@/ui/commands.ts'

/**
 * `Ctrl`/`Cmd`+`K`: everything you can do, one search box (D-130).
 *
 * The thing that most makes this a desktop app rather than a page. A window
 * this size has more screens than a nav can hold at once — the sidebar already
 * hides a section's children until you are in it — and more *operations* than
 * it has ever shown anywhere: save is a button, a menu item and a key, and
 * categorize is a count on two screens.
 *
 * The list itself is `commands.ts`; this file is only the surface. Three rules
 * it keeps:
 *
 * - **Nothing here does work of its own.** Every row calls something that
 *   already has a button, which is the same line the File menu holds (D-128).
 * - **Unavailable is absent.** No greyed rows — a palette is a search box, and
 *   a result you cannot act on wasted the keystroke.
 * - **The keyboard is the whole point.** Type to filter, arrows to move, Enter
 *   to run, Escape to leave, and focus goes back where it came from.
 *
 * **And it finds entries** (M37 U2c, D-475 3B): after the places and commands,
 * so *Save* is never buried, every entry that holds what was typed — the rows
 * `search_document` finds (`paletteEntries.ts`) — names first, four a format,
 * and *n more in X* opening that format's list holding the search. Choosing one
 * lands on the one entry view.
 */
export function CommandPalette({ onImportStatement }: { onImportStatement: () => void }) {
  const open = useCommandPaletteOpen()
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [recents, setRecents] = useState<readonly { path: string; name: string }[]>([])
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const returnFocusTo = useRef<Element | null>(null)
  const navigate = useNavigate()
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  // The entries trail the typing a frame when a document is large; the
  // commands above them never do.
  const typed = useDeferredValue(query)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      if (event.key.toLowerCase() !== 'k') return
      event.preventDefault()
      openCommandPalette()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Every opening starts from nothing typed, whichever of the two opened it.
  useEffect(() => {
    if (!open) return
    returnFocusTo.current = document.activeElement
    setQuery('')
    setSelected(0)
    // Read once per opening: the shell's recents list is a file on disk, and
    // the palette cannot await inside a render.
    void loadRecents().then(setRecents)
  }, [open])

  const declarations = useMemo(
    () => (open && db !== undefined ? listFormats(db) : []),
    // `revision` is the dependency that matters: every write bumps it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, db, revision],
  )
  const groups = useMemo(
    () => (open && db !== undefined ? paletteEntries(db, typed, declarations) : []),
    [open, db, typed, declarations],
  )

  const commands = useMemo(
    () =>
      open
        ? filterCommands(
            buildCommands({
              // The screen already showing is not a step to go back over (M31 U9),
              // which is what a `Link` to it does too.
              go: (to) => navigate(to, { replace: `#${to}` === window.location.hash }),
              importStatement: onImportStatement,
              recents,
            }),
            query,
            groups.length > 0,
          )
        : [],
    [open, query, recents, navigate, onImportStatement, groups.length],
  )

  /** Everything the arrows walk: the commands, then each format's entries and its *n more*. */
  const items = useMemo((): readonly Item[] => {
    const out: Item[] = commands.map((command) => ({ kind: 'command', command }))
    for (const group of groups) {
      for (const entry of group.entries.slice(0, ENTRIES_PER_FORMAT)) {
        out.push({ kind: 'entry', format: group.format, entry, count: group.entries.length })
      }
      const more = group.entries.length - ENTRIES_PER_FORMAT
      if (more > 0) out.push({ kind: 'more', format: group.format, more, first: group.entries[0]?.id })
    }
    return out
  }, [commands, groups])
  const held = groups.reduce((sum, group) => sum + group.entries.length, 0)

  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  // Keep the highlighted row in view when the arrows walk off the end of it.
  useEffect(() => {
    list.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected, query])

  if (!open) return null

  const close = (): void => {
    setCommandPaletteOpen(false)
    // Back where it came from, or the key that opened the palette costs the
    // user their place in whatever they were typing.
    if (returnFocusTo.current instanceof HTMLElement) returnFocusTo.current.focus()
  }

  const run = (item: Item | undefined): void => {
    if (item === undefined) return
    close()
    if (item.kind === 'command') {
      item.command.run()
      return
    }
    if (item.kind === 'entry') {
      navigate(entryAddress(item.format, item.entry.id))
      return
    }
    if (db !== undefined) navigate(moreAddress(db, item.format, declarations, query, item.first))
  }

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (items.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      // Wrapping, because a list this short is faster to reach from the end.
      setSelected((current) => (current + step + items.length) % items.length)
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      run(items[selected])
    }
  }

  return (
    <div
      // The scrim closes on a click, which is what every palette does and what
      // a person tries first when they opened it by accident. Closing, it and
      // the palette fade out (M39, src/ui/motion/closing.ts).
      data-motion-close
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 px-6 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
        className="fc-pop-enter flex max-h-[60vh] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-hairline-strong bg-elevated shadow-pop"
        onKeyDown={onKeyDown}
      >
        <input
          ref={input}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setSelected(0)
          }}
          placeholder={db === undefined ? 'Go to a screen, or do something…' : 'Search every entry, or go to a screen…'}
          aria-label="Search"
          aria-controls="command-list"
          aria-activedescendant={items[selected] === undefined ? undefined : `command-${selected}`}
          className="shrink-0 border-b border-hairline bg-transparent px-4 py-3 text-body outline-none placeholder:text-ink-tertiary"
        />

        <div ref={list} id="command-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto py-1">
          {items.map((item, index) => {
            const at = {
              index,
              selected: index === selected,
              onHover: () => setSelected(index),
              onPick: () => run(item),
            }
            const before = items[index - 1]
            if (item.kind === 'command') {
              const command = item.command
              return (
                <Row
                  key={command.id}
                  command={command}
                  {...at}
                  // The heading repeats only when the group changes, so the list
                  // reads as sections without carrying a header per row.
                  heading={
                    before?.kind === 'command' && before.command.group === command.group ? undefined : command.group
                  }
                />
              )
            }
            if (item.kind === 'more') {
              return <MoreRow key={`more:${item.format.name}`} format={item.format} more={item.more} {...at} />
            }
            const heading = before === undefined || before.kind === 'command' || before.format.name !== item.format.name
            return (
              <EntryRow
                key={`entry:${item.format.name}:${item.entry.id}`}
                format={item.format}
                entry={item.entry}
                query={typed}
                heading={heading ? { title: item.format.title, count: item.count } : undefined}
                {...at}
              />
            )
          })}
          {typed.trim().length >= ENTRY_SEARCH_MIN && db !== undefined && held === 0 ? (
            <p className="px-4 py-4 text-ink-secondary">
              No entry holds “<Bidi>{typed.trim()}</Bidi>”.
            </p>
          ) : (
            items.length === 0 && <p className="px-4 py-6 text-center text-ink-tertiary">Nothing matches that.</p>
          )}
        </div>

        <div className="flex shrink-0 gap-3.5 border-t border-hairline px-4 py-1.5 text-caption text-ink-tertiary">
          <span>
            <Kbd>↑</Kbd> <Kbd>↓</Kbd> to move
          </span>
          <span>
            <Kbd>Enter</Kbd> to open
          </span>
          <span>
            <Kbd>Esc</Kbd> to leave
          </span>
          {held > 0 && (
            <span className="ml-auto">{held === 1 ? '1 entry holds it' : `${String(held)} entries hold it`}</span>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * **The way in that needs no knowledge** (M46 U1, D-458): the palette, behind a
 * button in the title bar beside Back and Forward — on every route, in the shell
 * and in a browser tab, at any width, because the arrows' corner is the one
 * place the title bar never gives up to a long document name.
 *
 * The palette exists so the screen can carry fewer controls, and a key nobody
 * told you about is not a way in. So the button's tooltip teaches the key —
 * `Commands (Ctrl+K)`, `Commands (⌘K)` on a Mac — and after that a person
 * needs the button less.
 */
export function CommandPaletteButton() {
  const key = commandPaletteKey()
  return (
    <button
      type="button"
      aria-label="Commands"
      aria-keyshortcuts={key === '⌘K' ? 'Meta+K' : 'Control+K'}
      title={`Commands (${key})`}
      className="fc-icon-action shrink-0"
      onClick={openCommandPalette}
    >
      <ActionGlyph name="search" />
    </button>
  )
}

/** One row the arrows walk. */
type Item =
  | { readonly kind: 'command'; readonly command: Command }
  | {
      readonly kind: 'entry'
      readonly format: FormatDeclaration
      readonly entry: PaletteEntry
      /** How many of this format's entries hold it — the group's heading. */
      readonly count: number
    }
  | {
      readonly kind: 'more'
      readonly format: FormatDeclaration
      readonly more: number
      /** The best hit, should the list's own search hold none of them. */
      readonly first: string | undefined
    }

interface RowPlace {
  index: number
  selected: boolean
  onHover: () => void
  onPick: () => void
}

function rowClass(selected: boolean): string {
  return `flex w-full flex-col gap-px px-4 py-1.5 text-left transition-colors duration-[var(--duration-micro)] ${
    selected ? 'bg-accent-soft' : ''
  }`
}

/** The text around the match, the match marked — or the text itself when it is not in it. */
function Snip({ text, query }: { text: string; query: string }) {
  const snippet = snippetOf(text, query)
  if (snippet === undefined) return <Bidi>{text}</Bidi>
  return (
    <>
      {snippet.leading && '…'}
      <Bidi>
        {snippet.before}
        <mark className="fc-hit">{snippet.hit}</mark>
        {snippet.after}
      </Bidi>
      {snippet.trailing && '…'}
    </>
  )
}

/**
 * An entry: its name — the match marked when the name is what held it — and
 * its format on the right; found in another column, that column named under it
 * with the text around the match (the mockup's `.prow`).
 */
function EntryRow({
  format,
  entry,
  query,
  heading,
  index,
  selected,
  onHover,
  onPick,
}: RowPlace & {
  format: FormatDeclaration
  entry: PaletteEntry
  query: string
  heading: { title: string; count: number } | undefined
}) {
  return (
    <>
      {heading !== undefined && (
        <p className="flex items-baseline gap-2 px-4 pt-3 pb-1">
          <span className="text-label text-ink-tertiary uppercase">{heading.title}</span>
          <span className="text-caption text-ink-tertiary">{heading.count}</span>
        </p>
      )}
      <button
        type="button"
        id={`command-${index}`}
        role="option"
        aria-selected={selected}
        data-selected={selected}
        data-entry={entry.id}
        onMouseMove={onHover}
        onClick={onPick}
        className={rowClass(selected)}
      >
        <span className="flex w-full min-w-0 items-center gap-2.5 text-ink">
          <span className="inline-flex w-4 flex-none justify-center text-ink-tertiary">
            <ActionGlyph name="note" size={14} />
          </span>
          <span className="min-w-0 truncate">
            {entry.rank < 3 ? <Snip text={entry.name} query={query} /> : <Bidi>{entry.name}</Bidi>}
          </span>
          <span className="ml-auto shrink-0 text-caption text-ink-tertiary">{format.title}</span>
        </span>
        {entry.column !== undefined && entry.text !== undefined && (
          <span className="w-full truncate pl-[26px] text-caption text-ink-secondary">
            <span className="mr-1.5 text-ink-tertiary">{entry.column.replace(/_/g, ' ')}</span>
            <Snip text={entry.text} query={query} />
          </span>
        )}
      </button>
    </>
  )
}

/** *12 more in Recipe, in its list* — the format's list, holding the search. */
function MoreRow({
  format,
  more,
  index,
  selected,
  onHover,
  onPick,
}: RowPlace & { format: FormatDeclaration; more: number }) {
  return (
    <button
      type="button"
      id={`command-${index}`}
      role="option"
      aria-selected={selected}
      data-selected={selected}
      data-more={format.name}
      onMouseMove={onHover}
      onClick={onPick}
      className={`${rowClass(selected)} text-caption text-accent`}
    >
      <span className="flex min-w-0 items-center gap-2.5">
        <span className="inline-flex w-4 flex-none justify-center">
          <ActionGlyph name="arrow" size={14} />
        </span>
        <span>
          {more} more in {format.title}, in its list
        </span>
      </span>
    </button>
  )
}

function Row({
  command,
  index,
  selected,
  heading,
  onHover,
  onPick,
}: {
  command: Command
  index: number
  selected: boolean
  heading: string | undefined
  onHover: () => void
  onPick: () => void
}) {
  return (
    <>
      {heading !== undefined && (
        <p className="px-4 pt-3 pb-1 text-label text-ink-tertiary uppercase">{heading}</p>
      )}
      <button
        type="button"
        id={`command-${index}`}
        role="option"
        aria-selected={selected}
        data-selected={selected}
        onMouseMove={onHover}
        onClick={onPick}
        className={`flex w-full items-baseline gap-3 px-4 py-1.5 text-left transition-colors duration-[var(--duration-micro)] ${
          selected ? 'bg-accent-soft text-ink' : 'text-ink-secondary'
        }`}
      >
        <span className="min-w-0 truncate">{command.label}</span>
        {command.detail !== undefined && (
          <span className="min-w-0 shrink truncate text-caption text-ink-tertiary">
            {command.detail}
          </span>
        )}
        {command.hint !== undefined && (
          <span className="ml-auto shrink-0">
            {command.hint.split('+').map((key, at) => (
              <span key={key}>
                {at > 0 && '+'}
                <Kbd>{key}</Kbd>
              </span>
            ))}
          </span>
        )}
      </button>
    </>
  )
}
