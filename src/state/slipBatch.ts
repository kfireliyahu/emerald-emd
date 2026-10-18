import type { BatchSlip } from '@/data/importer/slipBatch.ts'
import { createStore } from './store.ts'

/**
 * **The batch of payslips being read, kept where the screen cannot take it
 * away** — M28 F1, D-171's fix for the batch D-171 predates.
 *
 * From M28 U3's trial: *"when i added my paychecks it started reading.
 * then i went to another tab and its gone.. but i think its still reading in
 * the background."* Both were true. The batch lived in
 * `ReadSlips`' `useState`, so leaving the screen threw away every slip already
 * read, and the loop kept calling the model for slips nothing would ever show.
 * Here the loop writes into this store instead, so coming back finds the batch
 * where it was — and `SlipBatchBar` says it is still going, with the way back
 * and a Stop, while you are somewhere else.
 *
 * **Per document.** `owner` is the database the batch was read against; a batch
 * whose owner is not the open document is somebody else's and is shown nowhere.
 *
 * A plain store rather than zustand, like `reading.ts`, for its reason: this is
 * what is happening right now, and a reload has nothing happening.
 */
export interface SlipBatchState {
  readonly owner: unknown
  readonly slips: readonly BatchSlip[]
  /** What a person named each reader's rows, by `namingKey` and then by field. */
  readonly named: ReadonlyMap<string, ReadonlyMap<string, string>>
  readonly ticks: ReadonlyMap<string, boolean>
  /** What it is reading now; undefined when nothing is being read. */
  readonly progress: string | undefined
  readonly problem: string | undefined
}

const EMPTY: SlipBatchState = {
  owner: undefined,
  slips: [],
  named: new Map(),
  ticks: new Map(),
  progress: undefined,
  problem: undefined,
}

const batch = createStore<SlipBatchState>(EMPTY)
let stopping = false

export function useSlipBatch(): SlipBatchState {
  return batch.use()
}

/** The same answer outside React. */
export function slipBatchNow(): SlipBatchState {
  return batch.get()
}

export function updateSlipBatch(change: (state: SlipBatchState) => SlipBatchState): void {
  batch.set(change(batch.get()))
}

/** Nothing read and nothing waiting — a batch written, or a document changed. */
export function clearSlipBatch(): void {
  stopping = false
  updateSlipBatch(() => EMPTY)
}

/** Asked between slips; the slip being read finishes or is cancelled by its caller. */
export function stopSlipBatch(): void {
  stopping = true
}

export function slipBatchStopping(): boolean {
  return stopping
}

/** A new run starting: whatever stop was asked of the last one is spent. */
export function resumeSlipBatch(): void {
  stopping = false
}

/** Whether a batch belongs to this document and still has something to show. */
export function isLive(state: SlipBatchState, owner: unknown): boolean {
  return state.owner === owner && (state.progress !== undefined || state.slips.length > 0)
}
