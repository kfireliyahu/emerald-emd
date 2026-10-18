import { useEffect, useState } from 'react'

import { canAutoSaveAtAll } from '@/data/storage/autoSave.ts'
import { shellDocuments } from '@/data/storage/desktop.ts'
import { wouldOverwrite } from '@/data/storage/externalChange.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Button } from '@/ui/components/Button.tsx'
import { ChoiceField } from '@/ui/components/ChoiceField.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { Working } from '@/ui/components/Working.tsx'
import { Kbd } from '@/ui/components/Kbd.tsx'
import { loadRecents } from '@/ui/commands.ts'
import { isDemo } from '@/ui/edition.ts'

/**
 * The document's state, always visible and never a modal (D-021).
 *
 * A dirty indicator that sits in the title bar is the difference between a
 * document-based app you can trust and one that loses your afternoon.
 *
 * **Save is disabled while the file has changed underneath us**, also D-116's
 * audit. `save` has always refused in that case — it re-checks the disk first
 * and returns — but the button stayed enabled, so clicking it did nothing and
 * said nothing. The notice above already carries the three answers; the button
 * now says why it is not one of them.
 *
 * **It says which operation is in flight, not just that one is** (D-116's
 * audit). `busy` was a boolean set by six operations and this rendered one
 * word for all of them, so opening a document announced "saving…" and so did
 * creating one — the single most alarming thing a document app can say while
 * it is not doing it.
 *
 * **Under auto-save the dot stops being a warning and becomes state** (D-155
 * rule 5): *unsaved → saving… → saved 14:32*, and the dot is hollow when there
 * is nothing outstanding. It said something was *wrong* before, which is the
 * right thing to say in a window where only the user can write the file and
 * exactly the wrong thing in one where the app does.
 *
 * **Where the app cannot write, the dot says so and still asks** (rule 6). The
 * download adapter has nowhere to write and a document that has never been
 * saved has no path yet, so both keep the `Ctrl+S` nudge. Pretending otherwise
 * would be the one lie the storage layer has never told.
 *
 * **Save stays, and goes quiet** (rule 7 keeps `Ctrl/Cmd+S`; the button is its
 * visible half). Under auto-save it is disabled almost all the time, which is
 * the honest reading: it is the way to write *now* rather than in a second, and
 * there is nothing to write the rest of the time.
 */

const BUSY_WORD = {
  creating: 'creating…',
  opening: 'opening…',
  saving: 'saving…',
  reloading: 'reloading…',
} as const
export function DocumentBar() {
  const { db, documentName, isDirty, busy, lastSavedAt, adapter, diskState, knownMark } =
    useDocumentStore()
  const working = busy !== undefined
  const blocked = wouldOverwrite(diskState)
  // Whether the app writes this document itself — a fact about where it lives,
  // not about whether it has unsaved work (D-155).
  const automatic = canAutoSaveAtAll({
    hasDocument: db !== undefined,
    canSaveSilently: adapter.canSaveSilently,
    knowsTheFile: knownMark !== undefined,
  })
  const createNew = useDocumentStore((state) => state.createNew)
  const requestNew = useDocumentStore((state) => state.requestNew)
  const openFile = useDocumentStore((state) => state.openFile)
  const requestOpenFile = useDocumentStore((state) => state.requestOpenFile)
  const save = useDocumentStore((state) => state.save)

  // **The demo's document has a name and nothing else here** (M33 U1, D-413):
  // no New, no Open…, no Save, no recents and no "unsaved", because a visitor
  // has no file for any of them to be about.
  if (isDemo()) {
    return db === undefined ? null : <span className="fc-view-enter truncate">{documentName}</span>
  }

  if (db === undefined) {
    // Keyed both ways, so a document arriving or going fades its bar in (M39 F1).
    return (
      <div key="none" className="fc-view-enter flex items-center gap-3">
        <span className="text-ink-secondary">No document open</span>
        <Button variant="primary" size="sm" onClick={() => void createNew()} disabled={working}>
          New
        </Button>
        <Button size="sm" onClick={() => void openFile()} disabled={working}>
          Open…
        </Button>
        <OpenRecent />
      </div>
    )
  }

  return (
    <div key="open" className="fc-view-enter flex items-center gap-3">
      <span className="truncate" title={adapter.describe()}>
        {documentName}
      </span>

      {/* The dirty state, as a dot rather than a word (docs/11): filled ink when
          there is unsaved work, a hollow ring when there is not. */}
      <span className="flex items-center gap-2 text-ink-secondary" aria-live="polite">
        <DirtyDot dirty={isDirty} busy={working} />
        {busy !== undefined ? (
          BUSY_WORD[busy]
        ) : isDirty ? (
          // The same word in both cases and a different promise behind it: under
          // auto-save "unsaved" is a state that is about to end by itself, and
          // the shortcut is offered only where pressing it is the only way out.
          automatic ? (
            'unsaved'
          ) : (
            <>
              unsaved · <Kbd>Ctrl</Kbd>+<Kbd>S</Kbd>
            </>
          )
        ) : lastSavedAt === undefined ? (
          'no changes'
        ) : (
          `saved ${new Date(lastSavedAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}`
        )}
      </span>

      <Button
        variant="primary"
        size="sm"
        onClick={() => void save()}
        disabled={working || !isDirty || blocked}
        {...(blocked
          ? { title: 'The file changed on disk. Answer that above before saving over it.' }
          : {})}
      >
        Save
      </Button>
      {/* New, while a document is open (M38 F1): `requestNew`, so unsaved work
          here is asked about rather than thrown away — the same path as
          Ctrl+N, the palette and the shell's File menu. Secondary, because
          Save is this row's one primary. Open… asks the same before its
          picker (M38 U3). */}
      <Button size="sm" onClick={() => void requestNew()} disabled={working}>
        New
      </Button>
      <Button size="sm" onClick={() => void requestOpenFile()} disabled={working}>
        Open…
      </Button>
      <OpenRecent />
    </div>
  )
}

/**
 * **Open recent, by the Open button** (M31 U9): the shell's recents list (D-128)
 * in the app's own searchable list — the one a format's fields use — rather
 * than only behind the native File menu. Type to narrow by name or folder.
 *
 * Only in the shell. A browser tab is handed a file and never its path, so it
 * keeps no list it could open again, and the field is absent rather than empty.
 */
function OpenRecent() {
  const documentName = useDocumentStore((state) => state.documentName)
  const here = useDocumentStore((state) => state.adapter.location?.())
  const requestOpen = useDocumentStore((state) => state.requestOpen)
  const [recents, setRecents] = useState<readonly { path: string; name: string }[]>([])
  const [text, setText] = useState('')
  // Again whenever the open document changes: opening one is what puts it on the list.
  useEffect(() => void loadRecents().then(setRecents), [documentName])

  const others = recents.filter((entry) => entry.path !== here)
  if (shellDocuments() === undefined || others.length === 0) return null
  return (
    <ChoiceField
      text={text}
      choices={others.map((entry) => ({
        value: entry.path,
        label: entry.name,
        detail: entry.path.slice(0, Math.max(entry.path.length - entry.name.length - 1, 0)),
        search: entry.path,
      }))}
      filter
      onText={setText}
      onPick={(choice) => {
        setText('')
        void requestOpen(choice.value)
      }}
      onFocus={() => void loadRecents().then(setRecents)}
      placeholder="Open recent…"
      aria-label="Open a recent document"
      className={`${FIELD} h-7 w-40`}
    />
  )
}

function DirtyDot({ dirty, busy }: { dirty: boolean; busy: boolean }) {
  // Opening, saving, reloading: the one progress indicator, where the dot is
  // (M28 U4). The word beside it says which.
  if (busy) return <Working size={14} />
  return (
    <span
      aria-hidden
      className={`h-2 w-2 rounded-full transition-colors duration-[var(--duration-base)] ${
        dirty || busy ? 'bg-ink' : 'border border-hairline-strong'
      }`}
    />
  )
}
