import { useMemo } from 'react'

import { guideFor } from '@/data/packs/packs.ts'
import { shellDocuments } from '@/data/storage/desktop.ts'
import type { GuideChecks, GuideProgress, GuideStep } from '@/domain/guide.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { useKeptPacks } from '@/ui/packs.ts'
import { today } from '@/ui/today.ts'

export interface OpenGuide {
  readonly steps: readonly GuideStep[]
  readonly checks: GuideChecks
  readonly progress: GuideProgress
  /** Where the guide stopped, written to the document. Only on put away, finish and the offer's answer. */
  readonly save: (next: GuideProgress) => void
}

/**
 * The open document's guide — its pack's steps, what the document says about
 * each, and where it stopped — or `undefined` when no kept pack declares one.
 *
 * `active` false skips the checks, which read the plan and the cushion: the line
 * on Home and the open dialog ask, and nothing else pays for the question.
 */
export function useGuide(active: boolean): OpenGuide | undefined {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const guide = guideFor(useKeptPacks())

  const progress = useMemo(
    () => (db === undefined || guide === undefined ? undefined : guide.progress(db)),
    [db, revision, guide],
  )
  const checks = useMemo(
    () => (db === undefined || guide === undefined || !active ? {} : guide.checks(db, today())),
    [db, revision, guide, active],
  )

  if (guide === undefined || progress === undefined) return undefined
  return {
    steps: guide.steps,
    checks,
    progress,
    save: (next) => mutate((database) => guide.save(database, next, Date.now())),
  }
}

/**
 * Where the guide can be reopened from, in this front end's words: the shell has
 * Help › Guide me; a browser tab has no menu bar, so it is the palette.
 */
export function reopenedFrom(): string {
  return shellDocuments() === undefined ? 'Ctrl+K › Guide me' : 'Help › Guide me'
}
