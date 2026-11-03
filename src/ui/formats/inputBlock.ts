/**
 * **An input view on a dashboard** — M55 U4, D-533, D-535, U1's brief
 * (`docs/mockups/m55-u1/brief.md` §6, *On a dashboard*). Pure on the document:
 * the sentence under a block's title, where its form starts, the row it adds
 * — judged and written as `record_format_rows` writes one, so no new write —
 * taking one back, and making a new input view with its block in one step.
 *
 * The page (`InputView.tsx`) judges its rows with the entry's own judge; a
 * block has no entry beside it, so it asks the batch the tool asks, which says
 * every refusal at once and at its column (M55 U5, D-545).
 */

import type { Database } from 'sql.js'

import { inTransaction } from '@/data/db/database.ts'
import { stageRows, type StagedRow } from '@/data/repositories/formatBatchRepository.ts'
import { insertRows, rowsLinkingTo } from '@/data/repositories/formatRowRepository.ts'
import { saveView, savedViews, setDashboardBlocks } from '@/data/repositories/formatViewRepository.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { INPUT_KIND, inputDraft, inputViewRefusals, type InputShape } from '@/domain/format/inputView.ts'
import { screenWords, type StoredRow } from '@/domain/format/row.ts'
import { blankDraft, offeredOf, type RowDraft } from '@/domain/format/rowDraft.ts'
import { entryDefaults, savedNameRefusal, withArticle, type DashboardBlock } from '@/domain/format/view.ts'

import { inputAddress } from './addressFilter.ts'
import { addsAsWords, inputFormOf, keptSentence } from './inputForm.ts'

/** A problem with the row a block adds: at its field, or about the row when it names none. */
export interface BlockProblem {
  readonly column: string | undefined
  readonly reason: string
}

/** *Adds a card charge as account Visa · date today* — or *Adds a card charge* when it sets nothing. */
export function blockSentence(declaration: FormatDeclaration, shape: InputShape): string {
  const sets = addsAsWords(inputFormOf(declaration, shape).sets)
  const one = withArticle(declaration.title.toLowerCase())
  return sets === '' ? `Adds ${one}` : `Adds ${one} as ${sets}`
}

/** Where the block's form starts, and starts again after every Add: the view's defaults, a date's word worked out on `day`. */
export function inputStart(
  declaration: FormatDeclaration,
  shape: InputShape,
  day: string,
  previous?: StoredRow | undefined,
  currency?: string | undefined,
): RowDraft {
  return {
    ...blankDraft(declaration, previous, currency),
    ...entryDefaults(declaration.columns, new Set(), { input: inputDraft(declaration, shape.defaults, day), address: {} }),
  }
}

/** *amount: needs a figure* said at its field: *Needs a figure*. */
function atItsField(reason: string, column: string | undefined): string {
  if (column === undefined || !reason.startsWith(`${column}: `)) return reason
  const rest = reason.slice(column.length + 2)
  return rest.charAt(0).toUpperCase() + rest.slice(1)
}

/**
 * **The row a block would add**, judged as `record_format_rows` judges it —
 * every refusal at once, each at its column — or the row ready to write. A
 * row nobody typed into is refused before it is judged, as entry/new's is.
 */
export function stageInput(
  db: Database,
  declaration: FormatDeclaration,
  draft: RowDraft,
  startsAt: RowDraft,
  day: string,
  declarations: readonly FormatDeclaration[],
): { readonly row: StagedRow } | { readonly problems: readonly BlockProblem[] } {
  // `typedOf`'s test, here so the conversation's dashboard text can read this module without React's.
  const start = offeredOf(declaration, startsAt)
  const typed = Object.entries(offeredOf(declaration, draft)).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(start[key]))
  if (typed.length === 0) {
    return { problems: [{ column: undefined, reason: 'Nothing has been filled in yet.' }] }
  }
  const batch = stageRows(db, declaration, [offeredOf(declaration, draft, day)], declarations)
  if (batch.refusals.length > 0) {
    const problems: BlockProblem[] = []
    for (const each of batch.refusals) {
      // One sentence a field, the first it earned.
      if (each.column !== undefined && problems.some((was) => was.column === each.column)) continue
      problems.push({ column: each.column, reason: atItsField(screenWords(each.reason, declaration), each.column) })
    }
    return { problems }
  }
  const [row] = batch.accepted
  return row === undefined ? { problems: [{ column: undefined, reason: 'Not added.' }] } : { row }
}

/** Write a staged row: the write entry/new and quick add write by. */
export function writeInput(db: Database, declaration: FormatDeclaration, row: StagedRow): void {
  insertRows(db, declaration, [row.cells], [row.id])
}

/** Why a row just added cannot be taken back — another row names it (M27 U2, D-300) — or nothing. */
export function undoRefusal(
  db: Database,
  declaration: FormatDeclaration,
  id: string,
  declarations: readonly FormatDeclaration[],
): string | undefined {
  const linking = rowsLinkingTo(db, declaration, [id], declarations)
  const count = linking.reduce((sum, each) => sum + [...each.counts.values()].reduce((a, b) => a + b, 0), 0)
  return count > 0 ? keptSentence(count) : undefined
}

/** A new input view made in *Add a block*: its name, what it asks and sets, whether Add opens it, and where it goes. */
export interface InputMade {
  readonly dashboard: string | undefined
  readonly format: string
  readonly name: string
  readonly shape: InputShape
  readonly isDefault: boolean
}

/** Its block: a saved view, as every view's is — so no migration (U1's brief). */
export function inputBlock(made: InputMade): DashboardBlock {
  return { dashboard: made.dashboard, format: made.format, kind: 'saved', name: made.name.trim(), address: '' }
}

/** Why a new input view is refused — its name, a name taken, what `arrange_views` refuses too — or nothing. */
export function inputMadeRefusal(db: Database, declaration: FormatDeclaration, made: InputMade): string | undefined {
  const name = made.name.trim()
  const named = savedNameRefusal(name)
  if (named !== undefined) return named
  if (savedViews(db, declaration.name).some((each) => each.name.toLowerCase() === name.toLowerCase())) {
    return `${declaration.title} already has a view called ${name}.`
  }
  const reasons = inputViewRefusals(declaration, made.shape)
  return reasons.length > 0 ? reasons.join(' ') : undefined
}

/** Save the input view and place its block, together. */
export function makeInputView(db: Database, blocks: readonly DashboardBlock[], made: InputMade): void {
  inTransaction(db, () => {
    saveView(db, {
      format: made.format,
      name: made.name.trim(),
      kind: INPUT_KIND,
      address: inputAddress(made.format, made.shape),
      ...(made.isDefault ? { isDefault: true } : {}),
    })
    setDashboardBlocks(db, made.dashboard, [...blocks, inputBlock(made)])
  })
}
