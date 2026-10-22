/**
 * **The development pack** — M27 U1.
 *
 * The project's own memory, `docs/memory.emd`, as a pack: `decision`, `unit`,
 * `open_question`, `review_entry` (M22, D-240) and, since this unit,
 * `milestone` — and, since M44 U1, `inbox`: what another project's session
 * hands this document, written with `record_format_rows` like any other row. Built the way M25 built the ledger's (D-265): one `.format.md`
 * per format beside this file, each the text a document stored as text already
 * is (D-244), so the pack's declaration and the document's are the same file.
 * `pack.test.ts` holds them to it — the pack and `docs/memory.emd` may not
 * drift apart.
 *
 * ## No seeds, no code, no lock
 *
 * **It seeds nothing.** A milestone or a decision is the project's record, not
 * something a build ships, so every row is the document's own.
 *
 * **It carries no code that writes.** Its rows are written by the engine's own
 * tools — `record_format_rows`, `update_format_rows` — and by the sheet. That is
 * why its formats declare no owner (D-269): an owner says rows are written only
 * through the pack's code, and this pack's code is the engine.
 *
 * **Kept by a document that declares these formats**, as `docs/memory.emd`
 * does — and, since M38 U7, by any document a person or a conversation asks to
 * keep it: the Packs screen's *Keep this pack here*, `keep_packs` and
 * `create_document`'s `packs`, all through `installDevelopmentPack` below.
 *
 * ## Its views are a line each, beside the formats (M27 U3, D-301)
 *
 * `views.md` is the views part a text document carries (D-294), so what the
 * pack declares and what `docs/memory.emd` holds are the same text again: two
 * boards, open questions by state and units by state. **No screen of its own**
 * — the engine draws a board for any format with an enum, and this file only
 * says which column the lanes are and what a card shows.
 */

import type { Database } from 'sql.js'

import { err, ok, type Result } from '@/core/result.ts'
import { readFormat as readFormatText, readViews, type ParsedFormat } from '@/domain/format/document.ts'
import { startQuestions, type StartQuestion, type ViewSetting } from '@/domain/format/view.ts'
import { SEEDED_UNITS } from '@/domain/format/unit.ts'
import { adoptFormat, readFormat } from '../../repositories/formatRepository.ts'
import { restoreViewSettings } from '../../repositories/formatViewRepository.ts'
import { fitOf, followingRenames, type PackRename } from '../fit.ts'
import VIEWS from './views.md?raw'

const SOURCES = import.meta.glob<string>('./formats/*.format.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})

let parsed: Result<readonly ParsedFormat[], string> | undefined

/** Every format the pack declares, each after the formats it links to. */
export function developmentFormats(): Result<readonly ParsedFormat[], string> {
  parsed ??= parseAll()
  return parsed
}

/** The names of the pack's formats. */
export function developmentFormatNames(): ReadonlySet<string> {
  const formats = developmentFormats()
  return new Set(formats.ok ? formats.value.map((each) => each.declaration.name) : [])
}

/**
 * The views the pack declares, each naming a format and a column it has — or
 * the sentence saying which line does not.
 */
export function developmentViews(): Result<readonly ViewSetting[], string> {
  const read = readViews(VIEWS)
  if (!read.ok) return err(`The development pack's views: ${read.error}`)
  const formats = developmentFormats()
  if (!formats.ok) return formats
  for (const view of read.value.views) {
    const declaration = formats.value.find((each) => each.declaration.name === view.format)?.declaration
    if (declaration?.columns.some((column) => column.name === view.column) !== true) {
      return err(`The development pack's ${view.format} ${view.view} names ${view.column}, which it has not got.`)
    }
  }
  return ok(read.value.views)
}

/**
 * **`CLAUDE.md`'s *Ask the document* table, written from the pack** (M27 U5,
 * D-303): one line per question `start_here` answers, from the same
 * `startQuestions` the tool asks, so the table cannot promise an answer the
 * tool does not give. `pack.test.ts` fails when `CLAUDE.md` holds anything else
 * between its two markers, and prints the table to paste.
 */
export function startHereTable(): Result<string, string> {
  const formats = developmentFormats()
  if (!formats.ok) return formats
  const views = developmentViews()
  if (!views.ok) return views
  const settingsOf =
    (kind: ViewSetting['view']) =>
    (format: string): ReadonlyMap<string, string> =>
      new Map(
        views.value
          .filter((each) => each.view === kind && each.format === format)
          .map((each) => [each.column, each.setting] as const),
      )
  const questions = startQuestions(
    formats.value.map((each) => each.declaration),
    settingsOf('ready'),
    settingsOf('start'),
  )
  return ok(startTableOf(questions))
}

/**
 * The table itself, for any document's questions: the pack's above, and the
 * section `emerald-mcp init` writes into a repository's CLAUDE.md from that
 * document's own views (M50 U1), so the two are one shape.
 */
export function startTableOf(questions: readonly StartQuestion[]): string {
  return [
    '| `start_here` answers | The whole list |',
    '|---|---|',
    ...questions.map(
      (each) =>
        `| ${each.kind === 'ready' ? `**Ready to start** \`${each.format}\`` : `\`${each.format}\``}: ${each.what} | ` +
        `${each.call === undefined ? 'only `start_here`' : `\`${each.call}\``} |`,
    ),
  ].join('\n')
}

function parseAll(): Result<readonly ParsedFormat[], string> {
  const texts = new Map<string, string>()
  for (const [path, text] of Object.entries(SOURCES)) {
    const name = /([a-z_]+)\.format\.md$/.exec(path)?.[1]
    if (name !== undefined) texts.set(name, text)
  }

  const formats: ParsedFormat[] = []
  for (const name of linkOrder(texts)) {
    const read = readFormatText(
      texts.get(name) ?? '',
      SEEDED_UNITS,
      formats.map((each) => each.declaration),
    )
    if (!read.ok) return err(`The development pack's ${name}: ${read.error}`)
    if (read.value.declaration.name !== name) {
      return err(`${name}.format.md declares ${read.value.declaration.name}.`)
    }
    formats.push(read.value)
  }
  return ok(formats)
}

/**
 * The formats, each after the ones its `link` rows point at. No aggregate
 * points back yet, so one pass is the whole order; a link into its own format
 * (`decision.supersedes`) is not an edge. A target the pack does not declare is
 * left for `readFormat` to refuse by name.
 */
function linkOrder(texts: ReadonlyMap<string, string>): readonly string[] {
  const order: string[] = []
  const visit = (name: string, seen: ReadonlySet<string>): void => {
    if (order.includes(name) || seen.has(name) || !texts.has(name)) return
    const targets = (texts.get(name) ?? '')
      .split('\n')
      .map((line) => line.split('|').map((cell) => cell.trim()))
      .filter((cells) => (cells[2] === 'link' || cells[2] === 'links') && cells[3] !== undefined && cells[3] !== name)
      .map((cells) => cells[3] ?? '')
    for (const target of targets) visit(target, new Set([...seen, name]))
    order.push(name)
  }
  for (const name of [...texts.keys()].sort()) visit(name, new Set())
  return order
}

/**
 * **The columns this pack renamed**, oldest first (M44 U5, D-443): keeping the
 * pack again in a document that holds the old name renames it, values and all.
 */
export const DEVELOPMENT_RENAMES: readonly PackRename[] = [{ format: 'unit', from: 'claimed_by', to: 'taken_by' }]

/** What keeping the pack did: the formats it declared, and those it completed. */
export interface DevelopmentInstall {
  readonly declared: readonly string[]
  readonly completed: readonly string[]
}

/**
 * Give a document the pack's declarations it does not hold yet, in link order,
 * and the views of each one it declares. Idempotent.
 *
 * **A format the document already declares** (M38 U7) is completed when it is
 * the pack's — given the optional columns it lacks, and nothing else, so a
 * person's own column on it stays and so does how they chose to look at it
 * (D-265) — and refused, whole and before anything is written, when it clashes
 * (`fit.ts`): a column of another type, unit or target, or one the pack
 * requires that it has not got. **A column the pack renamed** (D-420) is renamed
 * in place first, its values kept (`DEVELOPMENT_RENAMES`, D-443).
 */
export function installDevelopmentPack(db: Database, now: number): Result<DevelopmentInstall, string> {
  const formats = developmentFormats()
  if (!formats.ok) return formats
  const views = developmentViews()
  if (!views.ok) return views

  const heldOf = (name: string) => {
    const held = readFormat(db, name)
    return held === undefined ? undefined : followingRenames(held, DEVELOPMENT_RENAMES)
  }
  const clashes = formats.value.flatMap(({ declaration }) => {
    const held = heldOf(declaration.name)
    return held === undefined ? [] : fitOf(held.held, declaration).clashes
  })
  if (clashes.length > 0) {
    return err(`The development pack was not kept: this document's own formats clash with it. ${clashes.join(' ')}`)
  }

  const declared: string[] = []
  const completed: string[] = []
  const grown: { format: string; column: string }[] = []
  for (const { declaration } of formats.value) {
    const following = heldOf(declaration.name)
    const held = following?.held
    const missing = held === undefined ? [] : fitOf(held, declaration).missing
    const renames = new Map((following?.renames ?? []).map((each) => [each.to, each.from]))
    if (held !== undefined && missing.length === 0 && renames.size === 0) continue
    const plan = adoptFormat(
      db,
      // **The pack's language too, when it is newer** (M47 U4): a column the
      // pack grew in a later language — `inbox.about`, an `elsewhere` at 23 —
      // added under the held declaration's older number is a format no build
      // can read back.
      held === undefined
        ? declaration
        : {
            ...held,
            language: Math.max(held.language, declaration.language),
            columns: [...held.columns, ...missing],
          },
      now,
      renames,
    )
    if (plan.refusals.length > 0) {
      return err(
        `The development pack's ${declaration.name} was not declared: ${plan.refusals.map((each) => each.detail).join(' ')}`,
      )
    }
    ;(held === undefined ? declared : completed).push(declaration.name)
    grown.push(...missing.map((column) => ({ format: declaration.name, column: column.name })))
  }
  // A format declared here takes the pack's views whole; one completed takes
  // them for the columns it grew and nothing else, so the document's own
  // arrangement stands — the inbox's `about` comes with its line (M47 U4).
  restoreViewSettings(
    db,
    views.value.filter(
      (each) =>
        declared.includes(each.format) ||
        grown.some((one) => one.format === each.format && one.column === each.column),
    ),
  )
  return ok({ declared, completed })
}
