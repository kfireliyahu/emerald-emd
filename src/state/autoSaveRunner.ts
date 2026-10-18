import { AUTO_SAVE_IDLE_MS, autoSaveAt, mayAutoSave } from '@/data/storage/autoSave.ts'
import { useDocumentStore } from '@/state/documentStore.ts'

/**
 * The app writes the document instead of asking you to (D-155) — the *when*,
 * with no React in it.
 *
 * Separated from `useAutoSave` for the reason `externalChange.ts` is separated
 * from the store: this is the half that can be wrong in a way nobody would see
 * until it wrote a file it should not have, and it is the half a Node test can
 * drive. The hook is three lines around it.
 *
 * **It adds no rule of its own.** Every refusal is `mayAutoSave`, and the write
 * is `save()` — the same call the Save button makes, so the external-change
 * check, the cancelled-picker branch and the crash-cache clear are the ones
 * that were already tested. What lives here is a debounce off the store's
 * revision, capped by a ceiling.
 *
 * **Rule 3 is the one to watch when this breaks** (D-155): the directory watcher must not read the app's own rename back as
 * somebody else's change. It does not, for two reasons that both have to hold —
 * `useDiskWatch` skips its check while `busy` is set, and `save()` records the
 * new mark before it clears `busy`. A bug here looks like the app arguing with
 * itself about a file nobody else touched.
 */
export function startAutoSave(
  timing: { readonly idleMs?: number; readonly ceilingMs?: number } = {},
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  // The first unsaved edit of the current run, which is what the ceiling is
  // measured from. Cleared whenever the document is written or the run ends.
  let firstEditAt: number | undefined

  const stop = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    firstEditAt = undefined
  }

  const write = (): void => {
    timer = undefined
    const state = useDocumentStore.getState()

    // A save the user asked for, or an open, is in flight. Come back rather
    // than dropping the run: this document still has unsaved work in it.
    if (state.busy !== undefined && state.isDirty) {
      timer = setTimeout(write, timing.idleMs ?? AUTO_SAVE_IDLE_MS)
      return
    }

    const allowed = mayAutoSave({
      hasDocument: state.db !== undefined,
      isDirty: state.isDirty,
      isBusy: state.busy !== undefined,
      canSaveSilently: state.adapter.canSaveSilently,
      knowsTheFile: state.knownMark !== undefined,
      diskState: state.diskState,
    })

    firstEditAt = undefined
    // A refusal ends the run rather than retrying it. The conflict notice is
    // already on screen and the dirty dot still says unsaved; a timer that
    // fires every second into a standing conflict is the app answering its own
    // question. The next edit schedules a fresh attempt, and `Ctrl+S` was never
    // taken away.
    if (allowed) void state.save()
  }

  const unsubscribe = useDocumentStore.subscribe((state, previous) => {
    // `revision` is the trigger rather than `isDirty` because exactly one thing
    // bumps it per mutation. Opening a document bumps it too, and that lands
    // with `isDirty` false — which is the branch below, not a write.
    if (state.revision === previous.revision) return
    if (!state.isDirty) {
      stop()
      return
    }
    const now = Date.now()
    firstEditAt ??= now
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(write, Math.max(0, autoSaveAt(firstEditAt, now, timing) - now))
  })

  return () => {
    unsubscribe()
    stop()
  }
}
