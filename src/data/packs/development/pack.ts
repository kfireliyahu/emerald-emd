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
 * keep it: the Packs screen's *Keep … here*, `keep_packs` and
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
import { installDeclared, type DeclaredInstall } from '../declared.ts'
import type { PackRename } from '../fit.ts'
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
export type DevelopmentInstall = DeclaredInstall

/**
 * Give a document the pack's declarations it does not hold yet, completing those
 * it holds of it and following the column it renamed (`DEVELOPMENT_RENAMES`,
 * D-443) — `installDeclared` (`../declared.ts`) says how. Idempotent.
 */
export function installDevelopmentPack(db: Database, now: number): Result<DevelopmentInstall, string> {
  const formats = developmentFormats()
  if (!formats.ok) return formats
  const views = developmentViews()
  if (!views.ok) return views
  return installDeclared(db, now, {
    title: 'The development pack',
    formats: formats.value,
    views: views.value,
    renames: DEVELOPMENT_RENAMES,
  })
}
