/**
 * `edit_categories` — what the Categories screen does to a category that is not
 * creating one (D-315): rename, colour, move, merge, archive, delete, and the
 * monthly target. `create_category` is the other half of the taxonomy and
 * `assign_category` is what puts rows in it.
 *
 * **A list, and a dry run** (D-110, D-092): one call is the whole tidy-up a
 * person described, with one preview and one `.bak`. Each entry is checked
 * against the document **before** anything is written, by the same rules the
 * repository enforces (a name another category has, three levels of nesting, a
 * category still in use), so the preview says *refused* where the commit would
 * have, instead of the commit being where the user learns it.
 *
 * **No groups since M28 F29** (D-348): a heading is a top-level category, so
 * moving one under a heading is `parent_id`, and renaming a heading is `name`.
 *
 * Merge and delete are the two that cannot be undone from the screen, so they
 * stand alone in an entry: `merge_into` and `delete` refuse to ride with other
 * fields. A delete of a category nothing uses goes; one still in use needs
 * `move_to`, where its rows, rules, subcategories, budgets and the rest go
 * first, and with nowhere of its kind to move them it is refused by what still
 * uses it (M28 F18, D-340) — the screen's rule, judged by the same functions.
 */

import { fromMajorUnits } from '@/core/money.ts'
import { listed } from '@/core/text.ts'
import {
  categoryDeleteTargets,
  categoryUsage,
  deleteCategory,
  describeCategoryUsage,
  isCategoryInUse,
  listCategories,
  mergeCategories,
  moveCategory,
  renameCategory,
  reparentCategory,
  setCategoryAppearance,
  setCategoryArchived,
  type Category,
} from '@/data/repositories/categoryRepository.ts'
import { setCategoryBudget } from '@/data/repositories/categoryBudgetRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { CATEGORY_COLOR_TOKENS } from '@/domain/categoryColors.ts'
import { placementProblem } from '@/domain/categoryTree.ts'

import { count, paragraphs, plural, table } from '../format.ts'
import { today } from '../today.ts'
import { mutatingCall } from '../write.ts'
import {
  PATH_PROP,
  ToolInputError,
  booleanProp,
  requireString,
  stringProp,
  type Args,
  type PluginTool,
} from './tool.ts'

const BATCH_MAX = 100

/** What was asked of one category. `null` clears; absent leaves it alone. */
interface Edit {
  readonly id: string
  readonly name: string | undefined
  /** `null` is the top level. */
  readonly parentId: string | null | undefined
  readonly archived: boolean | undefined
  readonly target: number | null | undefined
  readonly color: string | null | undefined
  readonly icon: string | null | undefined
  readonly mergeInto: string | undefined
  readonly remove: boolean
  /** With `remove`: where what still uses it goes first. */
  readonly moveTo: string | undefined
  /** One place up or down among its siblings. */
  readonly move: -1 | 1 | undefined
}

interface Planned {
  readonly edit: Edit
  readonly label: string
  readonly changes: readonly string[]
  readonly problem: string | undefined
}

const nullable = (record: Record<string, unknown>, key: string): unknown =>
  record[key] === undefined ? undefined : record[key]

function readEdits(args: Args): readonly Edit[] {
  const raw = args['edits']
  if (args['groups'] !== undefined) {
    throw new ToolInputError(
      'There are no groups any more: a heading is a top-level category, so rename it with `name` ' +
        'and move a category under it with `parent_id`.',
    )
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError('`edits` must be a non-empty array of {category_id, …}.')
  }
  if (raw.length > BATCH_MAX) {
    throw new ToolInputError(`That is ${raw.length} edits; the ceiling is ${BATCH_MAX} in one call.`)
  }

  return raw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ToolInputError(`\`edits[${index}]\` must be an object.`)
    }
    const record = entry as Record<string, unknown>
    const where = `edits[${index}]`
    const string = (key: string): string | undefined => {
      const value = record[key]
      if (value === undefined || value === null) return undefined
      if (typeof value !== 'string') throw new ToolInputError(`\`${where}.${key}\` must be a string.`)
      return value.trim() === '' ? undefined : value.trim()
    }
    const parent = nullable(record, 'parent_id')
    if (parent !== undefined && parent !== null && typeof parent !== 'string') {
      throw new ToolInputError(`\`${where}.parent_id\` must be a category id, or null for the top level.`)
    }
    const target = nullable(record, 'monthly_target')
    if (target !== undefined && target !== null && (typeof target !== 'number' || !Number.isFinite(target) || target < 0)) {
      throw new ToolInputError(`\`${where}.monthly_target\` must be a number of at least 0, or null to clear it.`)
    }
    const color = nullable(record, 'color')
    if (color !== undefined && color !== null && (typeof color !== 'string' || !CATEGORY_COLOR_TOKENS.includes(color))) {
      throw new ToolInputError(
        `\`${where}.color\` must be one of ${CATEGORY_COLOR_TOKENS.join(', ')}, or null for automatic.`,
      )
    }
    const icon = nullable(record, 'icon')
    if (icon !== undefined && icon !== null && typeof icon !== 'string') {
      throw new ToolInputError(`\`${where}.icon\` must be a string, or null to clear it.`)
    }
    const archived = record['archived']
    if (archived !== undefined && typeof archived !== 'boolean') {
      throw new ToolInputError(`\`${where}.archived\` must be true or false.`)
    }
    const remove = record['delete'] === true
    const mergeInto = string('merge_into')
    const moveTo = string('move_to')
    if (moveTo !== undefined && !remove) {
      throw new ToolInputError(`\`${where}.move_to\` goes with \`delete: true\`; to fold one category into another, use \`merge_into\`.`)
    }
    const move = record['move']
    if (move !== undefined && move !== 'up' && move !== 'down') {
      throw new ToolInputError(`\`${where}.move\` must be "up" or "down".`)
    }
    if (record['group'] !== undefined) {
      throw new ToolInputError(
        `\`${where}.group\`: there are no groups any more — a heading is a top-level category, so ` +
          'send its id as `parent_id`.',
      )
    }
    const others = ['name', 'parent_id', 'archived', 'monthly_target', 'color', 'icon'].filter(
      (key) => record[key] !== undefined,
    )
    if ((remove || mergeInto !== undefined) && others.length > 0) {
      throw new ToolInputError(
        `\`${where}\` merges or deletes, so it cannot also change ${others.join(', ')}. ` +
          'Send those as another entry, before the merge.',
      )
    }
    if (remove && mergeInto !== undefined) {
      throw new ToolInputError(`\`${where}\` both deletes and merges. Choose one.`)
    }

    return {
      id: requireString(record, 'category_id'),
      name: string('name'),
      parentId: parent === undefined ? undefined : parent === null || parent === '' || parent === 'top' ? null : parent,
      archived: archived as boolean | undefined,
      target: target as number | null | undefined,
      color: color as string | null | undefined,
      icon: icon as string | null | undefined,
      mergeInto,
      remove,
      moveTo,
      move: move === undefined ? undefined : move === 'up' ? -1 : 1,
    }
  })
}

function planOne(
  all: readonly Category[],
  usage: (id: string) => ReturnType<typeof categoryUsage>,
  targets: (id: string) => readonly Category[],
  edit: Edit,
): Planned {
  const found = all.find((one) => one.id === edit.id)
  if (found === undefined) {
    return { edit, label: edit.id, changes: [], problem: 'no category has this id' }
  }
  const label = found.path
  const refused = (problem: string): Planned => ({ edit, label, changes: [], problem })

  if (edit.remove) {
    const used = usage(edit.id)
    if (used.isSystem) return refused('a system category cannot be deleted')
    if (!isCategoryInUse(used)) {
      return edit.moveTo === undefined
        ? { edit, label, changes: ['delete'], problem: undefined }
        : refused('nothing uses it, so there is nothing to move: send `delete: true` without `move_to`')
    }
    const using = listed(describeCategoryUsage(used), 'nothing')
    const open = targets(edit.id)
    if (open.length === 0) {
      return refused(`it still has ${using}, and there is no other category of its kind to move them to — make one, or archive it`)
    }
    if (edit.moveTo === undefined) {
      return refused(
        `it still has ${using}: name \`move_to\`, where they go first — a live category of its kind` +
          `${used.subcategories > 0 ? ' with room for its subcategories' : ''} (${count(open.length)} can take them; ids from \`category_tree\`)`,
      )
    }
    const into = open.find((one) => one.id === edit.moveTo)
    if (into === undefined) {
      return refused('`move_to` cannot take them: it has to be a live category of the same kind, not under this one, with room for its subcategories within three levels')
    }
    return { edit, label, changes: [`delete, moving its ${using} to ${into.path}`], problem: undefined }
  }

  if (edit.mergeInto !== undefined) {
    const into = all.find((one) => one.id === edit.mergeInto)
    if (into === undefined) return refused('the category to merge into does not exist')
    if (into.id === found.id) return refused('a category cannot be merged into itself')
    if (found.isSystem) return refused('a system category cannot be merged away')
    const used = usage(edit.id)
    if (used.subcategories > 0) {
      const problem = all
        .filter((one) => one.parentId === found.id)
        .map((child) => placementProblem(all, into.id, child.id))
        .find((one) => one !== undefined)
      if (problem !== undefined) return refused(`its subcategories cannot move there — ${problem.toLowerCase()}`)
    }
    return {
      edit,
      label,
      changes: [
        `merge into ${into.path}: ${plural(used.transactions, 'row')}, ` +
          `${plural(used.subcategories, 'subcategory', 'subcategories')} and its rules move with it`,
      ],
      problem: undefined,
    }
  }

  const changes: string[] = []
  if (edit.name !== undefined && edit.name !== found.name) {
    const taken = all.find((one) => one.name === edit.name && one.id !== found.id)
    if (taken !== undefined) return refused(`there is already a category called ${taken.path}`)
    changes.push(`rename to ${edit.name}`)
  }
  if (edit.parentId !== undefined && (edit.parentId ?? undefined) !== found.parentId) {
    if (edit.parentId !== null) {
      const parent = all.find((one) => one.id === edit.parentId)
      if (parent === undefined) return refused('the new parent does not exist')
      if (parent.isSystem) return refused(`${parent.name} is a system category and takes no subcategories`)
      if (parent.kind !== found.kind) return refused(`${parent.path} is ${parent.kind}, and a category goes under one of its own kind`)
      const problem = placementProblem(all, parent.id, found.id)
      if (problem !== undefined) return refused(problem.toLowerCase())
      changes.push(`move under ${parent.path}`)
    } else {
      changes.push('move to the top level')
    }
  }
  if (edit.move !== undefined) changes.push(edit.move === -1 ? 'move up' : 'move down')
  if (edit.archived !== undefined && edit.archived !== found.isArchived) {
    changes.push(edit.archived ? 'archive' : 'bring back from the archive')
  }
  if (edit.target !== undefined) {
    changes.push(edit.target === null ? 'clear its Plan bucket' : `Plan bucket ${String(edit.target)} a month`)
  }
  if (edit.color !== undefined && (edit.color ?? undefined) !== found.color) {
    changes.push(edit.color === null ? 'automatic colour' : `colour ${edit.color}`)
  }
  if (edit.icon !== undefined && (edit.icon ?? undefined) !== found.icon) {
    changes.push(edit.icon === null ? 'clear the icon' : `icon ${edit.icon}`)
  }
  return { edit, label, changes, problem: undefined }
}

function describe(plan: readonly Planned[]): string {
  const doing = plan.filter((each) => each.problem === undefined && each.changes.length > 0)
  const refused = plan.filter((each) => each.problem !== undefined)
  const same = plan.filter((each) => each.problem === undefined && each.changes.length === 0)
  return paragraphs(
    `${count(doing.length)} of ${plural(plan.length, 'edit')} would change a category.`,
    doing.length === 0
      ? undefined
      : table(['Category', 'Id', 'Change'], doing.map((each) => [each.label, each.edit.id, each.changes.join('; ')])),
    refused.length === 0
      ? undefined
      : `Refused: ${refused.map((each) => `${each.label} — ${each.problem ?? ''}`).join('; ')}.`,
    same.length === 0 ? undefined : `${count(same.length)} already as asked and untouched.`,
    'Archiving hides a category from the pickers and keeps it on every row it has. A merge moves ' +
      'the rows, the rules and the subcategories and removes the emptied one; a delete moves whatever ' +
      'still uses the category to `move_to` first, and is refused when nothing of its kind can take it.',
  )
}

export const editCategoriesTool: PluginTool = {
  definition: {
    name: 'edit_categories',
    title: 'Rename, colour, move, merge, archive or delete categories',
    description:
      'Change categories that exist — **a list of edits in one call**. Per entry: `name`, ' +
      '`parent_id` (any category of its kind with room — three levels at most — or null for the top level), `move` (up or down), `archived`, `monthly_target` (major units, null ' +
      'clears — the category’s Plan bucket in the plan in use: one figure, shared with Plan), `color` (category-1 … category-11, null for automatic), `icon`, ' +
      'or, alone in the ' +
      'entry, `merge_into` (a category id) or `delete: true` — with `move_to` (a category id of the same kind) when ' +
      'rows, rules, subcategories, Plan buckets, bills, debts or goals still use it. This is the Categories screen’s ' +
      'rename, colour, move, merge, archive and delete, and its Plan bucket. A heading (Living, Income…) is a ' +
      'top-level category, renamed and moved like any other. Adding categories ' +
      'is `create_category`. **Dry-runs by default**: it says what each entry would do and which it ' +
      'refuses (a taken name, a fourth level, a delete with nowhere to move what uses it) and writes nothing until ' +
      'you call again with `commit: true`. The document is copied to a timestamped .bak first. ' +
      'Ids come from `category_tree`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        edits: {
          type: 'array',
          description: `One entry per category. Up to ${String(BATCH_MAX)} in a call.`,
          items: {
            type: 'object',
            properties: {
              category_id: stringProp('The category, from `category_tree`.'),
              name: stringProp('A new name. Another category’s name is refused.'),
              parent_id: { type: ['string', 'null'], description: 'Move under this category (its subcategories come along), or null for the top level.' },
              archived: booleanProp('True archives, false brings it back.'),
              monthly_target: { type: ['number', 'null'], description: 'The category’s Plan bucket, each month, in the document’s currency, major units (Home shows spending against it); with no plan yet it makes the default one. Null clears.' },
              color: { type: ['string', 'null'], description: `One of ${CATEGORY_COLOR_TOKENS.join(', ')}, or null for automatic.` },
              icon: { type: ['string', 'null'], description: 'An emoji, or null to clear.' },
              move: { type: 'string', enum: ['up', 'down'], description: 'One place up or down among its siblings, in the order the screen lists them.' },
              merge_into: stringProp('Merge this category into another: its rows, rules and subcategories move. Alone in the entry.'),
              delete: booleanProp('Delete the category. Alone in the entry, or with `move_to` when something still uses it.'),
              move_to: stringProp('With `delete`: the category its rows, rules, subcategories, Plan buckets, bills, debts and goals move to first. Same kind; with room for its subcategories.'),
            },
            required: ['category_id'],
            additionalProperties: false,
          },
        },
        commit: booleanProp('Default false. False previews and writes nothing; true makes the changes.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const edits = readEdits(args)
    return mutatingCall<readonly Planned[]>(path, args['commit'] === true, {
      plan: (document) => {
        // A merge empties what it merges from, so a later entry is judged
        // against the taxonomy as the earlier ones leave it — approximately:
        // names and parents are read once, and a conflict the earlier entry
        // creates is reported by the commit, per entry, rather than hidden.
        const all = listCategories(document.db, { includeArchived: true })
        return edits.map((edit) =>
          planOne(
            all,
            (id) => categoryUsage(document.db, id),
            (id) => categoryDeleteTargets(document.db, id),
            edit,
          ),
        )
      },
      describe,
      apply: (document, plan) => {
        const now = Date.now()
        const currency = documentCurrency(document.db)
        const failed: string[] = []
        let done = 0
        for (const each of plan) {
          if (each.problem !== undefined || each.changes.length === 0) continue
          const edit = each.edit
          try {
            if (edit.remove) deleteCategory(document.db, edit.id, now, edit.moveTo)
            else if (edit.mergeInto !== undefined) mergeCategories(document.db, edit.id, edit.mergeInto, now)
            else {
              const current = listCategories(document.db, { includeArchived: true }).find((one) => one.id === edit.id)
              if (edit.name !== undefined) renameCategory(document.db, edit.id, edit.name, now)
              if (edit.move !== undefined) moveCategory(document.db, edit.id, edit.move, now)
              if (edit.parentId !== undefined) reparentCategory(document.db, edit.id, edit.parentId ?? undefined, now)
              if (edit.archived !== undefined) setCategoryArchived(document.db, edit.id, edit.archived, now)
              if (edit.target !== undefined) {
                const result = setCategoryBudget(
                  document.db,
                  today(),
                  currency,
                  edit.id,
                  edit.target === null ? 0 : fromMajorUnits(edit.target, currency).minor,
                  now,
                )
                if (result === 'SEVERAL_BUCKETS') throw new Error("several of Plan's buckets are for it; edit them with set_plan")
              }
              if (edit.color !== undefined || edit.icon !== undefined) {
                setCategoryAppearance(
                  document.db,
                  edit.id,
                  {
                    color: edit.color === undefined ? current?.color : (edit.color ?? undefined),
                    icon: edit.icon === undefined ? current?.icon : (edit.icon ?? undefined),
                  },
                  now,
                )
              }
            }
            done += 1
          } catch (error) {
            failed.push(`${each.label} — ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        return paragraphs(
          `${plural(done, 'category', 'categories')} changed.`,
          failed.length === 0 ? undefined : `Not changed: ${failed.join('; ')}.`,
          plan.some((each) => each.problem !== undefined)
            ? `Refused before writing: ${plan.filter((each) => each.problem !== undefined).map((each) => `${each.label} — ${each.problem ?? ''}`).join('; ')}.`
            : undefined,
        )
      },
      refuses: (plan) => plan.every((each) => each.problem !== undefined || each.changes.length === 0),
    })
  },
}
