/**
 * **Which packs a document keeps** — M27 U7.
 *
 * Until this unit the question had one answer, `documentHasLedger`, and the
 * development pack — which `docs/memory.emd` keeps — showed nowhere: its views
 * were reachable only through each format's View menu. Now every pack is
 * asked, and a pack is one entry here plus its own file.
 *
 * **A document keeps a pack because it declares the pack's formats** (D-266),
 * and each pack says how that is checked:
 *
 * - **The ledger by what only it writes** — a seed record (M25 U2), because a
 *   person's own format called `account` must not make a ledger of a recipe
 *   book.
 * - **The development pack by its names, all of them.** It seeds nothing, so a
 *   name is all there is to read; requiring every one of them is what keeps
 *   a person's own `decision` from making a project tracker of their notes.
 *   **A document that declares some of them keeps nothing** — it is not shown
 *   partly, because a roadmap of milestones with no units under it is a sheet
 *   that looks broken. The Packs screen says which of the formats it holds.
 *
 * Nothing is stored to say a pack is shown (D-115): the formats are the answer.
 */

import type { Database } from 'sql.js'

import { err, ok, type Result } from '@/core/result.ts'
import type { LocalDate } from '@/core/time.ts'
import type { ParsedFormat } from '@/domain/format/document.ts'
import { isViewKind, type ViewSetting } from '@/domain/format/view.ts'
import type { GuideChecks, GuideProgress, GuideStep } from '@/domain/guide.ts'

import { dropStoredFeeds } from '../repositories/goalDepositRepository.ts'
import { adoptFormat, listFormats, readFormat } from '../repositories/formatRepository.ts'
import { listViewSettings, writeViewSettings } from '../repositories/formatViewRepository.ts'
import { ledgerGuideChecks, readGuideProgress, saveGuideProgress } from '../repositories/guideRepository.ts'
import {
  DEVELOPMENT_RENAMES,
  developmentFormatNames,
  developmentFormats,
  developmentViews,
  installDevelopmentPack,
} from './development/pack.ts'
import { DEVELOPMENT_PAST } from './development/past.ts'
import { fitOf, followingRenames, type PackRename } from './fit.ts'
import { LEDGER_GUIDE } from './ledger/guide.ts'
import { documentHasLedger, installLedgerPack, ledgerFormatNames, ledgerFormats } from './ledger/pack.ts'
import {
  keptPhrase,
  notesWereThePacks,
  placeKey,
  settingPhrase,
  wasThePacks,
  type PackPast,
  type SettingChange,
} from './past.ts'

/** A view kind that is a place of its own — what a pack's rail section links to. */
export type PlaceKind = 'roadmap' | 'board' | 'ready'

/**
 * Which setting makes a view a place. A roadmap needs a column to run in, a
 * board a column for lanes and a ready view the link it waits on; a format's
 * `roadmap` settings that only fold it under another (`unit`'s) are not one.
 */
const PLACE_SETTING: Record<PlaceKind, string> = { roadmap: 'order', board: 'lanes', ready: 'waits' }

export interface PackDescription {
  readonly id: string
  readonly title: string
  /** One sentence: what the pack is for. */
  readonly summary: string
  /** The pack's format names. */
  readonly formats: () => ReadonlySet<string>
  /** The views that are places, in the order the rail draws them. */
  readonly places: () => readonly { readonly kind: PlaceKind; readonly format: string }[]
  /** Whether a document keeps it. */
  readonly keptBy: (db: Database) => boolean
  /** Its declarations, each after the formats it links to — what keeping it compares a document against. */
  readonly declarations: () => Result<readonly ParsedFormat[], string>
  /**
   * **How a document comes to keep it** (M38 U7): declare what it lacks, and
   * complete what it holds of it. Idempotent. Returns the formats it declared.
   * The Packs screen, `keep_packs` and `create_document` all go through
   * `keepPack` below, which refuses a clash before this runs.
   */
  readonly install: (db: Database, now: number) => Result<readonly string[], string>
  /** Columns it renamed since a document may have kept it (D-443); `install` follows them. */
  readonly renames?: readonly PackRename[]
  /**
   * **Its views and what it declared before** (M51 U9, D-491): with both, keeping
   * it again brings a format's notes and its views' settings to this build's
   * wherever the document still holds what an earlier build wrote, and keeps —
   * and says — whatever a person put there instead. A pack without them (the
   * ledger, which brings itself up to date on every open, D-378) is not asked.
   */
  readonly views?: () => Result<readonly ViewSetting[], string>
  readonly past?: PackPast
  /**
   * **Its guide** (M28 U9, S2, D-330): the steps it declares, what its document
   * says about each, and where the guide stopped. The engine's walk reads this
   * and knows nothing else about the pack; a pack with none has no guide.
   */
  readonly guide?: PackGuide
}

export interface PackGuide {
  readonly steps: readonly GuideStep[]
  readonly checks: (db: Database, asOf: LocalDate) => GuideChecks
  readonly progress: (db: Database) => GuideProgress
  readonly save: (db: Database, progress: GuideProgress, now: number) => void
}

const LEDGER: PackDescription = {
  id: 'ledger',
  title: 'The ledger',
  summary:
    'A complete personal-finance application — statements, paychecks, funds, savings, debts and what they add up to.',
  formats: ledgerFormatNames,
  // Its places are hand-drawn in `ui/nav.ts`, from before a pack could declare a view.
  places: () => [],
  keptBy: documentHasLedger,
  declarations: ledgerFormats,
  install: (db, now) => {
    const installed = installLedgerPack(db, now)
    return installed.ok ? ok(installed.value.declared) : installed
  },
  guide: {
    steps: LEDGER_GUIDE,
    checks: ledgerGuideChecks,
    progress: readGuideProgress,
    save: saveGuideProgress,
  },
}

const DEVELOPMENT: PackDescription = {
  id: 'development',
  title: 'Development',
  summary:
    'A project’s own memory — milestones, units, decisions, open questions, review entries and an inbox for what another project hands it — and the roadmap, boards and ready list drawn from them.',
  formats: developmentFormatNames,
  places: () => {
    const views = developmentViews()
    return views.ok ? placesOf(views.value) : []
  },
  keptBy: (db) => declaresAll(db, developmentFormatNames()),
  declarations: developmentFormats,
  install: (db, now) => {
    const installed = installDevelopmentPack(db, now)
    return installed.ok ? ok(installed.value.declared) : installed
  },
  renames: DEVELOPMENT_RENAMES,
  views: developmentViews,
  past: DEVELOPMENT_PAST,
}

/** Every pack, in the order the rail and the Packs screen show them. */
export const PACKS: readonly PackDescription[] = [LEDGER, DEVELOPMENT]

/**
 * **Bring a document up to what this build's packs declare** (M36 U02, D-378) —
 * the one step every opener takes, the app's and the plugin's, so a document is
 * never read in a shape older than the code reading it. That is what lets the
 * pack's repositories assume their own tables and columns, with no probe and no
 * second read path for a document the pack has grown since.
 *
 * The ledger is installed where the document keeps one (D-266) — idempotent, so
 * a document already up to date changes nothing. A bank account's own cash is
 * made with the account and nowhere else (M36 U08, D-385): an account an older
 * build wrote without one is not given it here, since this project converts no
 * old document. A document that keeps no ledger is left as it is; the
 * development pack seeds nothing and grows nothing a document already declares.
 * The deposits an older build stored for a goal's feeds go (M36 U05, D-381):
 * they are worked out on read now, and kept they would count twice.
 *
 * Returns how many rows that changed, so the app can say the document changed,
 * or the sentence saying why the ledger would not install.
 */
export function bringUpToDate(db: Database, now: number): Result<{ readonly changed: number }, string> {
  if (!documentHasLedger(db)) return ok({ changed: 0 })
  const installed = installLedgerPack(db, now)
  if (!installed.ok) return installed
  return ok({ changed: dropStoredFeeds(db) })
}

/** A pack by its id, as a conversation names it. */
export function packById(id: string): PackDescription | undefined {
  return PACKS.find((pack) => pack.id === id)
}

/**
 * **What keeping a pack would do to a document** (M38 U7, D-405) — the plan the
 * Packs screen draws under the button and `keep_packs` returns as its dry run.
 */
export interface KeepPlan {
  readonly pack: PackDescription
  /** The document keeps it already, and keeping it again changes nothing. */
  readonly kept: boolean
  /** The pack's formats the document does not declare: keeping it declares them. */
  readonly declares: readonly string[]
  /** Formats the document holds that are the pack's and lack optional columns: keeping it adds them. */
  readonly completes: readonly { readonly format: string; readonly columns: readonly string[] }[]
  /** Columns the pack renamed that the document still holds by the old name: keeping it renames them, values kept (D-443). */
  readonly renames: readonly PackRename[]
  /** Formats the document holds that are the pack's already, whole. */
  readonly holds: readonly string[]
  /** Formats whose notes are an earlier build's: keeping it writes this build's (D-491). */
  readonly notes: readonly string[]
  /** Formats whose notes the document rewrote itself: keeping it leaves them, and says so. */
  readonly notesKept: readonly string[]
  /** View settings an earlier build wrote that this one changed: keeping it writes them (D-491). */
  readonly settings: readonly SettingChange[]
  /** View settings a person chose over the pack's: keeping it leaves them, and says so — `from` theirs, `to` the pack's. */
  readonly settingsKept: readonly SettingChange[]
  /** Why it would be refused: a format of the document's own that shares a name and not a shape. */
  readonly clashes: readonly string[]
}

/**
 * Plan keeping `pack` in a document, writing nothing. **A document with rows
 * may keep a pack** (D-405): keeping one only adds — formats, and optional
 * columns on formats that are already the pack's — so no row is re-meant, and
 * a clash is the one thing refused.
 */
export function planKeep(db: Database, pack: PackDescription): Result<KeepPlan, string> {
  const declarations = pack.declarations()
  if (!declarations.ok) return declarations
  const views = pack.views?.()
  if (views?.ok === false) return views
  const kept = pack.keptBy(db)
  const declares: string[] = []
  const completes: { format: string; columns: readonly string[] }[] = []
  const holds: string[] = []
  const clashes: string[] = []
  const renames: PackRename[] = []
  const notes: string[] = []
  const notesKept: string[] = []
  const settings: SettingChange[] = []
  const settingsKept: SettingChange[] = []
  const held = views === undefined ? [] : listViewSettings(db)
  for (const { declaration } of declarations.value) {
    const read = readFormat(db, declaration.name)
    if (read === undefined) {
      declares.push(declaration.name)
      continue
    }
    const { held: following, renames: due } = followingRenames(read, pack.renames ?? [])
    renames.push(...due)
    const fit = fitOf(following, declaration)
    // A pack the document keeps already is its own business: the ledger
    // grows and retires its formats on every open (D-378), so a difference
    // from this build's declaration there is not a person's format in the way.
    if (!kept) clashes.push(...fit.clashes)
    if (fit.missing.length > 0) completes.push({ format: declaration.name, columns: fit.missing.map((each) => each.name) })
    else if (due.length === 0) holds.push(declaration.name)

    // Its notes and its views' settings (D-491), where the pack says what it
    // declared before.
    const past = pack.past
    if (past === undefined || views === undefined) continue
    if (read.notes !== declaration.notes) {
      ;(notesWereThePacks(past, declaration.name, read.notes) ? notes : notesKept).push(declaration.name)
    }
    const changes = settingChanges(
      declaration.name,
      views.value,
      held,
      past,
      new Map(due.map((each) => [each.from, each.to])),
      // A column keeping it grows takes its views with it (`install`), so it
      // is not counted twice here.
      new Set(fit.missing.map((each) => each.name)),
    )
    for (const change of changes) (wasThePacks(past, change, change.from) ? settings : settingsKept).push(change)
  }
  return ok({ pack, kept, declares, completes, renames, holds, clashes, notes, notesKept, settings, settingsKept })
}

/**
 * Every place where the document's setting for `format` is not the pack's: each
 * place the pack declares a line now, and each it declared one before. The
 * document's columns are read by the names the pack uses (`renamed`, old to
 * new); a place of the document's own the pack never declared is not asked.
 */
function settingChanges(
  format: string,
  theirs: readonly ViewSetting[],
  ours: readonly ViewSetting[],
  past: PackPast,
  renamed: ReadonlyMap<string, string>,
  growing: ReadonlySet<string>,
): readonly SettingChange[] {
  const pack = new Map(theirs.filter((each) => each.format === format).map((each) => [placeKey(each), each] as const))
  const held = new Map(
    ours
      .filter((each) => each.format === format)
      .map((each) => {
        const place = { ...each, column: renamed.get(each.column) ?? each.column }
        return [placeKey(place), place] as const
      }),
  )
  const places = new Map<string, { readonly view: ViewSetting['view']; readonly column: string }>()
  for (const [key, each] of pack) places.set(key, each)
  for (const key of Object.keys(past.views)) {
    const [name, view, column] = key.split(' ')
    if (name !== format || view === undefined || column === undefined || places.has(key) || !isViewKind(view)) continue
    places.set(key, { view, column })
  }
  const changes: SettingChange[] = []
  for (const [key, place] of places) {
    if (growing.has(place.column)) continue
    const from = held.get(key)?.setting
    const to = pack.get(key)?.setting
    if (from !== to) changes.push({ format, view: place.view, column: place.column, from, to })
  }
  return changes
}

/**
 * **Whether keeping it again would change nothing** — kept, and holding every
 * column this build's pack declares by the name it declares it (D-443). A
 * document that kept the pack before it grew a column or renamed one is kept
 * and still behind, and keeping it again is how it catches up.
 */
export function upToDate(plan: KeepPlan): boolean {
  return (
    plan.kept &&
    plan.declares.length === 0 &&
    plan.completes.length === 0 &&
    plan.renames.length === 0 &&
    plan.notes.length === 0 &&
    plan.settings.length === 0
  )
}

/**
 * **What keeping it does, a phrase each** — the one wording `keep_packs` and the
 * Packs screen both say (D-227, D-491), so a conversation and a person are
 * shown the same plan. `done` puts it in the past tense.
 */
export function planParts(plan: KeepPlan, done: boolean): readonly string[] {
  const verb = (now: string, then: string): string => (done ? then : now)
  return [
    ...(plan.declares.length > 0 ? [`${verb('declares', 'declared')} ${plan.declares.join(', ')}`] : []),
    ...plan.renames.map((each) => `${verb('renames', 'renamed')} ${each.format}.${each.from} to ${each.to}, its values kept`),
    ...plan.completes.map((each) => `${verb('completes', 'completed')} ${each.format} with ${each.columns.join(', ')}`),
    ...(plan.notes.length > 0 ? [`${verb('brings', 'brought')} the notes of ${plan.notes.join(', ')} to this build’s`] : []),
    ...plan.settings.map((each) => settingPhrase(each, done)),
  ]
}

/**
 * **What a person chose that keeping it leaves** (D-491): notes they rewrote and
 * view settings they changed, which a newer pack never overwrites. Empty when
 * there are none.
 */
export function keptParts(plan: KeepPlan): readonly string[] {
  return [
    ...(plan.notesKept.length > 0 ? [`the notes of ${plan.notesKept.join(', ')}, which this document rewrote`] : []),
    ...plan.settingsKept.map(keptPhrase),
  ]
}

/**
 * **Keep a pack in a document** (M38 U7, D-405) — the one write behind the
 * Packs screen's *Keep this pack here*, `keep_packs` and `create_document`'s
 * `packs`. A pack the document keeps already is left alone and says so, unless
 * this build's pack has grown or renamed a column since (D-443); a clash is
 * refused, naming the column, before anything is written.
 */
export function keepPack(db: Database, pack: PackDescription, now: number): Result<KeepPlan, string> {
  const plan = planKeep(db, pack)
  if (!plan.ok || upToDate(plan.value)) return plan
  if (!plan.value.kept && plan.value.clashes.length > 0) return err(clashSentence(plan.value))
  const installed = pack.install(db, now)
  if (!installed.ok) return installed
  // The notes and settings an earlier build wrote, brought to this one's
  // (D-491); what a person chose was left out of the plan and is not touched.
  const declarations = pack.declarations()
  if (!declarations.ok) return declarations
  for (const name of plan.value.notes) {
    const held = readFormat(db, name)
    const notes = declarations.value.find((each) => each.declaration.name === name)?.declaration.notes
    if (held === undefined || notes === undefined) continue
    const adopted = adoptFormat(db, { ...held, notes }, now)
    if (adopted.refusals.length > 0) return err(adopted.refusals.map((each) => each.detail).join(' '))
  }
  writeViewSettings(
    db,
    plan.value.settings.map((each) => ({ format: each.format, view: each.view, column: each.column, setting: each.to })),
  )
  return plan
}

/** The sentence a refused keep says. */
export function clashSentence(plan: KeepPlan): string {
  return (
    `${plan.pack.title} was not kept: this document's own formats share its names and not its shape. ` +
    `${plan.clashes.join(' ')} Rename or remove those formats first, or keep the document as it is.`
  )
}

/** The packs a document keeps. */
export function packsKeptBy(db: Database | undefined): ReadonlySet<string> {
  if (db === undefined) return new Set()
  return new Set(PACKS.filter((pack) => pack.keptBy(db)).map((pack) => pack.id))
}

/**
 * A pack's views that are places: the first view of each kind on each format
 * that carries the setting making it one, in the order the views are written.
 */
export function placesOf(
  views: readonly { readonly format: string; readonly view: string; readonly setting: string }[],
): readonly { readonly kind: PlaceKind; readonly format: string }[] {
  const places: { kind: PlaceKind; format: string }[] = []
  for (const kind of ['roadmap', 'board', 'ready'] as const) {
    for (const view of views) {
      if (view.view !== kind || view.setting.split(/\s+/)[0] !== PLACE_SETTING[kind]) continue
      if (!places.some((each) => each.kind === kind && each.format === view.format)) {
        places.push({ kind, format: view.format })
      }
    }
  }
  return places
}

/** The guide of the first kept pack that has one — the ledger's, today. */
export function guideFor(kept: ReadonlySet<string>): PackGuide | undefined {
  return PACKS.find((pack) => kept.has(pack.id) && pack.guide !== undefined)?.guide
}

function declaresAll(db: Database, names: ReadonlySet<string>): boolean {
  if (names.size === 0) return false
  const declared = new Set(listFormats(db).map((format) => format.name))
  return [...names].every((name) => declared.has(name))
}
