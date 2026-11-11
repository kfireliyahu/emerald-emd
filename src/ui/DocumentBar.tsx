import { useEffect, useState } from 'react'

import { recentFolders } from '../../electron/bridge.ts'
import { canAutoSaveAtAll } from '@/data/storage/autoSave.ts'
import { shellDocuments } from '@/data/storage/desktop.ts'
import { wouldOverwrite } from '@/data/storage/externalChange.ts'
import { useT } from '@/i18n/current.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { ChoiceField } from '@/ui/components/ChoiceField.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { Working } from '@/ui/components/Working.tsx'
import { Kbd } from '@/ui/components/Kbd.tsx'
import { loadRecents } from '@/ui/commands.ts'
import { isDemo } from '@/ui/edition.ts'
import { isMac } from '@/ui/platform.ts'

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
 * **The title bar holds no primary** (M54 F6, D-531): it is chrome, and a
 * screen's own primary is the one filled button in the window. Save and New
 * are secondary here. While the file has changed on disk the status says so
 * and points at the notice below it, in words rather than a hover title on a
 * disabled button that takes no focus.
 *
 * **Save stays, and goes quiet** (rule 7 keeps `Ctrl/Cmd+S`; the button is its
 * visible half). Under auto-save it is disabled almost all the time, which is
 * the honest reading: it is the way to write *now* rather than in a second, and
 * there is nothing to write the rest of the time.
 */

const BUSY_WORD = {
  creating: 'chrome.documentBar.busy.creating',
  opening: 'chrome.documentBar.busy.opening',
  saving: 'chrome.documentBar.busy.saving',
  reloading: 'chrome.documentBar.busy.reloading',
} as const
export function DocumentBar() {
  const t = useT()
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
    return db === undefined ? null : <Bidi className="fc-view-enter truncate">{documentName}</Bidi>
  }

  if (db === undefined) {
    // Keyed both ways, so a document arriving or going fades its bar in (M39 F1).
    return (
      <div key="none" className="fc-view-enter flex items-center gap-3">
        <span className="text-ink-secondary">{t('chrome.documentBar.noDocument')}</span>
        <Button size="sm" onClick={() => void createNew()} disabled={working}>
          {t('chrome.documentBar.new')}
        </Button>
        <Button size="sm" onClick={() => void openFile()} disabled={working}>
          {t('chrome.documentBar.open')}
        </Button>
        <OpenRecent />
      </div>
    )
  }

  return (
    // `min-w-0`, or the row's min-content is the whole name and a long one pushes
    // the controls under the platform's caption buttons (M54 U6).
    <div key="open" className="fc-view-enter flex min-w-0 items-center gap-3">
      <span className="flex min-w-0" title={adapter.describe()}>
        <Bidi className="min-w-0 truncate">{documentName}</Bidi>
      </span>

      {/* The dirty state, as a dot rather than a word (docs/11): filled ink when
          there is unsaved work, a hollow ring when there is not. */}
      <span className="flex items-center gap-2 text-ink-secondary" aria-live="polite">
        <DirtyDot dirty={isDirty} busy={working} />
        {busy !== undefined ? (
          t(BUSY_WORD[busy])
        ) : blocked ? (
          t('chrome.documentBar.changedOnDisk')
        ) : isDirty ? (
          // The same word in both cases and a different promise behind it: under
          // auto-save "unsaved" is a state that is about to end by itself, and
          // the shortcut is offered only where pressing it is the only way out.
          automatic ? (
            t('chrome.documentBar.unsaved')
          ) : (
            <>
              {t('chrome.documentBar.unsaved')} · <SaveKeys />
            </>
          )
        ) : lastSavedAt === undefined ? (
          t('chrome.documentBar.noChanges')
        ) : (
          t('chrome.documentBar.saved', {
            time: new Date(lastSavedAt).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            }),
          })
        )}
      </span>

      <Button size="sm" onClick={() => void save()} disabled={working || !isDirty || blocked}>
        {t('chrome.documentBar.save')}
      </Button>
      {/* New, while a document is open (M38 F1): `requestNew`, so unsaved work
          here is asked about rather than thrown away — the same path as
          Ctrl+N, the palette and the shell's File menu. Open… asks the same
          before its picker (M38 U3). */}
      <Button size="sm" onClick={() => void requestNew()} disabled={working}>
        {t('chrome.documentBar.new')}
      </Button>
      <Button size="sm" onClick={() => void requestOpenFile()} disabled={working}>
        {t('chrome.documentBar.open')}
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
  const t = useT()
  const documentName = useDocumentStore((state) => state.documentName)
  const here = useDocumentStore((state) => state.adapter.location?.())
  const requestOpen = useDocumentStore((state) => state.requestOpen)
  const [recents, setRecents] = useState<readonly { path: string; name: string }[]>([])
  const [text, setText] = useState('')
  // Again whenever the open document changes: opening one is what puts it on the list.
  useEffect(() => void loadRecents().then(setRecents), [documentName])

  const others = recents.filter((entry) => entry.path !== here)
  if (shellDocuments() === undefined || others.length === 0) return null
  // The folder cut to the end that tells two of one name apart, as the File menu
  // shows it (M54 F7): the whole path tail-truncated cut exactly that part off.
  const folders = recentFolders(others)
  return (
    <ChoiceField
      text={text}
      choices={others.map((entry, index) => ({
        value: entry.path,
        label: entry.name,
        detail: folders[index] ?? '',
        search: entry.path,
      }))}
      filter
      onText={setText}
      onPick={(choice) => {
        setText('')
        void requestOpen(choice.value)
      }}
      onFocus={() => void loadRecents().then(setRecents)}
      placeholder={t('chrome.documentBar.openRecent')}
      aria-label={t('chrome.documentBar.openRecentLabel')}
      className={`${FIELD} h-7 w-40`}
    />
  )
}

/** `⌘S` on a Mac, `Ctrl+S` elsewhere — as the palette's own key is written (M54 F6). */
function SaveKeys() {
  return isMac() ? (
    <>
      <Kbd>⌘</Kbd>
      <Kbd>S</Kbd>
    </>
  ) : (
    <>
      <Kbd>Ctrl</Kbd>+<Kbd>S</Kbd>
    </>
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
