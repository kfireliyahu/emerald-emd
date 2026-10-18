/**
 * What the MCP server offers, in plain words and grouped (M26 U7, D-295).
 *
 * **The screen at `#/mcp` reads this and the server never does**, and that is
 * the whole reason it is a file of its own: the server's tool definitions sit
 * beside the code that runs them, which opens files with `node:fs`, and the
 * renderer may import none of that. So this is pure data — no import at all —
 * and **`catalog.test.ts` pins it to the server's own definitions name for
 * name**: a tool added to `server.ts` without a line here, a line here for a
 * tool the server dropped, or a tool here that says it only reads when its
 * definition says it writes, and the suite goes red. That is how the screen
 * cannot drift without being a copy of the descriptions, which are written for
 * a model and not for a person.
 *
 * The sentences are short on purpose (T9): what the tool lets an assistant do,
 * not how to call it — the server's own descriptions say that, to the one
 * reader who needs it.
 */

/** Which half of the server a tool is in. `--engine-only` offers the engine's. */
export type ToolHalf = 'engine' | 'ledger'

/** What a call can do to the document, from the definition's own annotations. */
export type ToolEffect = 'reads' | 'writes' | 'removes'

export interface CatalogTool {
  readonly name: string
  readonly effect: ToolEffect
  /** One sentence, for a person. */
  readonly plain: string
}

export interface ToolGroup {
  readonly half: ToolHalf
  readonly title: string
  readonly tools: readonly CatalogTool[]
}

const reads = (name: string, plain: string): CatalogTool => ({ name, effect: 'reads', plain })
const writes = (name: string, plain: string): CatalogTool => ({ name, effect: 'writes', plain })
const removes = (name: string, plain: string): CatalogTool => ({ name, effect: 'removes', plain })

export const TOOL_GROUPS: readonly ToolGroup[] = [
  // --- the engine: every document has these ---------------------------------
  {
    half: 'engine',
    title: 'Formats',
    tools: [
      writes('create_document', 'Makes a new document, with the packs you name.'),
      writes('keep_packs', 'Keeps a pack in a document — its formats, declared.'),
      reads('formats', 'Lists the formats this document declares, with their columns.'),
      writes('declare_format', 'Brings in a new kind of thing, as a real table.'),
      removes('extend_format', 'Adds to, renames, retypes or removes what a format has.'),
      writes('connect_formats', 'Links two formats, and can total one along the link.'),
      removes('delete_format', 'Removes a format and every row in it.'),
    ],
  },
  {
    half: 'engine',
    title: 'Rows',
    tools: [
      reads('format_rows', 'Reads a format’s rows, and what its claims say about each one.'),
      reads('show_format', 'Shows a format’s rows as the app’s table, in the conversation.'),
      reads('format_problems', 'Says what looks wrong in a format’s rows.'),
      reads('search_document', 'Finds a word anywhere in the document, or scans it before sharing.'),
      reads('start_here', 'Answers what to start from: what is ready to start, open, and latest.'),
      reads('format_rollup', 'Totals a format’s figure by month.'),
      writes('record_format_rows', 'Adds rows, many at once.'),
      writes('update_format_rows', 'Corrects rows already there.'),
      removes('delete_format_rows', 'Removes rows nothing else links to.'),
      writes('claim_units', 'Takes planned units of a project’s memory, on a branch, so no one else does.'),
      writes('land_units', 'Lands units or a child’s inbox proposals: built, with decisions, in one write.'),
      reads('dispatch_plan', 'Says which ready units can run at once, and which share a file and must wait.'),
      writes('apply_rules', 'Runs a format’s rules over its rows.'),
      writes('record_units', 'Teaches the document a unit it does not know.'),
      writes('arrange_views', 'Sets how a format is shown: Show as, order, lanes, widths.'),
    ],
  },
  {
    half: 'engine',
    title: 'Reading files',
    tools: [
      removes('read_onto_format', 'Reads a spreadsheet onto a format; read again, it can drop lines gone since.'),
      removes('supersede_reading', 'Takes back exactly the rows one file wrote.'),
      removes('readers', 'Lists, renames or forgets a format’s readers.'),
      writes('keep_copy', 'Keeps a named copy of the document in Emerald’s folder, before a change.'),
      writes('store_document_as', 'Stores the document as text or as SQLite bytes.'),
    ],
  },

  // --- the ledger: offered when the server is not started engine-only -------
  {
    half: 'ledger',
    title: 'The document',
    tools: [
      reads('document_info', 'Says what the document holds and whether it can be served.'),
      reads('guide_status', 'Says what is worth setting up, and what is done.'),
      writes('update_account', 'Names an account, its last four digits and its kind.'),
    ],
  },
  {
    half: 'ledger',
    title: 'Statements',
    tools: [
      reads('statement_preview', 'Reads a statement and checks it against its own total.'),
      writes('import_statement', 'Imports a statement into an account.'),
      writes('record_holdings_statement', 'Writes a broker statement you read: its rows, and its holdings as readings.'),
    ],
  },
  {
    half: 'ledger',
    title: 'Transactions and categories',
    tools: [
      reads('transactions', 'Finds transactions, with totals over every match.'),
      reads('category_tree', 'Lists the categories.'),
      reads('uncategorized_merchants', 'Lists the merchants nothing is categorized under yet.'),
      writes('assign_category', 'Categorizes transactions under a category.'),
      writes('create_rule', 'Categorizes matching transactions, now and on every import.'),
      writes('create_category', 'Adds categories, under one another three levels deep.'),
      removes('edit_categories', 'Renames, colours, moves, merges, archives or deletes categories.'),
      writes('set_excluded_from_totals', 'Leaves transactions out of the totals, or counts them again.'),
      writes('set_transaction_notes', 'Writes the note on a transaction.'),
      writes('set_transaction_holdings', 'Says which holding a transaction bought or sold, and how much.'),
      reads('transfers', 'Lists the transfers found between the person’s own accounts.'),
      writes('answer_transfers', 'Says whether two rows are one transfer between the person’s accounts.'),
      writes('count_card_charges', 'Counts a card payment with no statement as the spending it stands for.'),
      writes('set_card_payers', 'Says which bank rows pay a card.'),
      writes('skip_merchants', 'Sets merchants aside in the queue, or puts them back.'),
      writes('choose_categories', 'Puts categories away or brings them back.'),
      writes('note_merchant_suggestions', 'Remembers merchants nobody could place.'),
    ],
  },
  {
    half: 'ledger',
    title: 'Months and years',
    tools: [
      reads('month_summary', 'One month, added up and compared.'),
      reads('year_summary', 'One year, added up month by month.'),
    ],
  },
  {
    half: 'ledger',
    title: 'Bills',
    tools: [
      reads('fixed_expenses', 'Lists the bills being tracked.'),
      reads('fixed_expense_candidates', 'Lists charges that look like recurring bills.'),
      writes('track_fixed_expenses', 'Starts tracking recurring charges as bills.'),
      writes('dismiss_fixed_expense_candidates', 'Says a charge is not a bill.'),
      removes('edit_fixed_expenses', 'Edits, ends or stops tracking bills.'),
    ],
  },
  {
    half: 'ledger',
    title: 'Plan',
    tools: [
      reads('plans', 'Lists plans: what each bill does to them, and their buckets.'),
      writes('plan_month', 'Works a plan out for a month, and uses it.'),
      writes('set_fixed_expense_roles', 'Says what each bill does to a plan.'),
      removes('set_plan', 'Makes, resizes, points and deletes plans.'),
    ],
  },
  {
    half: 'ledger',
    title: 'Paychecks and funds',
    tools: [
      reads('paychecks', 'Lists paychecks, and the months with none.'),
      writes('record_paychecks', 'Writes paychecks in.'),
      removes('set_deduction_types', 'Makes, renames, orders and removes deduction types, and links them.'),
      writes('set_no_pay_months', 'Says a month had no pay, so no paycheck is missing for it.'),
      reads('funds', 'Lists pension and savings funds, and what their fees cost.'),
      writes('record_fund_readings', 'Writes in what a fund report says.'),
    ],
  },
  {
    half: 'ledger',
    title: 'Savings and debts',
    tools: [
      reads('savings', 'Lists goals and where the money is.'),
      reads('goal_projection', 'Says what each goal will hold in N months.'),
      writes('create_goals', 'Adds goals.'),
      writes('record_deposits', 'Records money moving in a goal.'),
      writes('set_place_accounts', 'Says which account each place is, and makes its cash holding.'),
      writes('record_holding_readings', 'Writes what a statement says a holding is worth on a day.'),
      writes('set_goal_deposit_categories', 'Says which Money moved category feeds each goal, and where it lands.'),
      writes('set_cushion', 'Sets the cushion: which bank accounts count, its months and its buckets.'),
      writes('pause_goals', 'Skips a goal for a few months, or starts it again.'),
      writes('settle_set_aside', 'Says whether money set aside for a goal is still there.'),
      writes('suggest_goal_amounts', 'Suggests the monthly amount for each goal, by nearest date.'),
      writes('set_goal_amounts', 'Sets the monthly amount toward a goal or extra on a debt, from Everything else.'),
      writes('set_opening_balances', 'Says what an account held before its first statement.'),
      reads('debts', 'Lists debts and what is left on each.'),
      reads('debt_projection', 'Says what each debt will have left in N months.'),
      writes('create_debts', 'Adds debts.'),
      writes('record_debt_payments', 'Records payments against a debt.'),
    ],
  },
]

/** The server's name in a client's configuration — `SERVER_NAME` in `server.ts`. */
export const CATALOG_SERVER_NAME = 'emerald'

/** The argument that offers the engine's half alone (M22 U0). */
export const ENGINE_ONLY_FLAG = '--engine-only'
