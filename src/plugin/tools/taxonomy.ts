/**
 * `create_category` — the one taxonomy write that adds rather than rearranges.
 *
 * It exists because a conversation hit the wall: `choose_categories` keeps or
 * archives what is already there, and nothing among the other tools could add a
 * name the shipped list never had. That is a question no tool answered, which by
 * D-095 is a request for **a new shaped tool** rather than an argument for
 * reopening the general query the same decision closed.
 *
 * **No dry run and no backup**, and unlike `note_merchant_suggestions` that is
 * not because it touches nothing. It is because the write is *additive*: it
 * creates rows and changes none, so there is no prior state for a `.bak` to
 * hold and nothing a preview could warn about that the answer does not already
 * say. The undo is archiving the category, which keeps whatever was filed under
 * it. A `.bak` per category would mean five full copies of the document to add
 * five categories, which buys nothing.
 *
 * **It takes a list** (D-110). It shipped taking one name, which is how a
 * conversation ended up making eight calls to describe a taxonomy it had worked
 * out in a single thought — and every one of those round trips re-sends the
 * whole transcript. A batch is also what makes a *parent and its children*
 * expressible at all: entries are processed in order against the live document,
 * so `Pets` and then `Pets → Vet` in one call works, where two separate calls
 * only managed it by round-tripping for the parent's id.
 *
 * The rule that a subcategory **inherits its parent's kind** is not here — it
 * moved into `createCategory` itself, so it holds for this caller, the app's
 * form, and whatever writes next.
 *
 * **No groups since M28 F29** (D-348): a group was a top-level category by
 * another name, so a heading is made like any category and what goes under it
 * names it as its parent — three levels at most.
 */

import {
  createCategory,
  listCategories,
  setCategoryArchived,
  type Category,
  type CategoryKind,
} from '@/data/repositories/categoryRepository.ts'
import { MAX_CATEGORY_DEPTH } from '@/domain/categoryTree.ts'

import { count, paragraphs, table } from '../format.ts'
import { writeDocument } from '../write.ts'
import {
  ToolInputError,
  requireString,
  stringProp,
  PATH_PROP,
  type Args,
  type PluginTool,
} from './tool.ts'

const KINDS: readonly CategoryKind[] = ['EXPENSE', 'INCOME', 'TRANSFER', 'SAVING', 'DEBT_PAYMENT']

/** One batch. Beyond this the taxonomy is the thing to rethink, not the call. */
const BATCH_MAX = 100

interface Requested {
  readonly name: string
  readonly kind: CategoryKind
  readonly parentId: string | undefined
  readonly parentName: string | undefined
}

function siblingsOf(all: readonly Category[], parentId: string | undefined): readonly Category[] {
  return all.filter((one) => (one.parentId ?? undefined) === parentId)
}

/**
 * Read the batch **before** anything is written.
 *
 * A malformed entry is the caller's mistake and refuses the whole call, because
 * an LLM that sent `kind: "expenses"` will send the corrected batch a second
 * later and a half-applied one would have to be reconciled first. A *data*
 * condition — no such parent, the name already taken — is reported per entry
 * instead and the rest of the batch still lands, since the write is additive
 * and every outcome is named in the answer.
 */
function readBatch(args: Args): readonly Requested[] {
  const raw = args['categories']
  if (args['groups'] !== undefined) {
    throw new ToolInputError(
      'There are no groups any more: a heading is a top-level category. Create it in ' +
        '`categories` and give what goes under it its `parent_name`.',
    )
  }
  if (raw === undefined && args['name'] !== undefined) {
    throw new ToolInputError(
      'This tool takes a list. Send `categories: [{ name: "…" }]` rather than a bare `name` — ' +
        'one call can create the whole taxonomy, including a parent and its children.',
    )
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ToolInputError(
      '`categories` must be a non-empty array of {name, kind?, parent_id?, parent_name?}.',
    )
  }
  if (raw.length > BATCH_MAX) {
    throw new ToolInputError(
      `That is ${raw.length} categories; the ceiling is ${BATCH_MAX} in one call.`,
    )
  }

  return raw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new ToolInputError(`\`categories[${index}]\` must be an object.`)
    }
    const record = entry as Record<string, unknown>
    const name = record['name']
    if (typeof name !== 'string' || name.trim() === '') {
      throw new ToolInputError(`\`categories[${index}].name\` must be a non-empty string.`)
    }

    const rawKind = record['kind']
    if (rawKind !== undefined && rawKind !== null && typeof rawKind !== 'string') {
      throw new ToolInputError(`\`categories[${index}].kind\` must be a string.`)
    }
    const kind = typeof rawKind === 'string' ? rawKind.toUpperCase() : undefined
    if (kind !== undefined && !KINDS.includes(kind as CategoryKind)) {
      throw new ToolInputError(
        `\`categories[${index}].kind\` must be one of ${KINDS.join(', ')}; got "${String(rawKind)}".`,
      )
    }

    const parentId = record['parent_id']
    const parentName = record['parent_name']
    if (parentId !== undefined && parentId !== null && typeof parentId !== 'string') {
      throw new ToolInputError(`\`categories[${index}].parent_id\` must be a string.`)
    }
    if (parentName !== undefined && parentName !== null && typeof parentName !== 'string') {
      throw new ToolInputError(`\`categories[${index}].parent_name\` must be a string.`)
    }

    if (record['group'] !== undefined) {
      throw new ToolInputError(
        `\`categories[${index}].group\`: there are no groups any more — a heading is a top-level ` +
          'category, so name it as `parent_name`.',
      )
    }

    return {
      name: name.trim(),
      kind: (kind as CategoryKind | undefined) ?? 'EXPENSE',
      parentId: typeof parentId === 'string' && parentId !== '' ? parentId : undefined,
      parentName: typeof parentName === 'string' && parentName !== '' ? parentName : undefined,
    }
  })
}

/**
 * Resolve the parent of one entry against the document **as it stands now**.
 *
 * "As it stands now" is the whole reason entries are processed in order: a
 * batch that creates `Pets` and then `Pets → Vet` resolves the second against
 * the first, which is the case that made the list worth having.
 */
function parentFor(
  all: readonly Category[],
  entry: Requested,
): { readonly parent?: Category; readonly refusal?: string } {
  if (entry.parentId === undefined && entry.parentName === undefined) return {}

  const wanted = entry.parentName ?? ''
  const parent =
    entry.parentId !== undefined
      ? all.find((one) => one.id === entry.parentId)
      : (all.find((one) => one.name.toLowerCase() === wanted.toLowerCase()) ??
        all.find((one) => one.path.toLowerCase() === wanted.toLowerCase()))

  if (parent === undefined) {
    return {
      refusal:
        entry.parentId !== undefined
          ? `no category with id ${entry.parentId ?? ''}`
          : `no category named "${wanted}"`,
    }
  }
  // Refused here rather than left to the repository, which throws with no clue
  // which entry was at fault.
  if (parent.depth >= MAX_CATEGORY_DEPTH) {
    return {
      refusal: `${parent.path} is already ${String(MAX_CATEGORY_DEPTH)} levels down, and categories nest ${String(MAX_CATEGORY_DEPTH)} levels at most`,
    }
  }
  if (parent.isSystem) {
    return { refusal: `${parent.name} is a system category and takes no children` }
  }
  return { parent }
}

export const createCategoryTool: PluginTool = {
  definition: {
    name: 'create_category',
    title: 'Create categories',
    description:
      'Add categories the document does not have — **a list of them in one call**. ' +
      '`choose_categories` only keeps or archives the ones already there, so this is what ' +
      'answers "none of these fit". Give a `parent_id` or `parent_name` to put it under another, ' +
      'in which case it takes the parent’s kind and `kind` is ignored. Categories nest three levels at most ' +
      '(Living → Utilities → Electricity): a top-level category is a heading — Living, Lifestyle, Income — ' +
      'and a Plan bucket for it counts everything under it. Entries are applied in order, so a parent and its children go in the ' +
      'same call. If a category of the same name already sits in the same place nothing is ' +
      'created: a live one is reported back with its id, an archived one is brought back rather ' +
      'than twinned. Writes immediately — the change is additive, so there is nothing to preview.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        categories: {
          type: 'array',
          description: `One entry per category. Up to ${String(BATCH_MAX)} in a call.`,
          items: {
            type: 'object',
            properties: {
              name: stringProp('The name as the user would say it. `Groceries`, not a path.'),
              kind: stringProp(
                `One of ${KINDS.join(', ')}. Defaults to EXPENSE. Ignored for a subcategory.`,
              ),
              parent_id: stringProp('The category this one goes under. Ids from `category_tree`.'),
              parent_name: stringProp(
                'The parent by name (or path) instead of by id — including one created earlier in this ' +
                  'same call.',
              ),
            },
            required: ['name'],
            additionalProperties: false,
          },
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const batch = readBatch(args)

    return writeDocument(path, (document) => {
      const now = Date.now()
      const outcomes: string[][] = []
      let created = 0

      for (const entry of batch) {
        // Re-read per entry: each creation changes what the next one can name,
        // which is the point of processing a list in order.
        const all = listCategories(document.db, { includeArchived: true })
        const { parent, refusal } = parentFor(all, entry)
        if (refusal !== undefined) {
          outcomes.push([entry.name, '—', `not created — ${refusal}`])
          continue
        }

        // Same name in the same place. The archived case is the one worth
        // having: onboarding archives most of the shipped list, so the name a
        // conversation "cannot find" is usually sitting right there with its
        // history attached, and a twin would split that history in two.
        const twin = siblingsOf(all, parent?.id).find(
          (one) => one.name.toLowerCase() === entry.name.toLowerCase(),
        )
        if (twin !== undefined) {
          if (!twin.isArchived) {
            outcomes.push([twin.path, twin.id, 'already existed — use this id'])
            continue
          }
          setCategoryArchived(document.db, twin.id, false, now)
          outcomes.push([twin.path, twin.id, 'was archived — brought back, history intact'])
          continue
        }

        let id: string
        try {
          id = createCategory(
            document.db,
            parent === undefined
              ? { name: entry.name, kind: entry.kind }
              : { name: entry.name, kind: entry.kind, parentId: parent.id },
            now,
          )
        } catch (error) {
          outcomes.push([entry.name, '—', `not created — ${error instanceof Error ? error.message : String(error)}`])
          continue
        }
        const made = listCategories(document.db, { includeArchived: true }).find(
          (one) => one.id === id,
        )
        created++
        outcomes.push([
          made?.path ?? entry.name,
          id,
          `created, kind ${made?.kind ?? entry.kind}, ${parent === undefined ? 'at the top level' : `under ${parent.path}`}`,
        ])
      }

      return paragraphs(
        `${count(created)} created of ${count(batch.length)} asked for.`,
        table(['Category', 'Id', 'What happened'], outcomes),
        'New categories have no colour or icon yet. `edit_categories` renames, colours, ' +
          'moves, merges, archives and deletes them.',
      )
    })
  },
}
