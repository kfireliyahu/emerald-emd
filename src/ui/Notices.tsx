import { useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { waitingItems } from '@/data/repositories/homeRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { shellUpdates } from '@/data/storage/desktop.ts'
import { waitingCounts } from '@/domain/home.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { openEarlierCopies } from '@/ui/EarlierCopies.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { useKeepsLedger } from '@/ui/packs.ts'
import { today } from '@/ui/today.ts'
import { answer, useUpdateState } from '@/ui/useUpdates.ts'

/**
 * Everything the app has to say, in one place and in one order (D-130).
 *
 * There used to be four independent bars — `DiskConflictBar`, `PendingOpenBar`,
 * the error strip and the resume banner — each added where it was needed, each
 * rendering its own bordered row, and each pushing the content down by another
 * 40px. Nothing had ever decided what happens when three of them are true at
 * once, and after D-127 they can be: a watcher can fire while a document is
 * waiting to open and an import is half-reviewed.
 *
 * So they are one region, and the order is **consequence**, which is the shape
 * the home dashboard already ranks things in (D-108):
 *
 * 1. **The disk conflict**, because `save` *refuses* while it is true. Nothing
 *    else on this list can be finished until it is answered.
 * 2. **The document waiting to open**, because something outside the app is
 *    blocked on the answer — a double-click that appears to have done nothing.
 *    A new document asked for over unsaved work waits in the same rank and
 *    asks the same three things (M38 F1).
 * 3. **The error**, because it reports something that already failed. It is
 *    the past; the two above are the present.
 * 3½. **The copy kept before a large read** (M34 U6, D-399), because where it
 *    is has to be said once, and in a browser it is gone with the page unless
 *    it is downloaded — a present-tense question, but about a file rather than
 *    about what is in the document.
 * 4. **What waits for an answer** (M31 U1, D-367): the card settlements that
 *    count the month twice (D-160), the transfers, and everything else Home's
 *    list holds, as one count. Below the three above because they are about the
 *    document as a file and this is about what is in it.
 * 5. **A newer Emerald** (M42 U8, D-502), last, because it is about the app
 *    and not about anything open in it — and quiet: no dialog, nothing that
 *    takes focus, gone on Later until the next start or the next day's check.
 *
 * **One primary action across the region, and it belongs to the notice at the
 * top** — docs/11's rule about a screen's single primary action, applied to a
 * stack that can hold four of them. A lower notice keeps its leading verb and
 * loses the fill, so the eye is told where to start rather than offered four
 * equally loud answers.
 */

interface NoticeAction {
  readonly label: string
  readonly onClick: () => void
  readonly disabled?: boolean
  /** The choice that loses nothing. Filled, but only in the leading notice. */
  readonly lead?: boolean
  /** "Ignore", "Not now" — an exit rather than an answer. */
  readonly quiet?: boolean
}

interface Notice {
  readonly id: string
  readonly body: ReactNode
  readonly actions: readonly NoticeAction[]
}

export function Notices({
  offerResume,
}: {
  /**
   * False during onboarding and while the mapper has the window: onboarding is
   * a flow with its own way out (docs/06). The name is older than the notice it
   * gated — an import walked away from mid-review — which went with the review
   * screen in M28 U5 (D-313): nothing is staged before Write any more.
   */
  offerResume: boolean
}) {
  const conflict = useDiskConflictNotice()
  const pending = usePendingOpenNotice()
  const replacing = usePendingReplaceNotice()
  const failure = useErrorNotice()
  const kept = useKeptCopyNotice()
  // It reads the ledger's tables, which a document that keeps none has not
  // got (M25 U2).
  const keepsLedger = useKeepsLedger()
  const waiting = useWaitingNotice(offerResume && keepsLedger)
  const update = useUpdateNotice()

  // The array order *is* the ranking. Written out rather than sorted by a
  // number, because four fixed things in a fixed order is what this is.
  const notices = [conflict, pending, replacing, failure, kept, waiting, update].filter(
    (notice): notice is Notice => notice !== undefined,
  )

  if (notices.length === 0) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="shrink-0 divide-y divide-hairline border-b border-hairline bg-surface"
    >
      {notices.map((notice, index) => (
        <Row key={notice.id} notice={notice} leading={index === 0} />
      ))}
    </div>
  )
}

function Row({ notice, leading }: { notice: Notice; leading: boolean }) {
  return (
    <div className="fc-pop-enter flex flex-wrap items-center gap-x-4 gap-y-2 px-6 py-2 text-ink-secondary">
      {/* The same marker the dashboard's ranked list uses, so a stack of two
          reads as one list rather than as two unrelated bars. */}
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-ink" />
      <span className="min-w-0">{notice.body}</span>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {notice.actions.map((action) => (
          <Button
            key={action.label}
            size="sm"
            variant={
              action.quiet === true
                ? 'ghost'
                : action.lead === true && leading
                  ? 'primary'
                  : 'secondary'
            }
            onClick={action.onClick}
            disabled={action.disabled === true}
          >
            {action.label}
          </Button>
        ))}
      </div>
    </div>
  )
}

/**
 * "This file changed on disk." The visible half of D-092.
 *
 * The app holds the document in memory and writes it back whole, so anything
 * else that touched the file — a second window, a sync client, the Claude
 * plugin — is undone by the next Save unless the user is told. Save refuses
 * while this is true, which is why it leads the region.
 *
 * Two situations, and only one of them has a safe answer:
 *
 * - **Nothing unsaved here.** Reloading loses nothing, so it leads.
 * - **Unsaved work here too.** Neither reloading nor overwriting is lossless,
 *   so neither is offered as *the* answer: saving a copy leads, because it is
 *   the only choice that keeps both versions, and the other two say plainly
 *   what they discard. Doing the arithmetic for the user here would mean
 *   picking whose work to throw away.
 */
function useDiskConflictNotice(): Notice | undefined {
  const diskState = useDocumentStore((state) => state.diskState)
  const documentName = useDocumentStore((state) => state.documentName)
  const busy = useDocumentStore((state) => state.busy) !== undefined
  const save = useDocumentStore((state) => state.save)
  const reloadFromDisk = useDocumentStore((state) => state.reloadFromDisk)
  const saveCopyAs = useDocumentStore((state) => state.saveCopyAs)
  const dismiss = useDocumentStore((state) => state.dismissDiskState)

  if (diskState.kind === 'unwatched' || diskState.kind === 'in-sync') return undefined

  if (diskState.kind === 'unreadable') {
    return {
      id: 'unreadable',
      body: (
        <>
          <strong className="font-medium">{documentName}</strong> could not be read where it was —
          it may have been moved, renamed, or deleted. {diskState.reason}
        </>
      ),
      actions: [
        { label: 'Save as…', onClick: () => void saveCopyAs(), disabled: busy, lead: true },
        { label: 'Dismiss', onClick: dismiss, disabled: busy, quiet: true },
      ],
    }
  }

  if (diskState.hasUnsavedWork) {
    return {
      id: 'conflict',
      body: (
        <>
          <strong className="font-medium">{documentName}</strong> changed on disk since you opened
          it, and you have unsaved changes here. Saving would overwrite the newer file; reloading
          would discard your changes.
        </>
      ),
      actions: [
        { label: 'Save a copy…', onClick: () => void saveCopyAs(), disabled: busy, lead: true },
        { label: 'Discard mine, reload', onClick: () => void reloadFromDisk(), disabled: busy },
        {
          label: 'Overwrite the file',
          onClick: () => void save({ overwrite: true }),
          disabled: busy,
        },
      ],
    }
  }

  return {
    id: 'conflict',
    body: (
      <>
        <strong className="font-medium">{documentName}</strong> changed on disk since you opened it.
        Nothing here is unsaved, so reloading loses nothing.
      </>
    ),
    actions: [
      { label: 'Reload', onClick: () => void reloadFromDisk(), disabled: busy, lead: true },
      { label: 'Ignore', onClick: dismiss, disabled: busy, quiet: true },
    ],
  }
}

/**
 * **Where the copy from before is** (M34 U6, D-399). In the shell it is a file
 * among the document's earlier copies already (D-470), so the notice says its
 * name and opens the list; in a browser it is held in this page, and
 * downloading it is the one way it is kept.
 */
function useKeptCopyNotice(): Notice | undefined {
  const kept = useDocumentStore((state) => state.keptCopy)
  const download = useDocumentStore((state) => state.downloadKeptCopy)
  const dismiss = useDocumentStore((state) => state.dismissKeptCopy)

  if (kept === undefined) return undefined

  if (kept.where === 'earlier-copies') {
    return {
      id: 'kept-copy',
      body: (
        <>
          A copy from before <Bidi>{kept.what}</Bidi> is among this document’s earlier copies, as{' '}
          <strong className="font-medium">
            <Bidi>{kept.name}</Bidi>
          </strong>
          .
        </>
      ),
      actions: [
        { label: 'Earlier copies', onClick: openEarlierCopies },
        { label: 'Dismiss', onClick: dismiss, quiet: true },
      ],
    }
  }

  return {
    id: 'kept-copy',
    body: (
      <>
        A copy from before <Bidi>{kept.what}</Bidi> is held in this page until it closes. Download
        it to keep it.
      </>
    ),
    actions: [
      { label: 'Download it', onClick: download, lead: true },
      { label: 'Discard it', onClick: dismiss, quiet: true },
    ],
  }
}

/**
 * "Another document is waiting to open, and this one has unsaved work."
 *
 * The shell can hand the app a document at any moment — a double-click while
 * the app is already running, the File menu's Open Recent, a second launch
 * (D-128). Opening replaces everything in the window, so when there is unsaved
 * work the arrival becomes a question instead of an event.
 */
function usePendingOpenNotice(): Notice | undefined {
  const pendingOpen = useDocumentStore((state) => state.pendingOpen)
  const documentName = useDocumentStore((state) => state.documentName)
  const busy = useDocumentStore((state) => state.busy) !== undefined
  const save = useDocumentStore((state) => state.save)
  const openDocumentAt = useDocumentStore((state) => state.openDocumentAt)
  const dismiss = useDocumentStore((state) => state.dismissPendingOpen)

  if (pendingOpen === undefined) return undefined

  const saveThenOpen = async (): Promise<void> => {
    await save()
    // A save that refused — because the file changed underneath us — leaves the
    // conflict above this one, which is the notice to answer first.
    if (useDocumentStore.getState().isDirty) return
    await openDocumentAt(pendingOpen)
  }

  return {
    id: 'pending-open',
    body: (
      <>
        <strong className="font-medium">{fileName(pendingOpen)}</strong> is waiting to open, and{' '}
        <strong className="font-medium">{documentName}</strong> has unsaved changes. Opening it
        replaces what is in this window.
      </>
    ),
    actions: [
      { label: 'Save, then open', onClick: () => void saveThenOpen(), disabled: busy, lead: true },
      {
        label: 'Discard mine, open',
        onClick: () => void openDocumentAt(pendingOpen),
        disabled: busy,
      },
      { label: 'Stay here', onClick: dismiss, disabled: busy, quiet: true },
    ],
  }
}

/**
 * "untitled-2026-10.emd has unsaved changes." (M38 F1, U3) — New or Open…
 * asked for over unsaved work, held rather than obeyed, and answered like a
 * document waiting to open: save first, discard, or stay.
 */
function usePendingReplaceNotice(): Notice | undefined {
  const pending = useDocumentStore((state) => state.pendingReplace)
  const documentName = useDocumentStore((state) => state.documentName)
  const busy = useDocumentStore((state) => state.busy) !== undefined
  const save = useDocumentStore((state) => state.save)
  const createNew = useDocumentStore((state) => state.createNew)
  const openFile = useDocumentStore((state) => state.openFile)
  const dismiss = useDocumentStore((state) => state.dismissPendingReplace)

  if (pending === undefined) return undefined

  const replace = (): Promise<void> => (pending === 'new' ? createNew() : openFile())
  const saveThenReplace = async (): Promise<void> => {
    await save()
    // A save that refused or was cancelled leaves the work unsaved, and the
    // question standing.
    if (useDocumentStore.getState().isDirty) return
    await replace()
  }
  const word = pending === 'new' ? 'new' : 'open…'

  return {
    id: 'pending-replace',
    body: (
      <>
        <strong className="font-medium">{documentName}</strong> has unsaved changes.{' '}
        {pending === 'new' ? 'A new document' : 'Opening another document'} replaces what is in this
        window.
      </>
    ),
    actions: [
      { label: `Save, then ${word}`, onClick: () => void saveThenReplace(), disabled: busy, lead: true },
      { label: `Discard mine, ${word}`, onClick: () => void replace(), disabled: busy },
      { label: 'Stay here', onClick: dismiss, disabled: busy, quiet: true },
    ],
  }
}

/**
 * **A newer Emerald, or the answer to Check for Updates Now** (M42 U8, D-502). The shell asks and
 * decides; this only says it. Download opens the release page in the browser, and Later hides it
 * until the next start or the next day's check. A scheduled check that finds nothing says nothing.
 *
 * **On Windows with the setting on** (M42 U9, D-503) the shell downloads it first, and this says
 * `<version> is ready` with **Install and restart**, which closes the window the ordinary way —
 * the unsaved-work question included — and opens Emerald again on the document open now.
 */
function useUpdateNotice(): Notice | undefined {
  const state = useUpdateState()
  const updates = shellUpdates()
  const notice = state?.notice
  if (notice === undefined || updates === undefined) return undefined

  const later = (): void => void answer(updates.later())
  const install = updates.install

  switch (notice.kind) {
    case 'checking':
      return { id: 'update', body: <>Checking for a newer version of Emerald…</>, actions: [] }
    case 'available':
      return {
        id: 'update',
        body: (
          <>
            <strong className="font-medium">Emerald {notice.version}</strong> is out. You have {state?.version}.
            {notice.unfetched !== undefined && <> It could not be downloaded here: {notice.unfetched}</>}
          </>
        ),
        actions: [
          {
            label: 'Download',
            onClick: () => {
              void updates.openReleasePage()
              later()
            },
            lead: true,
          },
          { label: 'Later', onClick: later, quiet: true },
        ],
      }
    case 'downloading':
      return {
        id: 'update',
        body: <>Downloading Emerald {notice.version}…</>,
        actions: [{ label: 'Later', onClick: later, quiet: true }],
      }
    case 'ready':
      return {
        id: 'update',
        body: (
          <>
            <strong className="font-medium">Emerald {notice.version}</strong> is ready. Installing it restarts Emerald;
            your documents are not touched.
          </>
        ),
        actions: [
          ...(install === undefined
            ? []
            : [
                {
                  label: 'Install and restart',
                  onClick: () => {
                    // The document open now, to open again after; the shell takes only a path it handed out.
                    const { db, adapter } = useDocumentStore.getState()
                    void install(db === undefined ? undefined : adapter.location?.()).catch(() => undefined)
                  },
                  lead: true,
                },
              ]),
          { label: 'Later', onClick: later, quiet: true },
        ],
      }
    case 'latest':
      return {
        id: 'update',
        body: <>You have the latest — Emerald {notice.version}.</>,
        actions: [{ label: 'Dismiss', onClick: later, quiet: true }],
      }
    case 'failed':
      return {
        id: 'update',
        body: <>Could not check for updates. {notice.reason}</>,
        actions: [{ label: 'Dismiss', onClick: later, quiet: true }],
      }
  }
}

/** Whatever the document store last failed at, until it is dismissed. */
function useErrorNotice(): Notice | undefined {
  const error = useDocumentStore((state) => state.error)
  const dismissError = useDocumentStore((state) => state.dismissError)

  if (error === undefined || error === '') return undefined

  return {
    id: 'error',
    body: <span className="text-negative">{error}</span>,
    actions: [{ label: 'Dismiss', onClick: dismissError, quiet: true }],
  }
}

/**
 * "17 answers wait on Home, and 5 of them change this month's totals." (M31 U1, D-367)
 *
 * Two notices once — the card settlements (D-160) and the transfers (D-356) —
 * each a count pointing at the queue on the accounts screen, and nothing about
 * the other eight questions an import leaves. Now one, over everything Home's
 * *Waiting for an answer* lists, from the same call, so the bar and the list
 * cannot disagree. It points at the list and is not shown on Home, where the
 * list says the same a few lines lower.
 *
 * **"Not now" is a session, not a decision.** Nothing is written; it comes back
 * next time the document is opened — a permanently dismissible prompt for the
 * thing that doubles the month is how it got missed in the first place.
 */
function useWaitingNotice(offer: boolean): Notice | undefined {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const navigate = useNavigate()
  const onHome = useLocation().pathname === '/'
  const [dismissed, setDismissed] = useState(false)

  // Not read at all when not offered, or on Home: a document that keeps no
  // ledger has no tables for it to read (M25 U2), and Home reads it itself.
  const counts = useMemo(
    () => (db === undefined || !offer || onHome ? undefined : waitingCounts(waitingItems(db, today(), documentCurrency(db)))),
    [db, revision, offer, onHome],
  )

  if (counts === undefined || counts.all === 0 || dismissed) return undefined

  return {
    id: 'waiting',
    body: (
      <>
        <span className="tabular-nums">{counts.all}</span> {counts.all === 1 ? 'answer waits' : 'answers wait'} on Home
        {counts.totals > 0 ? (
          <>
            , and <span className="tabular-nums">{counts.totals}</span> of them {counts.totals === 1 ? 'changes' : 'change'} this month’s totals.
          </>
        ) : (
          '.'
        )}
      </>
    ),
    actions: [
      { label: 'Answer them', onClick: () => navigate('/'), lead: true },
      { label: 'Not now', onClick: () => setDismissed(true), quiet: true },
    ],
  }
}

/** Both separators, because a Windows path reaches this code as typed. */
function fileName(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut === -1 ? path : path.slice(cut + 1)
}
