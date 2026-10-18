import { describe, expect, it } from 'vitest'

import { graphOf } from '@/domain/format/connections.ts'
import { column, DECLARATION_LANGUAGE, type FormatDeclaration } from '@/domain/format/declaration.ts'
import {
  anchorOf,
  BUBBLE_WIDTH,
  foldedInto,
  GROUP_HEIGHT,
  HEAD_HEIGHT,
  nearestPort,
  pathBetween,
  placeGraph,
  PORT_HEIGHT,
  sideOf,
} from '@/ui/formats/connectionLayout.ts'

/**
 * **The one piece of this screen a browser check could not catch** — M20 U5.
 *
 * The drop test is arithmetic, and the first version of it only answered for a
 * point within 28 pixels of an endpoint's dot or inside a bubble's head. A dot
 * sits on one edge of a bubble 236 pixels wide, so *drop a figure on the column
 * that gathers it* — the gesture the whole ordering problem is answered by —
 * silently did nothing wherever a person would actually aim. It took driving the
 * screen to find, which is exactly what a test is for.
 */
function format(name: string, columns: readonly ReturnType<typeof column>[]): FormatDeclaration {
  return {
    language: DECLARATION_LANGUAGE,
    name,
    title: name,
    notes: '',
    columns,
    identities: [],
    aggregates: [],
    nothingMustHold: true,
  }
}

const RECIPE = format('recipe', [column('servings', 'integer')])
const LINE = format('recipe_line', [
  column('recipe', 'link', { target: 'recipe' }),
  column('amount_g', 'real'),
])

const PLACEMENT = placeGraph(graphOf([RECIPE, LINE]))

describe('the two sides of a bubble', () => {
  it('puts what a format names on the right and what names it on the left', () => {
    expect(sideOf({ kind: 'COLUMN', format: 'recipe_line', column: 'recipe' })).toBe('RIGHT')
    expect(sideOf({ kind: 'NEW_LINK', format: 'recipe_line' })).toBe('RIGHT')
    expect(sideOf({ kind: 'ROW', format: 'recipe' })).toBe('LEFT')
    expect(sideOf({ kind: 'FIGURE', format: 'recipe', figure: 'total' })).toBe('LEFT')
    expect(sideOf({ kind: 'NEW_FIGURE', format: 'recipe' })).toBe('LEFT')
  })

  it('anchors each endpoint on its own edge of its own bubble', () => {
    const row = anchorOf(PLACEMENT, { kind: 'ROW', format: 'recipe' })
    const link = anchorOf(PLACEMENT, { kind: 'COLUMN', format: 'recipe_line', column: 'recipe' })
    const bubble = PLACEMENT.nodes.find((each) => each.node.name === 'recipe')
    expect(row?.x).toBe(bubble?.x)
    expect(link?.x).toBe(
      (PLACEMENT.nodes.find((each) => each.node.name === 'recipe_line')?.x ?? 0) + BUBBLE_WIDTH,
    )
  })

  it('draws the most composed format first, so a link runs one way', () => {
    const line = PLACEMENT.nodes.find((each) => each.node.name === 'recipe_line')
    const recipe = PLACEMENT.nodes.find((each) => each.node.name === 'recipe')
    expect(line?.x).toBeLessThan(recipe?.x ?? 0)
  })
})

describe('the drop test', () => {
  it('takes an endpoint by its dot', () => {
    const dot = anchorOf(PLACEMENT, { kind: 'NEW_FIGURE', format: 'recipe' })
    expect(dot).toBeDefined()
    if (dot === undefined) return
    expect(nearestPort(PLACEMENT, dot.x + 4, dot.y - 3)).toEqual({
      kind: 'NEW_FIGURE',
      format: 'recipe',
    })
  })

  it('takes a column anywhere along its row, not only at the dot', () => {
    const node = PLACEMENT.nodes.find((each) => each.node.name === 'recipe_line')
    expect(node).toBeDefined()
    if (node === undefined) return
    // Middle of the first port row — 118 pixels from the dot, which is where a
    // person aiming at the word `recipe` actually lands.
    const middle = { x: node.x + BUBBLE_WIDTH / 2, y: node.y + HEAD_HEIGHT + PORT_HEIGHT / 2 }
    expect(nearestPort(PLACEMENT, middle.x, middle.y)).toEqual({
      kind: 'COLUMN',
      format: 'recipe_line',
      column: 'recipe',
    })
  })

  it('takes the row port anywhere in the head', () => {
    const node = PLACEMENT.nodes.find((each) => each.node.name === 'recipe')
    expect(node).toBeDefined()
    if (node === undefined) return
    expect(nearestPort(PLACEMENT, node.x + BUBBLE_WIDTH - 10, node.y + 6)).toEqual({
      kind: 'ROW',
      format: 'recipe',
    })
  })

  it('answers nothing in the space between bubbles', () => {
    expect(nearestPort(PLACEMENT, PLACEMENT.width - 2, PLACEMENT.height - 2)).toBeUndefined()
  })
})

describe('the curve', () => {
  it('leaves each end outwards from its own edge', () => {
    const from = anchorOf(PLACEMENT, { kind: 'COLUMN', format: 'recipe_line', column: 'recipe' })
    const to = anchorOf(PLACEMENT, { kind: 'ROW', format: 'recipe' })
    expect(from).toBeDefined()
    expect(to).toBeDefined()
    if (from === undefined || to === undefined) return
    const path = pathBetween(from, to)
    expect(path.startsWith(`M ${from.x} ${from.y} C `)).toBe(true)
    expect(path.endsWith(`${to.x} ${to.y}`)).toBe(true)
  })
})

/**
 * **A canvas: a place a person left, and a pack folded** — M26 U4, D-291.
 */
describe('the canvas', () => {
  const NODES = graphOf([RECIPE, LINE])

  it('draws a moved bubble where it was left, and the rest by rank as before', () => {
    const moved = placeGraph(NODES, { places: [{ kind: 'FORMAT', name: 'recipe', x: -40, y: 900 }] })
    const recipe = moved.nodes.find((each) => each.node.name === 'recipe')
    expect(recipe?.x).toBe(-40)
    expect(recipe?.y).toBe(900)
    expect(anchorOf(moved, { kind: 'ROW', format: 'recipe' })).toMatchObject({ x: -40, y: 900 + HEAD_HEIGHT / 2 })
    const line = (placement: typeof moved) => placement.nodes.find((each) => each.node.name === 'recipe_line')
    expect(line(moved)).toMatchObject({ x: line(PLACEMENT)?.x, y: line(PLACEMENT)?.y })
  })

  const PANTRY = format('pantry', [column('item', 'link', { target: 'recipe_line' })])
  const packOf = new Map([
    ['recipe', 'kitchen'],
    ['recipe_line', 'kitchen'],
  ])
  const WITH_PACK = graphOf([RECIPE, LINE, PANTRY])

  it('folds a pack into one bubble, and runs a connection into it to its edge', () => {
    const folded = placeGraph(WITH_PACK, { packOf })
    expect(folded.nodes.map((each) => each.node.name)).toEqual(['pantry'])
    expect(folded.groups).toHaveLength(1)
    const group = folded.groups[0]
    expect(group).toMatchObject({ pack: 'kitchen', members: ['recipe', 'recipe_line'], open: false })
    expect(group?.height).toBe(GROUP_HEIGHT)
    expect(foldedInto(folded, 'recipe_line')).toBe(group)
    expect(anchorOf(folded, { kind: 'ROW', format: 'recipe_line' })).toMatchObject({
      x: group?.x,
      y: (group?.y ?? 0) + HEAD_HEIGHT / 2,
    })
    // Nothing inside a folded pack is a drop target.
    expect(nearestPort(folded, (group?.x ?? 0) + 10, (group?.y ?? 0) + 10)).toBeUndefined()
  })

  it('opens a pack from where its group stood, moving nothing else', () => {
    const at = { kind: 'PACK' as const, name: 'kitchen', x: 600, y: 400 }
    const folded = placeGraph(WITH_PACK, { packOf, places: [at] })
    const open = placeGraph(WITH_PACK, { packOf, places: [at], opened: new Set(['kitchen']) })
    expect(open.groups[0]?.open).toBe(true)
    const names = open.nodes.map((each) => each.node.name).sort()
    expect(names).toEqual(['pantry', 'recipe', 'recipe_line'])
    const pantry = (placement: typeof open) => placement.nodes.find((each) => each.node.name === 'pantry')
    expect(pantry(open)).toMatchObject({ x: pantry(folded)?.x, y: pantry(folded)?.y })
    const members = open.nodes.filter((each) => each.node.name !== 'pantry')
    expect(Math.min(...members.map((each) => each.x))).toBe(600)
    expect(Math.min(...members.map((each) => each.y))).toBe(400)
  })
})
