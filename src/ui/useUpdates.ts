import { useEffect } from 'react'

import type { UpdateState } from '../../electron/bridge.ts'
import { shellUpdates } from '@/data/storage/desktop.ts'
import { createStore } from '@/state/store.ts'

/**
 * **What the shell says about updates** (M42 U8, D-502), held once for the window: the setting
 * About switches, and the notice the notice region shows. The main process asks GitHub and
 * decides; this only listens. Outside the shell, and in a shell older than M42 U8, it is
 * `undefined` and nothing about updates is drawn.
 */
const state = createStore<UpdateState | undefined>(undefined)

let listening = false

/** Subscribe once, and ask for where things stand — a check at start may have answered already. */
function listen(): void {
  const updates = shellUpdates()
  if (listening || updates === undefined) return
  listening = true
  updates.onChange((next) => state.set(next))
  void updates.state().then(
    (next) => state.set(next),
    () => undefined,
  )
}

export function useUpdateState(): UpdateState | undefined {
  useEffect(listen, [])
  return state.use()
}

/** Every call answers with the state after it, which the window shows at once. */
export async function answer(call: Promise<UpdateState>): Promise<void> {
  try {
    state.set(await call)
  } catch {
    // The shell reports a failed check as a notice; a refused call has nothing to add.
  }
}
