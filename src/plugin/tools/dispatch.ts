/**
 * **Which ready units can run at once** — M51 U4 (D-486).
 *
 * A manager handing out five units checked by eye that four of them touched
 * one file, because a unit's `files` is prose and nothing could compare it.
 * So a unit carries its `paths` too — one repository path per line, a folder
 * ending in `/` — and `dispatch_plan` is the one answer dispatch needs: for a
 * list of unit refs (every ready unit when none is named), each unit's brief
 * with the decisions it names and the units it waits on, and **which of them
 * share a path and so cannot run at once**.
 *
 * - A unit whose paths share nothing with another listed, nor with a unit in
 *   progress, can run beside the others.
 * - Units joined by a shared path — directly or through a third — go one after
 *   another, in the order given; a unit in progress on one of their paths goes
 *   first, since it is running already.
 * - **A unit with no paths is unknown, never safe**: nothing says what it
 *   touches, so it is reported on its own rather than put beside anything.
 *
 * **The answer is only as good as the paths written at planning**, and it says
 * so every time: a path a unit turns out to touch and nobody wrote down is a
 * collision this cannot see. Rows written before M51 U4 have no paths and are
 * left as they are (no old document is carried forward); they come back unknown.
 *
 * **Shaped, and it takes a list** (D-095): it reads the development pack's
 * `unit` and `decision` rows and answers one question. It writes nothing.
 */

import { listRows } from '@/data/repositories/formatRowRepository.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { idsIn, type StoredRow } from '@/domain/format/row.ts'

import { readDocument, type OpenDocument } from '../document.ts'
import { paragraphs, plural, section, table } from '../format.ts'
import { resolve } from './formats.ts'
import { PATH_PROP, requireString, ToolInputError, type Args, type PluginTool } from './tool.ts'

/** At most this many units in one answer. */
const UNITS_MAX = 50

/** The states a unit is ready from, and the ones that no longer hold another up. */
const READY = 'planned'
const DONE: ReadonlySet<string> = new Set(['built', 'dropped'])
const RUNNING = 'in_progress'

/** Said on every answer, because it is the whole limit of what this can see. */
export const ONLY_AS_GOOD =
  'Overlap is only as good as the `paths` written at planning: a file a unit turns out to touch that ' +
  'nobody wrote down is a collision this cannot see. A unit with no paths is unknown, never safe.'

// --- paths ------------------------------------------------------------------------

/**
 * A `paths` cell into its paths: one per line, trimmed, `\` as `/`, a leading
 * `./` dropped, each once. **Lines, never a separator inside one** — a line
 * holding a comma or a space is kept whole and named in `odd`, because it is
 * more likely two paths written on one line than one path with a space in it.
 */
export function pathsOf(cell: unknown): { readonly paths: readonly string[]; readonly odd: readonly string[] } {
  if (typeof cell !== 'string') return { paths: [], odd: [] }
  const paths: string[] = []
  const odd: string[] = []
  for (const line of cell.split(/\r?\n/)) {
    const path = line.trim().replace(/\\/g, '/').replace(/^\.\//, '')
    if (path === '' || paths.includes(path)) continue
    paths.push(path)
    if (/[\s,]/.test(path)) odd.push(path)
  }
  return { paths, odd }
}

/**
 * What two paths share, or nothing: the path itself when they are one, the
 * folder when one is a folder holding the other. Compared without case, since
 * a Windows checkout is case-insensitive and `Catalog.ts` is `catalog.ts` there.
 */
export function sharedPath(a: string, b: string): string | undefined {
  const x = a.toLowerCase()
  const y = b.toLowerCase()
  if (x === y) return a
  const holds = (folder: string, path: string): boolean =>
    path.startsWith(folder.endsWith('/') ? folder : `${folder}/`)
  if (holds(x, y)) return a
  if (holds(y, x)) return b
  return undefined
}

/** Every path two units share, each once. */
function sharedPaths(a: readonly string[], b: readonly string[]): readonly string[] {
  const found: string[] = []
  for (const one of a) {
    for (const other of b) {
      const shared = sharedPath(one, other)
      if (shared !== undefined && !found.includes(shared)) found.push(shared)
    }
  }
  return found
}

// --- the plan, pure ------------------------------------------------------------------

/** One unit as the plan reads it. */
export interface DispatchUnit {
  readonly ref: string
  readonly paths: readonly string[]
  /** Already at work, so first in any sequence it is part of. */
  readonly running?: boolean
}

/** Two units that share paths. */
export interface Overlap {
  readonly a: string
  readonly b: string
  readonly paths: readonly string[]
}

export interface DispatchPlan {
  /** Ready units that share no path with any other, nor with one running. */
  readonly atOnce: readonly string[]
  /** Units joined by shared paths, each group one after another — a running unit first. */
  readonly sequences: readonly (readonly string[])[]
  /** Units with no paths: nothing says what they touch. */
  readonly unknown: readonly string[]
  /** Every pair that shares a path, in the order given. */
  readonly overlaps: readonly Overlap[]
}

/**
 * **The plan** for ready units, beside the units already running: pairs that
 * share a path, then the groups those pairs join (a group is one after another,
 * since a pair inside it collides), then what is left — alone, or unknown. A
 * running unit only joins a group; it is never dispatched itself.
 */
export function dispatchPlan(ready: readonly DispatchUnit[], running: readonly DispatchUnit[] = []): DispatchPlan {
  const unknown = ready.filter((unit) => unit.paths.length === 0).map((unit) => unit.ref)
  const known = [
    ...running.filter((unit) => unit.paths.length > 0).map((unit) => ({ ...unit, running: true })),
    ...ready.filter((unit) => unit.paths.length > 0).map((unit) => ({ ...unit, running: false })),
  ]

  const overlaps: Overlap[] = []
  const group = new Map(known.map((unit) => [unit.ref, unit.ref]))
  const root = (ref: string): string => {
    let at = ref
    while (group.get(at) !== at) at = group.get(at) ?? at
    return at
  }
  for (let i = 0; i < known.length; i += 1) {
    for (let j = i + 1; j < known.length; j += 1) {
      const a = known[i]
      const b = known[j]
      if (a === undefined || b === undefined || (a.running && b.running)) continue
      const paths = sharedPaths(a.paths, b.paths)
      if (paths.length === 0) continue
      overlaps.push({ a: a.ref, b: b.ref, paths })
      group.set(root(b.ref), root(a.ref))
    }
  }

  const members = new Map<string, string[]>()
  for (const unit of known) {
    const at = root(unit.ref)
    members.set(at, [...(members.get(at) ?? []), unit.ref])
  }
  const runningRefs = new Set(running.map((unit) => unit.ref))
  const atOnce: string[] = []
  const sequences: string[][] = []
  for (const refs of members.values()) {
    if (refs.length === 1) {
      const [only] = refs
      if (only !== undefined && !runningRefs.has(only)) atOnce.push(only)
      continue
    }
    sequences.push(refs)
  }
  return { atOnce, sequences, unknown, overlaps }
}

// --- reading the document ----------------------------------------------------------------

type UnitRow = StoredRow

function text(row: UnitRow | undefined, column: string): string | undefined {
  const value = row?.cells[column]
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function refsOf(args: Args): readonly string[] | undefined {
  const raw = args['units']
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || raw.length === 0) throw new ToolInputError('`units` must be a non-empty array of refs, or left out for every ready unit.')
  if (raw.length > UNITS_MAX) {
    throw new ToolInputError(`That is ${String(raw.length)} units; the ceiling is ${String(UNITS_MAX)} in one call.`)
  }
  const refs: string[] = []
  raw.forEach((ref: unknown, index) => {
    if (typeof ref !== 'string' || ref.trim() === '') throw new ToolInputError(`\`units[${String(index)}]\` must be a unit's ref.`)
    if (!refs.some((each) => each.toLowerCase() === ref.trim().toLowerCase())) refs.push(ref.trim())
  })
  return refs
}

/** `D-460` and the like, as a brief cites them, each once and in order. */
function decisionRefsIn(brief: string | undefined): readonly string[] {
  return [...new Set((brief ?? '').match(/\bD-\d{3,}\b/g) ?? [])]
}

function dispatchText(document: OpenDocument, asked: readonly string[] | undefined): string {
  const units = resolve(document, 'unit')
  if ('refusal' in units) {
    return 'This reads the development pack’s `unit` rows. Keep the pack in this document with `keep_packs` first.'
  }
  const decisions = resolve(document, 'decision')
  const decisionDeclaration: FormatDeclaration | undefined = 'refusal' in decisions ? undefined : decisions.declaration

  const rows: readonly UnitRow[] = listRows(document.db, units.declaration)
  const byId = new Map(rows.map((row) => [row.id, row]))
  const byRef = new Map(rows.map((row) => [(text(row, 'ref') ?? '').toLowerCase(), row]))
  const decisionRows: readonly UnitRow[] = decisionDeclaration === undefined ? [] : listRows(document.db, decisionDeclaration)
  const decisionById = new Map(decisionRows.map((row) => [row.id, row]))
  const decisionByRef = new Map(decisionRows.map((row) => [(text(row, 'ref') ?? '').toLowerCase(), row]))

  const stateOf = (row: UnitRow): string => text(row, 'state') ?? ''
  const openBlocks = (row: UnitRow): readonly string[] =>
    idsIn(row.cells['blocks']).filter((id) => {
      const blocker = byId.get(id)
      return blocker === undefined || !DONE.has(stateOf(blocker))
    })
  const isReady = (row: UnitRow): boolean => stateOf(row) === READY && openBlocks(row).length === 0
  const refOf = (row: UnitRow): string => text(row, 'ref') ?? row.id
  const nameOfUnit = (id: string): string => {
    const row = byId.get(id)
    return row === undefined ? `${id} (not there)` : `${refOf(row)} (${stateOf(row) || 'no state'})`
  }

  // The units asked about, or every ready one.
  const wanted: readonly UnitRow[] =
    asked === undefined ? rows.filter(isReady) : asked.flatMap((ref) => byRef.get(ref.toLowerCase()) ?? [])
  const missing = asked === undefined ? [] : asked.filter((ref) => !byRef.has(ref.toLowerCase()))
  if (wanted.length === 0 && missing.length === 0) return 'No unit is ready: none is `planned` with everything it waits on built or dropped.'

  const ready = wanted.filter(isReady)
  const notReady = wanted.filter((row) => !isReady(row))
  const readyIds = new Set(ready.map((row) => row.id))
  const running = rows.filter((row) => stateOf(row) === RUNNING && !readyIds.has(row.id))

  const unitOf = (row: UnitRow): DispatchUnit => ({ ref: refOf(row), paths: pathsOf(row.cells['paths']).paths })
  const plan = dispatchPlan(ready.map(unitOf), running.map(unitOf))
  const runningRefs = new Set(running.map(refOf))
  const titleOf = (ref: string): string => text(byRef.get(ref.toLowerCase()), 'title') ?? ''
  const shown = (ref: string): string => (runningRefs.has(ref) ? `**${ref}** (in progress)` : `**${ref}**`)

  const parts: string[] = [
    `${plural(wanted.length, 'unit')} asked about: ${plural(plan.atOnce.length, 'can', 'can')} run at once, ` +
      `${plural(plan.sequences.reduce((sum, refs) => sum + refs.filter((ref) => !runningRefs.has(ref)).length, 0), 'goes', 'go')} ` +
      `one after another, ${plural(plan.unknown.length, 'is', 'are')} unknown` +
      (notReady.length + missing.length > 0 ? `, ${plural(notReady.length + missing.length, 'is', 'are')} not ready.` : '.'),
  ]

  if (plan.atOnce.length > 0) {
    parts.push(
      section(
        'At once',
        'No path shared with another listed, nor with a unit in progress.\n\n' +
          plan.atOnce.map((ref) => `- **${ref}** — ${titleOf(ref)}`).join('\n'),
      ),
    )
  }
  if (plan.sequences.length > 0) {
    const pairs = plan.overlaps.map((each) => [each.a, each.b, each.paths.map((path) => `\`${path}\``).join(', ')])
    parts.push(
      section(
        'One after another',
        'These share a path, directly or through each other, so one at a time — in this order.\n\n' +
          plan.sequences.map((refs, index) => `${String(index + 1)}. ${refs.map(shown).join(' → ')}`).join('\n') +
          '\n\n' +
          table(['Unit', 'Unit', 'Shares'], pairs),
      ),
    )
  }
  if (plan.unknown.length > 0) {
    parts.push(
      section(
        'Unknown',
        'No `paths` written, so nothing says what they touch: never safe beside another.\n\n' +
          plan.unknown.map((ref) => `- **${ref}** — ${titleOf(ref)}`).join('\n'),
      ),
    )
  }
  if (notReady.length + missing.length > 0) {
    const lines = [
      ...notReady.map((row) => {
        const held = openBlocks(row)
        const why =
          stateOf(row) !== READY
            ? `it is ${stateOf(row) || 'without a state'}`
            : `it waits on ${held.map(nameOfUnit).join(', ')}`
        return `- **${refOf(row)}** — ${why}`
      }),
      ...missing.map((ref) => `- **${ref}** — no unit has this ref`),
    ]
    parts.push(section('Not ready', lines.join('\n')))
  }

  // Each ready unit, as a session handed it would start: the brief, what it waits on, the decisions it names.
  const each = ready.map((row) => {
    const { paths, odd } = pathsOf(row.cells['paths'])
    const blocks = idsIn(row.cells['blocks']).map(nameOfUnit)
    const decisionLines = [
      ...idsIn(row.cells['decision']).flatMap((id) => decisionById.get(id) ?? []),
      ...decisionRefsIn(text(row, 'brief')).flatMap((ref) => decisionByRef.get(ref.toLowerCase()) ?? []),
    ]
      .filter((decision, index, all) => all.indexOf(decision) === index)
      .map((decision) => `- ${text(decision, 'ref') ?? decision.id} — ${text(decision, 'title') ?? ''}`)
    return paragraphs(
      `### ${refOf(row)} — ${text(row, 'title') ?? ''}`,
      `**Paths:** ${paths.length === 0 ? 'none written — unknown' : paths.map((path) => `\`${path}\``).join(', ')}`,
      odd.length === 0 ? undefined : `A line holding a space or a comma reads as one path: ${odd.map((path) => `\`${path}\``).join(', ')}. One path per line.`,
      text(row, 'files') === undefined ? undefined : `**Files:** ${text(row, 'files') ?? ''}`,
      blocks.length === 0 ? undefined : `**Waits on:** ${blocks.join(', ')}`,
      decisionLines.length === 0 ? undefined : `**Decisions it names:**\n${decisionLines.join('\n')}`,
      text(row, 'brief') ?? 'No brief.',
    )
  })
  if (each.length > 0) parts.push(section('Each unit', each.join('\n\n')))

  parts.push(ONLY_AS_GOOD)
  return paragraphs(...parts)
}

export const dispatchPlanTool: PluginTool = {
  definition: {
    name: 'dispatch_plan',
    title: 'Dispatch plan',
    description:
      'In a document that keeps the `development` pack, before handing units out: for unit refs (every ready unit if left out), which can run at once and which ' +
      'share a path in their `paths` — one per line — and so go one after another, beside any unit in progress; a ' +
      'unit with no paths is unknown, never safe. Then each one’s brief, the units it waits on and the decisions ' +
      'it names. Read-only.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        units: {
          type: 'array',
          description: `Refs, up to ${String(UNITS_MAX)}. Omit for every ready unit.`,
          items: { type: 'string' },
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const asked = refsOf(args)
    return readDocument(path, (document) => dispatchText(document, asked))
  },
}
