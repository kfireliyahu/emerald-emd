/**
 * **Connections: the graph across formats** — M20 U5,
 * [D-233](../../../docs/09-decision-log.md).
 *
 * A `link` and an aggregate are the two halves of the third arrow — *make
 * connections to other formats* — and until now both were authored in prose
 * sections of a form about **one** format. That is the wrong place for them by
 * construction: a connection is a fact about two formats, and a form that can
 * only see one of them has to ask a person to remember the other. The editor's
 * aggregate section said so out loud — *"Nothing points at this format yet.
 * Declare that one first, then come back"* — which is a screen admitting its
 * ordering is the wrong way round.
 *
 * **A graph has no *create this one first*.** Both formats are on it, the edge
 * between them is the connection, and the gesture that makes one is a drag from
 * an endpoint on the first to an endpoint on the second. This file is that
 * graph's structure and its meaning; the pixels are `ui/formats/`.
 *
 * ## Nothing here is stored
 *
 * There is no `ConnectionDeclaration`, no new table, nothing new in the
 * artefact and nothing new in `declare_format`. A link is a `link` column and
 * an aggregate is an `AggregateDeclaration`, exactly as they were — this module
 * **reads** the graph out of the declarations and **writes** the same two
 * things back. That is U4's rule again (D-232) and for the same reason: a second
 * representation is a second vocabulary, and a second vocabulary is the drift
 * D-227 caught between the editor and the tool. The parity rule survives
 * because there are no other characters to write.
 *
 * ## The ports carry the direction, so the drag does not have to
 *
 * A connection has a direction — `recipe_line.recipe` names a row of `recipe`,
 * and `recipe.total_kcal` gathers back along it — but **the direction is in the
 * two endpoints, not in which one your finger left first.** So `proposalFor` is
 * symmetric: it tries the pair both ways round and answers with the one
 * connection the pair can mean. A person dragging the "wrong" way gets what
 * they meant rather than nothing happening, and there is no arrowhead to learn
 * before you can draw one.
 *
 * The one pair that is genuinely ambiguous is a bubble on a bubble — two rows,
 * no column, and no way to say which of them gathers from the other — and that
 * is refused with a sentence naming what to drag instead.
 *
 * ## What a drag may not do, and why the refusal is the reconciler's
 *
 * Making an existing column a link **retypes** it, which is one of the four
 * things `planReconcile` refuses on a column with data in it (D-216) — and it
 * is the dangerous one, because every figure under it would change meaning.
 * Nothing here re-implements that check. A proposal is what the gesture means;
 * whether the document will accept it is the plan's answer, printed verbatim on
 * the dialog before anything is written (D-140). **A verifier proves what it
 * checks and nothing else** (D-138), and this one deliberately checks only the
 * shape of the gesture.
 */

import { err, ok, type Result } from '@/core/result.ts'

import {
  foldsEvery,
  isWiderFilter,
  type AggregateDeclaration,
  type AggregateKind,
  type AggregateSource,
} from './aggregate.ts'
import {
  column,
  FILTER_LANGUAGE,
  FILTER_TESTS_LANGUAGE,
  FOUND_BY_LANGUAGE,
  isLinkType,
  LATEST_LANGUAGE,
  type ColumnType,
  type FormatDeclaration,
} from './declaration.ts'
import { compileDerived, derived, type DerivedType } from './derived.ts'
import type { FormulaName } from './formula.ts'
import { foundByText, type FoundBy, type FoundGrain } from './foundBy.ts'
import { IDENTITY_TYPES } from './identity.ts'
import { isPointType } from './span.ts'
import { SEEDED_UNITS, type UnitTable } from './unit.ts'
import { capitalize } from '@/core/text.ts'

/**
 * A place a connection can start or end — an *endpoint*, in the roadmap's word.
 *
 * Five kinds, and the two `NEW_` ones are the only endpoints on this screen
 * that are not already a fact about the document. They exist because the
 * alternative is a person discovering that a drag from a column means something
 * by trying it: a port labelled *belongs to one…* says what the gesture is for
 * before the gesture — and, since M29 F10, which end is the many.
 */
export type Port =
  /** A row of this format — what a link names. Drawn on the bubble's head. */
  | { readonly kind: 'ROW'; readonly format: string }
  /** One declared column. Live if it is a `link`, quiet if it is not. */
  | { readonly kind: 'COLUMN'; readonly format: string; readonly column: string }
  /** One figure this format works out from rows elsewhere — an aggregate. */
  | { readonly kind: 'FIGURE'; readonly format: string; readonly figure: string }
  /** *belongs to one…* — a `link` column that does not exist yet: this is the many side. */
  | { readonly kind: 'NEW_LINK'; readonly format: string }
  /** *has many…* — an aggregate that does not exist yet: this is the one side (M29 F10). */
  | { readonly kind: 'NEW_FIGURE'; readonly format: string }

export function samePort(one: Port, other: Port): boolean {
  if (one.kind !== other.kind || one.format !== other.format) return false
  if (one.kind === 'COLUMN' && other.kind === 'COLUMN') return one.column === other.column
  if (one.kind === 'FIGURE' && other.kind === 'FIGURE') return one.figure === other.figure
  return true
}

/** One endpoint, as the graph needs to draw it. */
export interface GraphPort {
  readonly port: Port
  readonly label: string
  /** A column's declared type, for the glyph. Nothing for the other kinds. */
  readonly type: ColumnType | undefined
  /** The format a `link` names, when it names one this document declares. */
  readonly target: string | undefined
  /** How many connections run through it. A port with none is drawn quiet. */
  readonly edges: number
  /** The quiet words after the label — *one Paycheck*, *from work days* (M29 F10). */
  readonly detail: string | undefined
  /** What the port is and what a drag from it does, in a sentence: its hover. */
  readonly says: string
}

/** One format, as a bubble. */
export interface GraphNode {
  readonly name: string
  readonly title: string
  /**
   * How far this format is from one that names nobody — 0 for a format with no
   * links, otherwise one more than the deepest thing it names.
   *
   * It is the graph's only opinion about arrangement, and it is the useful one:
   * the most composed format is drawn first and **what a format is made of ends
   * up to its right**, so a link mostly runs one way across the screen and the
   * figure that gathers back along it is the one curve that returns. A cycle — two formats naming each other — is not an
   * error and is not resolved; the counting simply stops, because a rank that
   * threw would make a legal document undrawable.
   */
  readonly rank: number
  /** The row port, which is the bubble itself. */
  readonly row: GraphPort
  /** Every column, in declared order, then every figure, then the two `NEW_` ports. */
  readonly ports: readonly GraphPort[]
}

/** A connection that already exists, read out of the declarations. */
export type Edge =
  | {
      readonly kind: 'LINK'
      readonly from: Port
      readonly to: Port
      readonly format: string
      readonly column: string
      readonly target: string
      /** The target is not a format this document declares. */
      readonly dangling: boolean
    }
  | {
      readonly kind: 'FIGURE'
      readonly from: Port
      readonly to: Port
      readonly format: string
      readonly figure: string
      /** No column: every row of the format (M34 U4, D-397). */
      readonly over: AggregateSource
      /** The source format, or its link column, is gone or points elsewhere. */
      readonly dangling: boolean
    }

/** What a drag between two endpoints would mean, or why it means nothing. */
export type Proposal =
  /** A `link` column: a row of `from` names one row of `to`. */
  | {
      readonly kind: 'LINK'
      readonly from: string
      readonly to: string
      /** The column to be re-pointed or retyped, or nothing for a new one. */
      readonly column: string | undefined
      /** The column exists and is not a `link` yet, so this changes its type. */
      readonly retyping: boolean
    }
  /**
   * An aggregate on `format`, folding the rows of `over.format` that name it —
   * or, with no column, every row of it (M34 U4, D-397).
   */
  | {
      readonly kind: 'FIGURE'
      readonly format: string
      readonly over: AggregateSource
    }
  /**
   * Both, in one gesture — the ordering problem answered.
   *
   * A figure dropped on a format that does not point here yet needs the link
   * that gathers it, and on a graph both formats are already on the screen. So
   * the dialog writes two declarations rather than sending somebody away to
   * declare the first one and come back.
   */
  | { readonly kind: 'LINK_AND_FIGURE'; readonly format: string; readonly from: string }
  /**
   * Nothing, and the reason names what to drag instead. `detail` is the quieter
   * line under it, when the reason needs one (M29 F10).
   */
  | { readonly kind: 'NOTHING'; readonly reason: string; readonly detail?: string | undefined }

/* ------------------------------------------------------------- the picture */

/** The formats as bubbles, with their endpoints. */
export function graphOf(declarations: readonly FormatDeclaration[]): readonly GraphNode[] {
  const ranks = ranksOf(declarations)
  const edges = edgesOf(declarations)
  const through = (port: Port): number =>
    edges.filter((edge) => samePort(edge.from, port) || samePort(edge.to, port)).length
  const declared = new Set(declarations.map((each) => each.name))
  const title = titleIn(declarations)

  return declarations.map((format) => {
    const row: Port = { kind: 'ROW', format: format.name }
    const each = nounOf(format.title)
    const columns = format.columns.map((column): GraphPort => {
      const port: Port = { kind: 'COLUMN', format: format.name, column: column.name }
      const target = isLinkType(column.type) ? column.target : undefined
      const linked = column.type === 'link' && target !== undefined && target !== ''
      return {
        port,
        label: column.name,
        type: column.type,
        target: target !== undefined && declared.has(target) ? target : undefined,
        edges: through(port),
        detail: linked ? `one ${title(target)}` : undefined,
        says: linked
          ? `Each ${each} belongs to one ${nounOf(title(target))}.`
          : `${column.name} — ${typeWord(column.type)}${column.unit === undefined ? '' : `, in ${column.unit}`}. ` +
            'Drag onto a format to make it a connection.',
      }
    })
    const figures = format.aggregates.map((aggregate): GraphPort => {
      const port: Port = { kind: 'FIGURE', format: format.name, figure: aggregate.name }
      const many = pluralOf(title(aggregate.over.format))
      const every = foldsEvery(aggregate.over)
      return {
        port,
        label: aggregate.name,
        type: undefined,
        target: undefined,
        edges: through(port),
        detail: every ? `from every ${nounOf(title(aggregate.over.format))}` : `from ${many}`,
        says: every
          ? `${aggregate.name} adds up every ${nounOf(title(aggregate.over.format))}.`
          : `${aggregate.name} adds up its ${many}.`,
      }
    })
    return {
      name: format.name,
      title: format.title,
      rank: ranks.get(format.name) ?? 0,
      row: {
        port: row,
        label: format.title,
        type: undefined,
        target: undefined,
        edges: through(row),
        detail: undefined,
        says: `${format.title}. Drop “${NEW_LINK_WORDS}” from another format here.`,
      },
      ports: [
        ...columns,
        ...figures,
        {
          port: { kind: 'NEW_LINK', format: format.name },
          label: NEW_LINK_WORDS,
          type: undefined,
          target: undefined,
          edges: 0,
          detail: undefined,
          says: `Drag onto another format: each ${each} belongs to one of those.`,
        },
        {
          port: { kind: 'NEW_FIGURE', format: format.name },
          label: NEW_FIGURE_WORDS,
          type: undefined,
          target: undefined,
          edges: 0,
          detail: undefined,
          says: `Drag onto another format: each ${each} has many of those, and can add them up.`,
        },
      ],
    }
  })
}

/**
 * The two ports that start a connection, in the words chosen (M29
 * F10, wording A): they say the relationship rather than the storage, and
 * which end is the many before anything is dragged.
 */
export const NEW_LINK_WORDS = 'belongs to one…'
export const NEW_FIGURE_WORDS = 'has many…'

/* -------------------------------------------------------------- the words */

/**
 * A format's title as a noun inside a sentence — *Work day* is *work day* in
 * "each work day belongs to one paycheck" (M29 F10). A word in capitals stays
 * as it is: an acronym lowered is a different word.
 */
export function nounOf(title: string): string {
  return title
    .split(' ')
    .map((word) =>
      word.length > 1 && word === word.toUpperCase() ? word : word.charAt(0).toLowerCase() + word.slice(1),
    )
    .join(' ')
}

/**
 * And many of them — *work days*, *recipe lines*. English endings only: a
 * title in another script is left as it is, because a wrong ending is worse
 * than none.
 */
export function pluralOf(title: string): string {
  const noun = nounOf(title)
  if (!/[a-z]$/i.test(noun)) return noun
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`
  if (/(s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`
  return `${noun}s`
}

/** A format's title, or — for one this document does not declare — its name, said. */
export function titleIn(declarations: readonly FormatDeclaration[]): (name: string) => string {
  const index = new Map(declarations.map((each) => [each.name, each]))
  return (name) => {
    const title = index.get(name)?.title
    if (title !== undefined) return title
    const said = name.replace(/_/g, ' ')
    return capitalize(said)
  }
}

/** What a column holds, in a word a person would use. */
function typeWord(type: ColumnType): string {
  switch (type) {
    case 'text':
      return 'text'
    case 'integer':
    case 'real':
    case 'decimal':
      return 'a number'
    case 'percent':
      return 'a percentage'
    case 'date':
      return 'a date'
    case 'month':
      return 'a month'
    case 'instant':
      return 'a moment'
    case 'time':
      return 'a time of day'
    case 'boolean':
      return 'yes or no'
    case 'enum':
      return 'one of a list'
    case 'money':
      return 'money'
    case 'quantity':
      return 'an amount with its unit'
    case 'link':
      return 'a connection'
    case 'links':
      return 'a list of rows'
    case 'elsewhere':
      return 'a row in another document'
    case 'file':
      return 'a file'
    case 'enums':
      return 'several of a list'
  }
}

/**
 * Every connection in the document.
 *
 * **A dangling one is still an edge.** A link at a format that has been deleted
 * and an aggregate over a column that is gone are both drawn, marked, because
 * the alternative is a graph that quietly omits the thing a person came here to
 * fix — which is the shape of D-138 in a picture.
 */
export function edgesOf(declarations: readonly FormatDeclaration[]): readonly Edge[] {
  const index = new Map(declarations.map((each) => [each.name, each]))
  const edges: Edge[] = []

  for (const format of declarations) {
    for (const column of format.columns) {
      if (!isLinkType(column.type)) continue
      const target = column.target ?? ''
      if (target === '') continue
      edges.push({
        kind: 'LINK',
        from: { kind: 'COLUMN', format: format.name, column: column.name },
        to: { kind: 'ROW', format: target },
        format: format.name,
        column: column.name,
        target,
        dangling: !index.has(target),
      })
    }
    for (const aggregate of format.aggregates) {
      const source = index.get(aggregate.over.format)
      const over = aggregate.over.column
      // Every row of a format names no column, so the curve ends on the
      // whole bubble (M34 U4, D-397).
      if (over === undefined) {
        edges.push({
          kind: 'FIGURE',
          from: { kind: 'FIGURE', format: format.name, figure: aggregate.name },
          to: { kind: 'ROW', format: aggregate.over.format },
          format: format.name,
          figure: aggregate.name,
          over: aggregate.over,
          dangling: source === undefined,
        })
        continue
      }
      const link = source?.columns.find((each) => each.name === over && isLinkType(each.type))
      edges.push({
        kind: 'FIGURE',
        from: { kind: 'FIGURE', format: format.name, figure: aggregate.name },
        to: { kind: 'COLUMN', format: aggregate.over.format, column: over },
        format: format.name,
        figure: aggregate.name,
        over: aggregate.over,
        dangling: link === undefined || link.target !== format.name,
      })
    }
  }

  return edges
}

/**
 * How far each format is from one that names nobody. See `GraphNode.rank`.
 *
 * Depth-first with the visiting set as the cycle guard, which is the only part
 * worth the care: `recipe` naming `recipe` is a legal declaration — a
 * sub-recipe is one hop, not a traversal (D-224) — so this has to terminate on
 * it rather than treat it as a fault.
 */
export function ranksOf(declarations: readonly FormatDeclaration[]): ReadonlyMap<string, number> {
  const index = new Map(declarations.map((each) => [each.name, each]))
  const ranks = new Map<string, number>()
  const visiting = new Set<string>()

  const rank = (name: string): number => {
    const known = ranks.get(name)
    if (known !== undefined) return known
    const format = index.get(name)
    if (format === undefined || visiting.has(name)) return 0
    visiting.add(name)
    let deepest = -1
    for (const column of format.columns) {
      if (!isLinkType(column.type)) continue
      const target = column.target ?? ''
      if (target === '' || target === name || !index.has(target)) continue
      deepest = Math.max(deepest, rank(target))
    }
    visiting.delete(name)
    const answer = deepest + 1
    ranks.set(name, answer)
    return answer
  }

  for (const format of declarations) rank(format.name)
  return ranks
}

/* -------------------------------------------------------- what a drag means */

/**
 * What a drag from one endpoint to another would declare.
 *
 * Symmetric in its two arguments — see the head of this file. Everything it
 * answers is about the *shape* of the pair; whether the document will accept
 * the change is the reconciler's answer and is asked separately.
 */
export function proposalFor(
  one: Port,
  other: Port,
  declarations: readonly FormatDeclaration[],
): Proposal {
  if (samePort(one, other)) {
    return { kind: 'NOTHING', reason: `Those two are the same. Drag ${NEW_LINK_WORDS} onto another format.` }
  }
  const first = read(one, other, declarations)
  if (first.kind !== 'NOTHING') return first
  const second = read(other, one, declarations)
  return second.kind === 'NOTHING' ? first : second
}

function read(from: Port, to: Port, declarations: readonly FormatDeclaration[]): Proposal {
  const index = new Map(declarations.map((each) => [each.name, each]))
  const title = titleIn(declarations)
  const missing = (name: string): Proposal => ({ kind: 'NOTHING', reason: `There is no ${title(name)} format.` })

  // A new link column, pointed wherever it was dropped. The plain case, and
  // the only one that needs nothing to exist yet.
  if (from.kind === 'NEW_LINK' && to.kind === 'ROW') {
    if (!index.has(to.format)) return missing(to.format)
    return { kind: 'LINK', from: from.format, to: to.format, column: undefined, retyping: false }
  }

  // **Either end starts the one gesture** (M29 F9): *belongs to one…* on a
  // work day dropped on *has many…* on its paycheck says both halves at
  // once — the link, and the total along it — exactly as the other way round.
  if (from.kind === 'NEW_LINK' && to.kind === 'NEW_FIGURE') {
    if (!index.has(to.format)) return missing(to.format)
    return { kind: 'LINK_AND_FIGURE', format: to.format, from: from.format }
  }

  // An existing column, re-pointed or retyped. Which of the two it is matters
  // only for the sentence: the reconciler decides whether it may happen.
  if (from.kind === 'COLUMN' && to.kind === 'ROW') {
    const column = index.get(from.format)?.columns.find((each) => each.name === from.column)
    if (column === undefined) {
      return { kind: 'NOTHING', reason: `${title(from.format)} has no column called ${from.column}.` }
    }
    if (column.type === 'link' && column.target === to.format) {
      return {
        kind: 'NOTHING',
        reason: `${from.column} already connects each ${nounOf(title(from.format))} to a ${nounOf(title(to.format))}.`,
      }
    }
    return {
      kind: 'LINK',
      from: from.format,
      to: to.format,
      column: from.column,
      retyping: column.type !== 'link',
    }
  }

  // A figure, dropped on the link that gathers it.
  if (from.kind === 'NEW_FIGURE' && to.kind === 'COLUMN') {
    const column = index.get(to.format)?.columns.find((each) => each.name === to.column)
    if (column === undefined || column.type !== 'link') {
      return {
        kind: 'NOTHING',
        reason: `${to.column} isn’t a connection. Drop it on the whole format, or on a column that is.`,
      }
    }
    if (column.target !== from.format) {
      return {
        kind: 'NOTHING',
        reason: `${to.column} connects ${pluralOf(title(to.format))} to ${title(column.target ?? '')}, not to ${title(from.format)}.`,
      }
    }
    return { kind: 'FIGURE', format: from.format, over: { format: to.format, column: to.column } }
  }

  // A figure, dropped on the whole bubble. One link aimed here is the figure;
  // none is the link and the figure together; two is a question only a person
  // can answer, so it is asked rather than guessed.
  if (from.kind === 'NEW_FIGURE' && to.kind === 'ROW') {
    const source = index.get(to.format)
    if (source === undefined) return missing(to.format)
    const aimed = source.columns.filter(
      (each) => each.type === 'link' && each.target === from.format,
    )
    const only = aimed.length === 1 ? aimed[0] : undefined
    if (only !== undefined) {
      return {
        kind: 'FIGURE',
        format: from.format,
        over: { format: to.format, column: only.name },
      }
    }
    if (aimed.length > 1) {
      const ways = aimed.length === 2 ? 'two ways' : `${String(aimed.length)} ways`
      const many = pluralOf(title(to.format))
      return {
        kind: 'NOTHING',
        reason: `${capitalize(many)} belong to a ${nounOf(title(from.format))} in ${ways}. Drop it on the one to add up.`,
      }
    }
    return { kind: 'LINK_AND_FIGURE', format: from.format, from: to.format }
  }

  if (from.kind === 'ROW' && to.kind === 'ROW') {
    return {
      kind: 'NOTHING',
      reason: `Drag ${NEW_LINK_WORDS} from the format there are many of.`,
      detail: 'Two whole formats don’t say which one has many of the other.',
    }
  }

  if (from.kind === 'FIGURE' || to.kind === 'FIGURE') {
    const figure = from.kind === 'FIGURE' ? from.figure : to.kind === 'FIGURE' ? to.figure : ''
    return { kind: 'NOTHING', reason: `Press ${figure} to change it.` }
  }

  return {
    kind: 'NOTHING',
    reason: `Those two don’t connect. Drag ${NEW_LINK_WORDS} onto another format.`,
  }
}

/**
 * What the connection window's answers say so far — the ones the headline is
 * built from (M29 F10).
 */
export interface Answers {
  /** A date finds the row: the same month, or the same day. Nothing while it is picked. */
  readonly found?: FoundGrain | undefined
  /** The total kept along it, when there is one: its kind and what it is called. */
  readonly total?: { readonly kind: AggregateKind; readonly name: string } | undefined
}

/**
 * What a proposal would make true, in the sentence a person would say out loud
 * — *each work day belongs to one paycheck* (M29 F10, D-352).
 *
 * It is the window's headline and it is built from the answers, so it always
 * says what will be true rather than how it is stored: the found-by choice, the
 * "add up" tick and the kind of total each change it. It is here rather than in
 * the window because it is the product of the screen, and a gesture whose
 * meaning is only visible after it has happened is a gesture nobody can be sure
 * of.
 */
export function headlineOf(
  proposal: Proposal,
  declarations: readonly FormatDeclaration[],
  answers: Answers = {},
): string {
  const title = titleIn(declarations)
  const index = new Map(declarations.map((each) => [each.name, each]))

  switch (proposal.kind) {
    case 'LINK': {
      const head = belongs(title(proposal.from), title(proposal.to), answers.found)
      if (proposal.column === undefined) return `${head}.`
      if (proposal.retyping) {
        return `${head}, through ${proposal.column}. What ${proposal.column} holds now is replaced.`
      }
      const was = index.get(proposal.from)?.columns.find((each) => each.name === proposal.column)?.target
      if (was === undefined || was === proposal.to) return `${head}.`
      const totals = foldsOver(declarations, proposal.from, proposal.column).length > 0
      return (
        `Each ${nounOf(title(proposal.from))} will belong to one ${nounOf(title(proposal.to))} instead of one ` +
        `${nounOf(title(was))}.${totals ? ' Totals through it change too.' : ''}`
      )
    }
    case 'LINK_AND_FIGURE': {
      const head = belongs(title(proposal.from), title(proposal.format), answers.found)
      const total = answers.total
      if (total === undefined) return `${head}.`
      return `${head}, and each ${nounOf(title(proposal.format))} ${addsUp(total, title(proposal.from))}.`
    }
    case 'FIGURE':
      return `Each ${nounOf(title(proposal.format))} ${addsUp(answers.total, title(proposal.over.format), foldsEvery(proposal.over))}.`
    case 'NOTHING':
      return proposal.reason
  }
}

/**
 * A connection that already exists, in the same words.
 *
 * Separate from `headlineOf` because a proposal and a fact are different things
 * to say: opening a link to change its note is not re-pointing it. And a
 * connection whose other end is gone says so plainly, because the alternative
 * is a window that quietly reads as if nothing were wrong (D-138).
 */
export function edgeHeadline(edge: Edge, declarations: readonly FormatDeclaration[]): string {
  const title = titleIn(declarations)
  const index = new Map(declarations.map((each) => [each.name, each]))

  if (edge.kind === 'LINK') {
    if (edge.dangling) {
      return (
        `Each ${nounOf(title(edge.format))} belonged to one ${nounOf(title(edge.target))}, ` +
        `but there is no ${title(edge.target)} format now.`
      )
    }
    const column = index.get(edge.format)?.columns.find((each) => each.name === edge.column)
    return `${belongs(title(edge.format), title(edge.target), column?.foundBy?.grain)}.`
  }

  const many = pluralOf(title(edge.over.format))
  const every = foldsEvery(edge.over)
  if (edge.dangling) {
    return every
      ? `${title(edge.format)}’s ${edge.figure} adds up every ${nounOf(title(edge.over.format))}, but there is no ${title(edge.over.format)} format now.`
      : `${title(edge.format)}’s ${edge.figure} adds up ${many}, but ${many} no longer belong to ${pluralOf(title(edge.format))}.`
  }
  const held = index.get(edge.format)?.aggregates.find((each) => each.name === edge.figure)
  return `Each ${nounOf(title(edge.format))} ${addsUp(held === undefined ? undefined : { kind: held.kind, name: held.name }, title(edge.over.format), every)}.`
}

/**
 * A connection as the list beside the graph says it: the sentence, and the
 * quieter line under it naming where it lives (M29 F10). No code — the old list
 * printed `work_day.paycheck → paycheck` under a heading that said *in words*.
 */
export function edgeWords(
  edge: Edge,
  declarations: readonly FormatDeclaration[],
): { readonly says: string; readonly under: string } {
  const title = titleIn(declarations)
  if (edge.dangling) {
    return {
      says: edgeHeadline(edge, declarations).replace(/\.$/, ''),
      under: edge.kind === 'LINK' ? `${nounOf(title(edge.format))}’s ${edge.column} column` : 'computed each time, not stored',
    }
  }
  if (edge.kind === 'LINK') {
    return {
      says: `Each ${nounOf(title(edge.format))} belongs to one ${nounOf(title(edge.target))}`,
      under: `${nounOf(title(edge.format))}’s ${edge.column} column`,
    }
  }
  return {
    says: foldsEvery(edge.over)
      ? `${title(edge.format)} adds up ${edge.figure} from every ${nounOf(title(edge.over.format))}`
      : `${title(edge.format)} adds up ${edge.figure} from its ${pluralOf(title(edge.over.format))}`,
    under: 'computed each time, not stored',
  }
}

/** *Each work day belongs to one paycheck* — or to the one its date falls in. */
function belongs(many: string, one: string, found: FoundGrain | undefined): string {
  const each = `Each ${nounOf(many)}`
  if (found === undefined) return `${each} belongs to one ${nounOf(one)}`
  return found === 'DAY'
    ? `${each} belongs to the ${nounOf(one)} of the same day`
    : `${each} belongs to the ${nounOf(one)} of its month`
}

/** What a total does with the rows that belong to it, as a verb phrase. */
function addsUp(
  total: { readonly kind: AggregateKind; readonly name: string } | undefined,
  many: string,
  every = false,
): string {
  // *Every course*, not *its courses*: no course belongs to a degree (D-397).
  const rows = every ? `every ${nounOf(many)}` : `its ${pluralOf(many)}`
  if (total === undefined) return `adds up ${rows}`
  const name = total.name.trim()
  if (total.kind === 'COUNT') return `counts ${rows}`
  if (name === '') return `adds up ${rows}`
  if (total.kind === 'SUM') return `adds up the ${name} of ${rows}`
  return `shows the ${kindWord(total.kind)} ${name} of ${rows}`
}

/**
 * A kind of total, in the window's words: *smallest* and *largest*, where the
 * declaration says `minimum` and `maximum`.
 */
export function kindWord(kind: AggregateKind): string {
  switch (kind) {
    case 'SUM':
      return 'sum'
    case 'COUNT':
      return 'count'
    case 'AVERAGE':
      return 'average'
    case 'MINIMUM':
      return 'smallest'
    case 'MAXIMUM':
      return 'largest'
    case 'LATEST':
      return 'latest'
    case 'EARLIEST':
      return 'earliest'
  }
}

/* ------------------------------------------------------------ the two names */

/**
 * A free column name on this format, from a base.
 *
 * The base of a new link is the format it names — `ingredient`, which is what
 * every one of these is called by hand — and the suffix is only reached when
 * the obvious name is taken, which is a recipe line with two ingredients on it.
 */
export function freeColumnName(format: FormatDeclaration | undefined, base: string): string {
  const taken = new Set((format?.columns ?? []).map((each) => each.name))
  return free(taken, base)
}

/**
 * A name for a new total, suggested from what it adds up (M29 F10).
 *
 * The window used to open a total with an empty name and a red *a total needs a
 * name* above it, which is a refusal of something nobody had typed yet. So a
 * name is always offered, and it follows what is being added up until a person
 * types their own: a count is `work_day_count`, a sum of `grams *
 * ingredient.kcal / 100` is `total_kcal` — the last name in the line — and a
 * sum of nothing yet is `work_day_total`. It is a suggestion; it is never
 * written behind anybody's back.
 */
export function suggestedFigureName(
  kind: AggregateKind,
  source: string,
  format: FormatDeclaration | undefined,
  expression = '',
): string {
  if (source === '') return ''
  const taken = new Set([
    ...(format?.aggregates ?? []).map((each) => each.name),
    ...(format?.columns ?? []).map((each) => each.name),
    ...(format?.derived ?? []).map((each) => each.name),
  ])
  if (kind === 'COUNT') return free(taken, `${source}_count`)
  const named = [...expression.matchAll(/[a-z][a-z0-9_]*(?:\.([a-z][a-z0-9_]*))?/g)]
  const last = named[named.length - 1]
  const tail = last === undefined ? undefined : (last[1] ?? last[0])
  const word = kind === 'SUM' ? 'total' : kindWord(kind)
  return free(taken, tail === undefined ? `${source}_${word}` : `${word}_${tail}`)
}

function free(taken: ReadonlySet<string>, base: string): string {
  if (!taken.has(base)) return base
  for (let n = 2; n < 100; n += 1) {
    const tried = `${base}_${n}`
    if (!taken.has(tried)) return tried
  }
  return base
}

/* ---------------------------------------------- what the two ends can name */

/**
 * The names an expression folded over a link may use — the source's own
 * figures and times, its worked-out columns, and one hop through each of *its*
 * links — each with what it is, for the formula field to offer (M29 F9).
 *
 * Listed rather than left to be discovered, for the reason the identity box
 * lists its own: nobody would guess that `ingredient.kcal` is allowed on a
 * recipe line, and that hop is the entire point of the feature (D-224). **A
 * worked-out column is here too** (M29 F7, D-349): a work day's `earned` is
 * what its row shows, so a paycheck's total of it is the sum of what they show
 * — and a list of stored numbers only was the hint that hid it.
 *
 * It lived in the editor until U5 and moved here with the aggregate itself, so
 * that the one place a fold is authored and the one place its names are
 * computed are the same place.
 */
export function foldNames(
  source: FormatDeclaration,
  declarations: readonly FormatDeclaration[],
): readonly FormulaName[] {
  const usable = (type: ColumnType): boolean =>
    (IDENTITY_TYPES as readonly string[]).includes(type) || isPointType(type)
  const own = source.columns
    .filter((each) => usable(each.type))
    .map((each) => ({ name: each.name, says: each.type as string }))
  const worked = (source.derived ?? []).map((each) => ({ name: each.name, says: 'computed' }))
  const hopped = source.columns.flatMap((link) => {
    if (link.type !== 'link') return []
    const target = declarations.find((each) => each.name === link.target)
    return (target?.columns ?? [])
      .filter((each) => usable(each.type))
      .map((each) => ({ name: `${link.name}.${each.name}`, says: `${each.type as string} of ${link.target ?? ''}` }))
  })
  return [...own, ...worked, ...hopped]
}

/**
 * What a total of `expression` over the source's rows comes out as — money,
 * or a figure in the unit its rows agree on — or `undefined` while it does not
 * compile yet (M29 F9).
 *
 * Asked by compiling the line as if it were one more worked-out column of the
 * source, which is the typing F7 already folds by (D-349): a total of money is
 * in its rows' currency, carried with the figure, and **needs no unit** — the
 * panel offered `kcal` for one and refused `ILS`, which is not a unit but a
 * currency.
 */
export function foldType(
  expression: string,
  source: FormatDeclaration,
  declarations: readonly FormatDeclaration[],
  units: UnitTable = SEEDED_UNITS,
): DerivedType | undefined {
  if (expression.trim() === '') return undefined
  const taken = new Set([
    ...source.columns.map((each) => each.name),
    ...(source.derived ?? []).map((each) => each.name),
    ...source.aggregates.map((each) => each.name),
  ])
  const name = free(taken, 'total_of_each_row')
  const { compiled } = compileDerived(
    { ...source, derived: [...(source.derived ?? []), derived(name, expression)] },
    declarations.filter((each) => each.name !== source.name),
    units,
  )
  return compiled.find((each) => each.declaration.name === name)?.type
}

/**
 * The aggregates that gather their rows by this column.
 *
 * Asked before a link is taken away, and it is the same guard the formats
 * screen already puts on deleting a whole format: a fold whose link is gone
 * would be a figure over rows nothing selects. **Nothing in this document is
 * removed on somebody's behalf**, so the answer is a refusal with the figures
 * named rather than a cascade.
 */
export function foldsOver(
  declarations: readonly FormatDeclaration[],
  source: string,
  column: string,
): readonly { readonly format: string; readonly aggregate: AggregateDeclaration }[] {
  return declarations.flatMap((format) =>
    format.aggregates
      .filter((each) => each.over.format === source && each.over.column === column)
      .map((each) => ({ format: format.name, aggregate: each })),
  )
}

/* ------------------------------------------------- a connection, as a request */

/**
 * A connection asked for in words rather than drawn — M24 U2, parity gap #11.
 *
 * The screen's drag ends in a `Proposal` and a dialog of fields; a conversation
 * has neither, and says the whole thing at once: *`recipe_line.recipe` names a
 * `recipe`, and `recipe` sums `amount_g` back along it.* `figure` carries no
 * `over`, because the link being made **is** the over — a fold aimed anywhere
 * else is not this connection and is a different call.
 */
export interface ConnectionRequest {
  /** The format that gets the link column — the many side. */
  readonly from: string
  readonly column: string
  /** The format the link names a row of — the side a figure is folded back onto. */
  readonly target: string
  readonly required: boolean
  readonly note: string
  readonly figure: Omit<AggregateDeclaration, 'over'> | undefined
  /**
   * How the link is filled while it is empty — `date in period` (M29 F8,
   * D-350). On a link that already exists and is found by nothing, this is the
   * whole request: it only adds.
   */
  readonly foundBy?: FoundBy | undefined
}

/**
 * The declarations a connection revises, **in the order they have to be
 * adopted**: the link's format first, because the figure's own validation asks
 * whether a column aimed here exists. A self-link with a figure over it is one
 * declaration carrying both, and the panel's `buildDrafts` meets the same case.
 *
 * **An existing link is taken as it is** when it already names the target, so
 * *add a figure over the link I already have* is the same request with the
 * column named — which is the screen's `FIGURE` drag. A column of that name that
 * is anything else is refused rather than retyped: retyping is an alteration
 * whose loss the reconciler has to judge against rows, and nobody asked for it.
 *
 * Only the shape of the request is checked here. Whether the declarations are
 * sound — names, the figure's expression, a duplicate aggregate — is
 * `declarationProblems`'s, and whether the table can take them is the plan's:
 * the same two authorities the screen asks (D-138).
 */
export function connect(
  declarations: readonly FormatDeclaration[],
  request: ConnectionRequest,
): Result<readonly FormatDeclaration[], string> {
  const from = declarations.find((each) => each.name === request.from)
  const target = declarations.find((each) => each.name === request.target)
  if (from === undefined) return err(`This document declares no format called ${request.from}.`)
  if (target === undefined) return err(`This document declares no format called ${request.target}.`)

  const held = from.columns.find((each) => each.name === request.column)
  if (held !== undefined && held.type !== 'link') {
    return err(
      `${from.name} already has a column called ${held.name}, and it is a ${held.type} rather ` +
        `than a link. Name the new link something else — ${freeColumnName(from, target.name)} is free.`,
    )
  }
  if (held !== undefined && held.target !== target.name) {
    return err(
      `${from.name}.${held.name} is already a link to ${held.target ?? 'nothing'}, not to ` +
        `${target.name}. Re-pointing a link is done at #/connections, where the plan is drawn ` +
        `against the rows it already names; a new link wants a new name — ` +
        `${freeColumnName(from, target.name)} is free.`,
    )
  }
  const finding = request.foundBy
  if (held !== undefined && finding !== undefined && held.foundBy !== undefined) {
    return err(
      `${from.name}.${held.name} is already found by ${foundByText(held.foundBy)}. Changing how it is ` +
        'found is done at #/connections, where the link is drawn; this only adds.',
    )
  }
  if (held !== undefined && request.figure === undefined && finding === undefined) {
    return err(
      `${from.name}.${held.name} already links to ${target.name}, so there is nothing to make. ` +
        'Name a figure to fold back along it, or leave it as it is.',
    )
  }

  const made: FormatDeclaration =
    held === undefined
      ? {
          ...from,
          columns: [
            ...from.columns,
            column(request.column, 'link', {
              target: target.name,
              required: request.required,
              note: request.note,
              foundBy: finding,
            }),
          ],
        }
      : finding === undefined
        ? from
        : {
            ...from,
            columns: from.columns.map((each) => (each.name === held.name ? { ...each, foundBy: finding } : each)),
          }
  // A link found by a date needs the language that can say it (D-350).
  const linked: FormatDeclaration =
    finding === undefined ? made : { ...made, language: Math.max(made.language, FOUND_BY_LANGUAGE) }

  const figure = request.figure
  if (figure === undefined) return ok([linked])

  const folded = (owner: FormatDeclaration): FormatDeclaration => ({
    ...owner,
    // A filter needs the language that can say it (U8, D-260); a figure
    // without one leaves the owner's language as it was.
    // A pick by an order needs language 11 (M25 E3, D-272).
    language: Math.max(
      owner.language,
      figure.where === undefined ? 0 : isWiderFilter(figure.where) ? FILTER_TESTS_LANGUAGE : FILTER_LANGUAGE,
      figure.by === undefined ? 0 : LATEST_LANGUAGE,
    ),
    aggregates: [
      ...owner.aggregates,
      { ...figure, over: { format: from.name, column: request.column } },
    ],
  })

  if (from.name === target.name) return ok([folded(linked)])
  return ok(held === undefined || finding !== undefined ? [linked, folded(target)] : [folded(target)])
}
