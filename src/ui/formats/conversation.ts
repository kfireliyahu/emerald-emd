import { createContext, type MouseEvent } from 'react'

import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import type { StoredRow } from '@/domain/format/row.ts'

/**
 * **What a view may hand to the conversation it is drawn in** (M51 U7) — only
 * the frame provides it, and only what its host offers (`src/frame/host.ts`'s
 * `Offers`). The app provides nothing, so every view in the app is as it was,
 * and so is the frame in a host that offers neither.
 *
 * **Still read-only**: nothing here writes the document. Starting a row sends
 * a line the person could have typed; selecting rows tells the model which
 * rows "these" means.
 */
export interface Conversation {
  /**
   * Send one line naming the row and what its entry says at length — a ready
   * row's *Start this unit*. Absent where the host takes no message.
   */
  readonly start?: (format: FormatDeclaration, row: StoredRow) => void
  /**
   * The rows the person selected, which the model is told of. Absent where the
   * host takes no model context: then no row can be selected.
   */
  readonly selection?: {
    readonly has: (id: string) => boolean
    readonly toggle: (format: FormatDeclaration, row: StoredRow) => void
  }
}

export const Conversation = createContext<Conversation>({})

/**
 * **A click that selects rather than opens** (M51 U7): Ctrl, or ⌘ on a Mac —
 * the desktop's own gesture for picking one more. Plain clicks open the row as
 * they always did.
 */
export function selects(event: MouseEvent, conversation: Conversation): boolean {
  return conversation.selection !== undefined && (event.ctrlKey || event.metaKey)
}
