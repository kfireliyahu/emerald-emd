/**
 * **Keeping a pack of declared formats** — lifted out of the development pack
 * by M63 U3, when the exports pack became the second pack built only of
 * `.format.md` files and view lines, with no code that writes.
 *
 * Give a document the pack's declarations it does not hold yet, in link order,
 * and the views of each one it declares. Idempotent.
 *
 * **A format the document already declares** (M38 U7) is completed when it is
 * the pack's — given the optional columns it lacks, and nothing else, so a
 * person's own column on it stays and so does how they chose to look at it
 * (D-265) — and refused, whole and before anything is written, when it clashes
 * (`fit.ts`): a column of another type, unit or target, or one the pack
 * requires that it has not got. **A column the pack renamed** (D-420) is renamed
 * in place first, its values kept (D-443).
 */

import type { Database } from 'sql.js'

import { err, ok, type Result } from '@/core/result.ts'
import type { ParsedFormat } from '@/domain/format/document.ts'
import type { ViewSetting } from '@/domain/format/view.ts'

import { adoptFormat, readFormat } from '../repositories/formatRepository.ts'
import { restoreViewSettings } from '../repositories/formatViewRepository.ts'
import { fitOf, followingRenames, type PackRename } from './fit.ts'

/** A pack of declared formats, as keeping it needs it. */
export interface DeclaredPack {
  /** How a refusal names it: `The development pack`. */
  readonly title: string
  /** Its declarations, each after the formats it links to. */
  readonly formats: readonly ParsedFormat[]
  readonly views: readonly ViewSetting[]
  readonly renames: readonly PackRename[]
}

/** What keeping the pack did: the formats it declared, and those it completed. */
export interface DeclaredInstall {
  readonly declared: readonly string[]
  readonly completed: readonly string[]
}

export function installDeclared(db: Database, now: number, pack: DeclaredPack): Result<DeclaredInstall, string> {
  const heldOf = (name: string) => {
    const held = readFormat(db, name)
    return held === undefined ? undefined : followingRenames(held, pack.renames)
  }
  const clashes = pack.formats.flatMap(({ declaration }) => {
    const held = heldOf(declaration.name)
    return held === undefined ? [] : fitOf(held.held, declaration).clashes
  })
  if (clashes.length > 0) {
    return err(`${pack.title} was not kept: this document's own formats clash with it. ${clashes.join(' ')}`)
  }

  const declared: string[] = []
  const completed: string[] = []
  const grown: { format: string; column: string }[] = []
  for (const { declaration } of pack.formats) {
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
        `${pack.title}'s ${declaration.name} was not declared: ${plan.refusals.map((each) => each.detail).join(' ')}`,
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
    pack.views.filter(
      (each) =>
        declared.includes(each.format) ||
        grown.some((one) => one.format === each.format && one.column === each.column),
    ),
  )
  return ok({ declared, completed })
}
