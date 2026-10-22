import type { Database } from 'sql.js'

import { err, ok, type Result } from '@/core/result.ts'
import { adoptFormat } from '@/data/repositories/formatRepository.ts'
import { allDashboardBlocks } from '@/data/repositories/formatViewRepository.ts'
import { listUnits } from '@/data/repositories/unitRepository.ts'
import { DECLARATION_LANGUAGE, declarationProblems, type FormatDeclaration } from '@/domain/format/declaration.ts'
import { declarationChangeRefusal } from '@/domain/format/owner.ts'

import { rollupName } from './madeInPlace.ts'

/**
 * **A chart is renamed and deleted where it is listed** — M53 F3, amending
 * D-521. A chart is a rollup in its format's declaration; the rail lists a
 * format's rollups under it beside its saved views, and its tab on the format
 * deletes it too.
 *
 * **No new write**: the format's declaration with the rollup renamed or gone,
 * adopted by `adoptFormat` — the format's own edit, and `extend_format rename`
 * and `remove` in a conversation. `adoptFormat` takes a dashboard's chart
 * blocks along: renamed with the rollup, deleted with it, as a deleted saved
 * view's blocks are (M53 U7).
 */

/** A rollup's change, judged and ready to adopt. */
export interface RollupChange {
  readonly after: FormatDeclaration
  /** New name to old, as `adoptFormat` takes them — a rollup's, here. */
  readonly renames: ReadonlyMap<string, string>
}

/** The declaration as a person's edit writes it, or why it may not be. */
function judged(
  db: Database,
  declarations: readonly FormatDeclaration[],
  before: FormatDeclaration,
  rollups: NonNullable<FormatDeclaration['rollups']>,
): Result<FormatDeclaration, string> {
  const after: FormatDeclaration = { ...before, language: DECLARATION_LANGUAGE, rollups }
  const problems = declarationProblems(
    after,
    declarations.filter((each) => each.name !== before.name),
    listUnits(db),
  )
  if (problems.length > 0) return err(problems.map((each) => each.message).join(' '))
  const owned = declarationChangeRefusal(before, after)
  if (owned !== undefined) return err(owned)
  return ok(after)
}

/**
 * **A rollup under another name** — what the person typed, folded as *New
 * chart* folds it (`Done by month` is `done_by_month`) — or why not. A
 * dashboard holding its chart beside a block already called that is refused,
 * so the chart never loses its rollup to a rename.
 */
export function rollupRenamed(
  db: Database,
  declarations: readonly FormatDeclaration[],
  format: string,
  from: string,
  words: string,
): Result<RollupChange | undefined, string> {
  const before = declarations.find((each) => each.name === format)
  if (before === undefined) return err(`${format} is not declared here any more.`)
  if (!(before.rollups ?? []).some((each) => each.name === from)) return err(`${before.title} has no rollup called ${from} any more.`)
  const to = rollupName(words)
  if (to === '') return err('Give it a name.')
  if (to === from) return ok(undefined)
  const blocks = allDashboardBlocks(db).filter((each) => each.format === format)
  const crowded = blocks.find(
    (each) =>
      each.name === to &&
      blocks.some((chart) => chart.kind === 'rollup' && chart.name === from && chart.dashboard === each.dashboard),
  )
  if (crowded !== undefined) {
    return err(`A dashboard holding this chart has a block called ${to} already.`)
  }
  const after = judged(
    db,
    declarations,
    before,
    (before.rollups ?? []).map((each) => (each.name === from ? { ...each, name: to } : each)),
  )
  return after.ok ? ok({ after: after.value, renames: new Map([[to, from]]) }) : after
}

/** **A rollup gone** from its format's declaration, or why it may not go. */
export function rollupDeleted(
  db: Database,
  declarations: readonly FormatDeclaration[],
  format: string,
  name: string,
): Result<RollupChange, string> {
  const before = declarations.find((each) => each.name === format)
  if (before === undefined) return err(`${format} is not declared here any more.`)
  if (!(before.rollups ?? []).some((each) => each.name === name)) return err(`${before.title} has no rollup called ${name} any more.`)
  const after = judged(db, declarations, before, (before.rollups ?? []).filter((each) => each.name !== name))
  return after.ok ? ok({ after: after.value, renames: new Map() }) : after
}

/**
 * **Adopt it** — and a dashboard's chart of it follows or goes, in the same
 * transaction. A document that stopped agreeing since it was judged throws
 * its refusal, and nothing is written.
 */
export function changeRollup(db: Database, change: RollupChange): void {
  const adopted = adoptFormat(db, change.after, Date.now(), change.renames)
  if (adopted.refusals.length > 0) throw new Error(adopted.refusals.map((each) => each.detail).join(' '))
}
