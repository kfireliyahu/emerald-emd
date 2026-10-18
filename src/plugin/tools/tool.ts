/**
 * What a tool is, and how its arguments are read.
 *
 * The server uses the SDK's low-level `Server`, so a tool's JSON Schema is
 * documentation for the caller rather than something the runtime enforces
 * (D-093). Arguments are therefore read here, by hand, with one rule: a wrong
 * argument comes back as a sentence naming the argument, never as a stack
 * trace and never as a silently-ignored field. An LLM that passed
 * `month: "August"` should be told what shape `month` takes, because it will
 * get it right on the next call.
 */

import type { Tool } from '@modelcontextprotocol/sdk/types.js'

import { fromMajorUnits, type Money } from '@/core/money.ts'
import { parseISODate, parseYearMonth, type LocalDate, type YearMonth } from '@/core/time.ts'

export interface PluginTool {
  readonly definition: Tool
  run(args: Args, context: ToolContext): Promise<string>
  /**
   * The answer with what travels beside the text, for the one tool that has
   * any (M41 U1): `_meta` on the result, which a client hands to an MCP App's
   * frame and keeps out of the model's context. When present the server calls
   * this instead of `run`, and `run` stays the text alone.
   */
  answer?(args: Args, context: ToolContext): Promise<ToolAnswer>
}

/** A tool's text, the `_meta` its result carries, and its `structuredContent` when it has one. */
export interface ToolAnswer {
  readonly text: string
  readonly meta: Record<string, unknown>
  /** Only `frame_copy`'s (M41 F3): a host may drop `_meta` on the way to a view. */
  readonly structured?: Record<string, unknown>
}

export type Args = Record<string, unknown>

/** A bad argument. Caught by the server and returned as a tool failure. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolInputError'
  }
}

export function requireString(args: Args, name: string): string {
  const value = args[name]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolInputError(`\`${name}\` is required and must be a non-empty string.`)
  }
  return value
}

export function optionalString(args: Args, name: string): string | undefined {
  const value = args[name]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new ToolInputError(`\`${name}\` must be a string.`)
  return value.trim() === '' ? undefined : value
}

export function optionalBoolean(args: Args, name: string): boolean | undefined {
  const value = args[name]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'boolean') throw new ToolInputError(`\`${name}\` must be true or false.`)
  return value
}

export function optionalNumber(args: Args, name: string): number | undefined {
  const value = args[name]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ToolInputError(`\`${name}\` must be a number.`)
  }
  return value
}

/**
 * A row limit, clamped rather than rejected.
 *
 * Asking for more than the maximum is a reasonable thing for a caller to try,
 * and refusing the whole call over it would waste a turn to teach a lesson the
 * `capNote` in the answer teaches anyway.
 */
export function limitArg(args: Args, fallback: number, max: number): number {
  const value = optionalNumber(args, 'limit')
  if (value === undefined) return fallback
  if (value < 1) throw new ToolInputError('`limit` must be at least 1.')
  return Math.min(Math.floor(value), max)
}

export function optionalDate(args: Args, name: string): LocalDate | undefined {
  const text = optionalString(args, name)
  if (text === undefined) return undefined
  const parsed = parseISODate(text)
  if (parsed === undefined) {
    throw new ToolInputError(`\`${name}\` must be a date as YYYY-MM-DD; got "${text}".`)
  }
  return parsed
}

export function optionalPeriod(args: Args, name: string): YearMonth | undefined {
  const text = optionalString(args, name)
  if (text === undefined) return undefined
  const parsed = parseYearMonth(text)
  if (parsed === undefined) {
    throw new ToolInputError(`\`${name}\` must be a month as YYYY-MM; got "${text}".`)
  }
  return parsed
}

/**
 * An amount bound, in major units.
 *
 * `fromMajorUnits` is documented as the float boundary — call it once, at the
 * edge, on a value that came from outside. A number that arrived in a tool call
 * is exactly that edge, and this is the only place in the plugin where one
 * becomes `Money`.
 */
export function optionalMoney(args: Args, name: string, currency: string): Money | undefined {
  const value = optionalNumber(args, name)
  return value === undefined ? undefined : fromMajorUnits(value, currency)
}

/** A JSON Schema `string` property, since every tool writes several. */
export function stringProp(description: string): Record<string, unknown> {
  return { type: 'string', description }
}

export function numberProp(description: string): Record<string, unknown> {
  return { type: 'number', description }
}

export function booleanProp(description: string): Record<string, unknown> {
  return { type: 'boolean', description }
}

/**
 * The `path` argument, which every tool takes and none of them may omit.
 *
 * The plugin holds no document open between calls (see `documentInfo.ts` on why
 * the first tool is not called `open_document`), so the path is not context to
 * be remembered — it is part of every question.
 */
export const PATH_PROP = stringProp('Absolute path to a .emd file on this machine.')

// --- what the client can do for us -----------------------------------------

/**
 * A form the server asks the client to put in front of the user.
 *
 * MCP calls this elicitation, and **Claude Code supports it** — it advertises
 * `elicitation: { form: {} }` (D-096, verified against the running client). The
 * schema is a flat object of primitives, which does include single- and
 * multi-select enums, so "tick the institutions you use" is expressible and not
 * merely "type a name".
 */
export interface ElicitForm {
  readonly message: string
  readonly requestedSchema: {
    readonly type: 'object'
    readonly properties: Record<string, unknown>
    readonly required?: readonly string[]
  }
}

export type ElicitOutcome =
  | { readonly action: 'accept'; readonly content: Record<string, unknown> }
  | { readonly action: 'decline' | 'cancel' }

/**
 * What a tool is given besides its arguments.
 *
 * `elicit` is **absent** when the connected client did not declare the
 * capability, which is the whole shape of the "optional UI" rule: a tool asks
 * whether it can show a form by checking whether the function exists, and every
 * tool has to work when it does not. A client that declares it can still answer
 * `decline` or `cancel` — and a headless run does, every time — so both are
 * ordinary outcomes rather than errors, and the fallback is to ask in prose.
 *
 * The rule this enforces: **elicitation may only ever save the user typing.**
 * No tool may require it, and no tool may reach a state it cannot reach from
 * ordinary arguments.
 */
export interface ToolContext {
  readonly elicit?: (form: ElicitForm) => Promise<ElicitOutcome>
  /**
   * The server was started `--engine-only` (M22 U0). A server argument, never
   * document state (D-217); `create_document` reads it for which packs a new
   * document starts with when it is not told (M38 U7, D-405).
   */
  readonly engineOnly?: boolean
  /**
   * The client that connected, as it said at `initialize` (M51 F1, D-489): its
   * name, and whether it advertised `io.modelcontextprotocol/ui` for this
   * server's pages. Absent with no client behind the call. `drawnLine` turns it
   * into the sentence a drawing tool's answer opens with.
   */
  readonly client?: { readonly name: string; readonly saysItDraws: boolean }
}

/** A tool run with no client behind it — every unit test, and any client without forms. */
export const NO_CLIENT: ToolContext = {}
