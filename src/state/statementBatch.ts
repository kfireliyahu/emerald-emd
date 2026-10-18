import type { SheetWorkbook } from '@/data/importer/sheetTable.ts'
import type { SheetVerdict, StatementSheet } from '@/data/importer/statementBatch.ts'
import { createStore } from './store.ts'

/**
 * **The files Home is reading, kept where the screen cannot take them away** —
 * M28 U5, on the pattern M28 F1 set for the payslip batch.
 *
 * A statement reads in milliseconds, so there is no loop to outlive a screen
 * here; what has to outlive it is the *read* — sheets judged and ticked, a row
 * somebody typed a figure into, a file waiting on the mapper — none of which is
 * written until Write. Leaving `#/read` for the mapper, or for anywhere, and
 * coming back finds it where it was.
 *
 * **Per document**, by `owner`, like the slip batch: a batch read against
 * another database is shown nowhere.
 */
export type BatchFile =
  | { readonly kind: 'reading'; readonly id: string; readonly fileName: string }
  /** One sheet a stored reader knows. A file with two such sheets is two of these. */
  | { readonly kind: 'sheet'; readonly id: string; readonly fileName: string; readonly sheet: StatementSheet }
  /** No saved mapping fits it: the column mapper is the next step. */
  | {
      readonly kind: 'new-layout'
      readonly id: string
      readonly fileName: string
      readonly workbook: SheetWorkbook
      readonly fileHash: string
    }
  /** A payslip, which Paychecks reads (M28 U3) — handed there, not read here. */
  | { readonly kind: 'payslip'; readonly id: string; readonly fileName: string; readonly file: File }
  | { readonly kind: 'failed'; readonly id: string; readonly fileName: string; readonly message: string }

export interface StatementBatchState {
  readonly owner: unknown
  readonly files: readonly BatchFile[]
  /** A person's say on a sheet: ticked or left out. Absent is the verdict's default. */
  readonly ticks: ReadonlyMap<string, boolean>
  /** Sheets written although their running balance disagrees — *Write anyway*. */
  readonly forced: ReadonlySet<string>
  /**
   * A new layout on its way to the column mapper, which takes the whole window
   * (`App`), and comes back here as a sheet when it is mapped.
   */
  readonly mapping: Extract<BatchFile, { kind: 'new-layout' }> | undefined
}

const EMPTY: StatementBatchState = {
  owner: undefined,
  files: [],
  ticks: new Map(),
  forced: new Set(),
  mapping: undefined,
}

const batch = createStore<StatementBatchState>(EMPTY)

export function useStatementBatch(): StatementBatchState {
  return batch.use()
}

/**
 * Change the batch for `owner`. A batch that was another document's is
 * dropped first, so nothing read against one file can be written into another.
 */
export function updateStatementBatch(
  owner: unknown,
  change: (state: StatementBatchState) => StatementBatchState,
): void {
  const current = batch.get()
  batch.set(change(current.owner === owner ? current : { ...EMPTY, owner }))
}

/** The batch as `owner` sees it: its own, or nothing. */
export function batchFor(state: StatementBatchState, owner: unknown): StatementBatchState {
  return state.owner === owner ? state : { ...EMPTY, owner }
}

/** The batch's sheets, in its order — the order Write writes them in. */
export function sheetsOf(state: StatementBatchState): readonly { readonly id: string; readonly sheet: StatementSheet }[] {
  return state.files.flatMap((file) => (file.kind === 'sheet' ? [{ id: file.id, sheet: file.sheet }] : []))
}

/**
 * Whether Write writes a sheet: one that adds up is ticked unless a person
 * unticked it; one with a gap only when they said *Write anyway*; one already
 * written, or whose rows are in another account until they say which, never.
 */
export function writesSheet(state: StatementBatchState, id: string, verdict: SheetVerdict | undefined): boolean {
  if (verdict === undefined || verdict.state === 'same' || verdict.state === 'elsewhere') return false
  const said = state.ticks.get(id)
  if (verdict.state === 'gap') return state.forced.has(id) && said !== false
  return said ?? true
}

/**
 * The batch with these files taken out before anything is written (M28 F12):
 * a person's tick, a *Write anyway* and a trip to the mapper go with the file,
 * so nothing of it is left to be written or mapped. A file still reading is
 * taken out too, and the read that finishes later finds no row to land on.
 */
export function withoutFiles(state: StatementBatchState, ids: ReadonlySet<string>): StatementBatchState {
  const ticks = new Map(state.ticks)
  const forced = new Set(state.forced)
  for (const id of ids) {
    ticks.delete(id)
    forced.delete(id)
  }
  return {
    ...state,
    files: state.files.filter((file) => !ids.has(file.id)),
    ticks,
    forced,
    mapping: state.mapping !== undefined && ids.has(state.mapping.id) ? undefined : state.mapping,
  }
}

/**
 * **What the bottom bar says about a batch left behind** (M28 F14), or nothing
 * when there is nothing to keep: the batch is another document's, it is empty,
 * or the mapper — the batch's own next step — has the window.
 *
 * Read files was closed with files still on it and they were not gone,
 * only invisible: the batch outlived the screen, as M28 U5 built it to, and
 * nothing said so. `SlipBatchBar`'s bargain (D-311) is the answer for this
 * batch too: a file still reading keeps the bar *reading*, and once it is over
 * the bar stays while anything waits, because none of it is written until Write.
 */
export function batchLine(
  state: StatementBatchState,
  owner: unknown,
): { readonly reading: boolean; readonly title: string; readonly detail: string } | undefined {
  if (state.owner !== owner || state.files.length === 0 || state.mapping !== undefined) return undefined
  const total = state.files.length
  const still = state.files.filter((file) => file.kind === 'reading').length
  const files = (count: number): string => (count === 1 ? '1 file' : `${String(count)} files`)
  if (still > 0) return { reading: true, title: 'Reading files', detail: `${String(total - still)} of ${String(total)} read` }
  return { reading: false, title: `${files(total)} read`, detail: 'Not written yet.' }
}
