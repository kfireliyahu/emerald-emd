import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'

import { SUPPORTED_EXTENSIONS } from '@/data/importer/sheetTable.ts'
import type { StatementSheet } from '@/data/importer/statementBatch.ts'
import { readSnapshot, clearSnapshot } from '@/data/storage/crashCache.ts'
import { shellDocuments } from '@/data/storage/desktop.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { batchFor, updateStatementBatch, useStatementBatch } from '@/state/statementBatch.ts'
import { CommandPalette } from '@/ui/CommandPalette.tsx'
import { EarlierCopies } from '@/ui/EarlierCopies.tsx'
import { About } from '@/ui/About.tsx'
import { watchClosing } from '@/ui/motion/closing.ts'
import { Notices } from '@/ui/Notices.tsx'
import { ScreenBoundary } from '@/ui/ScreenBoundary.tsx'
import { Sidebar } from '@/ui/Sidebar.tsx'
import { ReadingBar } from '@/ui/components/ReadingBar.tsx'
import { useWindowTaken } from '@/ui/useFullWindow.ts'
import { toggleSidebar } from '@/ui/useSidebar.ts'
import { TitleBar } from '@/ui/TitleBar.tsx'
import { MapperScreen } from '@/ui/import/MapperScreen.tsx'
import { useWindowFileDrop } from '@/ui/import/useWindowFileDrop.ts'
import { Button } from '@/ui/components/Button.tsx'
import { useKeepsLedger } from '@/ui/packs.ts'
import { installLedgerPack } from '@/data/packs/ledger/pack.ts'
import { NoLedger } from '@/ui/screens/NoLedger.tsx'
import { DASHBOARD_PATH, packOf } from '@/ui/nav.ts'
import { Guide } from '@/ui/guide/Guide.tsx'
import { Accounts } from '@/ui/screens/Accounts.tsx'
import { Categories } from '@/ui/screens/Categories.tsx'
import { ByMerchant } from '@/ui/screens/ByMerchant.tsx'
import { DebtDetail } from '@/ui/screens/DebtDetail.tsx'
import { Debts } from '@/ui/screens/Debts.tsx'
import { DeductionTypes } from '@/ui/screens/DeductionTypes.tsx'
import { Agenda } from '@/ui/screens/Agenda.tsx'
import { DocumentDashboard } from '@/ui/screens/Dashboard.tsx'
import { Connections } from '@/ui/screens/Connections.tsx'
import { Mcp } from '@/ui/screens/Mcp.tsx'
import { DeclaredFormats } from '@/ui/screens/DeclaredFormats.tsx'
import { FormatRows } from '@/ui/screens/FormatRows.tsx'
import { FormatPage, FormatReady, FormatRoadmap } from '@/ui/screens/FormatLinkViews.tsx'
import { ReadFiles } from '@/ui/screens/ReadFiles.tsx'
import { Plan } from '@/ui/screens/Plan.tsx'
import { ReadSlips } from '@/ui/paychecks/ReadSlips.tsx'
import { SlipBatchBar } from '@/ui/paychecks/SlipBatchBar.tsx'
import { ReadFilesBar } from '@/ui/import/ReadFilesBar.tsx'
import { FundDetail } from '@/ui/screens/FundDetail.tsx'
import { Funds } from '@/ui/screens/Funds.tsx'
import { GoalDetail } from '@/ui/screens/GoalDetail.tsx'
import { Export } from '@/ui/screens/Export.tsx'
import { FileGap } from '@/ui/screens/FileGap.tsx'
import { Home } from '@/ui/screens/Home.tsx'
import { HomeShell } from '@/ui/screens/HomeShell.tsx'
import { ListDetail, screenOf } from '@/ui/screens/ListDetail.tsx'
import { LocalModel } from '@/ui/screens/LocalModel.tsx'
import { Readers } from '@/ui/screens/Readers.tsx'
import { Overview } from '@/ui/screens/Overview.tsx'
import { Paychecks } from '@/ui/screens/Paychecks.tsx'
import { ReadStatements } from '@/ui/screens/ReadStatements.tsx'
import { Packs } from '@/ui/screens/Packs.tsx'
import { Rules } from '@/ui/screens/Rules.tsx'
import { Goals } from '@/ui/screens/Goals.tsx'
import { Section } from '@/ui/screens/Section.tsx'
import { Transactions } from '@/ui/screens/Transactions.tsx'
import { Year } from '@/ui/screens/Year.tsx'
import { addStatementFiles, readWaitingLayouts } from '@/ui/home/statementIntake.ts'
import { isDemo } from '@/ui/edition.ts'
import { useAutoSave } from '@/ui/useAutoSave.ts'
import { useDiskWatch } from '@/ui/useDiskWatch.ts'
import { useSaveShortcuts } from '@/ui/useSaveShortcuts.ts'
import { useShellCommands } from '@/ui/useShellCommands.ts'

export function App() {
  const navigate = useNavigate()

  const db = useDocumentStore((state) => state.db)

  useDocumentFile()

  // Closing a window, panel or dialog fades, app-wide (M39 U3): one watcher
  // for the whole page, so no screen wires it.
  useEffect(() => watchClosing(document.body), [])

  // Only in a document that keeps a ledger: the window-wide drop is the pack's.
  const ledger = useKeepsLedger()
  const batch = batchFor(useStatementBatch(), db)

  /**
   * **Files are read on Home** (M28 U5): dropped anywhere, picked from the
   * palette, any number — each into the batch on `#/read`, where it is judged
   * and nothing is written until Write.
   */
  const readNow = useCallback(
    (files: readonly File[]): void => {
      if (db === undefined || files.length === 0) return
      navigate('/read')
      void addStatementFiles(db, files)
    },
    [db, navigate],
  )

  /**
   * **A statement dropped on a document without the ledger is offered one**
   * (M31 U2). The window-wide drop is the ledger's (M20 U0, D-227), and it used
   * to do nothing at all in a document that keeps none — the engine reads a
   * document *onto a format it declares*, from that format's own screen
   * (D-226). Now the files wait while the window asks whether to keep a ledger
   * here, and are read the moment it does. Held in this component and nowhere
   * else: a person who says no has lost nothing, and nothing is stored.
   */
  const [held, setHeld] = useState<readonly File[] | undefined>(undefined)
  useEffect(() => setHeld(undefined), [db])
  const readFiles = useCallback(
    (files: readonly File[]): void => {
      if (db === undefined || files.length === 0) return
      if (ledger) readNow(files)
      else setHeld(files)
    },
    [db, ledger, readNow],
  )

  // The hook stays wired in every document: without its `dragover` the browser
  // navigates to the dropped file and the app is gone.
  const dragging = useWindowFileDrop(readFiles)
  const isDraggingFile = dragging && db !== undefined

  /**
   * What the mapper hands back: the sheet takes the new layout's place in the
   * batch on Read files and goes back there. Since onboarding went (M28 U9) the
   * batch is the only way a file reaches the mapper.
   */
  const mapped = (sheet: StatementSheet): void => {
    const request = batch.mapping
    if (request === undefined || db === undefined) return
    // And every file still waiting that the reader just drawn now fits (M28 F15).
    updateStatementBatch(db, (state) =>
      readWaitingLayouts(db, {
        ...state,
        mapping: undefined,
        files: state.files.flatMap((file) =>
          file.id === request.id ? [{ kind: 'sheet' as const, id: sheet.id, fileName: file.fileName, sheet }] : [file],
        ),
      }),
    )
    navigate('/read')
  }
  const mapper =
    batch.mapping !== undefined
      ? { key: batch.mapping.id, workbook: batch.mapping.workbook, fileHash: batch.mapping.fileHash }
      : undefined

  useSidebarShortcut()

  /**
   * The one file input the palette's "Import a statement…" reaches.
   *
   * A file button is a `<label>` wrapping its own input, which is right for a
   * button and useless to a command: a command has no label to click. This is
   * the same native control, opened by name.
   */
  const picker = useRef<HTMLInputElement>(null)

  /**
   * The nav shows only when there is a document and nothing is in the way.
   * Navigating mid-review would strand staged rows behind a screen with no way
   * back — docs/06 puts the import outside the tabs, and the sidebar inherits
   * that rule rather than restating it (D-130).
   *
   * **`taken` is the same rule, said by a routed screen** (D-163): a reading
   * being transcribed off a report is as much a flow with its own way out as
   * the import is, and until `FlowFrame` existed there was no way for one to
   * say so. `App` does not know or care which flow it is.
   */
  const taken = useWindowTaken()
  const navigable = db !== undefined && mapper === undefined && !taken

  return (
    // `overflow-clip`, not `hidden` (M31 U9): whatever pokes past the window — a
    // screen's entrance, a long rail — is cut off rather than making the page
    // itself scrollable, so a wheel at the end of a list never scrolls the whole
    // app into the white below it, and a clip is no scroller for `scrollIntoView`.
    <div className="flex h-screen flex-col overflow-clip bg-background text-ink">
      {/* The document, across the top: the window's title bar in the shell and
          the same row without a drag region in a browser tab (D-130). */}
      <TitleBar />

      <div className="flex min-h-0 flex-1">
        <Sidebar navigable={navigable} />

        <div className="flex min-w-0 min-h-0 flex-1 flex-col">
          {/* One region for all four of them, ordered by consequence (D-130). */}
          <Notices offerResume={navigable} />

          {/* Inside `main` and outside nothing else: a screen that throws
              leaves the title bar and the sidebar working, which is what makes
              "save a copy" a way out rather than a suggestion (D-116). */}
          <main className="min-h-0 flex-1">
            <ScreenBoundary>
              {mapper !== undefined && (
                <MapperScreen
                  key={mapper.key}
                  workbook={mapper.workbook}
                  fileHash={mapper.fileHash}
                  onDone={() => {
                    if (batch.mapping !== undefined) updateStatementBatch(db, (state) => ({ ...state, mapping: undefined }))
                  }}
                  onRead={mapped}
                />
              )}

              {mapper === undefined &&
                (db === undefined ? (
                  isDemo() ? <DemoOpening /> : <EmptyDocument />
                ) : held !== undefined && !ledger ? (
                  <NoLedger
                    waiting={{
                      files: held,
                      read: () => {
                        setHeld(undefined)
                        readNow(held)
                      },
                      leave: () => setHeld(undefined),
                    }}
                  />
                ) : (
                  <RoutedViews />
                ))}
            </ScreenBoundary>
          </main>

          {/* The read that outlived the screen that started it (D-171). At the
              foot, under the screen rather than over it: it is a thing still
              happening, not a thing to answer. */}
          <ReadingBar />
          {/* And the batch of payslips, which outlives its screen the same way
              (M28 F1). */}
          <SlipBatchBar />
          {/* And the statements on Read files, closed with files still on it
              (M28 F14): nothing is written until Write, so they wait here. */}
          <ReadFilesBar />
        </div>
      </div>

      {/* Guide me (M28 U9, D-330): beside a place on whichever screen is showing,
          and only while nothing else has the window. */}
      <Guide enabled={navigable && ledger} />

      <CommandPalette onImportStatement={() => picker.current?.click()} />
      {/* File › Earlier copies of this document (M45 U4, D-455): the shell's only. */}
      <EarlierCopies />
      {/* Help › About Emerald (M45 F3, D-457): the shell's only. */}
      <About />
      <input
        ref={picker}
        type="file"
        multiple
        accept={[...SUPPORTED_EXTENSIONS, '.pdf', '.txt'].join(',')}
        className="sr-only"
        onChange={(event) => {
          readFiles(Array.from(event.target.files ?? []))
          // Reset, so re-picking the same file after a change still fires.
          event.target.value = ''
        }}
      />

      {isDraggingFile && (
        // pointer-events-none, or this swallows the dragleave and drop it exists to announce.
        <div data-motion-close className="fc-view-enter pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/80">
          <div className="rounded border-2 border-dashed border-ink px-12 py-8 text-lg">
            Drop statements, payslips and fund reports, any number
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The document's way in and out of a file: `Ctrl/Cmd+S`, the close guard and
 * the crash snapshot, the watch on the file, auto-save, the shell's File menu
 * and the offer to restore unsaved work.
 *
 * **None of it in the demo** (M33 U1, D-413): a visitor has no file, and a
 * frame inside somebody else's page that asked about unsaved work on leaving,
 * or wrote a snapshot to storage it may not have, would be asking about
 * nobody's. Chosen once, by the build, so no hook is ever called conditionally.
 */
const useDocumentFile: () => void = isDemo()
  ? () => undefined
  : () => {
      useSaveShortcuts()
      useDiskWatch()
      // The other half of the same decision: one notices the file changing
      // underneath us, the other writes to it (D-155, D-127).
      useAutoSave()
      useShellCommands()
      useCrashRecovery()
    }

/**
 * The demo before its document is open, or when it could not be (M33 U1).
 * There is nothing to make and nothing to pick: the demo opens one document.
 */
function DemoOpening() {
  const error = useDocumentStore((state) => state.error)
  return (
    <div className="fc-view-enter mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-ink-secondary">{error ?? 'Opening the demo…'}</p>
    </div>
  )
}

/**
 * `Ctrl/Cmd+B` collapses the sidebar to its icons (D-130).
 *
 * The shell's View menu shows the same key but does not register it
 * (`registerAccelerator: false` in `electron/menu.ts`), so there is one handler
 * rather than two racing to toggle the same boolean back and forth.
 */
function useSidebarShortcut(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      if (event.key.toLowerCase() !== 'b') return
      event.preventDefault()
      toggleSidebar()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

/**
 * Offer the crash snapshot back when it is newer than anything on screen.
 *
 * Never restores silently: the snapshot may be from a session the user
 * deliberately abandoned, and nothing is auto-anything in this app.
 */
function useCrashRecovery(): void {
  const openBytes = useDocumentStore((state) => state.openBytes)
  const db = useDocumentStore((state) => state.db)
  const [asked, setAsked] = useState(false)

  useEffect(() => {
    if (asked || db !== undefined) return
    setAsked(true)

    const snapshot = readSnapshot()
    if (snapshot === undefined) return

    const when = new Date(snapshot.savedAt).toLocaleString()
    if (window.confirm(`Unsaved work from ${when} was found. Restore it?`)) {
      void openBytes(snapshot.bytes, snapshot.documentName)
    } else {
      clearSnapshot()
    }
  }, [asked, db, openBytes])
}

/**
 * The routed screens, each keyed on its screen so switching tabs replays the
 * view fade rather than diffing one screen into the next. **A screen, not an
 * address** (M39 U3): a list's detail pane has an address of its own
 * (`#/wealth/funds/3`) and is the same screen with its pane open, so opening it
 * keeps the list where it was and only the pane arrives (`screenOf`).
 */
function RoutedViews() {
  const location = useLocation()
  const keepsLedger = useKeepsLedger()
  // **A ledger screen in a document that keeps no ledger** (M25 U2): its
  // tables are not there to read, so the screen is not drawn. The root is the
  // exception — it is the engine's landing then, and redirects rather than
  // reads.
  const guarded = packOf(location.pathname) === 'ledger' && location.pathname !== '/'
  if (guarded && !keepsLedger) return <NoLedger />
  return (
    // Navigating is a 150 ms fade of the content area and nothing else — no
    // rise, so nothing on the new screen is anywhere but where it stays (M39).
    <div key={screenOf(location.pathname)} data-route={location.pathname} className="fc-view-enter h-full">
      <Routes location={location}>
        {/* **Home is the root now**, which is what docs/06 has specified since
            it was written and what M6's last line is. The ledger moves to
            `/transactions` and keeps working at `/` — an unknown hash and a
            stale bookmark both land somewhere sensible, and every drill-through
            that used to `navigate('/', { state })` now names the ledger
            explicitly rather than relying on it being the root (D-108). */}
        {/* **Home is the whole of Insights now** (D-157). The month was on two
            screens reading the same `monthlyReport`, so it is on one, and the
            year and trends are two more periods of it behind a control on the
            screen rather than a section of their own. `HomeShell` is the period
            control and an outlet; the three views are its children. */}
        {/* **In a document that keeps no ledger, the root is the engine's**
            (M20 U0, D-227; the document decides since M25 U8). `Home` is the
            pack's month, and a document with no ledger has no month to show —
            and only the *index* moves: `#/year` and `#/trends` land on the
            ledger's own "keeps no ledger" screen, like every other route of it. */}
        <Route path="/" element={<HomeShell />}>
          <Route index element={<LandingScreen />} />
          <Route path="year" element={<Year />} />
          {/* **Trends is the year's now** (M28 U5, D-313): its three parts —
              each category over time, the merchants, the same month a year
              apart — are Year's, and a path that ever worked keeps working. */}
          <Route path="trends" element={<Navigate to="/year" replace />} />
          {/* **Reading files is the month's** (M28 U5): statements read and
              judged, written with Write; a file that does not add up is shown
              its gap one level down. */}
          <Route path="read" element={<ReadStatements />} />
          {/* **Every reader in one list, beside the files they read** (M36 U10):
              a statement's, a payslip's and a fund report's were three places. */}
          <Route path="read/readers" element={<Readers />} />
          <Route path="read/:id" element={<FileGap />} />
        </Route>
        {/* Insights was a section for four milestones and every one of its
            hashes is bookmarkable. Same call D-031 made for `/settings/mappings`
            and D-089 made for `#/insights`: a path that ever worked keeps
            working, and `#/insights/month` lands on the screen that is now the
            month rather than on a 404. */}
        <Route path="/insights" element={<Navigate to="/" replace />} />
        <Route path="/insights/month" element={<Navigate to="/" replace />} />
        <Route path="/insights/year" element={<Navigate to="/year" replace />} />
        <Route path="/insights/trends" element={<Navigate to="/trends" replace />} />
        {/* A statement's readers were a tab of the transactions they read
            (M28 U3); they are in Home's one Readers list since M36 U10. */}
        <Route path="/transactions" element={<Section />}>
          <Route index element={<Transactions />} />
          {/* **By merchant is the other view of this one page** (M28 U6, D-315):
              it was `#/categorize`, an operation reached from a count. */}
          <Route path="merchants" element={<ByMerchant />} />
          <Route path="readers" element={<Navigate to="/read/readers" replace />} />
        </Route>
        {/* **Paychecks is top level** (D-157): a payslip is intake, and Plan is
            what you do once intake is done. It was `#/plan/paychecks` for three
            milestones — and `#/paychecks` before that, which redirected here,
            so the redirect simply turns round. */}
        {/* **And deduction types are a view of it, not a setting** (D-170).
            The payroll vocabulary decides what every figure on a slip means and
            is the only way into the deduction-to-fund link, and it spent four
            milestones as the sixth child of the last section in the rail. */}
        <Route path="/paychecks" element={<Section />}>
          <Route index element={<Paychecks />} />
          {/* The payroll vocabulary, a view of payroll rather than a setting
              (D-170). It was `<Navigate>`-ing to itself until D-193 — the
              redirect and the screen had been swapped between this block and
              Settings, so the tab in the rail rendered the strip and nothing
              under it. */}
          <Route path="deductions" element={<DeductionTypes />} />
          {/* M17's view, one month followed from the slip to where it sits
              (D-193), is half of the month on Paychecks since M28 U4; a path
              that ever worked keeps working. */}
          <Route path="trace" element={<Navigate to="/paychecks" replace />} />
          {/* **A stack of slips read in one go** (M28 U3), and the readers that
              read them, beside the slips rather than in Settings (D-292 kept
              them there until M28). */}
          <Route path="read" element={<ReadSlips />} />
          <Route path="readers" element={<Navigate to="/read/readers" replace />} />
        </Route>
        <Route path="/plan/paychecks" element={<Navigate to="/paychecks" replace />} />
        {/* An operation rather than a place, so it is not in the nav (the same
            call D-045 made about re-apply). It is reached from the ledger's
            uncategorized count and from the getting-started checklist — both of
            which are where the user is standing when they want it. */}
        <Route path="/categorize" element={<Navigate to="/transactions/merchants" replace />} />
        {/* **Plan** is the section docs/06 files paychecks under, and building it
            is the answer to D-044: sections with sub-navs, not the sidebar
            (D-054). The top nav gets shorter by gaining a screen. */}
        <Route path="/plan" element={<Plan />} />
        {/* Fixed expenses and the splitter were two pages of it (M28 U7, D-319);
            a bookmark to either lands on the one page they became. */}
        <Route path="/plan/fixed" element={<Navigate to="/plan" replace />} />
        <Route path="/plan/splitter" element={<Navigate to="/plan" replace />} />
        {/* **Wealth is a shell now**, which is the promotion D-068 deferred and
            D-071 deferred again: fee impact and the deposit check are the first
            genuine *siblings* of the funds list, and D-054's rule is that a
            section becomes a sub-nav the day it has a second sub-page. F07's
            savings and F08's debts are tabs of it. The fund detail stays a child
            of the funds tab, because it is a screen *of* a fund. */}
        <Route path="/wealth" element={<Section />}>
          {/* Savings leads, which is what the sidebar has said since D-086 and
              what the index did not do until D-157. */}
          <Route index element={<Overview />} />
          {/* **List and detail in one window** (D-130): the detail is a child
              route rather than a sibling, so the list stays mounted beside it
              and the hash is the one it always was. `ListDetail` is what draws
              the two, and draws only the list when no child is matched. */}
          <Route path="funds" element={<ListDetail><Funds /></ListDetail>}>
            <Route path=":fundId" element={<FundDetail />} />
          </Route>
          {/* Savings leads the section now: goals are what most people come
              here for, and funds are the part they cannot do anything about
              this month. The goal detail is a child of the savings tab for the
              reason the fund detail is a child of the funds tab. */}
          <Route path="goals" element={<ListDetail overlay><Goals /></ListDetail>}>
            <Route path=":goalId" element={<GoalDetail />} />
          </Route>
          {/* Debts sit beside savings rather than under funds: they are the
              other half of "what do I own and owe", and the detail is a child
              of the tab for the reason the fund and goal details are. */}
          <Route path="debts" element={<ListDetail><Debts /></ListDetail>}>
            <Route path=":debtId" element={<DebtDetail />} />
          </Route>
          {/* Net worth is the two of them subtracted, so it sits after both
              rather than leading the section: it is the answer, and the answer
              means nothing until there is something on each side of it. */}
          <Route path="worth" element={<Navigate to="/wealth" replace />} />
          <Route path="places" element={<Navigate to="/wealth" replace />} />
          <Route path="fees" element={<Funds />} />
          {/* The deposit check is a section of Funds (M36 U10), as fee impact is:
              the path opens Funds with it open. */}
          <Route path="deposits" element={<Funds />} />
          <Route path="readers" element={<Navigate to="/read/readers" replace />} />
        </Route>
        {/* **Rules sit beside the categories they fill** (M36 U10): nine links
            sent people to Settings for them. */}
        <Route path="/categories" element={<Section />}>
          <Route index element={<Categories />} />
          <Route path="rules" element={<Rules />} />
        </Route>
        {/* The engine, beside the app and touching none of it (D-214, D-216).
            The ledger's Readers list (`/read/readers`) is a different
            thing — F17's stored reading templates. */}
        <Route path="/formats" element={<DeclaredFormats />} />
        {/* **A format's name is a place** (M20 U1, D-227): its rows are here,
            and it is a child of Formats in the rail. The route carries the
            format's *name* and not its table name — a declaration names
            declarations, and a URL that had to spell `fmt_` would be a URL
            about storage (D-216). */}
        <Route path="/formats/:name" element={<FormatRows />} />
        {/* **One entry, the one view of a row** (M26 U6, D-294; M35 U2, D-401):
            on the same screen as the sheet, and `new` for one not written yet. */}
        <Route path="/formats/:name/entry/:entry" element={<FormatRows />} />
        {/* **A board** (M27 U3, D-301): the rows as cards in lanes, one per
            member of an enum — a view the engine draws for any format with one. */}
        <Route path="/formats/:name/board" element={<FormatRows board />} />
        {/* **A list** (M53 U4, D-519): one line per row, a tick, grouped by a
            column, and quick add — every format has one. */}
        <Route path="/formats/:name/list" element={<FormatRows list />} />
        {/* **A format's dashboard** (M53 U7, D-521): the last tab of its strip. */}
        <Route path="/formats/:name/dashboard" element={<FormatRows dashboard />} />
        {/* **A roadmap** (M27 U4, D-302): rows in order with what names each. */}
        <Route path="/formats/:name/roadmap" element={<FormatRoadmap />} />
        {/* **What is ready** (M27 U5, D-303): rows waiting on nothing open. */}
        <Route path="/formats/:name/ready" element={<FormatReady />} />
        {/* A row's page is its entry (M35 U2, D-401); kept so old links land. */}
        <Route path="/formats/:name/page/:entry" element={<FormatPage />} />
        {/* Reading files onto a format, each by the reader that fits it (M26 U5). */}
        <Route path="/formats/:name/read" element={<ReadFiles />} />
        {/* **The third arrow, as a place** (M20 U5, D-233): the graph across
            formats, where a `link` and an aggregate are authored between two
            bubbles rather than in a section of a form about one. */}
        {/* **The document's dashboard** (M53 U7, D-521): blocks from any format;
            `#/` itself in a document with no ledger. */}
        <Route path="/dashboard" element={<DocumentDashboard />} />
        <Route path="/connections" element={<Connections />} />
        {/* **The agenda** (M49 U3, D-473): every dated format's rows from
            today, grouped by day, and what is overdue above it. */}
        <Route path="/agenda" element={<Agenda />} />
        {/* What an assistant can do here, and the snippet to connect one
            (M26 U7, D-295). In the rail, not under Settings. */}
        <Route path="/mcp" element={<Mcp />} />
        {/* A shell with a sub-nav, now that F12 has given settings a second
            section. `/settings/mappings` was the statement readers for a year
            (D-031) and redirects to where they went in M28 U3; `/settings` lands
            on Accounts. */}
        <Route path="/settings" element={<Section />}>
          <Route index element={<SettingsHome />} />
          {/* Where a document takes the ledger on (M25 U8). Not behind the
              ledger it adds, for the obvious reason. */}
          <Route path="packs" element={<Packs />} />
          <Route path="accounts" element={<Accounts />} />
          {/* Where the ledger's readers lived until M28: a path that ever
              worked keeps working. */}
          <Route path="mappings" element={<Navigate to="/read/readers" replace />} />
          <Route path="formats" element={<Navigate to="/read/readers" replace />} />
          <Route path="rules" element={<Navigate to="/categories/rules" replace />} />
          {/* Where the payroll vocabulary lived until D-170. A path that ever
              worked keeps working, and this one is in four screens' worth of
              prose. */}
          <Route path="deductions" element={<Navigate to="/paychecks/deductions" replace />} />
          {/* M10. Off by default and inert until asked: the screen opens having
              looked at nothing (D-134). */}
          <Route path="model" element={<LocalModel />} />
          {/* The months' CSV left Home for here (M28 U5, D-313). */}
          <Route path="export" element={<Export />} />
        </Route>
        {/* An unknown hash is a typo or a stale bookmark, not an error page. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

/**
 * Where a document lands — the pack's month when it keeps a ledger, and the
 * engine's formats when it does not (M20 U0, D-227; M25 U8).
 *
 * A component rather than a ternary in the route table, so the redirect is
 * re-decided when the document changes rather than at the moment the router
 * was built.
 */
function LandingScreen() {
  // Keyed by the location: a `Navigate` redirects once, when it mounts, and a
  // way back to `/` while the last redirect was still loading `/formats` keeps
  // this same one mounted — which left the demo on a blank root (M33 U2).
  const at = useLocation().key
  // **Without a ledger, `#/` is the document's dashboard** (M53 U7, D-521);
  // it was Formats until then. With one, Home stays the root.
  return useKeepsLedger() ? <Home /> : <Navigate key={at} to={DASHBOARD_PATH} replace />
}

/**
 * `#/settings` on its own. Mappings for a year of commits (D-031), and Packs
 * when the screen mappings is about is not being shown.
 */
function SettingsHome() {
  return <Navigate to={useKeepsLedger() ? '/settings/accounts' : '/settings/packs'} replace />
}

/**
 * The front door — M20 U0 (D-227).
 *
 * **It stopped saying "Your finances live in a file you own."** That sentence
 * was true of the app for eighteen milestones and it is now true of one pack of
 * it: the first thing a person reads should be what this is, and what this is
 * is a document that holds whatever kinds of thing you have described to it.
 * The finance app is one of those, shown when the open document keeps it
 * (D-266).
 *
 * What survives verbatim is the half the sentence was actually carrying —
 * *nothing is uploaded and there is no account to make* — because that is the
 * claim the whole design is built to keep (D-124) and it belongs on the first
 * screen.
 *
 * **The ledger is at the front door** (M25 U8): `New ledger` is a new document
 * that keeps one, which is the only way a document gets the pack's tables
 * besides asking for them from a ledger screen (D-266). It opens on Home, where
 * the guide offers to walk an untouched ledger (M28 U9, D-330).
 */
function EmptyDocument() {
  const createNew = useDocumentStore((state) => state.createNew)
  const mutate = useDocumentStore((state) => state.mutate)
  const navigate = useNavigate()

  const newLedger = async (): Promise<void> => {
    await createNew()
    // The root decided on the new, empty document before the pack was in it.
    navigate('/', { replace: true })
    try {
      mutate((db) => {
        const installed = installLedgerPack(db, Date.now())
        if (!installed.ok) throw new Error(installed.error)
      })
    } catch (error) {
      useDocumentStore.setState({ error: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <div className="fc-view-enter mx-auto flex h-full max-w-md flex-col items-center justify-center gap-5 px-6 text-center">
      <p className="text-title">A document of your own, in your own shapes.</p>
      <p className="text-ink-secondary">
        Everything happens here: nothing is uploaded, and there is no account to make.
      </p>
      {/* **Which button keeps money, said plainly** (M31 U2). Two buttons and a
          paragraph about columns left a person with a bank statement guessing,
          and the wrong guess was a document their statement could not go into. */}
      <div className="grid w-full grid-cols-2 gap-3 text-left">
        <div className="flex flex-col gap-2 border border-hairline p-4">
          <Button variant="primary" onClick={() => void createNew()}>
            New document
          </Button>
          <span className="text-caption text-ink-secondary">
            For any kind of thing but money: describe it once — its columns, what it claims — and
            it is kept true.
          </span>
        </div>
        <div className="flex flex-col gap-2 border border-hairline p-4">
          <Button variant="secondary" onClick={() => void newLedger()}>
            New ledger
          </Button>
          <span className="text-caption text-ink-secondary">
            For your money: drop a card or bank statement and it becomes your months.
          </span>
        </div>
      </div>
      <RecentDocuments />
    </div>
  )
}

/**
 * The documents this person has opened before (D-128).
 *
 * The shell's File menu has the same list, and this is where a person actually
 * is when they need it — looking at an app with no document in it. Empty
 * outside the shell, and on a first run, so it renders nothing rather than an
 * empty heading.
 */
function RecentDocuments() {
  const [recents, setRecents] = useState<readonly { path: string; name: string }[]>([])
  const requestOpen = useDocumentStore((state) => state.requestOpen)

  useEffect(() => {
    let live = true
    void shellDocuments()
      ?.recents()
      .then((found) => {
        if (live) setRecents(found)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])

  if (recents.length === 0) return null

  return (
    <div className="flex w-full flex-col items-center gap-1 border-t border-hairline pt-5">
      <p className="text-caption text-ink-tertiary">Recent</p>
      {recents.map((entry) => (
        <button
          key={entry.path}
          type="button"
          onClick={() => void requestOpen(entry.path)}
          title={entry.path}
          className="max-w-full truncate rounded px-2 py-1 text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {entry.name}
        </button>
      ))}
    </div>
  )
}
