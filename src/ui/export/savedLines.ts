import type { ExportFile, ExportFileState } from '../../../electron/bridge.ts'
import type { SavedExportText } from '@/data/export/formatExport.ts'
import type { MessageKey } from '@/i18n/catalogue.ts'

/**
 * **What Settings › Export's saved exports show, worked out without React**
 * (M63 U4, D-605): each saved export's line — its file, what it holds, and the
 * word for whether the file on disk holds it — from the bytes the page worked
 * out and the shell's answer for each file. `SavedExports.tsx` draws these.
 */
export interface SavedLine {
  /** As the row holds it, relative to the document's folder. */
  readonly file: string
  /** How many rows of which format it holds; absent when the row could not be worked out. */
  readonly holds?: { readonly rows: number; readonly format: string }
  /** The state's word, or `undefined` while the shell has not answered. */
  readonly word: MessageKey | undefined
  /** The shared `.fc-state` mark's tone (`ui/formats/tone.ts`): done when current, waiting when owed. */
  readonly tone: 'done' | 'waiting' | undefined
  /**
   * Why it is not written: the document's sentence (an unknown format or
   * column, a line that cannot be read), or `outside` when the shell refused
   * the file for leaving the document's folder.
   */
  readonly refusal?: { readonly said: string } | 'outside'
}

export function savedLines(saved: readonly SavedExportText[], states: ReadonlyMap<string, ExportFileState>): readonly SavedLine[] {
  return saved.map((each): SavedLine => {
    if (!each.exported.ok) {
      return { file: each.file, word: 'settings.export.saved.refused', tone: undefined, refusal: { said: each.exported.error } }
    }
    const holds = { rows: each.exported.value.rows, format: each.exported.value.format }
    const state = states.get(each.file)
    switch (state) {
      case undefined:
        return { file: each.file, holds, word: undefined, tone: undefined }
      case 'refused':
        return { file: each.file, holds, word: 'settings.export.saved.refused', tone: undefined, refusal: 'outside' }
      case 'current':
      case 'written':
        return { file: each.file, holds, word: 'settings.export.saved.current', tone: 'done' }
      case 'differs':
        return { file: each.file, holds, word: 'settings.export.saved.differs', tone: 'waiting' }
      case 'missing':
        return { file: each.file, holds, word: 'settings.export.saved.missing', tone: 'waiting' }
    }
  })
}

/** What the page asks the shell about: every saved export that could be worked out, with its bytes. */
export function exportFiles(saved: readonly SavedExportText[]): readonly ExportFile[] {
  return saved.flatMap((each): ExportFile[] => (each.exported.ok ? [{ file: each.file, text: each.exported.value.text }] : []))
}

/** What the button writes: the files the shell found stale or missing, and nothing it has not answered for. */
export function owedFiles(files: readonly ExportFile[], states: ReadonlyMap<string, ExportFileState>): readonly ExportFile[] {
  return files.filter((each) => {
    const state = states.get(each.file)
    return state === 'differs' || state === 'missing'
  })
}
