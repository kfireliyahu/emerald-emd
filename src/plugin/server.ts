/**
 * The MCP server: the tool surface, and the plumbing that exposes it.
 *
 * Built on the low-level `Server` rather than the SDK's `McpServer` helper for
 * one reason worth the extra dozen lines: `registerTool` describes a tool with
 * a Zod schema, which would make `zod` a direct dependency of this repo, and
 * the tool surface is a public API (D-092) that is easier to review as the
 * literal JSON Schema a client will actually receive.
 *
 * The server itself makes **zero network calls**, and `server.test.ts` proves
 * it rather than asserting it. The only thing that leaves this machine is
 * whatever Claude puts in the conversation — which is a different privacy
 * contract from the in-app AI route, and deliberately so (docs/f14 trap 3).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolResult,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
// The frame's page, built by `vite build --mode frame` and compiled in as a
// string by the `fc:frame-embedded` plugin (M41 U1), so this stays one file.
import FRAME_PAGE from 'virtual:emerald-frame'

import { APP_MIME, SHEET_URI, UI_EXTENSION } from '@/frame/contract.ts'

import { PLUGIN_VERSION } from './document.ts'
import { addSubscriptions } from './subscriptions.ts'
import { ENGINE_INSTRUCTIONS, SERVER_INSTRUCTIONS } from './instructions.ts'
import { documentInfoTool } from './tools/documentInfo.ts'
import { categoryTreeTool, transactionsTool, uncategorizedMerchantsTool } from './tools/ledger.ts'
import { monthSummaryTool, yearSummaryTool } from './tools/insights.ts'
import { debtProjectionTool, debtsTool, fixedExpensesTool, goalProjectionTool, savingsTool } from './tools/wealth.ts'
import {
  dismissFixedExpenseCandidatesTool,
  fixedExpenseCandidatesTool,
  trackFixedExpensesTool,
} from './tools/fixed.ts'
import {
  editFixedExpensesTool,
  planMonthTool,
  plansTool,
  setFixedExpenseRolesTool,
  setPlanTool,
} from './tools/plan.ts'
import { paychecksTool, recordPaychecksTool } from './tools/paychecks.ts'
import { setDeductionTypesTool } from './tools/deductionTypes.ts'
import { fundsTool, recordFundReadingsTool } from './tools/funds.ts'
import { createSavingGoalsTool, recordDepositsTool } from './tools/savings.ts'
import { setPlaceAccountsTool } from './tools/placeAccounts.ts'
import { recordHoldingReadingsTool } from './tools/holdingReadings.ts'
import { setTransactionHoldingsTool } from './tools/transactionHoldings.ts'
import { answerTransfersTool, transfersTool } from './tools/transfers.ts'
import { countCardChargesTool, setNoPayMonthsTool } from './tools/waiting.ts'
import { setOpeningBalancesTool } from './tools/accountBalances.ts'
import { setCushionTool, setGoalDepositCategoriesTool } from './tools/goalDeposits.ts'
import { pauseGoalsTool, setGoalAmountsTool, settleSetAsideTool, suggestGoalAmountsTool } from './tools/goalRhythm.ts'
import { createDebtsTool, recordDebtPaymentsTool } from './tools/debts.ts'
import { assignCategoryTool, noteMerchantSuggestionsTool } from './tools/categorize.ts'
import { createRuleTool } from './tools/rules.ts'
import {
  setCardPayersTool,
  setExcludedFromTotalsTool,
  setTransactionNotesTool,
  skipMerchantsTool,
} from './tools/rows.ts'
import { editCategoriesTool } from './tools/categoryEdits.ts'
import { createCategoryTool } from './tools/taxonomy.ts'
import { importStatementTool, statementPreviewTool } from './tools/ingest.ts'
import { recordHoldingsStatementTool } from './tools/holdingStatement.ts'
import { readersTool, readOntoFormatTool, supersedeReadingTool } from './tools/intake.ts'
import { formatProblemsTool } from './tools/audit.ts'
import { keepCopyTool } from './tools/keepCopy.ts'
import { storeDocumentAsTool } from './tools/storeAs.ts'
import { arrangeViewsTool } from './tools/views.ts'
import {
  connectFormatsTool,
  declareFormatTool,
  deleteFormatTool,
  extendFormatTool,
  formatRollupTool,
  applyRulesTool,
  deleteFormatRowsTool,
  formatRowsTool,
  formatsTool,
  recordFormatRowsTool,
  recordUnitsTool,
  updateFormatRowsTool,
} from './tools/formats.ts'
import { dispatchPlanTool } from './tools/dispatch.ts'
import { claimUnitsTool, landUnitsTool } from './tools/landing.ts'
import { searchDocumentTool } from './tools/searchDocument.ts'
import { startHereTool } from './tools/startHere.ts'
import { showFormatTool, frameCopyTool, servedPage } from './tools/sheet.ts'
import { guideStatusTool } from './tools/guide.ts'
import { keepPacksTool } from './tools/packs.ts'
import { chooseCategoriesTool, createDocumentTool, updateAccountTool } from './tools/setup.ts'
import {
  ToolInputError,
  type ElicitForm,
  type ElicitOutcome,
  type PluginTool,
  type ToolContext,
} from './tools/tool.ts'

export const SERVER_NAME = 'emerald'

/**
 * **The whole tool surface**, in one screenful, on purpose.
 *
 * "Chosen once, deliberately, and kept small" (D-092) is a decision that has to
 * be visible somewhere, and a list is a place a reviewer can count: one gate,
 * three over the ledger, two over a period, three that read the standing
 * commitments and three that answer the detector behind them, four over the
 * payslips and the funds and four more over the savings and the debts — a read
 * beside each write, which is the pairing whose absence D-109, D-111, D-112 and
 * D-113 were each found by — five that walk a document's first run (`create_document` went to the engine's list, D-405),
 * one that adds categories the shipped list never had, two that categorize — the
 * assignment and the memo about names nobody could place (D-104) — one that
 * writes a rule, and two that read and import a statement. The five over
 * investments left with them (D-283): a person declares their own.
 *
 * **There is no number in that sentence any more**, and there used to be. It
 * went stale the day the twentieth tool landed and again at the twenty-first,
 * while the list below was right both times — which is the whole argument for
 * keeping the list in one screenful and for counting nothing in prose (D-109).
 * **Every one of them is shaped**, and there is deliberately no general
 * `query` escape hatch beside them (D-095).
 *
 * **A name says whether it writes**: reads are noun phrases and writes are verb
 * phrases (D-096), so `month_summary` reads and `create_document` does not.
 *
 * That is the point of the list, not a caveat about it. A shaped tool is a
 * capability someone chose to expose; a general query is every capability at
 * once, including the ones nobody listed — payslip lines, the budget plan, the
 * rules engine, import internals. It also makes any future gate unenforceable,
 * because anything gated can be rebuilt with a `SELECT`. The escape hatch was
 * not needed inside the trust boundary anyway: a `.emd` is a plain
 * SQLite file and `sqlite3` opens it.
 *
 * Every name here is an API from the day a stranger's conversation depends on
 * it. Adding one is cheap; renaming or removing one is not — and a question no
 * tool answers is a request for a *new shaped tool*, never a reason to reopen
 * the hatch.
 */
export const LEDGER_TOOLS: readonly PluginTool[] = [
  documentInfoTool,
  categoryTreeTool,
  uncategorizedMerchantsTool,
  transactionsTool,
  monthSummaryTool,
  yearSummaryTool,
  fixedExpensesTool,
  debtsTool,
  savingsTool,
  goalProjectionTool,
  debtProjectionTool,
  // The detector, which had been built since M4 and unreachable from here: the
  // candidates, the confirmation, and saying no. Two verbs rather than one,
  // because confirming writes a standing commitment and dismissing writes a
  // note — and those want different safeguards (D-111).
  fixedExpenseCandidatesTool,
  trackFixedExpensesTool,
  dismissFixedExpenseCandidatesTool,
  // The Plan screen (M28 U7, D-319): fixed expenses and the split on one page,
  // and every write on it. A list and a dry run each, like the rest.
  plansTool,
  planMonthTool,
  setFixedExpenseRolesTool,
  setPlanTool,
  editFixedExpensesTool,
  // Payslips and funds, each a read beside the write it was missing (D-112).
  // They are a pair rather than two units: the deposit check — F13's highest
  // claim, and the reason the app is worth opening — is the payslips and the
  // fund's own report put side by side, and neither side was reachable.
  paychecksTool,
  recordPaychecksTool,
  // What each deduction type counts as and pays into — how a fund finds its payslip lines (M36 F1).
  setDeductionTypesTool,
  fundsTool,
  recordFundReadingsTool,
  // Savings and debts: the writes beside the two reads already in `wealth.ts`
  // (D-113). What the user knows and can say — a goal, a movement, a debt, a
  // payment. What the *app* discovered stays app-only: the debt review queue
  // and installment promotion are answers to the ledger, not to the user.
  createSavingGoalsTool,
  recordDepositsTool,
  setPlaceAccountsTool,
  // What a statement says a holding is worth on a day (M30 U5).
  recordHoldingReadingsTool,
  // Where a goal finds its bank deposits, and the cushion (M28 U8, D-324).
  setGoalDepositCategoriesTool,
  setCushionTool,
  // Pausing, the set-aside check and the suggested split (M28 U8, S7, S5, S3).
  pauseGoalsTool,
  settleSetAsideTool,
  suggestGoalAmountsTool,
  setGoalAmountsTool,
  setOpeningBalancesTool,
  createDebtsTool,
  recordDebtPaymentsTool,
  // The document. `guide_status` is the app's Guide me as a list (M28 U9,
  // D-330), which replaced onboarding's two tools. `create_document` went to
  // the engine's list at M38 U7 (D-405): it makes a document with whichever
  // packs it is asked for, the ledger no longer implied.
  guideStatusTool,
  updateAccountTool,
  chooseCategoriesTool,
  // The taxonomy write: `choose_categories`
  // keeps or archives what shipped, and a name the list never had needed a tool
  // of its own (D-095 — a question no tool answers is a new shaped tool).
  createCategoryTool,
  // The other half of the taxonomy, and what the Transactions and Categories
  // screens do beyond filing (M28 U6, D-315): each is a list and a dry run, and
  // each closed a screen-only write on parity's ratchet.
  editCategoriesTool,
  setExcludedFromTotalsTool,
  setTransactionNotesTool,
  // What a row's cash turned into inside its account (M30 U2).
  setTransactionHoldingsTool,
  // The two ends of a transfer between the person's own accounts (M30 U3).
  transfersTool,
  answerTransfersTool,
  // The two answers Home's waiting list added (M31 U1): a card charge with no
  // statement, counted as spending, and a month with no pay.
  countCardChargesTool,
  setNoPayMonthsTool,
  setCardPayersTool,
  skipMerchantsTool,
  // The first tool that changes rows in a document somebody already cares
  // about, and the reason the dry run, the backup and the provenance exist.
  assignCategoryTool,
  // A memo about merchants that were *not* categorized, so the same names are
  // not asked about twice. The one write with no dry run: it touches no row.
  noteMerchantSuggestionsTool,
  // The widest write here, and the only one with a gate the caller cannot skip.
  createRuleTool,
  // Ingestion: the app's own import pipeline, driven from a conversation.
  statementPreviewTool,
  importStatementTool,
  // A statement of an account with holdings, which the conversation reads
  // itself: rows and readings in one batch, keyed by the balance after each row (M30 U6).
  recordHoldingsStatementTool,
]

/**
 * The engine's own tools — the surface over whatever *this document* declares.
 *
 * **Separate from the list above because `--engine-only` omits that one**
 * (M22 U0). The two halves were always conceptually apart; until the measuring
 * they were apart in a comment only.
 */
export const ENGINE_TOOLS: readonly PluginTool[] = [
  // The engine (M19 U2, D-217). Everything above is a capability somebody wrote
  // by hand; these five are the surface over whatever *this document* declares,
  // and they are the first tools here that know nothing about money. Their
  // vocabulary comes from the document rather than from this build, which is
  // why `formats` is the one to call first and why the other four refuse a
  // column the declaration has not got by naming the ones it has.
  //
  // **They are still shaped** in the sense D-095 means: they can name nothing
  // but a declared format, reach nothing but a `fmt_` table, and take no SQL
  // from anybody. A declaration is not an escape hatch — it is a vocabulary the
  // user wrote down and the document holds.
  //
  // And they are where the surface stops only adding. `update_format_rows` and
  // `delete_format_rows` arrived because a declared format's rows had no screen
  // at all (D-217); **M20 U1 gave them one, and the reason inverted rather than
  // expired** (D-227, D-229). The rule from M20 is that anything a person can do
  // on a screen a conversation can do too, so these two stay — and the "Not
  // here" section below is now a list of edits whose *tool* has not been built,
  // rather than a principle. **`src/parity.test.ts` is the audit that says
  // which** (U6, D-234): six of the engine's capabilities have one half, and
  // each carries the assertion that keeps it honest until somebody builds it.
  formatsTool,
  declareFormatTool,
  // M24 U2 (D-253): parity gap #11. The graph's gesture, for two formats that
  // are both already there, and it only ever adds.
  connectFormatsTool,
  // M24 U3 (D-254): the other two. `extend_format` renames, retypes and
  // removes too since M38 U6 (D-412), judged by the reconciler as the sheet is.
  extendFormatTool,
  deleteFormatTool,
  formatRowsTool,
  // M41 U1: the same answer, and in a client that draws MCP Apps the app's own
  // sheet of it in the conversation — the one tool here with a page.
  showFormatTool,
  // M34 U3 (D-396): what the engine can see is wrong, asked for — the same
  // look a read takes unasked, and the band on the format's page.
  formatProblemsTool,
  // M47 U6: every row that holds a term, across the whole document, in one
  // call where `format_rows`' search is one a format — and, given a denylist,
  // the scan before a document is shared.
  searchDocumentTool,
  // M27 U5 (D-303): the questions a session asks first, as the document's own
  // views declare them — ready, open, left to review, latest — in one call.
  startHereTool,
  // M25 E2 (D-271): a declared figure per month, the screen's view on the
  // format's own page.
  formatRollupTool,
  applyRulesTool,
  recordFormatRowsTool,
  updateFormatRowsTool,
  deleteFormatRowsTool,
  // M47 U3 (D-460): the development pack's two moments, claiming and landing a
  // unit, each one call — compositions of the two above, writing nothing they
  // do not (`src/parity.test.ts` lists them as such).
  claimUnitsTool,
  landUnitsTool,
  // M51 U4 (D-486): before handing units out, which share a path and so
  // cannot run at once — read-only, over the same pack.
  dispatchPlanTool,
  // U4a (D-223): the unit table is rows in the document, so there has to be a
  // way to add one. Without it the claim that every conversion reads *what the
  // document knows* would be true and useless — which is D-208 exactly.
  recordUnitsTool,
  // Intake's two halves (M20 U7, D-235), and they are the last capability the
  // parity audit found with a screen and no tool. `read_onto_format` is the
  // general form of the two above it: `import_statement` reads onto the pack's
  // transactions table and can never read onto a declared one, so a document
  // with four hundred lines in a spreadsheet had no way in from a conversation
  // at all. `supersede_reading` is the half that makes the first one safe —
  // *every import is idempotent* here means **the same file**, by its bytes,
  // and a tool that could write an intake but not take one back would be the
  // more dangerous half on its own.
  readOntoFormatTool,
  supersedeReadingTool,
  // M26 F1 (D-293): a reader named or forgotten, the read screen's two icons.
  readersTool,
  // M34 U6 (D-399): a named copy, whenever asked — the one a read or a large
  // batch keeps by itself, for anything else somebody may want to undo.
  keepCopyTool,
  // M47 U7: the per-file choice of text or SQLite bytes (D-246), the app's
  // Save as text — a screen with no tool until then.
  storeDocumentAsTool,
  // M35 U4 (D-403): how a format is shown — Show as, the header line, the
  // entry's order, a board's lanes, a sheet's widths. Refused until then on
  // "a conversation draws no page" (D-289, D-294, D-301); the person it works
  // for is looking at the page.
  arrangeViewsTool,
  // M38 U7 (D-405): a document made with the packs it is asked for, and a
  // pack kept in one that exists — the Packs screen's *Keep this pack here*.
  // `create_document` is the only tool here that does not take a path to
  // something that already exists.
  createDocumentTool,
  keepPacksTool,
]

/**
 * **The frame's own tools** (M44 U4, D-442): `_meta.ui.visibility: ["app"]`, so
 * a host that draws MCP Apps keeps them out of the model's list and lets only
 * this server's frame call them. **Listed to every client** (M41 F2, D-446): a
 * host that draws without advertising MCP Apps the way M41 U2 read it refuses
 * a page's call to a tool it was never listed, and a client that knows no
 * visibility hands a model a tool that refuses it without the key the page
 * carries (M41 F3, D-447).
 */
export const APP_TOOLS: readonly PluginTool[] = [frameCopyTool]

/**
 * A tool as `tools/list` hands it out: its title said twice (M42 U1).
 *
 * The spec reads a display name from `title` first and `annotations.title`
 * second, and a directory's review asks for the annotation; a client written
 * against the older spec knows only that one. Each definition writes its title
 * once, and this copies it into the annotations, so the two cannot disagree.
 * `annotations.test.ts` holds every listed tool to the full set of hints.
 */
export function listedDefinition(definition: Tool): Tool {
  return { ...definition, annotations: { title: definition.title, ...definition.annotations } }
}

/** Everything this server can *answer*, in the order the list above reads. */
const TOOLS: readonly PluginTool[] = [...LEDGER_TOOLS, ...ENGINE_TOOLS, ...APP_TOOLS]

/**
 * How the server was started.
 *
 * `engineOnly` is a **server argument and never document state** — `tools/list`
 * carries no document (D-217), so this process cannot read a per-document pack
 * flag at the moment it has to answer. Configuration may say it; a document may
 * not be asked.
 */
export interface ServerOptions {
  /**
   * Offer the engine's tools and not the ledger's (M22 U0).
   *
   * **Measured 2026-09-20: `tools/list` is 46 tools and ~23,900 tokens, of
   * which ~19,250 are the ledger's 38** — in a session's context on every turn,
   * whether or not money is what it is doing. It is a token measure, not the
   * app's old staging switch, which M25 U8 took away (D-266).
   */
  readonly engineOnly?: boolean
  /**
   * Where a line about the connection goes (M41 F2): `main.ts` writes it to
   * stderr, which a host shows in its server log — VS Code under Output → MCP.
   * Said once per client, on `initialized`: who it is and what it advertised.
   */
  readonly log?: (line: string) => void
}

export function createServer(options: ServerOptions = {}): Server {
  const offered = options.engineOnly === true ? ENGINE_TOOLS : [...LEDGER_TOOLS, ...ENGINE_TOOLS]
  const server = new Server(
    { name: SERVER_NAME, version: PLUGIN_VERSION },
    // `instructions` rides on `initialize` and is rendered by the client once
    // per conversation (D-110). It is where anything shared by many tools
    // belongs — the goal of the whole surface, the working practices, the
    // vocabulary — precisely because the alternative is repeating it in every
    // description and paying for it in every one of them.
    {
      // `resources` serves one page, the frame `show_format` and `start_here`
      // name (M41 U1, U2), and **a document is a resource you can subscribe
      // to** (M44 U2, D-440): `subscriptions.ts`.
      capabilities: { tools: {}, resources: { subscribe: true } },
      instructions: options.engineOnly === true ? ENGINE_INSTRUCTIONS : SERVER_INSTRUCTIONS,
    },
  )

  // **The filter is on what you are offered and nowhere else** (M22 U0):
  // `tools/list` offers the engine's, and a caller that names a ledger tool
  // anyway still gets an answer rather than "unknown tool". It cuts what a
  // session holds in context; it never makes a capability vanish.
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [...offered, ...APP_TOOLS].map((tool) => listedDefinition(tool.definition)),
  }))

  // **What a client advertised, said where a person can read it** (M41 F2):
  // VS Code's chat drew a page with no document because the copy then went
  // only to a client advertising MCP Apps in the form this server read, and
  // nothing said what that client had advertised instead.
  if (options.log !== undefined) {
    const log = options.log
    server.oninitialized = () => log(clientLine(server.getClientVersion(), server.getClientCapabilities()))
  }

  // **One listed resource, and it is a page** (M41 U1): the frame a client
  // that draws MCP Apps reads when a tool names it. Served from memory; it
  // holds no document — the drawn page fetches that with `frame_copy` — and
  // carries this process's key, which is how `frame_copy` knows the page from
  // a model (M41 F3, D-447). A document is subscribed to, never listed or read
  // here (M44 U2).
  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: [{ uri: SHEET_URI, name: 'sheet', title: 'A format’s table', mimeType: APP_MIME }],
  }))
  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    if (request.params.uri !== SHEET_URI) {
      throw new Error(
        `No resource at ${request.params.uri}. This server serves ${SHEET_URI}; ` +
          'a document is subscribed to by its file:// URI and read with the tools.',
      )
    }
    // Borderless (M41 F1): the frame wears the host's surface, so a host's own
    // card around it would draw a box inside the conversation.
    return {
      contents: [{ uri: SHEET_URI, mimeType: APP_MIME, text: servedPage(FRAME_PAGE), _meta: { ui: { prefersBorder: false } } }],
    }
  })

  // A subscription to a document (M44 U2): the one thing this server holds
  // between calls, and it holds nothing of the document.
  addSubscriptions(server)

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const tool = TOOLS.find((one) => one.definition.name === request.params.name)
    if (tool === undefined) {
      return failure(
        `Unknown tool: ${request.params.name}. This server offers ` +
          `${offered.map((one) => one.definition.name).join(', ')}.`,
      )
    }

    try {
      const args = request.params.arguments ?? {}
      const context = contextFor(server, options.engineOnly === true)
      if (tool.answer !== undefined) {
        const { text, meta, structured } = await tool.answer(args, context)
        return {
          content: [{ type: 'text', text }],
          ...(structured === undefined ? {} : { structuredContent: structured }),
          ...(Object.keys(meta).length === 0 ? {} : { _meta: meta }),
        }
      }
      const text = await tool.run(args, context)
      return { content: [{ type: 'text', text }] }
    } catch (error) {
      // A bad argument is the caller's to fix and comes back as a sentence.
      // Anything else is this server's fault and says so rather than pretending
      // the document said something.
      if (error instanceof ToolInputError) return failure(error.message)
      return failure(
        `${request.params.name} failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  })

  return server
}

/**
 * What this client can do for a tool, decided per call from what it declared.
 *
 * `elicit` is present **only** when the client advertised elicitation — Claude
 * Code advertises `elicitation: { form: {} }` (D-096) and other clients do not.
 * A tool checks for the function rather than for a capability string, so the
 * absent case is the one the type system makes it handle.
 *
 * A thrown elicitation is folded into `cancel` on purpose. From a tool's point
 * of view "the user did not answer" and "the client could not ask" lead to the
 * same next move — ask in prose — and turning a UI failure into a tool failure
 * would make the optional thing load-bearing.
 */
function contextFor(server: Server, engineOnly: boolean): ToolContext {
  const capabilities = server.getClientCapabilities()
  const name = server.getClientVersion()?.name
  // **Who asked, for the line a drawing tool opens with** (M51 F1, D-489).
  const client =
    name === undefined
      ? {}
      : { client: { name, saysItDraws: drawsMcpApps(uiExtension(capabilities as Record<string, unknown> | undefined)) } }
  if (capabilities?.elicitation === undefined) return { engineOnly, ...client }

  return {
    engineOnly,
    ...client,
    elicit: async (form: ElicitForm): Promise<ElicitOutcome> => {
      try {
        const result = await server.elicitInput({
          message: form.message,
          requestedSchema: form.requestedSchema as never,
        })
        return result.action === 'accept'
          ? { action: 'accept', content: result.content ?? {} }
          : { action: result.action === 'decline' ? 'decline' : 'cancel' }
      } catch {
        return { action: 'cancel' }
      }
    },
  }
}

/**
 * Whether a client's `io.modelcontextprotocol/ui` entry says it draws this
 * server's pages (M41 U2): present, and listing `text/html;profile=mcp-app`
 * among its media types or listing none. No copy of the document turns on it
 * (M41 F2, D-446); the line a drawing tool's answer opens with does (M51 F1,
 * D-489), because a model cannot see the person's screen and must not guess.
 */
function drawsMcpApps(extension: unknown): boolean {
  if (typeof extension !== 'object' || extension === null) return false
  const types = (extension as { mimeTypes?: unknown }).mimeTypes
  return !Array.isArray(types) || types.includes(APP_MIME)
}

/** A client's `io.modelcontextprotocol/ui` entry, as it declared it. */
function uiExtension(capabilities: Record<string, unknown> | undefined): unknown {
  return (capabilities?.['extensions'] as Record<string, unknown> | undefined)?.[UI_EXTENSION]
}

/**
 * One line about a client that connected: its name and version, whether it
 * advertised MCP Apps and how, and every capability it declared, whole — so
 * a host that draws under another key is read off the log, not guessed.
 */
export function clientLine(
  client: { name?: string; version?: string } | undefined,
  capabilities: Record<string, unknown> | undefined,
): string {
  const extension = uiExtension(capabilities)
  const ui =
    extension === undefined
      ? `${UI_EXTENSION} not advertised`
      : `${UI_EXTENSION} ${JSON.stringify(extension)} (${drawsMcpApps(extension) ? 'draws this server’s pages' : `no ${APP_MIME}`})`
  return (
    `emerald: client ${client?.name ?? 'unnamed'} ${client?.version ?? ''}`.trimEnd() +
    `; ${ui}; capabilities ${JSON.stringify(capabilities ?? {})}`
  )
}

/**
 * A tool failure, not a protocol error.
 *
 * The distinction matters to the conversation: `isError` puts the text in front
 * of Claude as a result it can reason about and retry, where a thrown JSON-RPC
 * error is the client's problem and the user never sees why.
 *
 * A document the plugin refuses on schema grounds is *not* one of these. That
 * is a successful answer to "will you serve this?", and the refusal text says
 * REFUSED in its own words.
 */
function failure(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true }
}
