/**
 * `statement_preview` and `import_statement` — the app's own import pipeline,
 * reached from a conversation.
 *
 * SheetJS runs in Node, so the importer is reusable as-is: `readWorkbook`,
 * `matchSavedMapping`, `guessMapping`, `applyMapping`, `assignNaturalKeys`,
 * `findPrintedTotal`, `stageImport`, `commitSession`. Nothing here parses a
 * statement — it drives the thing that does.
 *
 * **The user maps the columns; the app only guesses** (D-013). That rule is why
 * there are two tools rather than one. `statement_preview` reads the file and
 * shows what it found — the header row, what each column looks like, what the
 * guesser thinks each column is, and the first rows parsed with that guess —
 * and `import_statement` takes the answer. A saved mapping matched by header
 * signature skips all of it, exactly as it does in the app: a second import of
 * a known format does not ask again.
 *
 * **The staging area is not used as a queue.** The app stages so a review
 * screen can exist and so an import survives the tab closing; from here the
 * confirmation already happened in the conversation, so staging and committing
 * are one call and one transaction. That is the same reasoning D-092 applied to
 * the review queue, arriving at the import path (D-100).
 */

import { columnRoleIds } from '@/data/repositories/columnRoleRepository.ts'
import type { ColumnRoleId } from '@/domain/model/columnRoles.ts'
import { formatMoney, type Money } from '@/core/money.ts'
import {
  listAccounts,
  peekAccountForImport,
  resolveAccountForImport,
  type AccountKind,
} from '@/data/repositories/accountRepository.ts'
import {
  listMappings,
  saveMapping,
} from '@/data/repositories/importMappingRepository.ts'
import { acceptAllNew } from '@/data/repositories/stagedRowRepository.ts'
import { existingNaturalKeys, type RowsHeld } from '@/data/repositories/transactionRepository.ts'
import { overlapElsewhere } from '@/data/importer/statementBatch.ts'
import { allParsed, applyMapping, summarize, type ParsedRow } from '@/data/importer/apply.ts'
import { commitSession } from '@/data/importer/commit.ts'
import { columnCells, guessMapping, inferColumnShape, missingRequiredRoles } from '@/data/importer/guess.ts'
import { assignNaturalKeys } from '@/data/importer/naturalKey.ts'
import { findPrintedTotal, totalsAgree, type PrintedTotal } from '@/data/importer/printedTotal.ts'
import {
  computeHeaderSignature,
  headerCellsOf,
  matchSavedMapping,
} from '@/data/importer/signature.ts'
import {
  isSupportedFileName,
  SUPPORTED_EXTENSIONS,
  type SheetTable,
} from '@/data/importer/sheetTable.ts'
import { stageImport } from '@/data/importer/stage.ts'
import {
  AMOUNT_CONVENTIONS,
  requiredRolesFor,
  type AmountConvention,
  type DraftMapping,
} from '@/domain/model/importing.ts'

import { readDocument, type OpenDocument } from '../document.ts'
import { count, paragraphs, table as asTable } from '../format.ts'
import { mutatingCall, type Mutation } from '../write.ts'
import {
  PATH_PROP,
  ToolInputError,
  booleanProp,
  numberProp,
  optionalNumber,
  optionalString,
  requireString,
  stringProp,
  type Args,
  type PluginTool,
} from './tool.ts'
import { readSheetOffered } from '../files.ts'

/**
 * Sentinel for "the parse disagrees with the file", distinguishable from the
 * refusal text the schema gate returns through the same read.
 */
const REFUSE = '\u0000refuse'

/** Rows of the sheet shown as a sample. Enough to recognise a format by. */
const SAMPLE_ROWS = 6

const FILE_PROP = stringProp(
  `Absolute path to the statement file. One of ${SUPPORTED_EXTENSIONS.join(', ')}.`,
)

async function readSheet(
  file: string,
  sheetName: string | undefined,
): Promise<{ table: SheetTable; sheets: readonly string[]; hash: string; fileName: string }> {
  if (!isSupportedFileName(file)) {
    throw new ToolInputError(
      `Only ${SUPPORTED_EXTENSIONS.join(', ')} files can be read; ${file} is not one.`,
    )
  }

  // The same identity the app uses: a file is one import per *sheet*, because a
  // Max export is one file whose two sheets are two separate statements.
  const { sheet: table, sheets, hash, fileName } = await readSheetOffered(file, sheetName)
  return { table, sheets, hash, fileName }
}

// --- resolving the mapping -------------------------------------------------

interface Resolved {
  readonly mapping: DraftMapping
  readonly savedMappingId: string | undefined
  /** How the mapping was arrived at, said plainly in every answer. */
  readonly source: string
}

/**
 * The `columns` argument, checked against **this document's** vocabulary (D-213).
 *
 * Against the `const` it would refuse a role somebody added in the app for a
 * column no release could name (D-208) — so the conversation and the app would
 * disagree about what a role is, which is the one thing this tool surface must
 * never do.
 */
function columnsFrom(args: Args, roles: readonly string[]): ReadonlyMap<number, ColumnRoleId> | undefined {
  const raw = args['columns']
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ToolInputError('`columns` must be an object of column index → role.')
  }

  const known = new Set<string>(roles)
  const assigned = new Map<number, ColumnRoleId>()
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0) {
      throw new ToolInputError(`\`columns\` keys are column numbers; "${key}" is not one.`)
    }
    if (typeof value !== 'string' || !known.has(value)) {
      throw new ToolInputError(
        `\`columns["${key}"]\` must be one of ${roles.join(', ')}; got "${String(value)}".`,
      )
    }
    assigned.set(index, value)
  }
  return assigned
}

/**
 * Which amount convention a supplied mapping is in.
 *
 * The convention and the roles have to agree — `requiredRolesFor` asks the
 * convention what a mapping may leave out, so a caller who maps `amount` onto a
 * file the guesser read as a bank statement would otherwise be told that
 * `debit` and `credit` are missing from a mapping that does not want them.
 * Reading it back off the roles is what makes "map these columns" a complete
 * instruction rather than one that needs a second, invisible field to go with
 * it. An explicit `amount_convention` still wins, for the one case the roles
 * cannot express: whether a positive number is a charge or a credit.
 */
function conventionFor(
  columns: ReadonlyMap<number, ColumnRoleId>,
  args: Args,
  fallback: AmountConvention,
): AmountConvention {
  const stated = optionalString(args, 'amount_convention')
  if (stated !== undefined) {
    if (!AMOUNT_CONVENTIONS.includes(stated as AmountConvention)) {
      throw new ToolInputError(
        `\`amount_convention\` must be one of ${AMOUNT_CONVENTIONS.join(', ')}; got "${stated}".`,
      )
    }
    return stated as AmountConvention
  }

  const roles = new Set(columns.values())
  if (roles.has('debit') || roles.has('credit')) return 'SEPARATE_DEBIT_CREDIT'
  // A single amount column, on a mapping the guesser had read as debit/credit:
  // signed is the only convention that column can be in, since nothing else
  // states the direction.
  if (roles.has('amount') && fallback === 'SEPARATE_DEBIT_CREDIT') return 'SIGNED_SINGLE'
  return fallback
}

function resolveMapping(document: OpenDocument, table: SheetTable, args: Args): Resolved {
  const saved = listMappings(document.db)
  const matched = matchSavedMapping(table, saved)
  const columns = columnsFrom(args, columnRoleIds(document.db, 'STATEMENT'))
  const headerRowIndex = optionalNumber(args, 'header_row')

  // An explicit mapping wins, because it is the user answering the question the
  // preview asked. Everything else is the app recognising the file.
  if (columns !== undefined) {
    const base =
      matched?.mapping ??
      guessMapping(table, headerRowIndex === undefined ? {} : { headerRowIndex })
    if (base === undefined) {
      throw new ToolInputError(
        'No header row could be found, so `columns` has nothing to attach to. Pass `header_row` ' +
          'as well — `statement_preview` prints the rows with their numbers.',
      )
    }
    return {
      mapping: {
        ...base,
        columnRoles: columns,
        amountConvention: conventionFor(columns, args, base.amountConvention),
      },
      savedMappingId: undefined,
      source: 'the columns you supplied',
    }
  }

  if (matched !== undefined) {
    return {
      mapping: matched.mapping,
      savedMappingId: matched.candidate.id,
      source: `the reader "${matched.candidate.name}", matched by this file's header`,
    }
  }

  const guessed = guessMapping(table, headerRowIndex === undefined ? {} : { headerRowIndex })
  if (guessed === undefined) {
    throw new ToolInputError(
      'No header row could be found in this sheet. Pass `header_row` with the row number the ' +
        'headers are on — `statement_preview` prints the first rows with their numbers.',
    )
  }
  return { mapping: guessed, savedMappingId: undefined, source: "the app's own guess" }
}

// --- statement_preview -----------------------------------------------------

function describeColumns(table: SheetTable, mapping: DraftMapping): string {
  const header = headerCellsOf(table, mapping.headerRowIndex)
  const width = Math.max(header.length, ...table.rows.slice(0, 20).map((row) => row.length))

  const rows: string[][] = []
  for (let index = 0; index < width; index++) {
    const cells = columnCells(table, index, mapping.dataStartRowIndex)
    const sample = cells.find((cell) => cell.kind !== 'empty')
    rows.push([
      String(index),
      header[index] ?? '—',
      inferColumnShape(cells),
      sample === undefined ? '—' : sample.text,
      mapping.columnRoles.get(index) ?? '—',
    ])
  }

  return asTable(['#', 'Header', 'Looks like', 'First value', 'Mapped to'], rows)
}

function sampleRows(table: SheetTable, mapping: DraftMapping): string {
  const rows = table.rows
    .slice(mapping.headerRowIndex, mapping.headerRowIndex + SAMPLE_ROWS)
    .map((row, offset) => [
      String(mapping.headerRowIndex + offset),
      row.map((cell) => cell.text).join(' ⋮ '),
    ])
  return asTable(['Row', 'Cells'], rows)
}

function renderPreview(document: OpenDocument, args: Args, read: Awaited<ReturnType<typeof readSheet>>): string {
  const { table, sheets } = read
  const resolved = resolveMapping(document, table, args)
  const parsed = applyMapping(table, resolved.mapping)
  const summary = summarize(parsed)
  const missing = missingRequiredRoles(resolved.mapping)
  const accounts = listAccounts(document.db)

  return paragraphs(
    `**${read.fileName}**, sheet "${table.name}"` +
      (sheets.length > 1 ? ` (of ${sheets.length}: ${sheets.join(', ')})` : '') +
      `. Header on row ${resolved.mapping.headerRowIndex}, data from row ` +
      `${resolved.mapping.dataStartRowIndex}. Read with ${resolved.source}.`,
    missing.length === 0
      ? `Parsed ${count(summary.parsed)} rows, ${count(summary.errors)} errors, ` +
        `${count(summary.skipped)} skipped.`
      : `**Not mappable yet**: nothing is mapped to ${missing.join(', ')}. A ` +
        `${resolved.mapping.amountConvention} reader needs ` +
        `${requiredRolesFor(resolved.mapping.amountConvention).join(', ')}. Look at the columns ` +
        'below and pass `columns` to `import_statement`.',
    describeColumns(table, resolved.mapping),
    sampleRows(table, resolved.mapping),
    accounts.length === 0
      ? '**This document has no accounts yet.** Pass `new_account` — name, kind and last 4 ' +
        'digits — to `import_statement`, and the import makes it.'
      : `Import into one of: ${accounts.map((one) => `${one.name} (${one.id})`).join(', ')}.`,
    // This document's list, not this build's (D-213) — a role somebody added in
    // the app is one the conversation can map to in the same breath.
    'Roles you can map to: ' + columnRoleIds(document.db, 'STATEMENT').join(', ') +
      '. Only date, amount and merchant are ' +
      'required; a file with separate debit and credit columns maps those instead of amount.',
  )
}

export const statementPreviewTool: PluginTool = {
  definition: {
    name: 'statement_preview',
    title: 'Look at a statement file',
    description:
      'Read a card or bank statement (.xlsx, .xls, .csv) and report what is in it: which sheet, ' +
      'where the header row is, what each column looks like and what the app guesses it is, the ' +
      'first rows verbatim, and whether a reader already recognises these columns. Changes ' +
      'nothing — call this before import_statement so the user can confirm the columns. **The ' +
      'user maps the columns; the app only guesses**, so show them this and ask.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        file: FILE_PROP,
        sheet: stringProp('Which sheet, when the file has more than one. Defaults to the first.'),
        header_row: numberProp('Force the header row number, when the guess is wrong.'),
        columns: {
          type: 'object',
          description: 'Try columns without importing: column number → role.',
        },
        amount_convention: stringProp(
          `One of ${AMOUNT_CONVENTIONS.join(', ')}. Read from the roles when omitted.`,
        ),
      },
      required: ['path', 'file'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const read = await readSheet(requireString(args, 'file'), optionalString(args, 'sheet'))
    return readDocument(requireString(args, 'path'), (document) =>
      renderPreview(document, args, read),
    )
  },
}

// --- import_statement ------------------------------------------------------

interface Plan {
  readonly read: Awaited<ReturnType<typeof readSheet>>
  readonly resolved: Resolved
  /** Undefined until a `new_account` is written: the plan names it and the commit makes it. */
  readonly accountId: string | undefined
  readonly accountName: string
  readonly newAccount: NewAccount | undefined
  readonly parsed: readonly ParsedRow[]
  readonly newRows: number
  readonly duplicates: number
  /** Another account already holding rows of this file — the screen's *Already in* (M28 F11). */
  readonly elsewhere: RowsHeld | undefined
  readonly errors: number
  readonly skipped: number
  readonly parsedTotals: readonly Money[]
  readonly printed: PrintedTotal | undefined
  readonly reconciles: boolean | undefined
  readonly ignoreTotal: boolean
  readonly saveAs: string | undefined
}

/**
 * Totals per currency of everything that parsed, as magnitudes.
 *
 * The same shape the review screen compares against the printed figure — a file
 * with a dollar section and a shekel section prints one total for each.
 */
function totalsOf(parsed: readonly ParsedRow[]): readonly Money[] {
  const byCurrency = new Map<string, number>()
  for (const draft of allParsed(parsed)) {
    const current = byCurrency.get(draft.amount.currency) ?? 0
    byCurrency.set(draft.amount.currency, current + Math.abs(draft.amount.minor))
  }
  return [...byCurrency].map(([currency, minor]) => ({ minor, currency }))
}

/**
 * **A statement makes its account** (D-313, and M28 U9 for the conversation):
 * the screen has resolved a file's account by its last four digits since the
 * statement batch, and `add_institutions` went with onboarding's institution
 * step. So a new document's first statement names the account it is for, and
 * the commit finds it by those digits or makes it — `resolveAccountForImport`,
 * the screen's own write.
 */
interface NewAccount {
  readonly name: string
  readonly kind: AccountKind
  readonly last4: string | undefined
}

function newAccountOf(args: Args): NewAccount | undefined {
  const raw = args['new_account']
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new ToolInputError('`new_account` must be an object.')
  const spec = raw as Record<string, unknown>
  const name = typeof spec['name'] === 'string' ? spec['name'].trim() : ''
  const kind = spec['kind']
  const last4 = typeof spec['last4'] === 'string' && spec['last4'] !== '' ? spec['last4'] : undefined
  if (name === '') throw new ToolInputError('`new_account.name` is required.')
  if (kind !== 'CREDIT_CARD' && kind !== 'BANK') {
    throw new ToolInputError('`new_account.kind` must be CREDIT_CARD or BANK.')
  }
  if (last4 !== undefined && !/^\d{4}$/.test(last4)) {
    throw new ToolInputError(`\`new_account.last4\` must be exactly four digits; got "${last4}".`)
  }
  return { name, kind, last4 }
}

function buildPlan(document: OpenDocument, args: Args, read: Plan['read']): Plan {
  const givenId = optionalString(args, 'account_id')
  const newAccount = givenId === undefined ? newAccountOf(args) : undefined
  if (givenId === undefined && newAccount === undefined) {
    throw new ToolInputError(
      'Give `account_id` for an account the document has (`document_info` lists them), or ' +
        '`new_account` — name, kind and last 4 digits — and the import makes it.',
    )
  }
  const accounts = listAccounts(document.db, { includeArchived: true })
  const account =
    givenId !== undefined
      ? accounts.find((one) => one.id === givenId)
      : newAccount === undefined
        ? undefined
        : newAccount.last4 !== undefined
          ? accounts.find((one) => one.last4 === newAccount.last4 && one.kind === newAccount.kind)
          : // No number: the commit finds it by name, so the plan does too (M28 F11).
            peekAccountForImport(document.db, { boundAccountId: undefined, last4: undefined, fallbackName: newAccount.name })
  if (givenId !== undefined && account === undefined) {
    throw new ToolInputError(
      `No account with id ${givenId} in this document. \`document_info\` lists them.`,
    )
  }
  const accountId = account?.id

  const resolved = resolveMapping(document, read.table, args)
  const missing = missingRequiredRoles(resolved.mapping)
  if (missing.length > 0) {
    throw new ToolInputError(
      `Nothing is mapped to ${missing.join(', ')}. A ${resolved.mapping.amountConvention} ` +
        `reader needs ${requiredRolesFor(resolved.mapping.amountConvention).join(', ')}. Call ` +
        '`statement_preview` and pass `columns`.',
    )
  }

  const parsed = applyMapping(read.table, resolved.mapping)
  const summary = summarize(parsed)
  const drafts = allParsed(parsed)
  const keys = assignNaturalKeys(drafts)
  const already = accountId === undefined ? new Set<string>() : existingNaturalKeys(document.db, accountId)
  const duplicates = keys.filter((key) => already.has(key)).length
  const elsewhere = overlapElsewhere(
    document.db,
    keys.flatMap((key, index) => {
      const draft = drafts[index]
      return draft === undefined || already.has(key) ? [] : [{ key, direction: draft.direction }]
    }),
    drafts.length,
    accountId,
  )

  const lastDataRowIndex = parsed.reduce(
    (last, row) => (row.outcome.kind === 'parsed' ? row.rowIndex : last),
    resolved.mapping.dataStartRowIndex,
  )
  const printed = findPrintedTotal(read.table, {
    headerRowIndex: resolved.mapping.headerRowIndex,
    lastDataRowIndex,
    currency: resolved.mapping.defaultCurrency,
  })
  const parsedTotals = totalsOf(parsed)

  return {
    read,
    resolved,
    accountId,
    accountName: account?.name ?? `${newAccount?.name ?? 'a new account'} (new)`,
    newAccount: account === undefined ? newAccount : undefined,
    parsed,
    newRows: drafts.length - duplicates,
    duplicates,
    elsewhere,
    errors: summary.errors,
    skipped: summary.skipped,
    parsedTotals,
    printed,
    reconciles:
      printed === undefined
        ? undefined
        : parsedTotals.some((total) => totalsAgree(printed.amount, total)),
    ignoreTotal: args['ignore_printed_total'] === true,
    saveAs: optionalString(args, 'save_mapping_as'),
  }
}

function reconciliation(plan: Plan): string {
  const parsed = plan.parsedTotals.map((total) => formatMoney(total)).join(' + ') || 'nothing'

  if (plan.printed === undefined) {
    return (
      `The file prints no total of its own, so there is nothing to check the parse against. ` +
      `Parsed: ${parsed}.`
    )
  }

  const printed = formatMoney({
    minor: Math.abs(plan.printed.amount.minor),
    currency: plan.printed.amount.currency,
  })

  if (plan.reconciles === true) {
    return `**Reconciles.** The file says ${printed} and the parse comes to ${parsed} — read from ${plan.printed.sourceRowRef}, "${plan.printed.text}".`
  }

  return (
    `**Does not reconcile.** The file says ${printed} (from ${plan.printed.sourceRowRef}, ` +
    `"${plan.printed.text}") and the parse comes to ${parsed}. Something is mapped wrong, or ` +
    'rows are being skipped. **This is refused by default** — fix the reader rather than ' +
    'importing numbers the file itself says are wrong.'
  )
}

function describePlan(plan: Plan): string {
  return paragraphs(
    `**${plan.read.fileName}** → ${plan.accountName}, using ${plan.resolved.source}.`,
    `${count(plan.newRows)} new transactions, ${count(plan.duplicates)} already imported, ` +
      `${count(plan.errors)} rows failed to parse, ${count(plan.skipped)} skipped as not data.`,
    reconciliation(plan),
    plan.elsewhere === undefined
      ? undefined
      : `**${count(plan.elsewhere.rows)} of these rows are already in ${plan.elsewhere.accountName}** ` +
        `(\`account_id\` ${plan.elsewhere.accountId}). If this file is that account — another export ` +
        'of the same bank or card, in a layout of its own — pass that `account_id`, and the rows it ' +
        'already has are left out. Otherwise they are written a second time, into another account.',
    plan.duplicates === 0
      ? undefined
      : 'Duplicates are matched by natural key and are simply not imported again — re-importing ' +
        'the same statement is safe and adds nothing.',
    plan.errors === 0
      ? undefined
      : `The ${count(plan.errors)} failed rows are left out. If that number is large the reader ` +
        'is probably wrong; `statement_preview` shows what each column was read as.',
    plan.saveAs === undefined
      ? plan.resolved.savedMappingId === undefined
        ? 'Pass `save_mapping_as` to keep these columns as a reader, so the next statement of the ' +
          'same shape imports without asking.'
        : undefined
      : `The reader will be kept as "${plan.saveAs}".`,
  )
}

function applyPlan(document: OpenDocument, plan: Plan): string {
  // A backstop. The tool refuses before it gets here, in a read pass that runs
  // before any backup is taken; this exists so the rule holds for anything that
  // ever calls `applyPlan` directly.
  if (plan.reconciles === false && !plan.ignoreTotal) {
    throw new ToolInputError(`Refusing to import ${plan.read.fileName}: ${reconciliation(plan)}`)
  }

  const now = Date.now()
  let mappingId = plan.resolved.savedMappingId
  const accountId =
    plan.accountId ??
    resolveAccountForImport(
      document.db,
      {
        boundAccountId: undefined,
        last4: plan.newAccount?.last4,
        fallbackName: plan.newAccount?.name ?? plan.read.fileName,
        kind: plan.newAccount?.kind ?? 'CREDIT_CARD',
      },
      now,
    ).id

  if (plan.saveAs !== undefined) {
    const saved = saveMapping(
      document.db,
      {
        name: plan.saveAs,
        headerSignature: computeHeaderSignature(plan.read.table, plan.resolved.mapping.headerRowIndex),
        mapping: plan.resolved.mapping,
        accountId,
      },
      now,
    )
    mappingId = saved.id
  }

  const staged = stageImport(
    document.db,
    {
      accountId,
      fileName: plan.read.fileName,
      fileHash: plan.read.hash,
      sheetName: plan.read.table.name,
      ...(mappingId === undefined ? {} : { mappingId }),
      rows: plan.parsed,
      table: plan.read.table,
      headerRowIndex: plan.resolved.mapping.headerRowIndex,
      currency: plan.resolved.mapping.defaultCurrency,
    },
    now,
  )

  // The staging area is a review queue in the app and a step on the way here:
  // the confirmation already happened in the conversation, so the new rows are
  // accepted and committed in the same breath (D-100). Duplicates are left
  // unaccepted, which is what makes re-importing a statement a no-op.
  acceptAllNew(document.db, staged.sessionId, now)
  // The commit records the mapping's use: it is the session's (M25 U3b found
  // this counted twice).
  const result = commitSession(document.db, staged.sessionId, now)

  return paragraphs(
    `Imported **${count(result.imported)} transactions** from ${plan.read.fileName} into ` +
      `${plan.accountName}, \`account_id\` ${accountId}.`,
    // A batch in a conversation is one call per file (M28 F15): the account the
    // first file made is the one the next file of it names, in the same pass.
    plan.accountId === undefined
      ? 'The next file of this account — another month, or another export of it — passes that ' +
        '`account_id`, so its rows land here and the ones it shares with this file are left out.'
      : undefined,
    reconciliation(plan),
    [
      result.duplicates === 0 ? undefined : `${count(result.duplicates)} were already there.`,
      result.failed === 0 ? undefined : `${count(result.failed)} rows could not be parsed.`,
      result.categorizedByRule === 0
        ? undefined
        : `${count(result.categorizedByRule)} were categorized by an existing rule.`,
      result.settlementsLinked === 0
        ? undefined
        : `${count(result.settlementsLinked)} bank rows were linked to a card statement.`,
      result.debtPaymentsFound === 0
        ? undefined
        : `${count(result.debtPaymentsFound)} debt payments were discovered, awaiting ` +
          'confirmation in the app.',
      result.transfersSuggested === 0
        ? undefined
        : `${count(result.transfersSuggested)} transfers between the person’s own accounts were ` +
          'suggested; `transfers` lists them and `answer_transfers` answers them.',
    ]
      .filter((one) => one !== undefined)
      .join(' ') || undefined,
    result.imported === 0
      ? undefined
      : 'Anything left uncategorized is what `uncategorized_merchants` will show next.',
  )
}

export const importStatementTool: PluginTool = {
  definition: {
    name: 'import_statement',
    title: 'Import a statement',
    description:
      'Import a card or bank statement into an account, through the app’s own pipeline: the same ' +
      'parse, the same dedupe by natural key, the same rules applied on commit. **Dry-runs by ' +
      'default** — it reports what it would import and how the parse compares with the total the ' +
      'file prints for itself, and writes nothing until commit is true. **A file whose printed ' +
      'total does not reconcile is refused**, because importing over it puts numbers in the ' +
      'ledger the file itself says are wrong. Re-importing the same statement is safe: duplicates ' +
      'are matched and skipped.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        file: FILE_PROP,
        account_id: stringProp('The account to import into. Ids come from `document_info`. Or `new_account`.'),
        new_account: {
          type: 'object',
          description:
            'Instead of `account_id`, on a document that has no account for this file yet: the ' +
            'account the statement is for, made on commit — or found, when one of that kind already ' +
            'has these last 4 digits, as the app does when it reads a statement.',
          properties: {
            name: stringProp('A name the user will recognise, e.g. "Cal – Visa 1234".'),
            kind: stringProp('CREDIT_CARD or BANK.'),
            last4: stringProp('The last four digits of the card or account.'),
          },
          required: ['name', 'kind'],
          additionalProperties: false,
        },
        sheet: stringProp('Which sheet, when the file has more than one.'),
        header_row: numberProp('Force the header row number, when the guess is wrong.'),
        columns: {
          type: 'object',
          description:
            'Column number → role, from what the user confirmed in `statement_preview`. Omit ' +
            'when a reader already recognises the file.',
        },
        amount_convention: stringProp(
          `One of ${AMOUNT_CONVENTIONS.join(', ')}. Usually read from the roles you map — state ` +
            'it only when a single amount column needs saying which sign is a charge.',
        ),
        save_mapping_as: stringProp(
          'Keep these columns as a reader under this name, so the next statement of the same shape ' +
            'imports without asking.',
        ),
        ignore_printed_total: booleanProp(
          'Import even though the parse disagrees with the total the file prints. Default false, ' +
            'and it should stay false unless the user is certain the file’s own figure is wrong.',
        ),
        commit: booleanProp('Default false. False previews the import and writes nothing.'),
      },
      required: ['path', 'file'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const read = await readSheet(requireString(args, 'file'), optionalString(args, 'sheet'))
    const commit = args['commit'] === true

    const mutation: Mutation<Plan> = {
      plan: (document) => buildPlan(document, args, read),
      describe: describePlan,
      apply: applyPlan,
    }

    if (commit) {
      // Checked in its own read pass, **before** `mutatingCall` takes a backup.
      // A file that does not add up is refused rather than imported, and a
      // refused call must not leave a `.bak` behind whose only meaning is that
      // nothing happened — the same ordering the schema gate keeps (D-098).
      const objection = await readDocument(path, (document) =>
        buildPlan(document, args, read).reconciles === false && args['ignore_printed_total'] !== true
          ? REFUSE
          : '',
      )
      if (objection === REFUSE) {
        return paragraphs(
          `**Not imported: ${read.fileName} does not add up to what it says it does.**`,
          await mutatingCall(path, false, mutation),
          'Fix the reader, or pass `ignore_printed_total: true` if the user is certain the ' +
            'file’s own figure is the wrong one.',
        )
      }
      // Anything else a read returns here is the gate refusing the document.
      if (objection !== '') return objection
    }

    return mutatingCall(path, commit, mutation)
  },
}
