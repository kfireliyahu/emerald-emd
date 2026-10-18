/**
 * **A matching rule** (M25 E4, D-267, D-273).
 *
 * *`category_rule` sets `transaction.category` when `merchant_normalized`
 * matches `pattern`.* A format declared a rule set over another: each of its
 * rows is a rule, and the engine sets a link of the other format's rows from
 * the rule that matches them. The ledger's categories are the first, and every
 * pack that sorts things by what they are called would otherwise write the
 * same matcher again.
 *
 * ## One sentence, and nothing it could grow into
 *
 * `transaction.category from target when merchant_normalized matches pattern
 * by kind (EXACT_MERCHANT equals, CONTAINS contains, REGEX regex) first by
 * origin then priority where is_enabled is true, recorded in category_source
 * as RULE, never over MANUAL, noting matched_rule`
 *
 * - **what it sets** — a link of another format, `transaction.category`, from
 *   a link of the rule's own row, `target`, both pointing at one format;
 * - **what it reads** — one or more text columns of the target, `or`-ed;
 * - **the pattern** — a text column of the rule's row. A pattern is a value in
 *   a row and never an expression (D-137): it reads one text and says yes or
 *   no, and cannot name a column or write anything;
 * - **the match kind** — from a closed list, `equals`, `contains`, `starts
 *   with` and `regex`: fixed for every rule (`as contains`), or read from an
 *   enum of the rule's row with its members named against the list. A member
 *   left out is not this rule set's, and a row of it is left to whoever else
 *   reads it — the ledger's amount and account rules stay pack code;
 * - **the order** — `first by` one or more required columns of the rule's row,
 *   ascending: a number, a day, a month, a moment, or an enum by the order its
 *   members were declared in;
 * - **filters** on the rule's own row, D-260's, `and`-ed — and `is empty`, so a
 *   rule carrying a condition the sentence cannot say is left to pack code;
 * - **where its value came from** — an enum of the target the engine writes
 *   the rule's member into, and the member that says a person set it. **A rule
 *   never overwrites a person's value** (the conventions' *user overrides
 *   win*): a row is the rules' only while its source is empty or the rules'
 *   own, or while it holds no value that a person put there;
 * - and optionally a link of the target that records **which rule** set it.
 *
 * ## Two rules that disagree are not a choice the engine makes
 *
 * The rules that match, in the declared order; the first rank wins. When the
 * rules tied at the top name **different** rows, the row is left as it is and
 * the tie is said, naming the rules — D-272's refusal to guess, for the same
 * reason: a default tie-break is an opinion nobody declared. Tied rules naming
 * the same row agree, and the one noted is the first by its id.
 *
 * ## Matching is folded, and a regex is bounded
 *
 * Every kind compares text the way a person typed it rather than the way a
 * statement printed it: spaces collapsed, invisible marks dropped, and case
 * folded — a pattern `paypal` is a rule that fires on `PAYPAL`. A regex is
 * compiled case-insensitively and is at most `MAX_PATTERN_LENGTH` characters;
 * one that does not compile is refused at the write of its rule rather than
 * matching nothing forever.
 *
 * Plain functions over plain values: the repository reads the rules and writes
 * what they decide.
 */

import { cleanText, foldText } from '@/core/text.ts'
import { err, ok, type Result } from '@/core/result.ts'

import { EMPTY, filterDecides, filterText, parseFilter, splitFilters, type AggregateFilter } from './aggregate.ts'
import { CLOCK_REASON } from './clock.ts'
import type { ColumnDeclaration } from './declaration.ts'
import type { StoredValue } from './row.ts'

/** The closed list (D-273). */
export const MATCH_KINDS = ['EQUALS', 'CONTAINS', 'STARTS_WITH', 'REGEX'] as const
export type MatchKind = (typeof MATCH_KINDS)[number]

/** Beyond this a pattern is not a rule, it is a paste accident. */
export const MAX_PATTERN_LENGTH = 200

/** Where a rule's match kind comes from: one for every rule, or an enum of its row. */
export type RuleKindSource =
  | { readonly fixed: MatchKind }
  | {
      /** An enum of the rule's own row — `kind`. */
      readonly column: string
      /** Its members this rule set reads, each against a kind on the list. */
      readonly members: readonly (readonly [member: string, kind: MatchKind])[]
    }

/** One declared rule set, on the format whose rows are the rules. */
export interface RuleSetDeclaration {
  /** `snake_case`, unique among the format's columns, aggregates, rollups and rule sets. */
  readonly name: string
  /** The format whose rows it sets — `transaction`. Never the rule format itself. */
  readonly target: string
  /** A link of the target — `category`. */
  readonly sets: string
  /** A link of the rule's row pointing at the same format — `target`. */
  readonly from: string
  /** Text columns of the target, any of which may match — `merchant_normalized`. */
  readonly reads: readonly string[]
  /** A text column of the rule's row — `pattern`. */
  readonly pattern: string
  readonly kind: RuleKindSource
  /** Columns of the rule's row, ascending, the first deciding. At least one. */
  readonly order: readonly string[]
  /** Only the rules every one of these takes (D-260's filter, the rule's own row). */
  readonly where: readonly AggregateFilter[]
  /** An enum of the target the engine writes — `category_source`. */
  readonly source: string
  /** Its member meaning *a rule set this* — `RULE`. */
  readonly ruleMember: string
  /** Its member meaning *a person set this* — `MANUAL`. */
  readonly personMember: string
  /** A link of the target, pointing at the rule format, naming the rule that won. */
  readonly noting?: string | undefined
  /** Why it is worth declaring, in the person's words. Prose, never parsed. */
  readonly note: string
}

/* ------------------------------------------------------------ the sentence */

const KIND_WORDS: Readonly<Record<MatchKind, string>> = {
  EQUALS: 'equals',
  CONTAINS: 'contains',
  STARTS_WITH: 'starts with',
  REGEX: 'regex',
}

function kindOfWord(text: string): MatchKind | undefined {
  return MATCH_KINDS.find((each) => KIND_WORDS[each] === text)
}

const KIND_PATTERN = 'equals|contains|starts with|regex'

const MAIN = new RegExp(
  '^(\\w+)\\.(\\w+) from (\\w+) when (\\w+(?: or \\w+)*) matches (\\w+) ' +
    `(?:as (${KIND_PATTERN})|by (\\w+) \\(([^)]*)\\)) ` +
    'first by (\\w+(?: then \\w+)*)(?: where (.+))?$',
)
const RECORDED = /^recorded in (\w+) as (\w+)$/
const NEVER_OVER = /^never over (\w+)$/
const NOTING = /^noting (\w+)$/
const MEMBER = new RegExp(`^(\\w+) (${KIND_PATTERN})$`)

const EXAMPLE =
  '`transaction.category from target when merchant matches pattern as contains first by priority, recorded in category_source as RULE, never over MANUAL`'

/** Split on `, ` outside the parentheses a kind's members are listed in. */
function clauses(sentence: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let quoted = false
  for (let at = 0; at < sentence.length; at += 1) {
    const char = sentence[at]
    // A quoted member of a filter may hold a comma (M48 U1).
    if (char === '"') quoted = !quoted
    if (quoted) continue
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
    else if (char === ',' && depth === 0 && sentence[at + 1] === ' ') {
      parts.push(sentence.slice(start, at))
      start = at + 2
    }
  }
  parts.push(sentence.slice(start))
  // `where kind is one of A, B` keeps its list (M48 U1): a part that is no
  // clause of a rule set's, after a `where`, is the rest of that filter.
  return parts.reduce<string[]>((kept, part) => {
    const last = kept.length - 1
    const previous = kept[last]
    if (previous !== undefined && previous.includes(' where ') && !TAIL_CLAUSE.test(part)) kept[last] = `${previous}, ${part}`
    else kept.push(part)
    return kept
  }, [])
}

const TAIL_CLAUSE = /^(recorded in|never over|noting) /

/**
 * The one spelling a rule set has, in the artefact's cell, the stored row and
 * a tool's `sets` alike. Only the shape is read here; whether the columns
 * exist and are the right types is `ruleSetRejection`'s in `declaration.ts`.
 */
export function parseRuleSet(name: string, text: string, note = ''): Result<RuleSetDeclaration, string> {
  const sentence = text.trim().replace(/\s+/g, ' ')
  const [main = '', ...tail] = clauses(sentence)
  const matched = MAIN.exec(main)
  if (matched === null) {
    return err(
      `"${main}" is not a rule set. Write the link it sets, the link it sets it from, the text it reads, the pattern, the match kind and the order — ${EXAMPLE}.`,
    )
  }
  const [, target = '', sets = '', from = '', reads = '', pattern = '', fixed, kindColumn, members, order = '', where] =
    matched

  let kind: RuleKindSource
  if (fixed !== undefined) {
    kind = { fixed: kindOfWord(fixed) ?? 'EQUALS' }
  } else {
    const listed: (readonly [string, MatchKind])[] = []
    for (const part of (members ?? '').split(',').map((each) => each.trim())) {
      const member = MEMBER.exec(part)
      const word = member?.[2] === undefined ? undefined : kindOfWord(member[2])
      if (member === null || member[1] === undefined || word === undefined) {
        return err(
          `"${part}" is not a member and a match kind. Inside the brackets, name each member of ${kindColumn ?? 'the kind'} and the kind it is — \`EXACT_MERCHANT equals, CONTAINS contains\` — from ${MATCH_KINDS.map((each) => KIND_WORDS[each]).join(', ')}.`,
        )
      }
      listed.push([member[1], word])
    }
    kind = { column: kindColumn ?? '', members: listed }
  }

  const filters: AggregateFilter[] = []
  for (const part of where === undefined ? [] : splitFilters(where)) {
    const filter = parseFilter(part)
    if ('problem' in filter) return err(filter.problem)
    // A rule writes what it decides, and what is written must not hang on the
    // day it ran (M49 U2, D-472).
    if (filter.clock !== undefined) {
      return err(`The rule set ${name} says where ${filterText(filter)}: a rule writes what it decides, and ${CLOCK_REASON}.`)
    }
    filters.push(filter)
  }

  let source: { column: string; rule: string } | undefined
  let person: string | undefined
  let noting: string | undefined
  for (const clause of tail) {
    const recorded = RECORDED.exec(clause)
    const never = NEVER_OVER.exec(clause)
    const noted = NOTING.exec(clause)
    if (recorded !== null && source === undefined) {
      source = { column: recorded[1] ?? '', rule: recorded[2] ?? '' }
    } else if (never !== null && person === undefined) {
      person = never[1]
    } else if (noted !== null && noting === undefined) {
      noting = noted[1]
    } else {
      return err(
        `"${clause}" is not part of a rule set. After the order come \`recorded in <column> as <member>\`, \`never over <member>\` and, if you want the winning rule kept, \`noting <link>\` — each once.`,
      )
    }
  }
  if (source === undefined || person === undefined) {
    return err(
      `The rule set ${name} does not say where its value came from. A rule never overwrites a person's value, so the target needs an enum the engine writes: \`recorded in category_source as RULE, never over MANUAL\`.`,
    )
  }

  return ok({
    name,
    target,
    sets,
    from,
    reads: reads.split(' or '),
    pattern,
    kind,
    order: order.split(' then '),
    where: filters,
    source: source.column,
    ruleMember: source.rule,
    personMember: person,
    noting,
    note,
  })
}

/** The sentence a rule set is written as — what `parseRuleSet` reads back. */
export function ruleSetText(each: RuleSetDeclaration): string {
  const kind =
    'fixed' in each.kind
      ? `as ${KIND_WORDS[each.kind.fixed]}`
      : `by ${each.kind.column} (${each.kind.members.map(([member, word]) => `${member} ${KIND_WORDS[word]}`).join(', ')})`
  const main = [
    `${each.target}.${each.sets} from ${each.from}`,
    `when ${each.reads.join(' or ')} matches ${each.pattern}`,
    kind,
    `first by ${each.order.join(' then ')}`,
    ...(each.where.length === 0 ? [] : [`where ${each.where.map(filterText).join(' and ')}`]),
  ].join(' ')
  return [
    main,
    `recorded in ${each.source} as ${each.ruleMember}`,
    `never over ${each.personMember}`,
    ...(each.noting === undefined ? [] : [`noting ${each.noting}`]),
  ].join(', ')
}

/* --------------------------------------------------------------- matching */

/**
 * Compile a pattern the way a `regex` rule reads it, or say why it will not.
 * Case-insensitive for the reason the other kinds fold case: a person typing
 * `paypal` means the shop and not its casing.
 */
export function compilePattern(pattern: string): Result<RegExp, string> {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return err(`Pattern is longer than ${MAX_PATTERN_LENGTH} characters`)
  }
  try {
    return ok(new RegExp(pattern, 'i'))
  } catch (error) {
    return err(error instanceof Error ? error.message : 'Not a valid regular expression')
  }
}

/**
 * Does this text match this pattern, as this kind? **An empty pattern matches
 * nothing** rather than everything — the one answer a bare `.includes` gets
 * backwards. `cache` holds compiled regexes for one pass over many rows.
 */
export function patternMatches(
  kind: MatchKind,
  pattern: string,
  text: string,
  cache: Map<string, RegExp | undefined> = new Map(),
): boolean {
  if (kind === 'REGEX') {
    if (pattern.trim() === '') return false
    if (!cache.has(pattern)) {
      const compiled = compilePattern(pattern)
      cache.set(pattern, compiled.ok ? compiled.value : undefined)
    }
    const compiled = cache.get(pattern)
    return compiled !== undefined && compiled.test(cleanText(text))
  }
  const folded = foldText(pattern)
  if (folded === '') return false
  const subject = foldText(text)
  switch (kind) {
    case 'EQUALS':
      return subject === folded
    case 'CONTAINS':
      return subject.includes(folded)
    case 'STARTS_WITH':
      return subject.startsWith(folded)
  }
}

/** The match kind a rule's row is, or undefined when this rule set does not read it. */
export function kindOf(each: RuleSetDeclaration, rule: Readonly<Record<string, StoredValue>>): MatchKind | undefined {
  if ('fixed' in each.kind) return each.kind.fixed
  const member = rule[each.kind.column]
  return each.kind.members.find(([name]) => name === member)?.[1]
}

/**
 * What is wrong with a rule's pattern, before its row is written — empty, too
 * long, or a regex that does not compile. A rule row of a kind this rule set
 * does not read is not its to judge.
 */
export function rulePatternProblems(
  sets: readonly RuleSetDeclaration[],
  rule: Readonly<Record<string, StoredValue>>,
): readonly string[] {
  const problems: string[] = []
  for (const each of sets) {
    const kind = kindOf(each, rule)
    if (kind === undefined) continue
    const pattern = rule[each.pattern]
    const text = typeof pattern === 'string' ? pattern : ''
    if (cleanText(text) === '') {
      problems.push(`A rule of ${each.name} needs a ${each.pattern} to match: an empty one matches nothing.`)
    } else if (text.length > MAX_PATTERN_LENGTH) {
      problems.push(`The ${each.pattern} is longer than ${MAX_PATTERN_LENGTH} characters.`)
    } else if (kind === 'REGEX') {
      const compiled = compilePattern(text)
      if (!compiled.ok) problems.push(`The ${each.pattern} is not a regular expression that compiles: ${compiled.error}.`)
    }
  }
  return problems
}

/* --------------------------------------------------------------- deciding */

/** A rule as the engine reads it: its id and its stored cells. */
export interface RuleRow {
  readonly id: string
  readonly cells: Readonly<Record<string, StoredValue>>
}

/** What the rules say about one row of the target. */
export type RuleDecision =
  | { readonly kind: 'NONE' }
  | { readonly kind: 'SET'; readonly value: string; readonly rule: string }
  /** The rules at the top name different rows; the row is left as it is. */
  | { readonly kind: 'TIE'; readonly rules: readonly string[] }

/**
 * A rule set made ready for many rows: the rules its filters take and whose
 * kind it reads, sorted by the declared order once.
 */
export interface PreparedRules {
  readonly set: RuleSetDeclaration
  readonly rules: readonly { readonly row: RuleRow; readonly kind: MatchKind; readonly rank: readonly (number | string)[] }[]
  readonly cache: Map<string, RegExp | undefined>
}

/**
 * `is empty` — a rule set's filter may also ask that a column of the rule hold
 * nothing, so a rule carrying a condition the sentence cannot say (an account
 * it is limited to, an amount band) is left to whoever can (D-273). The word is
 * every filter's since M36 U04, so it lives beside them in `aggregate.ts`.
 */
export { EMPTY }

function filterTakes(
  filter: AggregateFilter,
  cells: Readonly<Record<string, StoredValue>>,
  columns: ReadonlyMap<string, ColumnDeclaration>,
): boolean {
  // A money column is stored as its minor units beside a currency; the figure
  // is the one that is empty or not.
  const stored = columns.get(filter.column)?.type === 'money' ? `${filter.column}_minor` : filter.column
  const value = cells[stored]
  // The rule's own row, so a member is the cell as stored: a boolean's 1 or 0
  // is `true` or `false` (M36 U04's spellings, through `filterDecides`).
  const member =
    value === null || value === undefined || value === ''
      ? undefined
      : columns.get(filter.column)?.type === 'boolean'
        ? value === 1
          ? 'true'
          : 'false'
        : String(value)
  return filterDecides(filter, member) === 'TAKES'
}

function rankValue(column: ColumnDeclaration | undefined, value: StoredValue): number | string {
  if (column?.type === 'enum') {
    const at = column.values.indexOf(String(value))
    return at === -1 ? column.values.length : at
  }
  return typeof value === 'string' || typeof value === 'number' ? value : ''
}

function compareRanks(a: readonly (number | string)[], b: readonly (number | string)[]): number {
  for (let at = 0; at < a.length; at += 1) {
    const x = a[at] ?? ''
    const y = b[at] ?? ''
    if (x < y) return -1
    if (x > y) return 1
  }
  return 0
}

/** `ruleColumns` are the rule format's, so an enum orders by its declared members. */
export function prepareRules(
  set: RuleSetDeclaration,
  ruleColumns: readonly ColumnDeclaration[],
  rows: readonly RuleRow[],
): PreparedRules {
  const columns = new Map(ruleColumns.map((each) => [each.name, each]))
  const rules = rows
    .filter((row) => row.cells[set.from] !== null && row.cells[set.from] !== undefined)
    .filter((row) => set.where.every((filter) => filterTakes(filter, row.cells, columns)))
    .flatMap((row) => {
      const kind = kindOf(set, row.cells)
      if (kind === undefined) return []
      const rank = set.order.map((name) => rankValue(columns.get(name), row.cells[name] ?? null))
      return [{ row, kind, rank }]
    })
    .sort((a, b) => compareRanks(a.rank, b.rank) || (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0))
  return { set, rules, cache: new Map() }
}

/** Which rule sets this row's link, if any — or the tie that stops it. */
export function decide(prepared: PreparedRules, cells: Readonly<Record<string, StoredValue>>): RuleDecision {
  const { set } = prepared
  const texts = set.reads.map((name) => cells[name]).filter((each): each is string => typeof each === 'string')
  if (texts.length === 0) return { kind: 'NONE' }

  let top: (typeof prepared.rules)[number][] | undefined
  for (const rule of prepared.rules) {
    if (top !== undefined && compareRanks(rule.rank, top[0]?.rank ?? []) !== 0) break
    const pattern = rule.row.cells[set.pattern]
    if (typeof pattern !== 'string') continue
    if (!texts.some((text) => patternMatches(rule.kind, pattern, text, prepared.cache))) continue
    ;(top ??= []).push(rule)
  }
  if (top === undefined || top.length === 0) return { kind: 'NONE' }
  const values = new Set(top.map((rule) => String(rule.row.cells[set.from])))
  if (values.size > 1) return { kind: 'TIE', rules: top.map((rule) => rule.row.id) }
  const [winner] = top
  return winner === undefined
    ? { kind: 'NONE' }
    : { kind: 'SET', value: String(winner.row.cells[set.from]), rule: winner.row.id }
}

/**
 * Is this row the rules' to set? While its source is empty or the rules' own —
 * or while it holds no value, unless a person emptied it.
 */
export function isTheRules(set: RuleSetDeclaration, cells: Readonly<Record<string, StoredValue>>): boolean {
  const source = cells[set.source] ?? null
  if (source === null || source === set.ruleMember) return true
  const value = cells[set.sets] ?? null
  return value === null && source !== set.personMember
}

/** What a write becomes once the rules have read it, and what they did. */
export interface RuledWrite {
  readonly cells: Readonly<Record<string, StoredValue>>
  /** Per rule set that looked: what it decided, or that a person had the row. */
  readonly decisions: readonly { readonly set: string; readonly decision: RuleDecision | 'PERSON' }[]
}

/**
 * A write to the target, with the rules applied (D-273). `cells` is what the
 * writer sends — for an edit only the columns it names — and `before` the row
 * as it stood, empty for a new one.
 *
 * - **The writer changed the link** — a person set it: the source becomes the
 *   person's member, unless the writer said who set it, and no rule reads the
 *   row again until its source is emptied.
 * - **Otherwise, if the row is the rules'** (`isTheRules`, on the row as it
 *   would stand), the rules decide: a match sets the link, the rule's member and
 *   the noted rule; no match leaves what is there, since clearing a value on a
 *   write that did not touch it is a change nobody asked for; a tie leaves it
 *   and is said. A writer that names the person's member over an empty link has
 *   said *nothing*, and is taken at its word.
 */
export function applyOnWrite(
  prepared: readonly PreparedRules[],
  cells: Readonly<Record<string, StoredValue>>,
  before: Readonly<Record<string, StoredValue>> = {},
): RuledWrite {
  let result: Record<string, StoredValue> = { ...cells }
  const decisions: { set: string; decision: RuleDecision | 'PERSON' }[] = []
  for (const each of prepared) {
    const set = each.set
    const linkNow = set.sets in cells ? (cells[set.sets] ?? null) : (before[set.sets] ?? null)
    if (linkNow !== (before[set.sets] ?? null)) {
      const sourceSaid = set.source in cells && (cells[set.source] ?? null) !== (before[set.source] ?? null)
      if (!sourceSaid) result = { ...result, [set.source]: set.personMember }
      decisions.push({ set: set.name, decision: 'PERSON' })
      continue
    }
    const row = { ...before, ...result }
    if (!isTheRules(set, row)) continue
    const decision = decide(each, row)
    decisions.push({ set: set.name, decision })
    if (decision.kind !== 'SET') continue
    result = {
      ...result,
      [set.sets]: decision.value,
      [set.source]: set.ruleMember,
      ...(set.noting === undefined ? {} : { [set.noting]: decision.rule }),
    }
  }
  return { cells: result, decisions }
}
