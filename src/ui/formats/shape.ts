import type { ColumnType, FormatDeclaration } from '@/domain/format/declaration.ts'
import {
  columnIsBlank,
  headIsBlank,
  newColumn,
  newDerived,
  retype,
  type DraftProblem,
  type FormatDraft,
} from '@/domain/format/draft.ts'

/**
 * What the shape panel is open on: one column, what has to add up, or — when a
 * header was moved with the panel shut — the order (M29 U2, D-332), which asks
 * nothing and only says what the move does. Not a column's card: that takes
 * the cursor, and a column moved with the arrows wants it kept on its grip.
 */
export type ShapeFocus =
  | { readonly kind: 'COLUMN'; readonly key: string; readonly chosen: boolean }
  | { readonly kind: 'ADDS_UP' }
  | { readonly kind: 'ORDER' }
  /** A derived column, by its draft's key (M29 U3b, D-334). */
  | { readonly kind: 'DERIVED'; readonly key: string }

/** The panel's draft and what it is open on — changed together or not at all. */
export interface Shape {
  readonly draft: FormatDraft
  readonly focus: ShapeFocus
}

/**
 * Pressing a type tile, or pressing *Change* on the type already chosen.
 *
 * **One transition, not two** (M26 F3). It was a draft change followed by a
 * focus change, and the screen applied each to the state it had rendered —
 * so the second put back the draft the first had just retyped, and every type
 * picked snapped back to `text`. The draft and the focus come back as one
 * value so there is nothing for the second half to overwrite.
 */
export function chooseType(shape: Shape, type: ColumnType): Shape {
  const { draft, focus } = shape
  if (focus.kind !== 'COLUMN') return shape
  const column = draft.columns.find((each) => each.key === focus.key)
  if (column === undefined) return shape
  // *Change* hands back the type already chosen: it reopens the tiles and
  // keeps the type, so pressing it and walking away loses nothing.
  if (focus.chosen && type === column.type) return { draft, focus: { ...focus, chosen: false } }
  return {
    draft: {
      ...draft,
      columns: draft.columns.map((each) => (each.key === column.key ? retype(column, type) : each)),
    },
    focus: { ...focus, chosen: true },
  }
}

/**
 * **The column under the cursor, worked out instead of typed** (M29 U3b,
 * D-334): it leaves the stored columns and becomes a derived one with the name
 * already given, and the panel moves to what it works out. Only a column the
 * format does not hold yet — one that exists has entries typed into it, and
 * those are not thrown away by a tile.
 */
export function deriveInstead(shape: Shape, origin: ReadonlyMap<string, string>): Shape {
  const { draft, focus } = shape
  if (focus.kind !== 'COLUMN' || origin.has(focus.key)) return shape
  const column = draft.columns.find((each) => each.key === focus.key)
  if (column === undefined) return shape
  const derived = { ...newDerived(), name: column.name }
  return {
    draft: {
      ...draft,
      columns: draft.columns.filter((each) => each.key !== column.key),
      derived: [...(draft.derived ?? []), derived],
    },
    focus: { kind: 'DERIVED', key: derived.key },
  }
}

/** A new derived column at the end, with the panel on it. */
export function addDerived(draft: FormatDraft): Shape {
  const derived = newDerived()
  return { draft: { ...draft, derived: [...(draft.derived ?? []), derived] }, focus: { kind: 'DERIVED', key: derived.key } }
}

/**
 * **Where the editor opens on a format that does not exist yet** (M29 U1,
 * D-331). An empty one opens on its first column with the type tiles up; one
 * that came through a door with its columns filled in opens on its first
 * column — what has to add up is not a question it waits on any more (M29 F4,
 * D-345). A draft with no column at all is handed one, because the panel is
 * the only place a column is added before the sheet has a header to press.
 */
export function openingShape(draft: FormatDraft): Shape {
  const unnamed = draft.columns.find((each) => each.name.trim() === '')
  if (unnamed !== undefined) {
    return { draft, focus: { kind: 'COLUMN', key: unnamed.key, chosen: !columnIsBlank(unnamed) } }
  }
  const first = draft.columns[0]
  if (first !== undefined) return { draft, focus: { kind: 'COLUMN', key: first.key, chosen: true } }
  const column = newColumn()
  return {
    draft: { ...draft, columns: [column] },
    focus: { kind: 'COLUMN', key: column.key, chosen: false },
  }
}

/** A format being made: the problems worth drawing, and what Create still waits on. */
export interface Creation {
  readonly shown: readonly DraftProblem[]
  readonly waiting: readonly string[]
}

/**
 * **What a format still being made waits on, said rather than drawn red**
 * (M29 U1, D-331).
 *
 * The walk kept these quiet by asking them one step at a time; the editor asks
 * everything on one screen, so the two refusals nobody has caused yet — no
 * name, no column — would open it in `negative`. They are withheld from the
 * red list and named as what Create is waiting for, the same `columnIsBlank`
 * reasoning applied to the format's own questions. What has to add up was a
 * third until M29 F4 (D-345): a format with no identity is one where nothing
 * has to, and Create does not wait for anybody to say so. `draft` is the one
 * the problems were judged on (pruned).
 */
export function creationOf(draft: FormatDraft, problems: readonly DraftProblem[]): Creation {
  const unnamed = headIsBlank(draft)
  const columnless = draft.columns.length === 0
  const shown = problems.filter((each) => {
    if (each.where.kind !== 'FORMAT') return true
    const about = each.where.about
    if (unnamed && (about === 'TITLE' || about === 'NAME')) return false
    if (columnless && about === 'COLUMNS') return false
    return true
  })
  return {
    shown,
    waiting: [...(unnamed ? ['what one of them is called'] : []), ...(columnless ? ['a column'] : [])],
  }
}

/**
 * **The sheet drawn in the order being saved** (M29 U2, D-332). While a
 * format's shape is changed its sheet still draws the stored columns — the
 * entries hold values under those names — but in the draft's order, so a
 * header dragged stays where it was dropped before Save. A column the draft
 * removes keeps its place among its neighbours until Save takes it.
 */
export function inDraftOrder(
  declaration: FormatDeclaration,
  draft: FormatDraft,
  origin: ReadonlyMap<string, string>,
): FormatDeclaration {
  const rank = new Map<string, number>()
  draft.columns.forEach((each, index) => {
    const was = origin.get(each.key)
    if (was !== undefined) rank.set(was, index)
  })
  const columns = declaration.columns
    .filter((each) => rank.has(each.name))
    .sort((a, b) => (rank.get(a.name) ?? 0) - (rank.get(b.name) ?? 0))
  declaration.columns.forEach((each, index) => {
    if (!rank.has(each.name)) columns.splice(Math.min(index, columns.length), 0, each)
  })
  return columns.every((each, index) => each === declaration.columns[index])
    ? declaration
    : { ...declaration, columns }
}

/**
 * **The one header the panel underneath is about** (M29 F4, D-345).
 *
 * From making a format: *"only highlight the selected column that is
 * being added so he knows the dialog at the bottom is of a column."* So the
 * sheet marks one header and no other: the column the panel is open on, by
 * the name the sheet draws it under (`drawn`, its key's name on the sheet —
 * the stored name while a format is changed, the typed one while it is made),
 * or a header of its own (`NEW`) for one the sheet does not draw yet, named as
 * far as it has been typed. What has to add up and the order mark nothing.
 */
export type SheetMark =
  | { readonly kind: 'COLUMN'; readonly name: string }
  | { readonly kind: 'DERIVED'; readonly name: string }
  /** `key` is the draft's, so the header keeps one motion key while its name is typed (M39 F1). */
  | { readonly kind: 'NEW'; readonly name: string; readonly key?: string }

export function sheetMark(
  shape: Shape,
  drawn: ReadonlyMap<string, string>,
  sheet: FormatDeclaration,
): SheetMark | undefined {
  const { draft, focus } = shape
  if (focus.kind === 'COLUMN') {
    const name = drawn.get(focus.key)
    if (name !== undefined && sheet.columns.some((each) => each.name === name)) return { kind: 'COLUMN', name }
    const column = draft.columns.find((each) => each.key === focus.key)
    return column === undefined ? undefined : { kind: 'NEW', name: column.name.trim(), key: column.key }
  }
  if (focus.kind === 'DERIVED') {
    const derived = draft.derived?.find((each) => each.key === focus.key)
    if (derived === undefined) return undefined
    const name = derived.name.trim()
    return (sheet.derived ?? []).some((each) => each.name === name)
      ? { kind: 'DERIVED', name }
      : { kind: 'NEW', name, key: derived.key }
  }
  return undefined
}
