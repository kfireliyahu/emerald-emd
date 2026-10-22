import { readdirSync, readFileSync, statSync } from 'node:fs'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'

import { createServer } from './plugin/server.ts'

/**
 * **The parity audit** — M20 U6 (D-234).
 *
 * The rule, from M20 on: ***anything a person can do on a screen, a
 * conversation can do too.*** M19 proved the two halves drift — the editor could
 * change a declaration and `declare_format` could not, the plugin could write a
 * row and no screen could — each defensible on its own and incoherent together,
 * which is most of what D-227 was about.
 *
 * This file is that rule made **checkable rather than promised**, in the same
 * sense `format/boundary.test.ts` made *the engine touches none of the pack*
 * checkable (D-221): a prose rule nobody runs is a rule that has already been
 * broken somewhere.
 *
 * ## What makes counting possible at all
 *
 * **Both halves write through the same functions.** A screen writes inside
 * `mutate(...)` and a tool writes inside `mutatingCall(...)`, and neither holds a
 * line of SQL — every change to a document goes through a repository function,
 * and the last test below is what keeps that true. So the engine's
 * *capabilities* can be derived instead of listed: whatever writes, writes
 * through one of those functions, and every one of them has to be named here.
 *
 * A new one is therefore a **failing test** until somebody says which screen and
 * which tool reach it, which is the whole mechanism. The inventory below is not
 * a list somebody remembers to update; it is the thing the derivation is
 * compared against.
 *
 * ## What it covers, and what it does not
 *
 * **The engine only.** The ledger pack is parked (D-265), and what a
 * conversation may do to *it* is already pinned from the other side, by the
 * "Not here" section of the plugin's instructions and the test over it in
 * `plugin/server.test.ts`. M20's rule is the engine's, from M20 on.
 *
 * **Writes only.** A read that exists on one side and not the other is a real
 * break — U5 found one and D-234 fixed it — but it is not countable this way:
 * reads fan out into a dozen helpers per screen and the derivation would name
 * them all. What changes a document is the surface worth counting, and it is
 * where every drift so far has been.
 *
 * ## What it found
 *
 * Six one-sided capabilities when it was written: five with no tool, and one — a
 * unit, which is a row in the document — with no screen, which is the rule
 * cutting the other way. **Two of the five were U7's and are closed** (D-235).
 * A gap carries its reason and the proof that it is still open, so the day one
 * closes this file goes red and says so — which is exactly how those two came
 * off the list.
 *
 * ## Lopsided, since M24 U0 (D-249, D-251)
 *
 * **The tool half is mandatory and the screen half is owed.** Tools come first
 * and every screen waits for M26, so the two halves stopped being symmetric:
 *
 * - **A capability with a screen and no tool** still needs a hand-written gap,
 *   and the gap must now say who answers it — **owed by M24**, or **refused** by
 *   a decision that exists. Nothing waits on a milestone nobody is building.
 * - **A capability with a tool and no screen** writes no gap at all. It is a
 *   **screen trail**, derived here and exported to `docs/parity.md`, which is
 *   where M26 reads its scope — and its proof is the same *nobody on that side
 *   reaches it*, so it goes red the day a screen lands.
 * - **The ledger is counted too**, derived rather than listed: every write in a
 *   ledger repository and which halves reach it. It was never symmetric — most of
 *   it is screen-only, which the plugin's "Not here" section has said since
 *   D-109 — so what it gets is a ratchet: the writes with no tool may only get
 *   fewer, and the writes with both halves have to keep them.
 *
 * **And a proof follows imports now** (`M22 U6 #2`). It used to grep `ui/` and
 * `plugin/` for the call, and U6 reached `applyParts` from
 * `data/storage/encoding.ts`, one file further out — so a gap held while the
 * claim under it stopped being true. `reachIndex` below is the fix.
 */

/** Where a capability is done. A path under `src/`, or nothing. */
type Screen = string | undefined

/** The tool that does it, by the name a conversation calls. */
type Tool = string | undefined

/**
 * How the audit knows a missing half is still missing.
 *
 * Absence is the assertion that keeps a gap honest — the same trick the
 * instructions test plays on the "Not here" section, where every screen the
 * prose calls app-only must have no tool. A gap with no proof is a sentence
 * somebody wrote once.
 */
type Proof =
  /** Neither surface file mentions the write. The plainest kind. */
  | { readonly kind: 'NOBODY ON THAT SIDE CALLS IT' }
  /**
   * The write is shared with a capability that *is* paired, so its absence
   * cannot be seen in a call graph — `adoptFormat` both creates and alters. What
   * proves the gap is then the sentence the tool itself tells a caller.
   */
  | { readonly kind: 'THE TOOL SAYS SO'; readonly tool: string; readonly phrase: string }

/**
 * Who answers a missing tool (D-251). A gap that only explains itself can sit
 * forever; one that names the milestone building it, or the decision refusing
 * it, cannot.
 */
type Answer =
  /** M24 is where the tools land (D-249), so M24 is the only milestone a tool can be owed by. */
  | { readonly kind: 'OWED'; readonly by: 'M24' }
  /** A conversation should never do this. The decision has to be written down (`decided`). */
  | { readonly kind: 'REFUSED'; readonly decision: string }

interface Gap {
  readonly why: string
  readonly proof: Proof
  readonly answer: Answer
}

interface Capability {
  /** What a person does, in the words they would use. */
  readonly does: string
  /** The repository functions it goes through. The anchor both halves share. */
  readonly writes: readonly string[]
  readonly screen: Screen
  readonly tool: Tool
  /**
   * Required when the tool is missing. **Refused when only the screen is** — a
   * screen trail is derived, not written (D-249) — and when both halves are there.
   */
  readonly gap?: Gap
}

const DECLARED_FORMATS = 'ui/screens/DeclaredFormats.tsx'
const FORMAT_ROWS = 'ui/screens/FormatRows.tsx'
const INTAKE = 'ui/screens/ReadFiles.tsx'

/**
 * **The engine's surface, both halves of it.**
 *
 * Ten capabilities over twelve writes. Read it as the answer to *what can be
 * done to a document that declares its own formats* — and the three `gap`
 * entries as what M24 owes a conversation.
 *
 * **U7 closed two of the six this file was written with** (D-235), and it closed
 * them by going red rather than by somebody remembering to edit a list: the day
 * the plugin called `recordIntake`, the assertion that nobody on that side did
 * failed, and the entries had to go with it.
 *
 * **U4's entry left by a third route** (D-246): it was the only one with neither
 * half, and M22 U6 made it the open path rather than a capability. It is in
 * `THROUGH_ANOTHER` now, with the note on why it did not go red by itself.
 */
const CAPABILITIES: readonly Capability[] = [
  {
    does: 'Declare a format — a new kind of thing, compiled to a real table.',
    writes: ['adoptFormat'],
    screen: DECLARED_FORMATS,
    tool: 'declare_format',
  },
  {
    does: 'Add a column or an identity to a format that already exists.',
    writes: ['adoptFormat'],
    // M26 U3: on the format's own sheet — the `+` after the last column, and
    // what adds up, which closed `M23 U2 #1` — a named band since M29 U1 (D-331).
    screen: FORMAT_ROWS,
    // M24 U3 (D-254).
    tool: 'extend_format',
  },
  {
    // M29 U2 (D-332): a header dragged by its grip, or moved with the arrows,
    // saved from the panel; a conversation gives `extend_format` an `order`.
    does: 'Move a column — the order a format’s columns are shown in.',
    writes: ['adoptFormat'],
    screen: FORMAT_ROWS,
    tool: 'extend_format',
  },
  {
    // M26 U3 (D-290) on the sheet; a conversation's since M38 U6 (D-412), which
    // superseded D-290's refusal: `extend_format` takes `rename`, `change` and
    // `remove`, judged by the same reconciler, and an identity goes the same way.
    does: 'Rename, retype or remove a column of a format, remove an identity, or change what it is held to.',
    writes: ['adoptFormat'],
    screen: FORMAT_ROWS,
    tool: 'extend_format',
  },
  {
    does: 'Connect two formats — a link one way, and the figure folded back across it.',
    writes: ['adoptFormat'],
    screen: 'ui/screens/Connections.tsx',
    // M24 U2 (D-253): parity gap #11, closed. The same `adoptFormat` adopts the
    // same two declarations, link first — built by the panel's `buildDrafts` on
    // one side and by `connect` on the other.
    tool: 'connect_formats',
  },
  {
    // M38 U7 (D-405): *Keep this pack here* on each pack's card, and
    // `keep_packs` (with `create_document`'s `packs`), through the one
    // `keepPack` in `data/packs/packs.ts` — which declares through `adoptFormat`,
    // and since M51 U9 (D-491) brings an earlier build's view settings to this
    // one's through `writeViewSettings`, the same plan on both halves.
    does: 'Keep a pack in a document — declare the formats it lacks, complete the ones it holds, bring the notes and view settings an earlier build wrote to this one’s.',
    writes: ['adoptFormat', 'writeViewSettings'],
    screen: 'ui/screens/Packs.tsx',
    tool: 'keep_packs',
  },
  {
    does: 'Take a format away, with its table and every row in it.',
    writes: ['deleteFormat'],
    screen: DECLARED_FORMATS,
    // M24 U3 (D-254): a tool, not a refusal, on the screen's own terms —
    // refused while another format refers to it.
    tool: 'delete_format',
  },
  {
    does: 'Put rows on a format.',
    writes: ['insertRows'],
    screen: FORMAT_ROWS,
    tool: 'record_format_rows',
  },
  {
    // A card dragged to another lane of a board is this too (M27 U3, D-301):
    // one enum column of one row, judged as `update_format_rows` judges it.
    does: 'Correct a row — or move its card to another lane of a board, or tick it on a list.',
    writes: ['updateRow'],
    screen: FORMAT_ROWS,
    tool: 'update_format_rows',
  },
  {
    does: 'Take rows away.',
    writes: ['deleteRows'],
    screen: FORMAT_ROWS,
    tool: 'delete_format_rows',
  },
  {
    // M25 E4 (D-273). On a write of the target the rules ride inside
    // `insertRows` and `updateRow`'s callers; this is the run on demand.
    does: 'Apply a rule set to every row of the format it sets.',
    writes: ['applyRuleSet'],
    screen: FORMAT_ROWS,
    tool: 'apply_rules',
  },
  {
    // M29 F11 (D-353). A write fills an empty found link by itself (D-350);
    // this fills the empty ones already there, never one that is set.
    does: 'Fill a link’s empty cells by its `found by`, over the rows already there.',
    writes: ['applyFoundLink'],
    screen: 'ui/screens/Connections.tsx',
    tool: 'apply_rules',
  },
  // A screen trail, so no gap: `docs/parity.md` carries it to M26 (D-249).
  {
    does: 'Add a unit, or correct what one is worth.',
    writes: ['addUnit', 'correctUnit'],
    screen: undefined,
    tool: 'record_units',
  },
  {
    // M26 U2 (D-289). Presentation, kept per document beside the declaration.
    // Refused to a conversation until M35 U4 (D-403): the person it works for
    // is looking at the sheet.
    does: 'Make a column of a format’s sheet wider or narrower.',
    writes: ['setColumnWidth'],
    screen: FORMAT_ROWS,
    tool: 'arrange_views',
  },
  {
    // M26 U4 (D-291). Presentation, kept per document beside the declarations.
    does: 'Move a bubble, or a pack’s folded group, on the connections canvas — or put them all back.',
    writes: ['setGraphPlaces', 'clearGraphPlaces'],
    screen: 'ui/screens/Connections.tsx',
    tool: undefined,
    gap: {
      why:
        'A position is where a bubble is drawn, and a conversation draws no canvas: it reads the ' +
        'connections as columns and aggregates. A tool for it would move something nobody on ' +
        'that side can see.',
      proof: { kind: 'NOBODY ON THAT SIDE CALLS IT' },
      answer: { kind: 'REFUSED', decision: 'D-291' },
    },
  },
  {
    // M26 U6 (D-294), F2 (D-296) and M35 U3 (D-402): how a column is shown on
    // the entry and where it comes. Refused to a conversation on "a
    // conversation draws no page" until M35 U4 (D-403) reversed it: the person
    // it works for is looking at the page, and a pack made in a conversation
    // needs its views set the same way.
    does:
      'Choose how a column is shown on a format’s entry — its Show as — and where it comes on ' +
      'that page.',
    writes: ['setEntryInput', 'setEntryOrder'],
    screen: FORMAT_ROWS,
    tool: 'arrange_views',
  },
  {
    // M53 U2 (D-517): the entry's Fields list and a column's ⋯ menu; the
    // conversation's `hidden` and `new_entry` on `arrange_views`.
    does: 'Hide a column on a format’s entry, or mark it for a new entry to ask for.',
    writes: ['setEntryHidden', 'setEntryAsked'],
    screen: FORMAT_ROWS,
    tool: 'arrange_views',
  },
  {
    // M27 U3 (D-301); a conversation's since M35 U4 (D-403). The move itself
    // is `updateRow`, above.
    does: 'Choose which enum column a format’s board lays its lanes by.',
    writes: ['setBoardLanes'],
    screen: FORMAT_ROWS,
    tool: 'arrange_views',
  },
  {
    // M53 U4 (D-519): the list's *Group by*, *Ticked when* and *Line*; the
    // tick itself is `updateRow` and a row added in place `insertRows`, above.
    does: 'Choose what a format’s list groups by, what ticks a row, and what its lines show.',
    writes: ['setListSetting'],
    screen: FORMAT_ROWS,
    tool: 'arrange_views',
  },
  {
    // M53 U5 (D-520): the FilterBand's *Save this view*; the conversation's
    // `view: saved` on `arrange_views`.
    does: 'Save a format’s filter, order, columns and kind of view under a name.',
    writes: ['saveView'],
    // The band's control is drawn by the table, board, list, roadmap and ready
    // views alike, so its write is in the hook they share.
    screen: 'ui/formats/savedView.ts',
    tool: 'arrange_views',
  },
  {
    // M53 U5 (D-520): the rail renames and deletes a saved view in place.
    does: 'Rename a saved view, or delete it.',
    writes: ['renameSavedView', 'deleteSavedView'],
    screen: 'ui/RailFolder.tsx',
    tool: 'arrange_views',
  },
  // A screen trail, so no gap (M35 U4, D-403): a pack's views and a text
  // document set the header line, and no screen does yet.
  {
    does: 'Put a column in the entry’s header line, or take it out.',
    writes: ['setEntryHeader'],
    screen: undefined,
    tool: 'arrange_views',
  },
  {
    // M48 U3. The roadmap's *In the order of*, as the board's *Lanes by*.
    does: 'Choose which number column a format’s roadmap runs in.',
    writes: ['setRoadmapOrder'],
    screen: 'ui/screens/FormatLinkViews.tsx',
    tool: 'arrange_views',
  },
  {
    // M49 U3. The agenda's *by*, as the roadmap's *In the order of*.
    does: 'Choose which date column puts a format on the agenda.',
    writes: ['setAgendaDate'],
    screen: 'ui/screens/Agenda.tsx',
    tool: 'arrange_views',
  },
  // A screen trail, so no gap (M48 U3): a pack's views and a text document
  // set a roadmap's folds and lines, a ready list and a start-here question,
  // and a conversation now does too; no screen does yet.
  {
    does: 'Set what a roadmap folds and shows, what a ready list reads, a start-here question, or what finished is on the agenda.',
    writes: ['setViewSetting'],
    screen: undefined,
    tool: 'arrange_views',
  },
  {
    does: 'Read a document onto a format — a file becomes rows, and what wrote them is recorded.',
    writes: ['recordIntake'],
    screen: INTAKE,
    tool: 'read_onto_format',
  },
  {
    does: 'Supersede an earlier reading of the same file.',
    writes: ['supersedeIntake'],
    screen: INTAKE,
    tool: 'supersede_reading',
  },
  {
    // M26 F1 (D-293). What U5 left with a reader: no way to name one, and no
    // way to stop one being offered short of deleting the format.
    does: 'Name a reader, or forget one — the rows it wrote stay.',
    writes: ['renameReader', 'forgetReader'],
    screen: INTAKE,
    tool: 'readers',
  },
  {
    // M29 F3 (D-344): asked on a money column's panel, and beside the units.
    does: 'Choose the document’s currency — what a new amount starts in.',
    writes: ['setDocumentCurrency'],
    screen: FORMAT_ROWS,
    tool: 'record_units',
  },
]

/**
 * Writes that no surface calls, and should not.
 *
 * Not gaps: these are the inside of other capabilities. A caller reaching one of
 * them directly would be doing half of something — and `saveFormat` is the
 * clearest of the three, because storing a declaration without making the table
 * match it leaves the document describing a table it has not got.
 */
const THROUGH_ANOTHER: Readonly<Record<string, string>> = {
  // **U6 answered the question U4's gap entry was holding open, by making it
  // not apply** (D-246, D-247). That entry said the day something plumbed the
  // serializer's writing half, it would go red from both sides at once and
  // *which screen and which tool* would finally have to be answered. U6 plumbed
  // it, and the answer is neither: a text `.emd` is read by `openEncoded`, so
  // reading text **is opening a document** — the same thing `reconcileFormats`
  // is and for the same reason. Nobody chooses it; a person chooses a file.
  //
  // **The entry did not go red on its own**, and that is the finding worth
  // keeping: the proof greps `ui/` and `plugin/` for the call, and U6 reaches it
  // from `data/storage/encoding.ts`, one file further out than the grep can
  // see. So the gap held while the claim underneath it stopped being true —
  // which is the exact failure mode D-138 keeps naming, in the machinery built
  // to prevent it. **M24 U0 made the proof follow imports** (D-251), and the
  // last test in this file pins this exact case so it cannot slip again.
  applyParts:
    'The open path’s, since D-246. A text document is read into a fresh one by `openEncoded`, ' +
    'which is how a `.emd` of that shape opens at all — in the app and in the plugin both.',
  applyDocument: 'The inside of `applyParts`, which is the pair every caller uses.',
  saveFormat:
    'The declaration half of `adoptFormat`, which is the pair and the thing every caller uses.',
  reconcileFormats:
    'The open path’s. `documentStore` runs it when a document is opened; nobody chooses it.',
  forgetIntakes:
    'Called by `deleteFormat`, because the record of which file wrote a row goes with the row.',
  // M24 U12 (D-264). A pack's rows are seeded when a document with that pack
  // is opened, as a table is reconciled — M25 plumbs the call.
  seedRows:
    'The open path’s, from M25: a pack seeds its rows when a document is opened; nobody chooses it.',
  restoreSeeds: 'The inside of `applyDocument`: a text document’s seed records, after its rows.',
  forgetSeeds: 'Called by `deleteFormat`, for `forgetIntakes`’s reason.',
  // M26 U2 (D-289).
  restoreColumnWidths: 'The inside of `applyDocument`: a text document’s column widths, after its rows.',
  forgetColumnWidths: 'Called by `deleteFormat`, for `forgetIntakes`’s reason.',
  // M26 U4 (D-291).
  restoreGraphPlaces: 'The inside of `applyDocument`: a text document’s canvas places, after its rows.',
  forgetGraphPlace: 'Called by `deleteFormat`, for `forgetIntakes`’s reason.',
  // M26 U6 (D-294).
  restoreViewSettings: 'The inside of `applyDocument`: a text document’s view settings, after its rows.',
  // M29 F3 (D-344).
  restoreDocumentCurrency: 'The inside of `applyDocument`: a text document’s currency, after its rows.',
  // M38 U3 (D-408).
  restoreReadings: 'The inside of `applyDocument`: a text document’s readings and reader names, after its rows.',
  forgetViewSettings: 'Called by `deleteFormat`, for `forgetIntakes`’s reason.',
  // M53 U5 (D-520).
  restoreSavedViews: 'The inside of `applyDocument`: a text document’s saved views, after its rows.',
  forgetSavedViews: 'Called by `deleteFormat`, for `forgetIntakes`’s reason.',
  // M29 U3b (D-334). A derived view is compiled from the declarations, so it
  // is dropped and rebuilt around every change to one; nobody chooses it.
  dropDerivedViews:
    'Called by `adoptFormat`, `reconcileFormats` and `deleteFormat` before a table changes; nobody chooses it.',
  buildDerivedViews:
    'Called by `adoptFormat`, `reconcileFormats` and `deleteFormat` after a table changes; nobody chooses it.',
  // M47 U5 (D-462). The triggers that mark when a format last changed.
  keepChangeMarks:
    'Called by `adoptFormat`, `reconcileFormats` and every plugin open, after a table may have changed; nobody chooses it.',
  restoreChangeMarks: 'The inside of `applyDocument`: a text document’s change marks, after its rows.',
}


/** The repositories the engine changes a document through. */
const REPOSITORIES = [
  'data/repositories/formatRepository.ts',
  'data/repositories/formatRowRepository.ts',
  'data/repositories/formatJoinRepository.ts',
  'data/repositories/formatIntakeRepository.ts',
  'data/repositories/unitRepository.ts',
  'data/repositories/formatDocumentRepository.ts',
  'data/repositories/formatSeedRepository.ts',
  'data/repositories/formatRuleRepository.ts',
  'data/repositories/formatViewRepository.ts',
  'data/repositories/formatBatchRepository.ts',
]

/** Every other repository is the ledger's — the pack M25 moves onto `fmt_` tables. */
const LEDGER_REPOSITORIES = readdirSync(new URL('data/repositories', import.meta.url))
  .filter((entry) => /\.ts$/.test(entry) && !/\.test\.ts$/.test(entry))
  .map((entry) => `data/repositories/${entry}`)
  .filter((path) => !REPOSITORIES.includes(path))

/**
 * **The ledger's ratchet** (D-251). Counted at M24 U0, and allowed only to fall:
 * a ledger write no tool reaches, and one no screen reaches. `docs/parity.md`
 * names every one of them; these two numbers are what keep a new one from being
 * added by rewriting that file. Tightened at M28 U1 (D-308), when investments
 * left the pack and took nineteen writes with them, and at M28 U5 (D-313), when
 * the statement batch made resolving an account part of writing a statement —
 * the step `import_statement` always took — rather than a screen's own write, and
 * at M28 U6 (D-315), when a conversation got the Transactions and Categories
 * screens' row and category edits (`edit_categories`, `set_excluded_from_totals`,
 * `set_transaction_notes`, `set_card_payers`, `skip_merchants`): thirteen fewer, and
 * one more for the Undo of a filing, which is the screen's own, and at M28 U7
 * (D-319), when a conversation got the Plan screen (`set_plan`, `plan_month`,
 * `set_fixed_expense_roles`, `edit_fixed_expenses`): eleven fewer.
 *
 * **And raised by two at M28 U9 (D-330), one of which was never really
 * reached.** Onboarding's tools went, and `skipAll` went with them — By
 * merchant's write, "reached" by a tool only because onboarding's step machine
 * had a function of the same name, so the count was one lower than the truth.
 * The other is honest: `createInstitution` is the Accounts screen's "other"
 * provider, and `add_institutions` went with the institution step, because
 * reading a statement makes its account (D-313) — which `import_statement` now
 * does too (`new_account`), closing `resolveAccountForImport`. The guide's own
 * progress (`saveGuideProgress`) replaces `removeRecordFor` one for one: a
 * conversation has no screen to walk, so it gets `guide_status` instead.
 *
 * **One fewer at M28 F23**, and only partly: `set_goal_deposit_categories` sets a
 * goal's default holding through `updateGoal`, the Goals editor's write, because
 * reading the bank needs one. The editor's other fields — name, target, date —
 * still have no tool, which `create_goals` says.
 *
 * **One fewer at M30 U6**: `record_holdings_statement` makes the account a
 * broker's statement is for (`createAccount`), as a statement does on the
 * Accounts screen.
 *
 * **Two more without a screen at M30 F3 (D-363), and neither is a half that went
 * missing.** The goal form became one write, `saveGoalAnswer`, which both halves
 * reach (the form and Plan's new goal; `create_goals`). The drawer's feed
 * menu went into it, so the screen now sets a goal's feed and holding *through*
 * that write, and reach stops at the first write it meets: `setGoalFeed` and
 * `updateGoal` read as tool-only because `set_goal_deposit_categories` still
 * calls them by name. The capability has both halves; the count is the rule's.
 *
 * **And back to three at M30 F4**: `ONE_WRITE_FORMS` lets a form's one write carry the
 * writes it calls, so the goal form reaches `setGoalFeed` and `updateGoal` again.
 *
 * **78 at M36 U01**: `record_paychecks` runs `syncPayroll` after a slip as the screens do,
 * so `syncPayrollDeposits` has its tool half. M36 U05 (D-381) took that sync away — a
 * slip's deposits are worked out on read — and `syncPayroll` keeps the debts' half.
 *
 * **77 at M36 F1** (D-391): `set_deduction_types` sets what a deduction type counts as and
 * pays into through `updateDeductionType`, the deduction types screen's write.
 *
 * **74 at M36 F2** (D-392): the same tool makes, removes and reorders a type through
 * `createDeductionType`, `deleteDeductionType` and `reorderDeductionTypes`, the rest of that screen.
 *
 * **65 at M45 U2**: nine writes neither half reached were dead code and went —
 * `confirmTemplate`, `setPaycheckIrregular`, `moveDeposits`, `reorderGoals`, `setBufferBucket`
 * and the import review's four per-row setters.
 */
const LEDGER_WITHOUT_A_TOOL = 65
const LEDGER_WITHOUT_A_SCREEN = 3

/** Every path in this file is relative to `src/`, which is where this file sits. */
function sourceOf(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

interface Source {
  readonly path: string
  readonly text: string
}

/** Every file under a folder, tests excluded: a test calling a write proves nothing. */
function sourcesUnder(folder: string): readonly Source[] {
  const found: Source[] = []
  const walk = (relative: string): void => {
    for (const entry of readdirSync(new URL(relative, import.meta.url))) {
      const next = `${relative}/${entry}`
      if (statSync(new URL(next, import.meta.url)).isDirectory()) {
        walk(next)
        continue
      }
      if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue
      found.push({ path: next, text: sourceOf(next) })
    }
  }
  walk(folder)
  return found
}

const SCREENS = sourcesUnder('ui')
const PLUGIN = sourcesUnder('plugin')

/** Everything between a surface and a repository — where a call goes on its way to a write. */
const INNER = sourcesUnder('.').filter(
  (source) => !source.path.startsWith('./ui/') && !source.path.startsWith('./plugin/'),
)

/**
 * Whether a decision is written down: its entry in the log while its milestone
 * is current, or its `decision` row in `docs/memory.emd` (D-240), which stays
 * once the entry leaves the log — so either answers it. A row is a `### D-NNN`
 * heading in the document's `decision.format.md` part, matched as a whole line
 * so D-29 is not found inside D-291.
 */
function decided(id: string): boolean {
  const log = readFileSync(new URL('../docs/09-decision-log.md', import.meta.url), 'utf8')
  if (log.includes(`## ${id} · `)) return true
  const memory = readFileSync(new URL('../docs/memory.emd', import.meta.url), 'utf8')
  const start = memory.indexOf('<!-- emerald: decision.format.md -->')
  if (start === -1) return false
  const end = memory.indexOf('<!-- emerald: ', start + 1)
  const rows = memory.slice(start, end === -1 ? undefined : end)
  return rows.split(/\r?\n/).includes(`### ${id}`)
}

function calls(sources: readonly Source[], name: string): boolean {
  return sources.some((source) => new RegExp(`\\b${name}\\(`).test(source.text))
}

/**
 * **Writes that are always taken back** (M29 F2, D-343): the table asked what
 * it would refuse by writing a row inside a transaction that is rolled back
 * whatever happens. It changes no document, so it is no capability, and what
 * calls it is not a write by calling it.
 */
const TAKEN_BACK: ReadonlySet<string> = new Set(['tableRefusals', 'dryRun'])

/**
 * Every exported function in these repositories that changes a document.
 *
 * A function writes if it runs a statement, or if it calls one that does. The
 * second half is why this is a fixpoint rather than a grep: `adoptFormat` holds
 * no `db.run` of its own, and it is the most important name in the list.
 */
function writesDerived(
  files: readonly string[],
  /**
   * Writes these files make through another's — the engine's row functions,
   * which the ledger writes its declared tables through since M25 U2. Without
   * them a ledger function that calls `updateRow` and runs no statement of its
   * own would stop being a write, and the audit would owe less than it does.
   */
  through: ReadonlySet<string> = new Set(),
): ReadonlyMap<string, string> {
  const bodies = new Map<string, string>()
  const exported = new Map<string, string>()

  for (const file of files) {
    const text = sourceOf(file)
    const heads = [...text.matchAll(/^(export )?(?:async )?function (\w+)/gm)]
    heads.forEach((head, index) => {
      const from = head.index ?? 0
      const to = heads[index + 1]?.index ?? text.length
      bodies.set(head[2] ?? '', text.slice(from, to))
      if (head[1] !== undefined) exported.set(head[2] ?? '', file)
    })
  }

  const writers = new Set<string>()
  for (const [name, body] of bodies) {
    if (TAKEN_BACK.has(name)) continue
    const inside = body.slice(body.indexOf('\n'))
    const calls = [...through].some((writer) => new RegExp(`\\b${writer}\\(`).test(inside))
    if (/\.run\(/.test(body) || calls) writers.add(name)
  }

  for (let settled = false; !settled; ) {
    settled = true
    for (const [name, body] of bodies) {
      if (writers.has(name) || TAKEN_BACK.has(name)) continue
      const inside = body.slice(body.indexOf('\n'))
      for (const writer of writers) {
        if (!new RegExp(`\\b${writer}\\(`).test(inside)) continue
        writers.add(name)
        settled = false
        break
      }
    }
  }

  return new Map([...exported].filter(([name]) => writers.has(name)))
}

/**
 * The lines that open a named function: a declaration, a `const` holding an
 * arrow, a property holding one (a store's actions), and a method.
 */
const HEADS = [
  /^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+(\w+)/,
  /^(\s*)(?:export\s+)?(?:const|let)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:\(|<|\w+\s*=>|function\b)/,
  /^(\s*)(?:async\s+)?(\w+)\s*:\s*(?:async\s+)?(?:\(|\w+\s*=>|function\b)/,
  /^(\s*)(?:async\s+)?(\w+)\s*\([^)]*\)\s*(?::\s*[^{=]+)?\{\s*$/,
]
const NOT_A_NAME = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function'])

/**
 * Every named function in a file, with the identifiers its body mentions.
 *
 * **By indentation, not by parsing** — the source is formatted, so a body is
 * everything indented past its head, and a nested function is a chunk of its
 * own *and* part of its parent's. Crude on purpose: the failure it has is
 * finding a reach that is not there, which turns a proof red and asks a person,
 * and never the other way.
 */
function chunksOf(text: string): readonly { name: string; mentions: readonly string[] }[] {
  const lines = text.split('\n')
  const found: { name: string; mentions: readonly string[] }[] = []
  lines.forEach((line, at) => {
    const head = HEADS.map((pattern) => pattern.exec(line)).find((match) => match !== null)
    const name = head?.[2]
    if (head === undefined || name === undefined || NOT_A_NAME.has(name)) return
    const indent = (head[1] ?? '').length
    let end = at + 1
    for (; end < lines.length; end += 1) {
      const next = lines[end] ?? ''
      const trimmed = next.trimStart()
      if (trimmed === '' || next.length - trimmed.length > indent) continue
      // `): Result {` closes a signature and opens the body; `}` closes the body.
      if (/^[)\]}]/.test(trimmed) && /[({[]\s*$|=>\s*$/.test(trimmed)) continue
      if (/^[)\]}]/.test(trimmed)) end += 1
      break
    }
    found.push({ name, mentions: lines.slice(at, end).join('\n').match(/\b[A-Za-z_]\w*\b/g) ?? [] })
  })
  return found
}

/**
 * **Which writes each name reaches, through anything outside the surfaces** —
 * the fix for `M22 U6 #2` (D-251).
 *
 * A proof used to ask whether a file under `ui/` mentions the write. U6 reached
 * one from `data/storage/encoding.ts`, which the store calls, which every
 * screen calls, and the proof said *nobody* while the answer was *everybody*.
 * This follows the calls out through every non-surface file under `src/`.
 *
 * **By name, and deliberately conservative**: two functions called `open` are
 * one node here, so a reach can be found that is not real. That costs a red test
 * and a look; the opposite error is the one this exists to stop.
 */
function reachIndex(writes: ReadonlySet<string>): ReadonlyMap<string, ReadonlySet<string>> {
  const mentions = new Map<string, Set<string>>()
  for (const source of INNER) {
    for (const chunk of chunksOf(source.text)) {
      const into = mentions.get(chunk.name) ?? new Set<string>()
      for (const each of chunk.mentions) if (each !== chunk.name) into.add(each)
      mentions.set(chunk.name, into)
    }
  }

  const reach = new Map<string, Set<string>>()
  for (const [name, mentioned] of mentions) {
    reach.set(name, new Set([...mentioned].filter((each) => writes.has(each))))
  }
  for (let settled = false; !settled; ) {
    settled = true
    for (const [name, mentioned] of mentions) {
      const into = reach.get(name) ?? new Set<string>()
      for (const each of mentioned) {
        // **Reach stops at the first write it meets.** What a write does inside
        // is its own entry's business — opening a text `.emd` adds units through
        // `applyDocument`, and that is the open path, not a screen adding a unit.
        // It is the rule `THROUGH_ANOTHER` states, made mechanical.
        if (writes.has(each)) continue
        for (const write of reach.get(each) ?? []) {
          if (into.has(write)) continue
          into.add(write)
          settled = false
        }
      }
    }
  }
  return reach
}

const ENGINE_WRITES = writesDerived(REPOSITORIES)
const LEDGER_WRITES = writesDerived(LEDGER_REPOSITORIES, new Set(ENGINE_WRITES.keys()))
const ALL_WRITES: ReadonlySet<string> = new Set([...ENGINE_WRITES.keys(), ...LEDGER_WRITES.keys()])
const REACH = reachIndex(ALL_WRITES)

/**
 * **A form that is one write** (M30 F4): the writes inside it are the form's. Reach stops at
 * the first write it meets, and rightly for the open path (`applyParts` is not a screen adding a
 * unit); but the goal form became `saveGoalAnswer` at M30 F3 (D-363), and the feed and the goal's
 * own fields a person sets on it are set *through* that write, by the person, on the screen. A
 * surface that reaches one of these reaches the writes it calls by name, and nothing further.
 */
const ONE_WRITE_FORMS: Readonly<Record<string, string>> = {
  saveGoalAnswer: 'The goal form, Plan’s new goal and `create_goals`: the goal, its place, its money already there and its feed.',
}

/** Whether any file of a surface reaches a write — directly, through anything it calls, or through a form's one write. */
function reaches(sources: readonly Source[], write: string): boolean {
  return (
    reachesDirectly(sources, write) ||
    Object.keys(ONE_WRITE_FORMS).some(
      (form) => form !== write && REACH.get(form)?.has(write) === true && reachesDirectly(sources, form),
    )
  )
}

const NAMES = new WeakMap<Source, readonly string[]>()

/**
 * Each name a file mentions, once. Every write asks of every file, and splitting
 * the text again each time was most of this file's sixteen seconds — enough to
 * cross the test budget under a full run's load (M42 F3).
 */
function namesIn(source: Source): readonly string[] {
  let names = NAMES.get(source)
  if (names === undefined) {
    names = [...new Set(source.text.match(/\b[A-Za-z_]\w*\b/g) ?? [])]
    NAMES.set(source, names)
  }
  return names
}

function reachesDirectly(sources: readonly Source[], write: string): boolean {
  return sources.some((source) =>
    namesIn(source).some(
      (each) =>
        each === write || (!ALL_WRITES.has(each) && REACH.get(each)?.has(write) === true),
    ),
  )
}

/** Whether another write calls this one — the ledger's `THROUGH_ANOTHER`, derived. */
function inside(write: string): boolean {
  return [...ALL_WRITES].some((other) => other !== write && REACH.get(other)?.has(write) === true)
}

type Listed = Awaited<ReturnType<Client['listTools']>>['tools']

/** The tools as a conversation is actually offered them, not as this file imports them. */
async function listed(): Promise<Listed> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'parity', version: '0' }, { capabilities: {} })
  await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)])
  const { tools } = await client.listTools()
  await client.close()
  return tools
}

/** The ledger's writes, by which halves reach them. */
function ledgerHalves(): { withoutTool: string[]; withoutScreen: string[]; within: string[] } {
  const withoutTool: string[] = []
  const withoutScreen: string[] = []
  const within: string[] = []
  for (const write of [...LEDGER_WRITES.keys()].sort()) {
    const tool = reaches(PLUGIN, write)
    const screen = reaches(SCREENS, write)
    if (!tool && !screen && inside(write)) within.push(write)
    else if (!tool) withoutTool.push(write)
    else if (!screen) withoutScreen.push(write)
  }
  return { withoutTool, withoutScreen, within }
}

/** `data/repositories/debtRepository.ts` → `debtRepository`. */
function repositoryOf(write: string): string {
  return (LEDGER_WRITES.get(write) ?? '').replace(/^.*\/|\.ts$/g, '')
}

/** One line per repository, so a list of a hundred writes stays readable. */
function byRepository(writes: readonly string[]): string {
  const grouped = new Map<string, string[]>()
  for (const write of writes) {
    const into = grouped.get(repositoryOf(write)) ?? []
    into.push(`\`${write}\``)
    grouped.set(repositoryOf(write), into)
  }
  return [...grouped]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([repository, names]) => `- **${repository}** — ${names.join(', ')}`)
    .join('\n')
}

/** What `docs/parity.md` says. Derived on every run; the file is only where M26 reads it. */
function parityNote(): string {
  const trails = CAPABILITIES.filter((each) => each.screen === undefined)
  const owed = CAPABILITIES.filter((each) => each.tool === undefined)
  const { withoutTool, withoutScreen, within } = ledgerHalves()
  const line = (each: Capability, half: string): string =>
    `- **${each.does}** ${half} · ${each.writes.map((write) => `\`${write}\``).join(', ')}`
  const answer = (each: Capability): string =>
    each.gap?.answer.kind === 'REFUSED' ? `refused by ${each.gap.answer.decision}` : 'owed by M24'

  return `<!-- Written by src/parity.test.ts, never by hand: \`npx vitest run src/parity.test.ts -u\` rewrites it. -->

# Parity — what each half owes

Derived by [the parity audit](../src/parity.test.ts) on every test run (D-234, D-249, D-251), and a
copy that has gone stale fails the build. **Tools first, screens in M26**: a missing tool needs an
answer, a missing screen is only counted.

## Screen trails — M26's scope

What a conversation can do and no screen can. M26 closed with these left (D-297); the ledger's are M28's.

### The engine

${trails.map((each) => line(each, `\`${each.tool ?? ''}\``)).join('\n') || '_None._'}

### The ledger — ${withoutScreen.length}

${byRepository(withoutScreen) || '_None._'}

## Owed a tool

### The engine — each one answered

${owed.map((each) => line(each, `(${answer(each)})`)).join('\n') || '_None._'}

### The ledger — ${withoutTool.length}, a ratchet rather than a list to work through

A screen reaches these and no tool does, which the plugin's *Not here* has said since D-109. The
number may only fall. M25 rewrites what is under them, and M24's survey decides which the engine
has to be able to hold first. Of the ledger's ${LEDGER_WRITES.size} writes, ${within.length} more
are only ever called by another write, and count with it.

${byRepository(withoutTool) || '_None._'}
`
}

describe('the parity audit', () => {
  it('names every way this engine changes a document, and nothing that is not one', () => {
    // The check the whole file exists for. A write nobody has decided about is a
    // capability with one half or no halves, and this is where it is caught —
    // before it is a surface somebody has come to depend on.
    const named = new Set([
      ...CAPABILITIES.flatMap((capability) => capability.writes),
      ...Object.keys(THROUGH_ANOTHER),
    ])
    expect([...ENGINE_WRITES.keys()].sort()).toEqual([...named].sort())
  })

  it('finds the screen doing what the inventory says it does', () => {
    for (const capability of CAPABILITIES) {
      if (capability.screen === undefined) continue
      const text = sourceOf(capability.screen)
      for (const write of capability.writes) {
        const where = `${capability.screen} · ${write}`
        // Called there, or reached through what it calls — the rule the tool's
        // half has followed since D-251. M34 U2 moved the screen's reading into
        // `writeBatch`, which `read_onto_format` takes `files` through too.
        expect(
          new RegExp(`\\b${write}\\(`).test(text) || reaches([{ path: capability.screen, text }], write),
          where,
        ).toBe(true)
      }
    }
  })

  it('finds the tool doing it too, and the tool is one a conversation can call', async () => {
    const names = new Set((await listed()).map((tool) => tool.name))
    for (const capability of CAPABILITIES) {
      if (capability.tool === undefined) continue
      expect(names, capability.does).toContain(capability.tool)
      for (const write of capability.writes) {
        expect(reaches(PLUGIN, write), `${capability.tool} · ${write}`).toBe(true)
      }
    }
  })

  it('holds every gap open until something closes it, and every one has an answer', async () => {
    const tools = await listed()
    for (const capability of CAPABILITIES) {
      const { gap, screen, tool } = capability
      expect(screen !== undefined || tool !== undefined, `${capability.does} has neither half`).toBe(true)

      if (screen === undefined) {
        // **A screen trail** (D-249): no entry to write, only the proof that it
        // is still a trail. It goes red the day a screen lands.
        expect(gap, `${capability.does} is a screen trail — derived, not written`).toBeUndefined()
        for (const write of capability.writes) {
          expect(reaches(SCREENS, write), `${capability.does} · ${write}`).toBe(false)
        }
        continue
      }

      // The tool half is mandatory: a capability without one explains itself,
      // and says who answers it.
      expect(gap === undefined, capability.does).toBe(tool !== undefined)
      if (gap === undefined) continue
      expect(gap.why.length, capability.does).toBeGreaterThan(80)
      if (gap.answer.kind === 'REFUSED') {
        expect(decided(gap.answer.decision), `${capability.does} · ${gap.answer.decision}`).toBe(true)
      }

      if (gap.proof.kind === 'NOBODY ON THAT SIDE CALLS IT') {
        // The missing side really is missing — through anything it calls, not
        // only in its own files (D-251).
        for (const write of capability.writes) {
          expect(reaches(PLUGIN, write), `${capability.does} · ${write}`).toBe(false)
        }
        continue
      }

      // The shared-write case: `adoptFormat` is called from both sides, so what
      // proves the gap is the sentence the tool tells its caller. If that
      // sentence goes, either the tool alters now — and this is no longer a gap
      // — or a conversation is being told something that is not true.
      const { tool: named, phrase } = gap.proof
      const description = tools.find((each) => each.name === named)?.description ?? ''
      expect(description, capability.does).toContain(phrase)
    }
  })

  it('holds the ledger to what it has: a missing half may only get rarer', () => {
    // **Not exempt** (D-249), and not symmetric either. M25 rewrites the backend
    // of every screen here, and the acceptance is that each still behaves as it
    // does today — so a write that has both halves has to keep both, and the ones
    // missing a tool are the ratchet's, not a list somebody works through.
    const { withoutTool, withoutScreen } = ledgerHalves()
    expect(LEDGER_WRITES.size).toBeGreaterThan(100)
    expect(withoutTool.length).toBeLessThanOrEqual(LEDGER_WITHOUT_A_TOOL)
    expect(withoutScreen.length).toBeLessThanOrEqual(LEDGER_WITHOUT_A_SCREEN)
  })

  it('writes down what each half owes, where M26 reads its scope', async () => {
    await expect(parityNote()).toMatchFileSnapshot('../docs/parity.md')
  })

  it('follows a call out past the surface, which is what keeps a proof true', () => {
    // `M22 U6 #2`, pinned: no file under `ui/` names `applyParts`, and every
    // screen reaches it — through the store, `openEncoded` and
    // `data/storage/encoding.ts`. The old proof said *nobody*.
    expect(calls(SCREENS, 'applyParts')).toBe(false)
    expect(reaches(SCREENS, 'applyParts')).toBe(true)
    // And the index is not so loose that it finds everything everywhere.
    expect(reaches(SCREENS, 'addUnit')).toBe(false)
  })

  it('writes through the repositories on both sides, which is what makes the count a count', () => {
    // The property every test above rests on. A screen or a tool running a
    // statement of its own would be a capability the derivation cannot see — so
    // this is the one assertion here about neither half in particular.
    for (const source of [...SCREENS, ...PLUGIN]) {
      expect(/\b(?:db|database)\.(?:run|exec)\(/.test(source.text), source.path).toBe(false)
    }
    expect(SCREENS.length).toBeGreaterThan(20)
    expect(PLUGIN.length).toBeGreaterThan(5)
    expect(INNER.length).toBeGreaterThan(100)
  })
})

/**
 * **What a person does to the file, rather than to the rows in it** (M45 U4,
 * D-455). None of it goes through a repository, so the derivation above cannot
 * see it; the rule holds for it all the same, and this is where it is held.
 *
 * Restoring an earlier copy is the one refused: it overwrites the document from
 * a copy, which a model must never do unasked, and the person it would be done
 * for is the one who knows which moment they want back. The copy a write takes
 * is named in that write's answer, so a conversation can say where it is — and
 * the app's *Earlier copies of this document* is where it is put back.
 */
interface FileAction {
  readonly does: string
  /** Where the person does it, and the call it makes there. */
  readonly screen: string
  readonly call: string
  readonly tool: Tool
  /** Required exactly when there is no tool: the decision refusing one, which must be written down (`decided`). */
  readonly refusedBy?: string
}

const FILE_ACTIONS: readonly FileAction[] = [
  {
    does: 'Keep a copy of the document now, named for what it comes before.',
    screen: 'ui/commands.ts',
    call: 'keepCopy',
    tool: 'keep_copy',
  },
  {
    does: 'Store the document as text or as SQLite bytes from now on (D-246).',
    screen: 'ui/commands.ts',
    call: 'convertTo',
    tool: 'store_document_as',
  },
  {
    does: 'Put an earlier copy back over the document.',
    screen: 'ui/EarlierCopies.tsx',
    call: 'restoreEarlierCopy',
    tool: undefined,
    refusedBy: 'D-455',
  },
]

describe('the file itself (M45 U4, D-455)', () => {
  it('finds each on its screen, and a tool for it or the decision that refuses one', async () => {
    const names = new Set((await listed()).map((tool) => tool.name))
    for (const action of FILE_ACTIONS) {
      expect(calls([{ path: action.screen, text: sourceOf(action.screen) }], action.call), action.does).toBe(true)
      expect(action.tool === undefined, action.does).toBe(action.refusedBy !== undefined)
      if (action.tool !== undefined) {
        expect(names, action.does).toContain(action.tool)
        continue
      }
      expect(decided(action.refusedBy ?? ''), `${action.does} · ${action.refusedBy ?? ''}`).toBe(true)
      // Refused means nobody on that side does it — not by the call, and not by a tool's name.
      expect(calls(PLUGIN, action.call), action.does).toBe(false)
      expect([...names].filter((name) => /restore/i.test(name)), action.does).toEqual([])
    }
  })
})

/**
 * **Tools that are compositions of others** (M47 U3, D-460): one call for what
 * was several, writing nothing the tools they compose do not. The engine gains
 * no write by them, so parity (D-227) is met by the screen of the tools they
 * are made of — the sheet — and what is checked is that it stays so: each
 * composed tool is a capability's, and the composition reaches no write of its
 * own.
 */
const COMPOSITIONS: readonly { readonly tool: string; readonly source: string; readonly of: readonly string[] }[] = [
  { tool: 'land_units', source: 'plugin/tools/landing.ts', of: ['record_format_rows', 'update_format_rows'] },
  { tool: 'claim_units', source: 'plugin/tools/landing.ts', of: ['update_format_rows'] },
]

describe('compositions (M47 U3, D-460)', () => {
  it('composes only tools the audit already holds to both halves, and writes nothing itself', async () => {
    const names = new Set((await listed()).map((tool) => tool.name))
    const capable = new Set(CAPABILITIES.flatMap((capability) => (capability.tool === undefined ? [] : [capability.tool])))
    for (const composition of COMPOSITIONS) {
      expect(names, composition.tool).toContain(composition.tool)
      for (const tool of composition.of) expect(capable, `${composition.tool} · ${tool}`).toContain(tool)
      const source = [{ path: composition.source, text: sourceOf(composition.source) }]
      for (const write of ALL_WRITES) expect(calls(source, write), `${composition.tool} · ${write}`).toBe(false)
    }
  })
})

/**
 * **A filter is one question on both sides** (M37 U3, D-476). Reads are not
 * counted above, but a filter the screen can hold and a conversation cannot ask
 * — several values of a column, `is not`, `is empty` — is the drift D-227 is
 * about, so it is asked here the way each half asks it: the address the screen
 * writes, read as the screen reads it, against `format_rows` and `show_format`
 * called as a conversation calls them, on the project's own memory.
 */
describe('a filter, asked by the address and by a call (M37 U3, D-476)', () => {
  const MEMORY = new URL('../docs/memory.emd', import.meta.url)
  // The address spells the empty cell as nothing, a call as `null`: one question.
  const ASKED: readonly { readonly address: string; readonly match: Record<string, unknown>; readonly call?: Record<string, unknown> }[] = [
    { address: '?state=planned,in_progress', match: { state: ['planned', 'in_progress'] } },
    { address: '?state!=built', match: { state: { not: 'built' } } },
    { address: '?state!=built,dropped', match: { state: { not: ['built', 'dropped'] } } },
    { address: '?decision=', match: { decision: '' }, call: { decision: null } },
    { address: '?decision!=', match: { decision: { not: '' } }, call: { decision: { not: null } } },
  ]

  it('finds the same rows for the same filter, in each spelling', async () => {
    const { addressFilter } = await import('./ui/formats/addressFilter.ts')
    const { filterQuery } = await import('./data/repositories/formatFilterRepository.ts')
    const { listFormats } = await import('./data/repositories/formatRepository.ts')
    const { countRows } = await import('./data/repositories/formatRowRepository.ts')
    const { openEncoded } = await import('./data/storage/encoding.ts')
    const db = (await openEncoded(readFileSync(MEMORY))).db
    const declarations = listFormats(db)
    const unit = declarations.find((each) => each.name === 'unit')
    if (unit === undefined) throw new Error('docs/memory.emd declares unit')

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'parity', version: '0' }, { capabilities: {} })
    await Promise.all([createServer().connect(serverTransport), client.connect(clientTransport)])
    const said = async (name: string, args: Record<string, unknown>): Promise<string> => {
      const answer = await client.callTool({ name, arguments: { path: decodeURIComponent(MEMORY.pathname.replace(/^\/(\w:)/, '$1')), format: 'unit', ...args } })
      const [first] = answer.content as readonly { readonly text?: string }[]
      return first?.text ?? ''
    }
    try {
      for (const { address, match, call = match } of ASKED) {
        const filter = addressFilter(address)
        expect(filter.match, address).toEqual(match)
        const read = filterQuery(db, unit, filter, declarations)
        if (!read.ok) throw new Error(`${address}: ${JSON.stringify(read.error)}`)
        const shown = countRows(db, unit, read.value)
        expect(shown, address).toBeGreaterThan(0)
        const rows = await said('format_rows', { match: call, columns: ['ref'], limit: 1 })
        expect(Number(/^(\d+) rows? of/m.exec(rows)?.[1]), `${address}\n${rows.slice(0, 300)}`).toBe(shown)
        const sheet = await said('show_format', { match: call })
        expect(sheet, address).toContain(`: ${String(shown)} of ${String(countRows(db, unit))} rows.`)
      }
    } finally {
      await client.close()
      db.close()
    }
  })
})
