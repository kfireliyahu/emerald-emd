/**
 * `document_info` — the first tool, and the one that answers "may I?".
 *
 * **The name is deliberate, because a tool name is an API from the day a
 * stranger's conversation depends on it** (D-092). Three choices are baked into
 * these two words, and they set the pattern the rest of the surface follows:
 *
 * - *document*, not *file* or *database*, because that is the word the app, its
 *   docs and its users already use for a `.emd` (D-021). The plugin
 *   does not get to introduce a second vocabulary for the same thing.
 * - *info*, not *get_document_info*, because the tools beside it are noun
 *   phrases — `uncategorized_merchants`, `month_summary`, `transactions`.
 *   There is no `get_` prefix anywhere in the surface.
 * - not *open_document*, which was the obvious name and is the wrong one. The
 *   plugin holds nothing open between calls: every tool reads the file fresh
 *   and closes it. A name with `open` in it promises a handle, a session and a
 *   matching `close`, and that would be an API promise the design does not
 *   make and does not want to make.
 *
 * What it returns is prose rather than JSON on purpose. The consumer is a
 * conversation — F14's whole thesis is that Claude does the reasoning there —
 * and a parallel structured copy would be a second shape to keep in step with
 * the first for no reader.
 */

import { SCHEMA_VERSION } from '@/data/db/database.ts'
import { documentHasLedger, ledgerFormatNames } from '@/data/packs/ledger/pack.ts'
import { listAccounts } from '@/data/repositories/accountRepository.ts'
import { listCategories } from '@/data/repositories/categoryRepository.ts'
import { countTransactions } from '@/data/repositories/transactionRepository.ts'
import { documentCurrency } from '@/data/repositories/statisticsRepository.ts'
import { listFormats, rowCountOf } from '@/data/repositories/formatRepository.ts'

import { PLUGIN_VERSION, type OpenDocument, readDocument } from '../document.ts'
import { count, plural, table } from '../format.ts'
import { PATH_PROP, requireString, type PluginTool } from './tool.ts'

/**
 * Counts of what a document holds.
 *
 * Archived accounts and categories are included: the question is what is in
 * the file, not what the app currently shows, and a count that quietly omitted
 * rows would make "the plugin sees 61 categories, the app shows 63" a mystery
 * rather than a fact.
 */
interface DocumentCounts {
  readonly accounts: number
  readonly transactions: number
  readonly categories: number
}

function countDocument(document: OpenDocument): DocumentCounts {
  if (!documentHasLedger(document.db)) return { accounts: 0, transactions: 0, categories: 0 }
  return {
    accounts: listAccounts(document.db, { includeArchived: true }).length,
    transactions: countTransactions(document.db),
    categories: listCategories(document.db, { includeArchived: true }).length,
  }
}

/**
 * Read a document and describe it, or say why it will not be served.
 *
 * Counting is only attempted once the schema gate has passed, and not merely
 * out of caution: on an older schema the repositories' own SQL references
 * columns and tables that file does not have yet, so a count there would fail
 * with a confusing SQLite error instead of the one sentence that tells the user
 * to open their document in the app.
 */
export async function documentInfo(path: string): Promise<string> {
  return readDocument(path, (document) => {
    const counts = countDocument(document)
    const ledger = documentHasLedger(document.db)
    const accounts = ledger ? listAccounts(document.db, { includeArchived: true }) : []
    // A person's own formats. The ledger's are its tables (M25), and listing
    // thirty-four of them here would bury the one somebody declared.
    const pack = ledger ? ledgerFormatNames() : new Set<string>()
    const formats = listFormats(document.db).filter((format) => !pack.has(format.name))

    return [
      `Emerald document: ${document.path}`,
      `Schema version ${document.schemaVersion}, matching this plugin build ` +
        `(plugin ${PLUGIN_VERSION}, understands schema ${SCHEMA_VERSION}). Ready to serve.`,
      '',
      // **Formats first** (M38 U5): what this document declares is what a
      // conversation came to work on, and a stranger's first answer used to be
      // three counts about money. A format is declared per document, so this
      // is the only place a conversation learns `ingredient` is a thing here
      // before it goes looking (D-217).
      formats.length === 0
        ? 'No formats declared yet — `declare_format` makes one, and `read_onto_format` reads a ' +
          'spreadsheet or a folder of notes onto one.'
        : `Declared formats: ${formats
            .map((format) => `${format.name} (${plural(rowCountOf(document.db, format), 'row')})`)
            .join(', ')}. ` +
          'Their columns belong to this document rather than to this build — `formats` is ' +
          'what says what a row of one looks like.',
      '',
      ...(ledger
        ? [
            'It keeps the ledger:',
            `Accounts: ${count(counts.accounts)}`,
            `Transactions: ${count(counts.transactions)}`,
            `Categories: ${count(counts.categories)}`,
            `Reporting currency: ${documentCurrency(document.db)}`,
          ]
        : ['It does not keep the ledger, so the finance tools have nothing to work on here.']),
      // The ids, not just the count. Half the surface tells its caller that
      // account ids come from here, and until they were printed that sentence
      // was false: an import into a document this conversation did not create
      // had nowhere to get one (D-104).
      ...(accounts.length === 0
        ? []
        : [
            '',
            table(
              ['Account', 'Id', 'Kind', 'Last 4', 'Archived'],
              accounts.map((account) => [
                account.name,
                account.id,
                account.kind,
                account.last4 ?? '-',
                account.isArchived ? 'yes' : '-',
              ]),
            ),
          ]),
      '',
      'Accounts and categories include archived ones. This plugin never migrates a document — ' +
        'that stays the app’s job — but every call brings its ledger up to what this build ' +
        'declares, and a write saves that with its change.',
    ].join('\n')
  })
}

export const documentInfoTool: PluginTool = {
  definition: {
    name: 'document_info',
    title: 'Emerald document info',
    description:
      'Describe an Emerald document (a .emd file): whether this plugin will serve it, the ' +
      'formats it declares with how many rows each holds, and — when it keeps the ledger — its ' +
      'accounts, transactions, categories and reporting currency. ' +
      'Call this first — every other tool refuses a document whose schema does not match, and ' +
      'this is the tool that says so in a sentence the user can act on. Reads the file; never ' +
      'modifies it.',
    inputSchema: {
      type: 'object',
      properties: { path: PATH_PROP },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) => documentInfo(requireString(args, 'path')),
}
