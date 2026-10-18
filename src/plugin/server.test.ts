import { createLedgerDatabase } from '@/data/packs/ledger/testing.ts'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Socket } from 'node:net'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SCHEMA_VERSION, createDatabase, exportDatabase } from '@/data/db/database.ts'

import { APP_MIME, COPY_TOOL, KEY_META, SHEET_META, SHEET_URI, UI_EXTENSION } from '@/frame/contract.ts'

import { SERVER_NAME, type ServerOptions, clientLine, createServer } from './server.ts'
import { drawnLine, FOR_THE_MODEL, NO_KEY, servedPage } from './tools/sheet.ts'
import { tempDir } from '../testing/tempDir'

/**
 * The key the server wrote into the page it serves (M41 F3, D-447), read as a
 * host reads the page: with `resources/read`.
 */
async function pageKeyOf(client: Client): Promise<string> {
  const read = await client.readResource({ uri: SHEET_URI })
  const html = (read.contents[0] as { text?: string }).text ?? ''
  const key = new RegExp(`<meta name="${KEY_META}" content="([^"]+)"`).exec(html)?.[1]
  if (key === undefined) throw new Error('The page carries no key.')
  return key
}

/** `frame_copy`'s answer, from `structuredContent` (M41 F3). */
function copyOf(result: Awaited<ReturnType<Client['callTool']>>): { stamp: string; name?: string; uri?: string; bytes?: string } | undefined {
  return result.structuredContent as { stamp: string; bytes?: string } | undefined
}

/**
 * A real MCP client talking to the real server over a linked transport pair.
 *
 * In memory rather than over a pipe, deliberately: what is worth testing is the
 * handshake, the tool list and the tool call, and those are identical on any
 * transport. The five lines of stdio wiring in `main.ts` are proven by running
 * the built server from Claude Code, which is the only place they can be proven
 * honestly anyway.
 */
/** The test client, when it says it draws MCP Apps: what `drawnLine` is told of it. */
const TEST_DRAWS = { name: 'test', saysItDraws: true }

async function connected(options: ServerOptions = {}, drawsApps = false): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client(
    { name: 'test', version: '0' },
    // What a client that draws MCP Apps says (SEP-1865), when the test is one.
    { capabilities: drawsApps ? { extensions: { [UI_EXTENSION]: { mimeTypes: [APP_MIME] } } } : {} },
  )
  await Promise.all([
    createServer(options).connect(serverTransport),
    client.connect(clientTransport),
  ])
  return client
}

async function writeDocument(name: string): Promise<string> {
  const db = await createLedgerDatabase()
  const bytes = exportDatabase(db)
  db.close()
  const dir = await tempDir('emerald-plugin-')
  const path = join(dir, name)
  await writeFile(path, bytes)
  return path
}

function textOf(result: unknown): string {
  const content = (result as { content: readonly { type: string; text?: string }[] }).content
  return content.map((part) => part.text ?? '').join('\n')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the MCP server', () => {
  it('handshakes and identifies itself', async () => {
    const client = await connected()
    expect(client.getServerVersion()?.name).toBe(SERVER_NAME)
    await client.close()
  })

  it('exposes exactly this surface, and no more', async () => {
    // Not a style assertion, and the reason it is written out rather than
    // counted: a tool name is an API from the day a stranger's conversation
    // depends on one (D-092). Adding a name should mean editing this list on
    // purpose; a name appearing here by accident is the failure it catches, and
    // a name *disappearing* is the one that breaks somebody's conversation.
    const client = await connected()
    const { tools } = await client.listTools()

    expect(tools.map((tool) => tool.name)).toEqual([
      'document_info',
      'category_tree',
      'uncategorized_merchants',
      'transactions',
      'month_summary',
      'year_summary',
      'fixed_expenses',
      'debts',
      'savings',
      'goal_projection',
      'debt_projection',
      'fixed_expense_candidates',
      'track_fixed_expenses',
      'dismiss_fixed_expense_candidates',
      'plans',
      'plan_month',
      'set_fixed_expense_roles',
      'set_plan',
      'edit_fixed_expenses',
      'paychecks',
      'record_paychecks',
      'set_deduction_types',
      'funds',
      'record_fund_readings',
      'create_goals',
      'record_deposits',
      'set_place_accounts',
      'record_holding_readings',
      'set_goal_deposit_categories',
      'set_cushion',
      'pause_goals',
      'settle_set_aside',
      'suggest_goal_amounts',
      'set_goal_amounts',
      'set_opening_balances',
      'create_debts',
      'record_debt_payments',
      'guide_status',
      'update_account',
      'choose_categories',
      'create_category',
      'edit_categories',
      'set_excluded_from_totals',
      'set_transaction_notes',
      'set_transaction_holdings',
      'transfers',
      'answer_transfers',
      'count_card_charges',
      'set_no_pay_months',
      'set_card_payers',
      'skip_merchants',
      'assign_category',
      'note_merchant_suggestions',
      'create_rule',
      'statement_preview',
      'import_statement',
      'record_holdings_statement',
      // The engine (D-217, D-219). The first names here that are about no
      // particular subject: what they can reach is whatever this document
      // declares, and `formats` is what says what that is — while
      // `declare_format` is how a document comes to declare anything at all.
      'formats',
      'declare_format',
      'connect_formats',
      'extend_format',
      'delete_format',
      'format_rows',
      'show_format',
      'format_problems',
      'search_document',
      'start_here',
      'format_rollup',
      'apply_rules',
      'record_format_rows',
      'update_format_rows',
      'delete_format_rows',
      'claim_units',
      'land_units',
      'dispatch_plan',
      'record_units',
      'read_onto_format',
      'supersede_reading',
      'readers',
      'keep_copy',
      'store_document_as',
      'arrange_views',
      'create_document',
      'keep_packs',
      // The frame's own call (M44 U4), listed to every client since M41 F2
      // (D-446) and refused to anyone without the key the page carries (D-447).
      'frame_copy',
    ])
    await client.close()
  })

  it('tells the client what the whole surface is for, once', async () => {
    // MCP's `initialize` carries `instructions` and Claude Code renders them
    // (D-110). Before this, twenty-one tools each said what they did and
    // nothing said what the helper was *for*, so a conversation waited to be
    // told rather than asking for the payslip in the user's downloads folder.
    const client = await connected()
    const instructions = client.getInstructions() ?? ''

    expect(instructions).toContain('Emerald')
    // The two working practices that cost real money when they are missing.
    expect(instructions).toMatch(/batch/i)
    expect(instructions).toMatch(/dry-run|dry run/i)
    // And the one that costs something worse. Merchant names and provider
    // labels travel from a file the user imported into a model's context, and
    // until D-120 nothing anywhere said they are not to be obeyed (D-114).
    // Asserted as a capability rather than as wording: the words may be
    // rewritten, the claim may not disappear.
    expect(instructions).toMatch(/data, not instruction/i)
    await client.close()
  })

  it('names only tools it actually has, and only claims to lack ones it lacks', async () => {
    // The rule the stale onboarding step earned (D-109): a test over prose
    // asserts the **capability**, not the wording. Every tool the instructions
    // name must exist, and every screen they call app-only must have no tool —
    // so this goes red on the day one of those is built and the prose is not
    // updated with it, which is exactly when it should.
    const client = await connected()
    const instructions = client.getInstructions() ?? ''
    const { tools } = await client.listTools()
    const names = new Set(tools.map((tool) => tool.name))

    const named = [...instructions.matchAll(/`([a-z_]+)`/g)]
      .map((match) => match[1] ?? '')
      // Only backticked words that look like tool names, which is why the
      // vocabulary lines use `YYYY-MM-DD` and `merchantNormalized` instead.
      .filter((word) => word.includes('_') && !word.includes('-'))
    expect(named.length).toBeGreaterThan(5)
    for (const name of named) expect(names).toContain(name)

    // What the "Not here" section claims. Each one is a milestone away, and
    // the day it lands this assertion is the reminder — which is exactly what
    // happened to `paycheck` and `fund` (D-112), and to `saving_goal` and
    // `debt_payment` (D-113): each came off this list in the same diff as the
    // prose that stopped calling it app-only.
    // `review` is deliberately not a sentinel here: `statement_preview` contains
    // it. These four are the screens the prose still calls app-only.
    for (const absent of ['split', 'promote', 'confirm', 'resolve']) {
      expect([...names].filter((name) => name.includes(absent))).toEqual([])
    }

    // And what it claims about every write over the **ledger**: each one adds,
    // and none of them changes or removes anything. The prose says so; this is
    // what makes it stay true.
    //
    // It used to cover the whole surface, and D-217 narrowed it rather than
    // deleted it, because a declared format's rows had no screen at all.
    // **M20 U1 gave them one and these two stayed** (D-229): from M20 the rule
    // is that anything a person can do on a screen a conversation can do too,
    // so an edit having a screen is no longer an argument against its tool.
    // What this assertion now holds still is the *shape* of the surface rather
    // than a principle about it — a sixth name matching would be a tool nobody
    // decided on. Which tools the rule still *wants* is `src/parity.test.ts`,
    // the audit that derives them from the writes both halves share (D-234).
    const removes = [...names].filter((name) => /delete|remove|acknowledge/.test(name))
    // M24 U3 (D-254) added the third: a whole format, refused while anything
    // refers to it.
    expect(removes).toEqual(['delete_format', 'delete_format_rows'])
    expect([...names].filter((name) => name.startsWith('update_'))).toEqual([
      'update_account',
      'update_format_rows',
    ])
    await client.close()
  })

  it('names reads as nouns and writes as verbs, and marks them accordingly', async () => {
    // The naming rule writes brought with them (D-096): a transcript should say
    // what happened without anybody consulting a schema. Asserted rather than
    // trusted, because it is the kind of convention that decays one tool at a
    // time — and because `readOnlyHint` is what a client shows the user before
    // they approve a call.
    const READS = [
      'document_info',
      'category_tree',
      'uncategorized_merchants',
      'transactions',
      'transfers',
      'month_summary',
      'year_summary',
      'fixed_expenses',
      'debts',
      'savings',
      'goal_projection',
      'debt_projection',
      'fixed_expense_candidates',
      'plans',
      'paychecks',
      'funds',
      'guide_status',
      'statement_preview',
      'formats',
      'format_rows',
      'show_format',
      'format_problems',
      'search_document',
      'start_here',
      'format_rollup',
      'frame_copy',
      'dispatch_plan',
    ]

    // `edit_categories` is the third kind: a merge moves every row and rule of a
    // category and removes it, and a delete removes one, so a hint saying
    // otherwise would be this surface lying to the client (M28 U6, D-315).
    // So are `set_plan` (it deletes a plan) and `edit_fixed_expenses` (it stops
    // tracking one, and what every plan said about it), for the same reason (D-319).
    const DESTRUCTIVE = [
      'delete_format',
      'delete_format_rows',
      'supersede_reading',
      'edit_categories',
      'set_plan',
      'edit_fixed_expenses',
      // Removes a deduction type (M36 F2).
      'set_deduction_types',
      // Each can take away what a person kept (M42 U1): a column, a claim or a
      // rule from a format; a saved reader; the rows a file read again no
      // longer has, with `remove_gone`.
      'extend_format',
      'readers',
      'read_onto_format',
    ]

    const client = await connected()
    const { tools } = await client.listTools()

    for (const tool of tools) {
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(READS.includes(tool.name))
      expect(tool.description ?? '', tool.name).not.toBe('')
      // A write is marked destructive exactly when it can take something away,
      // and the list above says which (`annotations.test.ts` says what the hint
      // means). `supersede_reading` deletes rows, and a hint saying otherwise
      // would be this surface lying to the client that shows it to a person
      // before they approve.
      // `create_document` refuses an existing path rather than overwriting it,
      // which is what keeps it on the harmless side of this.
      expect(tool.annotations?.destructiveHint, tool.name).toBe(
        DESTRUCTIVE.includes(tool.name),
      )
    }
    await client.close()
  })

  it('takes a path on every tool but the one that makes the file', async () => {
    // `create_document` is the only tool whose path need not exist yet, and so
    // the only one that can ask for it instead of being given it.
    const client = await connected()
    const { tools } = await client.listTools()

    for (const tool of tools) {
      const required = tool.inputSchema.required ?? []
      if (tool.name === 'create_document') expect(required).toEqual([])
      else expect(required, tool.name).toContain('path')
    }
    await client.close()
  })

  it('requires only what each schema defines, at every depth (M28 F23)', async () => {
    // `record_deposits` required `holding_place` beside `additionalProperties:
    // false` and a `holding` it read, so no call could satisfy its own schema —
    // and every test passed, because the tests call `run` and never the schema.
    // This reads the schema as a client is handed it.
    const client = await connected()
    const { tools } = await client.listTools()
    const undefinedRequired: string[] = []

    const walk = (schema: unknown, where: string): void => {
      if (typeof schema !== 'object' || schema === null) return
      const node = schema as Record<string, unknown>
      const properties = (node['properties'] ?? {}) as Record<string, unknown>
      const required = Array.isArray(node['required']) ? (node['required'] as unknown[]) : []
      for (const name of required) {
        if (typeof name !== 'string' || !(name in properties)) undefinedRequired.push(`${where} requires ${String(name)}`)
      }
      for (const [name, child] of Object.entries(properties)) walk(child, `${where}.${name}`)
      walk(node['items'], `${where}[]`)
      for (const key of ['anyOf', 'oneOf', 'allOf']) {
        const options = node[key]
        if (Array.isArray(options)) options.forEach((option, index) => walk(option, `${where}<${key}${String(index)}>`))
      }
    }

    expect(tools.length).toBeGreaterThan(50)
    for (const tool of tools) walk(tool.inputSchema, tool.name)
    expect(undefinedRequired).toEqual([])
    await client.close()
  })

  it('answers document_info against a real document', async () => {
    const client = await connected()
    const path = await writeDocument('driven.emd')

    const result = await client.callTool({ name: 'document_info', arguments: { path } })
    const text = textOf(result)

    expect(text).toContain(path)
    expect(text).toContain(`Schema version ${SCHEMA_VERSION}`)
    expect(text).toContain('Transactions: 0')
    expect(result.isError).toBeFalsy()
    await client.close()
  })

  it('treats a missing path as a tool failure, not a crash', async () => {
    const client = await connected()
    const result = await client.callTool({ name: 'document_info', arguments: {} })

    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('path')
    await client.close()
  })

  it('does not report a refused document as a tool error', async () => {
    // "Will you serve this?" was answered. The refusal is the answer, and
    // dressing it as a protocol failure would hide the sentence that tells the
    // user to open the document in the app once.
    const db = await createDatabase(SCHEMA_VERSION - 1)
    const bytes = exportDatabase(db)
    db.close()
    const dir = await tempDir('emerald-plugin-')
    const path = join(dir, 'old.emd')
    await writeFile(path, bytes)

    const client = await connected()
    const result = await client.callTool({ name: 'document_info', arguments: { path } })

    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toContain('REFUSED')
    await client.close()
  })
})

/**
 * **A format's rows, drawn in the conversation** (M41 U1): an MCP App. The
 * tool names a page the server serves, and its result names the document the
 * page fetches (M41 F2) — while its text names every row the view shows, and
 * nothing longer, because that is all any model reads.
 */
describe('show_format, the one tool with a page (M41 U1)', () => {
  it('names the page, and the server serves it as an MCP App', async () => {
    const client = await connected({ engineOnly: true })
    const sheet = (await client.listTools()).tools.find((tool) => tool.name === 'show_format')
    expect(sheet?._meta).toEqual({ ui: { resourceUri: SHEET_URI } })
    expect(sheet?.annotations?.readOnlyHint).toBe(true)

    const { resources } = await client.listResources()
    expect(resources).toEqual([expect.objectContaining({ uri: SHEET_URI, mimeType: APP_MIME })])
    const read = await client.readResource({ uri: SHEET_URI })
    const page = read.contents[0] as { mimeType?: string; text?: string }
    expect(page.mimeType).toBe(APP_MIME)
    expect(page.text?.toLowerCase().startsWith('<!doctype html>')).toBe(true)
    // The key, written into the page as served (M41 F3), and the same on every read.
    expect(page.text).toMatch(new RegExp(`<meta name="${KEY_META}" content="[A-Za-z0-9_-]{43}" />`))
    expect(await pageKeyOf(client)).toBe(await pageKeyOf(client))
    await expect(client.readResource({ uri: 'ui://emerald/other.html' })).rejects.toThrow(SHEET_URI)
    await client.close()
  })

  it('names every row in its text, and the page fetches the file with its key (M41 F2, F3)', async () => {
    const path = await writeDocument('sheet.emd')
    const client = await connected({ engineOnly: true }, true)
    await client.callTool({
      name: 'declare_format',
      arguments: { path, format: 'book', title: 'Book', columns: [{ name: 'title', type: 'text', required: true }], commit: true },
    })
    await client.callTool({
      name: 'record_format_rows',
      arguments: { path, format: 'book', rows: [{ title: 'Dune' }, { title: 'Emma' }], commit: true },
    })

    const rows = await client.callTool({ name: 'format_rows', arguments: { path, format: 'book' } })
    const sheet = await client.callTool({ name: 'show_format', arguments: { path, format: 'book' } })
    expect(textOf(sheet)).toBe(
      `${drawnLine(TEST_DRAWS)}\n\n` +
        'book as its sheet — 2 rows.\n\n- Dune\n- Emma\n\nEvery column of these rows is one call away: `format_rows book`.',
    )
    // **Which document — never the file, and never the proof** (M41 F3).
    const carried = (sheet._meta as Record<string, { name: string; format: string; view: string; path: string }>)[SHEET_META]
    expect(carried).toEqual({ name: 'sheet.emd', format: 'book', view: 'sheet', path, uri: pathToFileURL(path).href })
    expect(JSON.stringify(sheet).length).toBeLessThan(1000)
    const key = await pageKeyOf(client)
    expect(JSON.stringify(sheet)).not.toContain(key)
    // The path from the call's input, the key from the page: as the frame asks.
    const fetched = await client.callTool({ name: COPY_TOOL, arguments: { path, key } })
    const copy = copyOf(fetched)
    expect(copy).toMatchObject({ name: 'sheet.emd', uri: pathToFileURL(path).href })
    expect(Buffer.from(copy?.bytes ?? '', 'base64').equals(await readFile(path))).toBe(true)
    expect(fetched._meta).toBeUndefined()
    // And nothing rides on a tool that has no page.
    expect(rows._meta).toBeUndefined()
    await client.close()
  })

  it('refuses a format the document has not got, and carries nothing', async () => {
    const path = await writeDocument('none.emd')
    const client = await connected({ engineOnly: true }, true)
    const answer = await client.callTool({ name: 'show_format', arguments: { path, format: 'nothing' } })
    const rows = await client.callTool({ name: 'format_rows', arguments: { path, format: 'nothing' } })
    expect(textOf(answer)).toBe(textOf(rows))
    expect((answer._meta ?? {})[SHEET_META]).toBeUndefined()
    await client.close()
  })
})

/**
 * **M41 U2**: a view other than the sheet is one the format has, and
 * `start_here` draws its picture. (Which clients were handed the copy, U2's
 * third rule, is M41 F2's now: none of them.)
 */
describe('the frame’s views, and who is handed what (M41 U2)', () => {
  async function book(name: string): Promise<string> {
    const path = await writeDocument(name)
    const client = await connected({ engineOnly: true })
    await client.callTool({
      name: 'declare_format',
      arguments: {
        path,
        format: 'book',
        title: 'Book',
        columns: [
          { name: 'title', type: 'text', required: true },
          { name: 'shelf', type: 'enum', values: ['to read', 'read'] },
        ],
        commit: true,
      },
    })
    await client.close()
    return path
  }

  it('hands every client the same answer, and none of them the file (M41 F2)', async () => {
    const path = await book('text.emd')
    const plain = await connected({ engineOnly: true })
    const drawing = await connected({ engineOnly: true }, true)
    const quiet = await plain.callTool({ name: 'show_format', arguments: { path, format: 'book' } })
    const drawn = await drawing.callTool({ name: 'show_format', arguments: { path, format: 'book' } })
    // A host that draws without advertising MCP Apps — VS Code's chat, once —
    // is handed what one that advertises is: a page with no document was the bug.
    expect(quiet._meta).toEqual(drawn._meta)
    expect((quiet._meta as Record<string, unknown>)[SHEET_META]).toBeDefined()
    expect(JSON.stringify(quiet).length).toBeLessThan(1500)
    // Only the first line differs: what each client said it draws (M51 F1, D-489).
    const [quietLine, ...quietRest] = textOf(quiet).split('\n\n')
    const [drawnFirst, ...drawnRest] = textOf(drawn).split('\n\n')
    expect(quietRest).toEqual(drawnRest)
    expect(quietLine).toBe(drawnLine({ name: 'test', saysItDraws: false }))
    expect(drawnFirst).toBe(drawnLine(TEST_DRAWS))
    await plain.close()
    await drawing.close()
  })

  it('says first whether anything was drawn, and never that it was (M51 F1, D-489)', async () => {
    // 2026-10-18: a session told the person the ready list was "drawn above"
    // when the Code tab had drawn nothing — the server a project's .mcp.json
    // starts is never drawn there, and the claude CLI says nothing of MCP Apps
    // to it. The answer now says so before anything else.
    const path = await book('said.emd')
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const cli = new Client({ name: 'claude-code', version: '2.1.299' }, { capabilities: { elicitation: {} } })
    await Promise.all([createServer({ engineOnly: true }).connect(serverTransport), cli.connect(clientTransport)])
    const shown = textOf(await cli.callTool({ name: 'show_format', arguments: { path, format: 'book' } }))
    const first = shown.split('\n\n')[0] ?? ''
    expect(first).toBe(drawnLine({ name: 'claude-code', saysItDraws: false }))
    expect(first).toContain('This client did not say it draws.')
    expect(first).toContain('call it there instead')
    await cli.close()
    // Where a client did say it draws, the line still claims nothing the server cannot see.
    for (const line of [drawnLine(TEST_DRAWS), drawnLine(undefined), drawnLine({ name: 'x', saysItDraws: false })]) {
      expect(line).not.toMatch(/\b(is|was) drawn above\b/)
    }
  })

  it('words that line for the model, never for the person to be told (M51 F3, D-493)', () => {
    // After F2 the board was drawn in the Code tab, and the session still told
    // the person which server it had called and that it could not check
    // whether a view appeared: the line, worded as a disclaimer, was relayed.
    const draws = drawnLine(TEST_DRAWS)
    const cannot = drawnLine({ name: 'claude-code', saysItDraws: false })
    const unknown = drawnLine(undefined)
    for (const line of [draws, cannot, unknown]) {
      expect(line.startsWith(FOR_THE_MODEL)).toBe(true)
      expect(line).toContain('say nothing to the person about drawing, views, servers or tools')
      // Nothing a model would read out as a disclaimer, and no client or server named.
      expect(line).not.toMatch(/cannot see|can't check|if you see|as far as this server|claude-code|\btest\b|emerald/i)
    }
    // Where the client draws: the view is beside the answer, and the reply adds only what it does not show.
    expect(draws).toContain('the view sits beside your answer')
    expect(draws).toContain('adds what the view does not show, or nothing')
    // And never retypes the view: drawn, the session still gave the details as text
    // (2026-10-18). The rows stay in the answer, framed as the model's to reason over.
    expect(draws).toContain('never retype what it shows — no list or table of these rows')
    expect(draws).toContain('The rows below are for you to reason over, not to repeat.')
    expect(draws).not.toContain('as text')
    // Where it does not: the rows are the answer, as text, with at most one plain sentence about it.
    for (const line of [cannot, unknown]) {
      expect(line).toContain('answer with the rows below as text')
      expect(line).toContain('never call anything drawn or above')
      expect(line).toContain('one plain sentence that it is shown here as a list')
      expect(line).not.toContain('beside your answer')
    }
  })

  it('opens on a view the format has, and refuses one it has not got', async () => {
    const path = await book('views.emd')
    const client = await connected({ engineOnly: true }, true)
    const board = await client.callTool({ name: 'show_format', arguments: { path, format: 'book', view: 'board' } })
    expect((board._meta as Record<string, { view: string }>)[SHEET_META]?.view).toBe('board')
    const roadmap = await client.callTool({ name: 'show_format', arguments: { path, format: 'book', view: 'roadmap' } })
    expect(roadmap.isError).toBe(true)
    expect(textOf(roadmap)).toBe('book has no roadmap. Its views: table, board.')
    await client.close()
  })

  it('draws only the rows `match` and `search` ask for, as format_rows reads them (M44 U6)', async () => {
    const path = await book('filtered.emd')
    const client = await connected({ engineOnly: true }, true)
    await client.callTool({
      name: 'record_format_rows',
      arguments: {
        path,
        format: 'book',
        rows: [
          { title: 'Dune', shelf: 'read' },
          { title: 'Emma', shelf: 'to read' },
          { title: 'Dracula', shelf: 'to read' },
        ],
        commit: true,
      },
    })
    const sheet = await client.callTool({ name: 'show_format', arguments: { path, format: 'book', match: { shelf: 'TO READ' } } })
    expect(textOf(sheet)).toBe(
      `${drawnLine(TEST_DRAWS)}\n\n` +
        'book as its sheet — 2 rows, each with its shelf.\n\nFiltered by shelf = TO READ: 2 of 3 rows.\n\n' +
        '- Dracula · to read\n- Emma · to read\n\n' +
        'Every column of these rows is one call away: `format_rows book match:{shelf:TO READ}`.',
    )
    // The frame is handed the filter, to open the format's address on.
    const carried = (sheet._meta as Record<string, { match?: unknown; search?: unknown }>)[SHEET_META]
    expect(carried?.match).toEqual({ shelf: 'TO READ' })
    expect(carried?.search).toBeUndefined()

    // The same rows format_rows returns, on the board and with a search.
    const board = await client.callTool({
      name: 'show_format',
      arguments: { path, format: 'book', view: 'board', match: { shelf: 'to read' }, search: 'dra' },
    })
    expect(textOf(board)).toContain('book as its board — 1 row in lanes by shelf.')
    expect(textOf(board)).toContain('Filtered by shelf = to read, search “dra”: 1 of 3 rows.')
    expect(textOf(board)).toContain('- to read (1): Dracula')
    const rows = await client.callTool({ name: 'format_rows', arguments: { path, format: 'book', match: { shelf: 'to read' }, search: 'dra' } })
    expect(textOf(rows)).toMatch(/^1 row of Book/)
    expect((board._meta as Record<string, { search?: unknown }>)[SHEET_META]?.search).toBe('dra')

    const none = await client.callTool({ name: 'show_format', arguments: { path, format: 'book', search: 'zzz' } })
    expect(textOf(none)).toContain('Filtered by search “zzz”: 0 of 3 rows.\n\nNo rows match.')

    // A filter format_rows refuses, show_format refuses in the same words.
    const wrong = await client.callTool({ name: 'show_format', arguments: { path, format: 'book', match: { author: 'x' } } })
    const wrongRows = await client.callTool({ name: 'format_rows', arguments: { path, format: 'book', match: { author: 'x' } } })
    expect(wrong.isError).toBe(true)
    expect(textOf(wrong)).toBe(textOf(wrongRows))
    await client.close()
  })

  it('filters a roadmap and a ready list to the rows asked for (M44 U6)', async () => {
    const client = await connected({ engineOnly: true }, true)
    const dir = await tempDir('emerald-filtered-')
    const path = join(dir, 'project.emd')
    await client.callTool({ name: 'create_document', arguments: { path, packs: ['development'] } })
    await client.callTool({
      name: 'record_format_rows',
      arguments: {
        path,
        format: 'milestone',
        rows: [
          { ref: 'M1', title: 'First', goal: 'One', state: 'closed', position: 1 },
          { ref: 'M2', title: 'Second', goal: 'Two', state: 'open', position: 2 },
        ],
        commit: true,
      },
    })
    await client.callTool({
      name: 'record_format_rows',
      arguments: {
        path,
        format: 'unit',
        rows: [
          { ref: 'M2 U1', milestone: 'M2', scope: 'engine', title: 'One', state: 'planned' },
          { ref: 'M2 U2', milestone: 'M2', scope: 'ledger', title: 'Two', state: 'planned' },
          { ref: 'M1 U1', milestone: 'M1', scope: 'engine', title: 'Old', state: 'built' },
        ],
        commit: true,
      },
    })
    const roadmap = await client.callTool({
      name: 'show_format',
      arguments: { path, format: 'milestone', view: 'roadmap', match: { state: 'open' } },
    })
    expect(textOf(roadmap)).toContain('- M2 · open · unit: 2 planned')
    expect(textOf(roadmap)).not.toContain('- M1 ')
    expect(textOf(roadmap)).toContain('Filtered by state = open: 1 of 2 rows.')

    const ready = await client.callTool({
      name: 'show_format',
      arguments: { path, format: 'unit', view: 'ready', match: { scope: 'engine' } },
    })
    expect(textOf(ready)).toContain('unit as its ready-to-start list — 1 ready, 0 held.')
    expect(textOf(ready)).toContain('Ready to start: M2 U1.')
    // A link matched by its target's name, as format_rows matches it.
    const under = await client.callTool({ name: 'show_format', arguments: { path, format: 'unit', match: { milestone: 'M2' } } })
    expect(textOf(under)).toContain('Filtered by milestone = M2: 2 of 3 rows.')
    expect(textOf(under)).toContain('- M2 U1 · planned\n- M2 U2 · planned')

    // **A unit has no roadmap; its milestone's lane is one** (M47 U7): drawn as
    // the milestone roadmap at M2, the units named under it.
    const lane = await client.callTool({
      name: 'show_format',
      arguments: { path, format: 'unit', view: 'roadmap', match: { milestone: 'M2' } },
    })
    expect(lane.isError).toBeFalsy()
    expect(textOf(lane)).toContain("unit has no roadmap of its own: its rows fold under milestone's")
    expect(textOf(lane)).toContain('- M2 · open · unit: 2 planned\n  - M2 U1 · planned\n  - M2 U2 · planned')
    expect(textOf(lane)).not.toContain('M1 U1')
    expect((lane._meta as Record<string, unknown>)[SHEET_META]).toMatchObject({ format: 'milestone', view: 'roadmap', match: { ref: 'M2' } })
    // Any other filter has no lane to be: refused, with the call that draws one.
    const scoped = await client.callTool({
      name: 'show_format',
      arguments: { path, format: 'unit', view: 'roadmap', match: { scope: 'engine' } },
    })
    expect(scoped.isError).toBe(true)
    expect(textOf(scoped)).toContain('`show_format milestone view:roadmap match:{ref:…}`')

    // **Which columns a unit's line draws, and which units fold** (M37 U5):
    // the address's `columns:unit` and `unit.state`, as a conversation asks them.
    const chosen = await client.callTool({
      name: 'show_format',
      arguments: {
        path,
        format: 'milestone',
        view: 'roadmap',
        match: { 'unit.state': 'built' },
        columns: { unit: ['title', 'state'] },
      },
    })
    expect(chosen.isError).toBeFalsy()
    expect(textOf(chosen)).toContain('Each unit line draws its name and title, state.')
    expect(textOf(chosen)).toContain('The rows folded under each are filtered by unit.state = built.')
    expect(textOf(chosen)).toContain('- M1 · closed · unit: 1 built')
    expect(textOf(chosen)).toContain('- M2 · open · unit: 0 of 2 shown')
    expect(textOf(chosen)).not.toContain('2 planned')
    expect((chosen._meta as Record<string, unknown>)[SHEET_META]).toMatchObject({
      view: 'roadmap',
      match: { 'unit.state': 'built' },
      columns: { unit: ['title', 'state'] },
    })
    const wrongColumn = await client.callTool({
      name: 'show_format',
      arguments: { path, format: 'milestone', view: 'roadmap', columns: { unit: ['colour'] } },
    })
    expect(wrongColumn.isError).toBe(true)
    expect(textOf(wrongColumn)).toContain('`columns.unit` names colour, which unit has not got.')
    await client.close()
  })

  it('stores a document as text and back, and refuses a ledger as text (M47 U7)', async () => {
    const client = await connected({ engineOnly: true })
    const dir = await tempDir('emerald-store-')
    const path = join(dir, 'project.emd')
    await client.callTool({ name: 'create_document', arguments: { path, packs: ['development'] } })
    await client.callTool({
      name: 'record_format_rows',
      arguments: { path, format: 'milestone', rows: [{ ref: 'M1', title: 'First', goal: 'One', state: 'open', position: 1 }], commit: true },
    })
    const sqlite = await readFile(path)

    const dry = await client.callTool({ name: 'store_document_as', arguments: { path, as: 'text' } })
    expect(textOf(dry)).toContain('is stored as SQLite bytes; it would be written as text')
    expect(textOf(dry)).toContain('**Nothing has been written.**')
    expect(await readFile(path)).toEqual(sqlite)

    const done = await client.callTool({ name: 'store_document_as', arguments: { path, as: 'text', commit: true } })
    expect(textOf(done)).toContain('is stored as text now')
    expect((await readFile(path, 'utf8')).includes('### M1')).toBe(true)
    // Every write after it keeps the shape it was given.
    await client.callTool({
      name: 'update_format_rows',
      arguments: { path, format: 'milestone', edits: [{ where: { ref: 'M1' }, values: { state: 'closed' } }], commit: true },
    })
    expect(await readFile(path, 'utf8')).toContain('state: closed')
    const again = await client.callTool({ name: 'store_document_as', arguments: { path, as: 'text', commit: true } })
    expect(textOf(again)).toContain('is already stored as text. Nothing to do.')

    const back = await client.callTool({ name: 'store_document_as', arguments: { path, as: 'sqlite', commit: true } })
    expect(textOf(back)).toContain('is stored as SQLite bytes now')
    expect(new TextDecoder().decode((await readFile(path)).subarray(0, 15))).toBe('SQLite format 3')

    const ledger = await writeDocument('ledger.emd')
    const before = await readFile(ledger)
    const refused = await client.callTool({ name: 'store_document_as', arguments: { path: ledger, as: 'text', commit: true } })
    expect(textOf(refused)).toContain('This document cannot be saved as text')
    expect(await readFile(ledger)).toEqual(before)
    await client.close()
  })

  it('draws start_here when the views say a picture, and carries nothing when they do not', async () => {
    const client = await connected({ engineOnly: true }, true)
    const start = (await client.listTools()).tools.find((tool) => tool.name === 'start_here')
    expect(start?._meta).toEqual({ ui: { resourceUri: SHEET_URI } })

    const plain = await writeDocument('plain.emd')
    const nothing = await client.callTool({ name: 'start_here', arguments: { path: plain } })
    expect(nothing._meta).toBeUndefined()

    const dir = await tempDir('emerald-start-')
    const path = join(dir, 'project.emd')
    await client.callTool({ name: 'create_document', arguments: { path, packs: ['development'] } })
    await client.callTool({
      name: 'record_format_rows',
      arguments: { path, format: 'milestone', rows: [{ ref: 'M1', title: 'One', goal: 'Go', state: 'open', position: 1 }], commit: true },
    })
    await client.callTool({
      name: 'record_format_rows',
      arguments: { path, format: 'unit', rows: [{ ref: 'M1 U1', milestone: 'M1', scope: 'engine', title: 'First', state: 'planned' }], commit: true },
    })
    const drawn = await client.callTool({ name: 'start_here', arguments: { path } })
    expect(textOf(drawn)).toContain('M1 U1')
    expect((drawn._meta as Record<string, { view: string; format: string }>)[SHEET_META]).toMatchObject({ view: 'start', format: '' })
    await client.close()
  })

  it('tells a model to draw when a person asks to see, and to read rows with format_rows (M41 U4)', async () => {
    // A page on every read would put a copy of the file beside every answer;
    // a model that reasons over rows wants them as text, with filters. Both
    // modes say so, in the one paragraph the formats half shares.
    for (const engineOnly of [false, true]) {
      const client = await connected({ engineOnly })
      const instructions = client.getInstructions() ?? ''
      await client.close()
      const paragraph = instructions.split('\n\n').find((block) => block.includes('`show_format`')) ?? ''
      expect(paragraph).toContain('`start_here`')
      expect(paragraph).toContain('`format_rows`')
      expect(paragraph).toMatch(/asks to \*see\*/)
      expect(paragraph).toContain('read-only')
    }
  })

  it('says how to show within the first 2,000 characters, where every host keeps it (M43 U11)', async () => {
    // A host may keep only the head of these instructions. The desktop Code
    // tab kept the first 2,038 characters of the engine-only block on
    // 2026-10-09 and cut the rest with "… [truncated]"; the line saying when
    // to draw sat at character 4,324, and a person who asked to see the
    // roadmap got a list typed by hand. So both blocks name both tools that
    // draw, as the way to show, before 2,000.
    for (const engineOnly of [false, true]) {
      const client = await connected({ engineOnly })
      const head = (client.getInstructions() ?? '').slice(0, 2000)
      await client.close()
      expect(head, `engine-only: ${String(engineOnly)}`).toMatch(/asks to \*see\* something/)
      expect(head).toContain('call `show_format` or `start_here`')
      expect(head).toContain('`format_rows` is for rows you will')
      // And that the answer, not the model, knows whether it was drawn (M51 F1,
      // D-489) — and that the person is told nothing of it (M51 F3, D-493).
      expect(head).toContain('first line is for you, never the person')
      expect(head).toMatch(/Never tell the\s+person about drawing, views, servers or tools/)
      expect(head).toMatch(/the view is the answer: never retype its rows/)
      // And that a hook's text drew nothing, so a request to see still calls
      // the tool, on a server the host runs itself where there is one (M51 F2).
      expect(head).toContain('Call it even when a hook already printed the same answer as text')
      expect(head).toMatch(/A host\s+may draw only the servers it runs itself/)
    }
  })
})

describe('the server makes zero network calls', () => {
  it('handshakes, lists and calls a tool without opening a socket', async () => {
    // docs/f14 trap 5, and the same standard F11 sets for the app. Everything
    // Node can use to reach the network funnels through one of these three:
    // `fetch` (undici), an outbound TCP connect (which is what http, https and
    // tls all end up calling), and a DNS lookup. Trapping them and running the
    // whole session through is the only way to assert an absence.
    const fetchSpy = vi.fn(() => {
      throw new Error('the plugin must not use fetch')
    })
    vi.stubGlobal('fetch', fetchSpy)

    const connect = vi.spyOn(Socket.prototype, 'connect').mockImplementation(() => {
      throw new Error('the plugin must not open a socket')
    })

    const dns = await import('node:dns')
    const lookup = vi.spyOn(dns.promises, 'lookup').mockImplementation(() => {
      throw new Error('the plugin must not resolve a hostname')
    })

    const path = await writeDocument('offline.emd')
    const client = await connected()
    await client.listTools()
    const result = await client.callTool({ name: 'document_info', arguments: { path } })
    await client.close()

    expect(textOf(result)).toContain('Ready to serve')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
    expect(lookup).not.toHaveBeenCalled()

    // And the trap is live rather than vacuous. Three assertions that something
    // did not happen are worth nothing unless the thing would have been caught,
    // and a spy on the wrong function is exactly the failure that hides here.
    expect(() => new Socket().connect(9999)).toThrow('must not open a socket')
    expect(connect).toHaveBeenCalledTimes(1)

    vi.unstubAllGlobals()
  })

  describe('started --engine-only (M22 U0)', () => {
    /**
     * **The definitions are the bill, not the calls.** Measured 2026-09-20:
     * `tools/list` is 46 tools and ~23,900 tokens, ~19,250 of them the
     * ledger's 38 — and a client holds that in context on every turn of every
     * session the server is loaded in, whether or not money is what it is
     * doing. This mode is a token measure, not the app's old staging switch,
     * which M25 U8 took away (D-266).
     */
    it('offers the engine and not the ledger', async () => {
      const client = await connected({ engineOnly: true })
      const { tools } = await client.listTools()
      await client.close()

      expect(tools.map((tool) => tool.name)).toEqual([
        'formats',
        'declare_format',
        'connect_formats',
        'extend_format',
        'delete_format',
        'format_rows',
        'show_format',
        'format_problems',
        'search_document',
        'start_here',
        'format_rollup',
        'apply_rules',
        'record_format_rows',
        'update_format_rows',
        'delete_format_rows',
        'claim_units',
        'land_units',
        'dispatch_plan',
        'record_units',
        'read_onto_format',
        'supersede_reading',
        'readers',
        'keep_copy',
        'store_document_as',
        'arrange_views',
        'create_document',
        'keep_packs',
        'frame_copy',
      ])
    })

    it('still answers a ledger tool that a caller names anyway', async () => {
      // **The filter is on what you are offered and nowhere else** (M22 U0):
      // the mode offers less; it never makes a capability vanish, and a mode
      // that broke an old conversation's replay would be a different decision
      // than the one that was made.
      const path = await writeDocument('engine-only.emd')
      const client = await connected({ engineOnly: true })
      const result = await client.callTool({ name: 'document_info', arguments: { path } })
      await client.close()

      expect(textOf(result)).toContain('Ready to serve')
    })

    it('names only tools it actually offers', async () => {
      // The same pin as the full surface's, which is the rule the whole
      // instructions file lives under (D-104, D-109): prose that names a
      // capability is asserted on the capability, never on the wording. It
      // matters more here, because the cheapest way to write this block was
      // to copy the other one — and a copy naming `import_statement` would
      // send a session to a tool this mode does not list.
      const client = await connected({ engineOnly: true })
      const instructions = client.getInstructions() ?? ''
      const { tools } = await client.listTools()
      const names = new Set(tools.map((tool) => tool.name))
      await client.close()

      const named = [...instructions.matchAll(/`([a-z_]+)`/g)]
        .map((match) => match[1] ?? '')
        .filter((word) => word.includes('_') && !word.includes('-'))
      expect(named.length).toBeGreaterThan(5)
      for (const name of named) expect(names).toContain(name)

      // And it says what it is, so a session does not conclude the ledger was
      // never built and offer to rebuild it in a declared format.
      expect(instructions).toContain('engine-only')
    })

    it('is worth the unit: the definitions it drops are most of the weight', async () => {
      // The measurement, kept as an assertion rather than a sentence in a
      // decision entry — the figure is the whole reason this mode exists, and
      // a tool description growing back past the budget is exactly the drift
      // nothing else here would catch. Chars rather than tokens because
      // tokenisation is the client's, and ~3.6 chars per token is the ratio
      // this repo has measured.
      const full = await connected()
      const engine = await connected({ engineOnly: true })
      const fullSize = JSON.stringify((await full.listTools()).tools).length
      const engineSize = JSON.stringify((await engine.listTools()).tools).length
      await Promise.all([full.close(), engine.close()])

      // A third until M28 U1 (D-308) took the five investment tools out of
      // the full set: the full set shrank, and the engine's did not grow.
      expect(engineSize).toBeLessThan(fullSize * 0.4)
      // 30k until M27 U5 (D-303), when `start_here` joined the engine's tools
      // and took it to ~30.4k: a new tool is growth, a description swelling is
      // drift, and the budget is for catching the second. 31.5k since M29 U3
      // (D-333): a fourteenth type is growth too — its words are in the
      // briefing every declaration reads, ~250 chars. 32k since M29 U3b
      // (D-334): `derived` on declare and extend, ~240 chars of new language.
      // 32.5k since M29 U4 (D-335): a fifteenth type, `time`, and spans in
      // `derived`'s words, ~150 chars. 33k since M29 F8 (D-350): `found_by` on
      // `connect_formats`, a new parameter, ~170 chars. 34k since M34 U1 (D-394):
      // what a stranger is told — that a list answers nothing_must_hold and still
      // gets every refusal, what an enum value and a list of links are written
      // as, where start_here sends work that is not money — ~550 chars. 34.5k
      // since M34 U2 (D-395): `files` on `read_onto_format` and `formats` on
      // `declare_format`, two new parameters, ~200 chars. 35k since M34 U3
      // (D-396): `format_problems`, a new tool — growth, ~380 chars. 35.5k
      // since M34 U4 (D-397): `aggregates` on `extend_format` and `every` on a
      // total, ~150 chars. 36k since M34 U5 (D-398): a sixteenth type, `enums`,
      // in the briefing, and `separators` on `read_onto_format` — ~350 chars.
      // 37k since M34 U6 (D-399): `keep_copy`, a new tool — growth, ~600 chars.
      // 38.5k since M35 U4 (D-403): `arrange_views`, a new tool with a list of
      // settings over three views — growth, ~1.2k chars, most of it schema.
      // 40.5k since M38 U7 (D-405): `create_document` joins the engine's tools
      // with `packs`, and `keep_packs` is new — growth, ~1.75k chars. 41k
      // since M38 U3 (D-408): `remove_gone` on `read_onto_format`, and a read
      // again in its description — a new parameter, ~250 chars. 41.5k since
      // M38 U4 (D-410): `items` and `under` on `read_onto_format`, two new
      // parameters, ~300 chars with the line that says what they do.
      // 41k again since M38 U5: `nothing_must_hold` left `declare_format`, and the
      // words it took paid for `offset` and a link named by columns. 42k since
      // M41 U1: `show_format`, a new tool with a page — growth, ~900 chars.
      // 42.5k since M41 U2 (D-432): `view` on `show_format`, and `start_here`
      // names the page — a new parameter and a `_meta`, ~200 chars.
      // 44k since M42 U1: every title said again as `annotations.title` and an
      // `idempotentHint` on every write, which a directory's review asks for —
      // ~1.15k chars, and growth rather than drift. 44.5k since M41 F2 (D-446):
      // `frame_copy` is listed to every client, this one too — a tool, ~500 chars.
      // 45k since M44 U6: `match` and `search` on `show_format`, two
      // parameters `format_rows` already had — ~300 chars, and growth.
      // 47.5k since M47 U3: `claim_units` and `land_units`, the development
      // pack's claim and closing pass as a call each — two tools, ~2.3k chars.
      // 48k since M47 U4: `elsewhere`, a seventeenth type, in every list of
      // types a tool's schema carries — ~200 chars, and growth.
      // 49k since M47 U6: `search_document`, a new tool — growth, ~750 chars.
      // 50k since M47 U7: `store_document_as`, a new tool — growth, ~550 chars.
      // 50.5k since M48 U3 (D-469): `setting` on `arrange_views`, so a roadmap,
      // a ready list and a start-here question are set from a conversation — a
      // new parameter, ~300 chars, and growth. 51k since M49 U3 (D-473):
      // `view: agenda` on `show_format`, which then takes no `format`, and an
      // agenda's words in `arrange_views`' `setting` — a new view, ~110 chars.
      // 51.5k since M37 U5 (D-478): `columns` on `show_format`, which columns
      // a format's lines draw, and `unit.state` in a roadmap's `match` — a new
      // parameter, ~190 chars, and growth. 52k since M51 U2 (D-484): `branch`
      // on `claim_units`, `branch`, `commit` and `other_branch` on each of
      // `land_units`' units — four parameters, ~450 chars, and growth.
      // 52.5k since M51 U3 (D-485): `inbox` on `land_units`, a child's landing
      // proposals by id, and the line that says how a child writes one — a
      // parameter, ~550 chars, and growth. 53.5k since M51 U4 (D-486):
      // `dispatch_plan`, a new read-only tool — growth, ~800 chars.
      expect(engineSize).toBeLessThan(53_500)
    })
  })
})

/**
 * **The texts a stranger reads are the onboarding** (M34 U1). A trial run by
 * somebody who had never seen the repo found six places where the surface
 * misled a model; this pins the six so none of them comes back, and pins the
 * sentence that replaced each one.
 */
describe('what the plugin says it does (M34 U1)', () => {
  async function everything(engineOnly: boolean): Promise<{ instructions: string; tools: Map<string, string> }> {
    const client = await connected({ engineOnly })
    const instructions = client.getInstructions() ?? ''
    const { tools } = await client.listTools()
    await client.close()
    return { instructions, tools: new Map(tools.map((tool) => [tool.name, JSON.stringify(tool)])) }
  }

  it('says none of the six things that misled a stranger', async () => {
    for (const engineOnly of [false, true]) {
      const { instructions, tools } = await everything(engineOnly)
      const all = [instructions, ...tools.values()].join('\n')
      for (const misled of [
        'opens the document read-only',
        // A skill in this repository's own .claude/, which nobody else has.
        'declare-a-format',
        'Only an aggregate reads through it',
        'nothing_must_hold: true` on purpose',
        'A column may not fill',
        'Read a spreadsheet (.xlsx',
      ]) {
        expect(all, `${misled} (engine-only: ${String(engineOnly)})`).not.toContain(misled)
      }
    }
  })

  it('says where work that is not money begins, in both modes', async () => {
    for (const engineOnly of [false, true]) {
      const { instructions, tools } = await everything(engineOnly)
      expect(instructions).toContain('## Where to start')
      expect(instructions).toContain('**Not everything here is money.**')
      // The conversation the skill held, said where every model can read it.
      expect(instructions).toContain('Ask what **one row** is')
      expect(instructions).toContain('**whether any of the\nfigures relate**')
      // The decision owed on bulk writes: one yes is one dry run.
      expect(instructions).toContain('**A yes covers the dry run it answered and nothing after it.**')
      expect(tools.get('start_here')).toContain('where work that is not money begins: `formats`, then ')
      expect(JSON.parse(tools.get('read_onto_format') ?? '{}').description).toMatch(
        /^Read any \.csv, \.xlsx \(or \.xls\) or \.json of rows onto a declared format — not only statements/,
      )
    }
  })

  it('sends work that is not money to formats, from a ledger and from an empty document', async () => {
    // A ledger's views answer only the ledger's questions; an empty document
    // answers none. Both used to leave a list of books nowhere to begin.
    const empty = await createDatabase()
    const dir = await tempDir('emerald-start-')
    const bare = join(dir, 'bare.emd')
    await writeFile(bare, exportDatabase(empty))
    empty.close()
    const ledger = await writeDocument('ledger.emd')

    const client = await connected()
    for (const path of [bare, ledger]) {
      const text = textOf(await client.callTool({ name: 'start_here', arguments: { path } }))
      expect(text, path).toContain('Work that is not money begins with `formats`')
      expect(text, path).toContain('`read_onto_format` for any .csv or .xlsx the user already keeps')
    }
    await client.close()
  })

  it('asks whether figures relate before a format answers that nothing adds up', async () => {
    const { tools } = await everything(true)
    const declare = tools.get('declare_format') ?? ''
    expect(declare).toContain('**Ask the user whether any figures relate** before answering')
    expect(declare).toContain('still gets every refusal')
    // And what an enum value and a list of links are written as.
    expect(declare).toContain('Each value is any text — spaces, emoji, any language — listed once.')
    expect(declare).toContain('Written as a list of row names or ids.')
  })
})

/**
 * **M44 U4**: the frame's own tool. Visible to the app and never to the model,
 * and a check costs a stamp — the copy rides only when the file moved. **M41
 * F2**: listed to every client, and refused without the key the page carries
 * (M41 F3), so a model in a host that ignores visibility cannot pull a copy.
 */
describe('frame_copy, the frame’s own call (M44 U4)', () => {
  it('is listed to every client, as visible to the app alone (M41 F2)', async () => {
    const plain = await connected({ engineOnly: true })
    const tool = (await plain.listTools()).tools.find((one) => one.name === COPY_TOOL)
    expect(tool?._meta).toEqual({ ui: { visibility: ['app'] } })
    expect(tool?.annotations?.readOnlyHint).toBe(true)
    await plain.close()
  })

  it('refuses a caller without the page’s key — a model — and hands it nothing (M41 F2, F3)', async () => {
    const path = await writeDocument('guarded.emd')
    const client = await connected({ engineOnly: true })
    await client.callTool({
      name: 'declare_format',
      arguments: { path, format: 'book', title: 'Book', columns: [{ name: 'title', type: 'text', required: true }], commit: true },
    })
    // What a model has: the call it made, and the result it was handed.
    const sheet = await client.callTool({ name: 'show_format', arguments: { path, format: 'book' } })
    const stale = /content="([^"]+)"/.exec(servedPage('<head>'))?.[1] ?? ''
    for (const args of [{ path }, { path, key: 'guessed' }, { path, ticket: 'guessed' }, { path, key: JSON.stringify(sheet._meta) }]) {
      const refused = await client.callTool({ name: COPY_TOOL, arguments: args })
      expect(refused.isError).toBe(true)
      expect(textOf(refused)).toBe(NO_KEY)
      expect(refused._meta).toBeUndefined()
      expect(refused.structuredContent).toBeUndefined()
    }
    // `servedPage` is this process's own: the test's server holds the same key.
    expect(stale).toBe(await pageKeyOf(client))
    await client.close()
  })

  it('hands the stamp the sheet was read under, and a copy only when the file moved', async () => {
    const path = await writeDocument('live.emd')
    const client = await connected({ engineOnly: true }, true)
    await client.callTool({
      name: 'declare_format',
      arguments: { path, format: 'book', title: 'Book', columns: [{ name: 'title', type: 'text', required: true }], commit: true },
    })
    const sheet = await client.callTool({ name: 'show_format', arguments: { path, format: 'book' } })
    const named = (sheet._meta as Record<string, { path?: string; uri?: string }>)[SHEET_META]
    expect(named?.path).toBe(path)
    expect(named?.uri).toBe(pathToFileURL(path).href)
    const key = await pageKeyOf(client)
    const first = await client.callTool({ name: COPY_TOOL, arguments: { path, key } })
    const carried = copyOf(first)
    expect(carried?.stamp).toMatch(/^\d+:\d+:\d+$/)

    const same = await client.callTool({ name: COPY_TOOL, arguments: { path, key, since: carried?.stamp } })
    const quiet = copyOf(same)
    expect(quiet).toEqual({ stamp: carried?.stamp, name: 'live.emd', uri: pathToFileURL(path).href })
    // One small call: the whole answer is a sentence and a stamp.
    expect(JSON.stringify(same).length).toBeLessThan(300)

    await client.callTool({ name: 'record_format_rows', arguments: { path, format: 'book', rows: [{ title: 'Dune' }], commit: true } })
    const moved = await client.callTool({ name: COPY_TOOL, arguments: { path, key, since: carried?.stamp } })
    const copy = copyOf(moved)
    expect(copy?.stamp).not.toBe(carried?.stamp)
    expect(Buffer.from(copy?.bytes ?? '', 'base64').equals(await readFile(path))).toBe(true)

    const missing = `${path}.missing`
    const gone = await client.callTool({ name: COPY_TOOL, arguments: { path: missing, key } })
    expect(gone.isError).toBe(true)
    expect(textOf(gone)).toBe(`No document at ${path}.missing.`)
    await client.close()
  })
})

/**
 * **M41 F2**: VS Code's chat drew a page that said there was nothing to draw,
 * and a 14.9 KB text the host saved to a file rather than read. The server
 * now says what each client advertised, and the text beside a drawn view
 * names every row it shows and nothing longer.
 */
describe('what a host advertised, and a short answer beside the view (M41 F2)', () => {
  it('logs each client’s name, version and MCP Apps entry when it has initialized', async () => {
    const lines: string[] = []
    const plain = await connected({ engineOnly: true, log: (line) => lines.push(line) })
    const drawing = await connected({ engineOnly: true, log: (line) => lines.push(line) }, true)
    await vi.waitFor(() => expect(lines).toHaveLength(2))
    expect(lines[0]).toBe(`emerald: client test 0; ${UI_EXTENSION} not advertised; capabilities {}`)
    expect(lines[1]).toContain(`${UI_EXTENSION} {"mimeTypes":["${APP_MIME}"]} (draws this server’s pages)`)
    expect(clientLine({ name: 'Visual Studio Code', version: '1.105' }, { extensions: { [UI_EXTENSION]: { mimeTypes: ['text/html+mcp'] } } })).toContain(
      `(no ${APP_MIME})`,
    )
    await plain.close()
    await drawing.close()
  })

  it('names every milestone on the roadmap with its state and its units counted — no cut at 25', async () => {
    const client = await connected({ engineOnly: true })
    const dir = await tempDir('emerald-roadmap-')
    const path = join(dir, 'project.emd')
    await client.callTool({ name: 'create_document', arguments: { path, packs: ['development'] } })
    const milestones = Array.from({ length: 30 }, (_, i) => ({
      ref: `M${String(i + 1)}`,
      title: `A milestone whose title is long enough to matter in a text answer, number ${String(i + 1)}`,
      goal: 'A goal that is also long, and that the roadmap text leaves out because the view shows it to the person.',
      state: i < 28 ? 'closed' : 'open',
      position: i + 1,
    }))
    await client.callTool({ name: 'record_format_rows', arguments: { path, format: 'milestone', rows: milestones, commit: true } })
    await client.callTool({
      name: 'record_format_rows',
      arguments: {
        path,
        format: 'unit',
        rows: [
          { ref: 'M30 U1', milestone: 'M30', scope: 'engine', title: 'One', state: 'built' },
          { ref: 'M30 U2', milestone: 'M30', scope: 'engine', title: 'Two', state: 'planned' },
        ],
        commit: true,
      },
    })
    const answer = await client.callTool({ name: 'show_format', arguments: { path, format: 'milestone', view: 'roadmap' } })
    const text = textOf(answer)
    for (const each of milestones) expect(text).toContain(`- ${each.ref} · ${each.state}`)
    expect(text).toContain('- M30 · open · unit: 1 built, 1 planned')
    expect(text).not.toContain('long enough to matter')
    expect(text).toContain('`format_rows milestone order:position`')
    expect(text.length).toBeLessThan(1200)
    await client.close()
  })
})
