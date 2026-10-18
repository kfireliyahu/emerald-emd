/**
 * The document from a conversation: making one, naming its accounts, and
 * trimming its categories.
 *
 * **This was onboarding's file, and onboarding went in M28 U9** (D-330). Its
 * seven screens became *Guide me*, a walk through the real screens that points
 * and does nothing of its own, and `onboarding_status` and `advance_onboarding`
 * became `guide_status` (`./guide.ts`): a conversation has no screen to walk, so
 * what it gets is the same list and what is done. `add_institutions` went with
 * the institutions screen: reading a statement makes its account (D-313), which
 * is `import_statement` here.
 *
 * **What stands in for a backup.** The write line of M7 promises a timestamped
 * `.bak` before any mutating batch, and these tools take one only when the
 * document holds work — an account or a transaction. An empty document holds
 * nothing older than the current conversation, so there is nothing a copy could
 * preserve (D-097). That used to be read off onboarding's progress; it is read
 * off the document now, which is what the progress was standing for.
 */

import {
  ACCOUNT_KINDS,
  listAccounts,
  renameAccount,
  setAccountKind,
  setAccountLast4,
  type AccountKind,
} from '@/data/repositories/accountRepository.ts'
import {
  listCategories,
  setCategoryArchived,
} from '@/data/repositories/categoryRepository.ts'
import { holdsWork } from '@/data/repositories/guideRepository.ts'
import { PACKS } from '@/data/packs/packs.ts'

import { count, paragraphs } from '../format.ts'
import type { OpenDocument } from '../document.ts'
import { createDocumentFile, writeDocument, writeWithBackup } from '../write.ts'
import { packsArg, packsProp } from './packs.ts'
import {
  PATH_PROP,
  ToolInputError,
  optionalString,
  requireString,
  stringProp,
  type Args,
  type PluginTool,
  type ToolContext,
} from './tool.ts'
// The one place the extension is defined, because the shell is what registers
// it with an operating system (D-156). `src/data/storage/adapter.ts` reads the
// same constant; a second copy here is how the two would drift.
import { DOCUMENT_EXTENSION } from '../../../electron/bridge.ts'

/**
 * Whether this document is still empty — no account, no transaction — which is
 * the state where a write has nothing to lose and takes no copy, and where
 * `keep_ids` may archive everything not listed.
 */
function isEmpty(document: OpenDocument): boolean {
  return !holdsWork(document.db)
}

// --- create_document -------------------------------------------------------

/**
 * Ask the user where the document should go, if the client can show a form.
 *
 * The one place in the plugin where elicitation genuinely earns its keep: a
 * path is a single string, the client knows its own roots, and the alternative
 * is Claude inventing a plausible-looking directory. **Never required** — the
 * argument works on its own, and a decline or a cancel just asks in prose.
 */
async function askForPath(context: ToolContext): Promise<string | undefined> {
  if (context.elicit === undefined) return undefined

  const outcome = await context.elicit({
    message:
      'Where should the new Emerald document be saved? Give a full path ending in ' +
      `${DOCUMENT_EXTENSION}.`,
    requestedSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          title: 'Document path',
          description: `For example C:/Users/you/Documents/household${DOCUMENT_EXTENSION}`,
        },
      },
      required: ['path'],
    },
  })

  if (outcome.action !== 'accept') return undefined
  const answer = outcome.content['path']
  return typeof answer === 'string' && answer.trim() !== '' ? answer : undefined
}

export const createDocumentTool: PluginTool = {
  definition: {
    name: 'create_document',
    title: 'Create an Emerald document',
    description:
      'Create a new .emd document at a path that does not exist yet; never overwrites. It keeps ' +
      'the `packs` named and no other (`[]` for none). **Omitted: the ledger** on a server with ' +
      'the ledger’s tools, **none** engine-only. With no path the user may be shown a form; ' +
      'otherwise ask them.',
    inputSchema: {
      type: 'object',
      properties: {
        path: stringProp(
          `Full path for the new document, ending in ${DOCUMENT_EXTENSION}. Omit to ask the user.`,
        ),
        packs: packsProp('The packs the document starts with, by id; `[]` for none.'),
      },
      required: [],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  run: async (args, context) => {
    // Read first, so a pack this build has not got is refused before the user
    // is asked anything.
    const named = packsArg(args, 'packs')
    // **The default** (D-405): the full server is the ledger's front door, as
    // it always was; an engine-only server knows nothing about money.
    const packs = named ?? PACKS.filter((pack) => pack.id === 'ledger' && context.engineOnly !== true)
    const given = optionalString(args, 'path')
    const path = given ?? (await askForPath(context))

    if (path === undefined) {
      return (
        'No path yet, so nothing was created. Ask the user where the document should live — a ' +
        `full path ending in ${DOCUMENT_EXTENSION} — and call this again with it.`
      )
    }

    const created = await createDocumentFile(path, packs)
    if (!created.ok) return `REFUSED — ${created.error.message}`

    const keeps = packs.length === 0 ? 'no pack' : packs.map((pack) => pack.title.toLowerCase()).join(' and ')
    const ledger = packs.some((pack) => pack.id === 'ledger')
    return paragraphs(
      `Created ${path} at schema version ${created.value}, keeping ${keeps}.`,
      ledger && context.engineOnly !== true
        ? 'Its ledger is empty. `guide_status` with this path lists the places worth setting up ' +
            'first and which are done — the first is reading a statement, with `statement_preview` ' +
            'and `import_statement`. Nothing there is mandatory.'
        : packs.length > 0
          ? '`formats` with this path lists what it declares.'
          : 'It declares nothing yet: `declare_format` brings in a kind of thing, and `keep_packs` ' +
            'a pack.',
    )
  },
}

// --- update_account --------------------------------------------------------

export const updateAccountTool: PluginTool = {
  definition: {
    name: 'update_account',
    title: 'Rename an account or set its last 4 digits',
    description:
      'Give an account a real name and the last 4 digits of its card or number. The digits are ' +
      'what matches an imported statement to the right account, and what identifies a card ' +
      'charge on a bank statement, so they are worth asking for. Account ids come from ' +
      'document_info.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        account_id: stringProp('The account to change.'),
        name: stringProp('A name the user will recognise, e.g. "Cal – Visa 1234".'),
        last4: stringProp('The last four digits, as digits.'),
        kind: stringProp(
          `One of ${ACCOUNT_KINDS.join(', ')}, if it was created as the wrong one. HOLDINGS is an ` +
            'account with holdings — a broker, a savings account; `set_place_accounts` then ' +
            'names it from the place its money is shown in.',
        ),
      },
      required: ['path', 'account_id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const accountId = requireString(args, 'account_id')
    const name = optionalString(args, 'name')
    const last4 = optionalString(args, 'last4')
    const kind = optionalString(args, 'kind')

    if (name === undefined && last4 === undefined && kind === undefined) {
      throw new ToolInputError('Give at least one of `name`, `last4` or `kind`.')
    }
    if (last4 !== undefined && !/^\d{4}$/.test(last4)) {
      throw new ToolInputError(`\`last4\` must be exactly four digits; got "${last4}".`)
    }
    if (kind !== undefined && !ACCOUNT_KINDS.includes(kind as AccountKind)) {
      throw new ToolInputError(`\`kind\` must be one of ${ACCOUNT_KINDS.join(', ')}.`)
    }

    return writeDocument(path, (document) => {
      const now = Date.now()
      const account = listAccounts(document.db, { includeArchived: true }).find(
        (one) => one.id === accountId,
      )
      if (account === undefined) {
        throw new ToolInputError(`No account with id ${accountId} in ${path}.`)
      }

      const changes: string[] = []
      if (name !== undefined) {
        renameAccount(document.db, accountId, name, now)
        changes.push(`name → ${name}`)
      }
      if (last4 !== undefined) {
        setAccountLast4(document.db, accountId, last4, now)
        changes.push(`last 4 → ${last4}`)
      }
      if (kind !== undefined) {
        setAccountKind(document.db, accountId, kind as AccountKind, now)
        changes.push(`kind → ${kind}`)
      }

      return `Updated ${account.name}: ${changes.join(', ')}.`
    })
  },
}

// --- choose_categories -----------------------------------------------------

function idList(args: Args, name: string): readonly string[] | undefined {
  const raw = args[name]
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) throw new ToolInputError(`\`${name}\` must be an array of category ids.`)
  return raw.filter((one): one is string => typeof one === 'string' && one.trim() !== '')
}

/**
 * Trim the taxonomy — and **`keep_ids` is an empty document's argument only** (D-110).
 *
 * "Everything not listed is archived" is the right shape for a fresh document,
 * where the alternative is naming forty categories to put away, and it is a
 * wrecking ball on a document that holds a year of filed transactions: one
 * forgotten id and a live category is archived out from under its rows. So the
 * shape the caller may use depends on what the document is, which is the same
 * fork the backup follows — an empty document is the state where a mistake
 * costs nothing.
 *
 * `archive_ids` and `restore_ids` say exactly what they do and work at any time,
 * which is what makes this tool reachable on a document that holds work. Nothing here
 * deletes: an archived category keeps its history and comes back with it.
 */
export const chooseCategoriesTool: PluginTool = {
  definition: {
    name: 'choose_categories',
    title: 'Archive or restore categories',
    description:
      'Put categories away, or bring them back. Give `archive_ids` and `restore_ids` to say ' +
      'exactly which — these work at any time. On a document that holds no account and no ' +
      'transaction yet, `keep_ids` is also accepted and archives everything not listed, which is ' +
      'the fast way to trim the shipped list; it is refused afterwards, when one forgotten id ' +
      'would archive a category out from under a year of transactions. Archiving is not ' +
      'deleting — the history stays and comes back with it — and system categories are never ' +
      'touched. Ids come from category_tree. On a document that already ' +
      'holds work it takes a timestamped .bak first.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        archive_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Categories to put away. Their transactions keep pointing at them.',
        },
        restore_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Archived categories to bring back.',
        },
        keep_ids: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Empty document only: every id to keep. Everything else is archived. Refused once ' +
            'the document holds an account or a transaction.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const keep = idList(args, 'keep_ids')
    const toArchive = new Set(idList(args, 'archive_ids') ?? [])
    const toRestore = new Set(idList(args, 'restore_ids') ?? [])

    if (keep === undefined && toArchive.size === 0 && toRestore.size === 0) {
      throw new ToolInputError(
        'Give `archive_ids`, `restore_ids`, or — on an empty document only — `keep_ids`.',
      )
    }
    for (const id of toArchive) {
      if (toRestore.has(id)) {
        throw new ToolInputError(`${id} is in both \`archive_ids\` and \`restore_ids\`.`)
      }
    }

    return writeWithBackup(
      path,
      (document) => !isEmpty(document),
      (document) => {
        const now = Date.now()
        const first = isEmpty(document)
        if (keep !== undefined && !first) {
          throw new ToolInputError(
            `${document.path} already holds work, so \`keep_ids\` is refused — it would ` +
              'archive every category not on the list, including ones with a year of ' +
              'transactions categorized under them. Name what to put away in `archive_ids` instead.',
          )
        }

        const keepSet = keep === undefined ? undefined : new Set(keep)
        const unknown: string[] = []
        let archived = 0
        let restored = 0

        for (const category of listCategories(document.db, { includeArchived: true })) {
          // A system category is not the user's to put away, and the app's own
          // step skips them for the same reason.
          if (category.isSystem) continue

          const shouldArchive =
            keepSet !== undefined
              ? !keepSet.has(category.id)
              : toArchive.has(category.id)
                ? true
                : toRestore.has(category.id)
                  ? false
                  : category.isArchived

          if (shouldArchive === category.isArchived) continue
          setCategoryArchived(document.db, category.id, shouldArchive, now)
          if (shouldArchive) archived++
          else restored++
        }

        const known = new Set(
          listCategories(document.db, { includeArchived: true }).map((one) => one.id),
        )
        for (const id of [...toArchive, ...toRestore]) if (!known.has(id)) unknown.push(id)

        return paragraphs(
          (archived === 0 ? '' : `Archived ${count(archived)}. `) +
            (restored === 0 ? '' : `Brought back ${count(restored)}. `) +
            (archived === 0 && restored === 0 ? 'Nothing changed — every category was already as asked.' : ''),
          unknown.length === 0
            ? undefined
            : `No category with these ids: ${unknown.join(', ')}. Everything else was applied.`,
          'Nothing was deleted. An archived category keeps whatever is already categorized under it, ' +
            'and `create_category` brings one back by name.',
        )
      },
    )
  },
}

