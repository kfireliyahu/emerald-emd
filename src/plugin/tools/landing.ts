/**
 * **Landing a unit is one call** — M47 U3 (D-460).
 *
 * A week on three documents counted the writes: 302 of 346 carried one row,
 * each a turn at full context, and most of them were the closing pass — the
 * unit to `built` with `landed` and `files`, a decision row or two, review
 * entries, now and then the milestone. The claim at the start was another.
 * So the development pack's two moments get a tool each:
 *
 * - `claim_units` — planned to `in_progress`, with `taken_by` and `started`,
 *   each refused unless it is still planned, for a list of refs.
 * - `land_units` — for a list of units, their decisions, the units themselves,
 *   their review entries and the milestones they close, **as one batch**: the
 *   steps run in order inside one transaction, and the whole landing applies
 *   or none of it does.
 *
 * **Where a unit was worked, in git's words** — M51 U2 (D-484). A claim may
 * name the `branch` it is taken on and a landing the `commit` that carries
 * the work, so the memory says who is where without depending on any host's
 * session API. A landing that names its branch is refused when the unit was
 * claimed on another, unless it says `other_branch: true`: a manager landing a
 * child's unit from the wrong checkout is the mistake this catches.
 *
 * **A child proposes, its manager lands** — M51 U3 (D-485). A session run for
 * a manager lands nothing itself: it writes one `inbox` row, `state: new`,
 * whose `refs` name its unit and whose `body` holds one fenced `json` block in
 * the shape of one of `units` here (no `close_milestone`, the maintainer's word;
 * no `other_branch`, the manager's). `land_units inbox:[ids]` reads each,
 * lands them all as one dry run and one commit, and moves each row to
 * `applied` with the unit it became and the decision it carried. A row that
 * is not a proposal, or not `new`, refuses the batch by its id and subject.
 * By id is safe here, though a text document derives ids from a row's
 * content (D-247): a proposal is never edited after it is written.
 *
 * **A stalled claim is taken over, and a landing names its commit and
 * carries its report** — M51 F4. A session interrupted mid-unit left its unit
 * `in_progress`, and `claim_units` could not take it, so a driver hand-edited
 * `taken_by`: `take_over` names whose claim this replaces, is refused unless
 * the unit is `in_progress` under that taker, resets `started` and keeps the
 * one it replaced on `taken_over_from`. Two units landed with no `commit`,
 * because a landing in the same commit as the work cannot name itself: a
 * landing without one is refused unless it says `same_commit: true`. And the
 * host cuts a child's note to its driver short, so a landing takes the child's
 * `report` and keeps it on the unit, one `format_rows` call away.
 *
 * **Shaped, never a general batch** (D-095). What it writes is four named
 * formats in a fixed order with the columns it names; a batch of mixed writes
 * to any format was the rejected alternative, because it is a general query by
 * another name.
 *
 * **No new write, and no second copy of one.** Each step is
 * `record_format_rows` or `update_format_rows`'s own mutation, judged by the
 * same plan and refused for the same reasons, so parity (D-227) is met by the
 * sheet already and `src/parity.test.ts` lists these as compositions. A step
 * that links to a row an earlier step writes — the unit naming the decision it
 * made — is judged by writing the earlier step first, rehearsed and taken back
 * in the dry run (`rehearse`, D-395), which is exactly what the commit does.
 */

import { rehearse } from '@/data/db/database.ts'
import { listRows, readRow } from '@/data/repositories/formatRowRepository.ts'
import { toISODate } from '@/core/time.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'

import type { OpenDocument } from '../document.ts'
import { paragraphs, plural, section, table } from '../format.ts'
import { today } from '../today.ts'
import { mutatingCall, type Mutation } from '../write.ts'
import { recordMutation, resolveWritable, updateMutation } from './formats.ts'
import {
  booleanProp,
  PATH_PROP,
  requireString,
  stringProp,
  ToolInputError,
  type Args,
  type PluginTool,
} from './tool.ts'

/** At most this many units in one landing or one claim. */
const UNITS_MAX = 50

/** The longest closing report a landing keeps — a report, not a transcript. */
export const REPORT_MAX = 4000

/** Where a document without the development pack is sent. */
const NO_PACK =
  'These tools write the development pack’s formats — `unit`, `decision`, `review_entry`, ' +
  '`milestone`. Keep the pack in this document with `keep_packs` first.'

// --- reading the arguments ----------------------------------------------------

interface Landing {
  readonly unit: string
  readonly landed: string | undefined
  readonly files: string | undefined
  readonly decision: string | undefined
  readonly decisions: readonly Record<string, unknown>[]
  readonly reviewEntries: readonly Record<string, unknown>[]
  readonly closeMilestone: string | undefined
  /** The branch the landing is made from; checked against the claim's. */
  readonly branch: string | undefined
  /** The commit that carries the unit's work. */
  readonly commit: string | undefined
  /** Land it although it was claimed on another branch. */
  readonly otherBranch: boolean
  /** The work goes in the same commit as this landing, so it names none. */
  readonly sameCommit: boolean
  /** The closing report of the session that built it. */
  readonly report: string | undefined
}

/** A git commit as a person or a tool prints it: 7 to 40 hex digits. */
const COMMIT = /^[0-9a-f]{7,40}$/i

function objectsOf(raw: unknown, field: string): readonly Record<string, unknown>[] {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) throw new ToolInputError(`\`${field}\` must be an array of row objects.`)
  return raw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new ToolInputError(`\`${field}[${String(index)}]\` must be an object.`)
    }
    return entry as Record<string, unknown>
  })
}

function textOf(entry: Record<string, unknown>, key: string, field: string): string | undefined {
  const value = entry[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolInputError(`\`${field}.${key}\` must be non-empty text.`)
  }
  return value.trim()
}

function listOf(args: Args, field: string): readonly unknown[] {
  const raw = args[field]
  if (!Array.isArray(raw) || raw.length === 0) throw new ToolInputError(`\`${field}\` must be a non-empty array.`)
  if (raw.length > UNITS_MAX) {
    throw new ToolInputError(`That is ${String(raw.length)} units; the ceiling is ${String(UNITS_MAX)} in one call.`)
  }
  return raw
}

function commitOf(entry: Record<string, unknown>, field: string): string | undefined {
  const commit = textOf(entry, 'commit', field)
  if (commit !== undefined && !COMMIT.test(commit)) {
    throw new ToolInputError(
      `\`${field}.commit\` is a git commit — 7 to 40 hex digits, as \`git rev-parse --short HEAD\` prints it — not \`${commit}\`.`,
    )
  }
  return commit
}

function flagOf(entry: Record<string, unknown>, key: string, field: string): boolean {
  const value = entry[key]
  if (value === undefined || value === null) return false
  if (typeof value !== 'boolean') throw new ToolInputError(`\`${field}.${key}\` must be true or false.`)
  return value
}

function otherBranchOf(entry: Record<string, unknown>, field: string): boolean {
  return flagOf(entry, 'other_branch', field)
}

function reportOf(entry: Record<string, unknown>, field: string): string | undefined {
  const report = textOf(entry, 'report', field)
  if (report !== undefined && report.length > REPORT_MAX) {
    throw new ToolInputError(
      `\`${field}.report\` is ${String(report.length)} characters, and a report is at most ${String(REPORT_MAX)}: ` +
        'what landed, what is left, what was found — not the transcript.',
    )
  }
  return report
}

const LANDING_KEYS = new Set([
  'unit',
  'landed',
  'files',
  'decision',
  'decisions',
  'review_entries',
  'close_milestone',
  'branch',
  'commit',
  'same_commit',
  'other_branch',
  'report',
])

/**
 * What a child may propose (M51 U3): a landing without `close_milestone`, which
 * is the maintainer's word and never a session's, and without `other_branch`, which
 * is the manager's to say when it lands the proposal.
 */
const PROPOSAL_KEYS: ReadonlySet<string> = new Set(
  [...LANDING_KEYS].filter((key) => key !== 'close_milestone' && key !== 'other_branch'),
)

/** One landing, from an object a caller or a child wrote; throws `ToolInputError`. */
function landingOf(raw: unknown, field: string, keys: ReadonlySet<string>): Landing {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ToolInputError(`\`${field}\` must be an object.`)
  }
  const entry = raw as Record<string, unknown>
  // A key this tool has not got refuses rather than being dropped, as a row's does.
  const unknown = Object.keys(entry).filter((key) => !keys.has(key))
  if (unknown.length > 0) {
    throw new ToolInputError(
      `\`${field}\` has ${unknown.map((key) => `\`${key}\``).join(', ')}, which a landing has not got. ` +
        `It takes ${[...keys].map((key) => `\`${key}\``).join(', ')}.`,
    )
  }
  const unit = textOf(entry, 'unit', field)
  if (unit === undefined) throw new ToolInputError(`\`${field}.unit\` is the unit's ref — \`M47 U3\`.`)
  const commit = commitOf(entry, field)
  const sameCommit = flagOf(entry, 'same_commit', field)
  if (commit !== undefined && sameCommit) {
    throw new ToolInputError(`\`${field}\` names a \`commit\` and says \`same_commit: true\`; it is one or the other.`)
  }
  return {
    unit,
    landed: textOf(entry, 'landed', field),
    files: textOf(entry, 'files', field),
    decision: textOf(entry, 'decision', field),
    decisions: objectsOf(entry['decisions'], `${field}.decisions`),
    reviewEntries: objectsOf(entry['review_entries'], `${field}.review_entries`),
    closeMilestone: textOf(entry, 'close_milestone', field),
    branch: textOf(entry, 'branch', field),
    commit,
    otherBranch: otherBranchOf(entry, field),
    sameCommit,
    report: reportOf(entry, field),
  }
}

/** The `units` a caller wrote out — none when it lands only proposals. */
function landingsOf(args: Args): readonly Landing[] {
  if (args['units'] === undefined) return []
  const landings = listOf(args, 'units').map((raw, index) => landingOf(raw, `units[${String(index)}]`, LANDING_KEYS))
  const seen = new Set<string>()
  for (const landing of landings) {
    const key = landing.unit.toLowerCase()
    if (seen.has(key)) throw new ToolInputError(`${landing.unit} is named twice; land a unit once.`)
    seen.add(key)
  }
  return landings
}

// --- a child's proposal, as an inbox row (M51 U3) ----------------------------------

/** An inbox row to land, by id, and whether the manager lands it off the claim's branch. */
interface ProposalRef {
  readonly id: string
  readonly otherBranch: boolean
}

function proposalRefsOf(args: Args): readonly ProposalRef[] {
  const raw = args['inbox']
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length === 0) throw new ToolInputError('`inbox` must be a non-empty array of inbox row ids.')
  if (raw.length > UNITS_MAX) {
    throw new ToolInputError(`That is ${String(raw.length)} proposals; the ceiling is ${String(UNITS_MAX)} in one call.`)
  }
  const refs = raw.map((entry: unknown, index): ProposalRef => {
    const field = `inbox[${String(index)}]`
    if (typeof entry === 'string' && entry.trim() !== '') return { id: entry.trim(), otherBranch: false }
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
      const object = entry as Record<string, unknown>
      const extra = Object.keys(object).filter((key) => key !== 'id' && key !== 'other_branch')
      if (extra.length > 0) {
        throw new ToolInputError(
          `\`${field}\` has ${extra.map((key) => `\`${key}\``).join(', ')}. A proposal lands as its child wrote it, ` +
            'so it takes only `id` and `other_branch`.',
        )
      }
      const id = textOf(object, 'id', field)
      if (id === undefined) throw new ToolInputError(`\`${field}.id\` is the inbox row's id, as \`format_rows\` prints it.`)
      return { id, otherBranch: otherBranchOf(object, field) }
    }
    throw new ToolInputError(`\`${field}\` is an inbox row's id, or \`{id, other_branch}\`.`)
  })
  const seen = new Set<string>()
  for (const ref of refs) {
    if (seen.has(ref.id)) throw new ToolInputError(`Inbox row ${ref.id} is named twice; land a proposal once.`)
    seen.add(ref.id)
  }
  return refs
}

/** A ```json (or ```landing) block in a row's body. */
const FENCE = /```[^\S\n]*(?:json|landing)[^\S\n]*\r?\n([\s\S]*?)\r?\n[^\S\n]*```/gi

/**
 * The landing an inbox row's body proposes: the one fenced `json` block in it,
 * or the whole body when it is nothing but the object. Throws `ToolInputError`
 * saying what is wrong, which the caller names the row with.
 */
export function proposalOf(body: string | undefined): Landing {
  const text = (body ?? '').trim()
  const blocks = [...text.matchAll(FENCE)].map((match) => match[1] ?? '')
  if (blocks.length > 1) {
    throw new ToolInputError(`Its body has ${String(blocks.length)} \`json\` blocks, and a proposal is one.`)
  }
  const source = blocks[0] ?? (text.startsWith('{') ? text : undefined)
  if (source === undefined) {
    throw new ToolInputError('Its body has no ```json block holding a landing, so it is not a proposal.')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch (error) {
    throw new ToolInputError(`Its landing is not JSON: ${error instanceof Error ? error.message : String(error)}.`)
  }
  return landingOf(parsed, 'proposal', PROPOSAL_KEYS)
}

/** A proposal read from its row, and the row it moves to applied. */
interface Proposal {
  readonly id: string
  readonly landing: Landing
}

/**
 * The inbox rows named, read as landings — and each that could not be,
 * refused by its id and subject, so a malformed one names itself rather than
 * being dropped.
 */
function proposalsIn(
  document: OpenDocument,
  refs: readonly ProposalRef[],
): { readonly blocked?: string; readonly proposals: readonly Proposal[]; readonly refusals: readonly string[][] } {
  if (refs.length === 0) return { proposals: [], refusals: [] }
  const inbox = resolveWritable(document, 'inbox')
  if ('refusal' in inbox) return { blocked: paragraphs(inbox.refusal, NO_PACK), proposals: [], refusals: [] }
  const proposals: Proposal[] = []
  const refusals: string[][] = []
  for (const ref of refs) {
    const row = readRow(document.db, inbox.declaration, ref.id)
    if (row === undefined) {
      refusals.push([`inbox ${ref.id}`, 'No `inbox` row has this id; `format_rows inbox match:{state:new}` prints them.'])
      continue
    }
    const named = `inbox ${ref.id} (${textCell(row, 'subject') ?? 'no subject'})`
    const state = textCell(row, 'state')
    if (state !== 'new') {
      refusals.push([named, `It is already ${state ?? 'without a state'}, and a proposal lands once.`])
      continue
    }
    let landing: Landing
    try {
      landing = proposalOf(textCell(row, 'body'))
    } catch (error) {
      if (!(error instanceof ToolInputError)) throw error
      refusals.push([named, error.message])
      continue
    }
    const said = textCell(row, 'refs')
    if (said !== undefined && !said.toLowerCase().includes(landing.unit.toLowerCase())) {
      refusals.push([named, `Its \`refs\` say \`${said}\`, and its landing is ${landing.unit}.`])
      continue
    }
    proposals.push({ id: ref.id, landing: { ...landing, otherBranch: ref.otherBranch } })
  }
  return { proposals, refusals }
}

// --- the steps ------------------------------------------------------------------

/** One step's plan, on the document as it stands when it is asked. */
interface Planned {
  readonly refused: boolean
  readonly said: string
  readonly apply: () => string
}

/** One format's write: `record_format_rows` or `update_format_rows`'s own mutation. */
interface Step {
  readonly heading: string
  readonly rows: number
  readonly run: (document: OpenDocument) => Planned
}

function stepOf<T>(heading: string, rows: number, mutation: Mutation<T>): Step {
  return {
    heading,
    rows,
    run: (document) => {
      const plan = mutation.plan(document)
      return {
        refused: mutation.refuses?.(plan) === true,
        said: mutation.describe(plan),
        apply: () => mutation.apply(document, plan),
      }
    },
  }
}

interface StepsPlan {
  /** A refusal before any step: a unit that is not there, or already landed. */
  readonly blocked: string | undefined
  readonly steps: readonly Step[]
  /** Each step's diff, in order, up to and including one that refused. */
  readonly said: readonly { readonly heading: string; readonly text: string }[]
  readonly refusedAt: string | undefined
}

/** A text cell of a row, or nothing. */
function textCell(row: { readonly cells: Readonly<Record<string, unknown>> }, column: string): string | undefined {
  const value = row.cells[column]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** The one row of a format whose `ref` is this, or why not. */
function byRef(document: OpenDocument, declaration: FormatDeclaration, ref: string) {
  const rows = listRows(document.db, declaration, { match: new Map([['ref', ref]]), limit: 2 })
  return rows.length === 1 ? rows[0] : undefined
}

/**
 * Run the steps in order, each judged on the document the steps before it
 * left — rehearsed and taken back, so a dry run writes nothing (D-395).
 */
function rehearsed(document: OpenDocument, steps: readonly Step[]): Omit<StepsPlan, 'blocked' | 'steps'> {
  return rehearse(document.db, () => {
    const said: { heading: string; text: string }[] = []
    for (const step of steps) {
      const planned = step.run(document)
      said.push({ heading: step.heading, text: planned.said })
      if (planned.refused) return { said, refusedAt: step.heading }
      planned.apply()
    }
    return { said, refusedAt: undefined }
  })
}

/** The composed mutation: plan by rehearsal, apply step by step. */
function stepsMutation(what: string, build: (document: OpenDocument) => { blocked?: string; steps: readonly Step[] }): Mutation<StepsPlan> {
  const refuses = (plan: StepsPlan): boolean => plan.blocked !== undefined || plan.refusedAt !== undefined
  const describe = (plan: StepsPlan): string => {
    if (plan.blocked !== undefined) return plan.blocked
    const body = plan.said.map((each) => section(each.heading, each.text))
    if (plan.refusedAt !== undefined) {
      return paragraphs(
        `**Nothing was written.** The ${plan.refusedAt} step refused, and ${what} applies whole or not at all. ` +
          'What the steps before it would have written is shown too, as it was judged.',
        ...body,
      )
    }
    return paragraphs(...body)
  }
  return {
    refuses,
    copyBefore: (plan) => {
      const rows = plan.steps.reduce((sum, step) => sum + step.rows, 0)
      return { what, rows }
    },
    plan: (document) => {
      const built = build(document)
      if (built.blocked !== undefined) return { blocked: built.blocked, steps: [], said: [], refusedAt: undefined }
      return { blocked: undefined, steps: built.steps, ...rehearsed(document, built.steps) }
    },
    describe,
    apply: (document, plan) => {
      if (refuses(plan)) return describe(plan)
      const done = plan.steps.map((step) => {
        const planned = step.run(document)
        // Unreachable while the rehearsal just above, in this same transaction,
        // passed — and if it is reached, throwing rolls the whole landing back.
        if (planned.refused) throw new Error(`The ${step.heading} step refused at commit: ${planned.said}`)
        return section(step.heading, planned.apply())
      })
      return paragraphs(...done)
    },
  }
}

// --- land_units -------------------------------------------------------------------

function landingSteps(
  document: OpenDocument,
  written: readonly Landing[],
  proposed: readonly ProposalRef[],
): { blocked?: string; steps: readonly Step[] } {
  const unitFormat = resolveWritable(document, 'unit')
  if ('refusal' in unitFormat) return { blocked: paragraphs(unitFormat.refusal, NO_PACK), steps: [] }
  const milestoneFormat = resolveWritable(document, 'milestone')
  const milestones = 'refusal' in milestoneFormat ? undefined : milestoneFormat.declaration

  const read = proposalsIn(document, proposed)
  if (read.blocked !== undefined) return { blocked: read.blocked, steps: [] }
  const refusals: string[][] = [...read.refusals]
  const landings = [...written, ...read.proposals.map((each) => each.landing)]
  const seen = new Set<string>()
  for (const landing of landings) {
    const key = landing.unit.toLowerCase()
    if (seen.has(key)) refusals.push([landing.unit, 'It is named twice, and a unit lands once.'])
    seen.add(key)
  }

  const decisions: Record<string, unknown>[] = []
  const edits: Record<string, unknown>[] = []
  const entries: Record<string, unknown>[] = []
  const closing = new Map<string, string>()
  /** Each unit's ref as its row has it and the decision it names, for the inbox row it answers. */
  const landedAs = new Map<string, { readonly ref: string; readonly decision: string | undefined }>()

  for (const landing of landings) {
    const row = byRef(document, unitFormat.declaration, landing.unit)
    if (row === undefined) {
      refusals.push([landing.unit, 'No `unit` row has this ref.'])
      continue
    }
    const state = textCell(row, 'state')
    if (state === 'built' || state === 'dropped') {
      refusals.push([landing.unit, `It is already ${state}.`])
      continue
    }
    const claimed = textCell(row, 'branch')
    if (claimed !== undefined && landing.branch !== undefined && claimed !== landing.branch && !landing.otherBranch) {
      refusals.push([
        landing.unit,
        `It was claimed on \`${claimed}\` and this landing is on \`${landing.branch}\`. ` +
          'Land it from that branch, or say `other_branch: true` to land it here.',
      ])
      continue
    }
    if (landing.commit === undefined && !landing.sameCommit) {
      refusals.push([
        landing.unit,
        'It names no `commit`. Commit the work first and land with its hash — then commit the landing — ' +
          'or say `same_commit: true` when the work goes in the same commit as this landing.',
      ])
      continue
    }
    const ref = textCell(row, 'ref') ?? landing.unit
    const landed = landing.landed ?? toISODate(today())
    // A decision row's milestone and scope are its unit's, unless it says otherwise.
    const linked = textCell(row, 'milestone')
    const milestoneRow = milestones === undefined || linked === undefined ? undefined : readRow(document.db, milestones, linked)
    const milestone = milestoneRow === undefined ? ref.split(/\s+/)[0] : textCell(milestoneRow, 'ref')
    const scope = textCell(row, 'scope')

    for (const decision of landing.decisions) {
      decisions.push({ date: landed, milestone, scope, state: 'live', ...decision })
    }
    const named = landing.decision ?? landing.decisions.map((each) => each['ref']).find((each) => typeof each === 'string')
    landedAs.set(landing.unit.toLowerCase(), { ref, decision: typeof named === 'string' ? named : undefined })
    edits.push({
      where: { ref },
      values: {
        state: 'built',
        landed,
        ...(landing.files === undefined ? {} : { files: landing.files }),
        ...(named === undefined ? {} : { decision: named }),
        ...(landing.branch === undefined ? {} : { branch: landing.branch }),
        ...(landing.commit === undefined ? {} : { commit: landing.commit }),
        ...(landing.report === undefined ? {} : { report: landing.report }),
      },
    })
    for (const entry of landing.reviewEntries) entries.push({ unit: ref, state: 'open', ...entry })
    if (landing.closeMilestone !== undefined) closing.set(landing.closeMilestone.toLowerCase(), landing.closeMilestone)
  }

  if (refusals.length > 0) {
    return {
      blocked: paragraphs(
        `**Nothing was written.** ${plural(refusals.length, 'unit was', 'units were')} refused, and a landing applies whole or not at all.`,
        table(['Unit', 'Why'], refusals),
      ),
      steps: [],
    }
  }

  // In this order because each may name what the one before wrote: the unit its
  // decision, the review entry its unit.
  const steps: Step[] = []
  if (decisions.length > 0) steps.push(stepOf('decision', decisions.length, recordMutation('decision', decisions)))
  steps.push(stepOf('unit', edits.length, updateMutation('unit', edits)))
  if (entries.length > 0) steps.push(stepOf('review_entry', entries.length, recordMutation('review_entry', entries)))
  if (closing.size > 0) {
    const closes = [...closing.values()].map((ref) => ({ where: { ref }, expect: { state: 'open' }, values: { state: 'closed' } }))
    steps.push(stepOf('milestone', closes.length, updateMutation('milestone', closes)))
  }
  // Last, because it names what the steps before it wrote: each proposal goes
  // applied with the unit it became and the decision it carried, and only from
  // `new` — of two managers landing one proposal, the second is refused.
  if (read.proposals.length > 0) {
    const applied = read.proposals.map(({ id, landing }) => {
      const became = landedAs.get(landing.unit.toLowerCase())
      return {
        id,
        expect: { state: 'new' },
        values: {
          state: 'applied',
          became_unit: became?.ref ?? landing.unit,
          ...(became?.decision === undefined ? {} : { answered_by: became.decision }),
        },
      }
    })
    steps.push(stepOf('inbox', applied.length, updateMutation('inbox', applied)))
  }
  return { steps }
}

export const landUnitsTool: PluginTool = {
  definition: {
    name: 'land_units',
    title: 'Land units',
    description:
      'A unit’s closing pass in one call, for a list of units by `ref`: their new `decisions` ' +
      '(date, milestone, scope and `state: live` default to the unit’s), the unit to `built` with ' +
      '`landed` (default today), `files` and `decision` (default its first new one), its ' +
      '`review_entries` (`state: open` default), `close_milestone`, its git `commit` (refused without ' +
      'one unless `same_commit: true`) and `branch` (another than the claim’s refused unless ' +
      '`other_branch`), and the `report` of the session that built it. Or `inbox`: ids of a child’s ' +
      'proposals — an inbox row, `state: new`, `refs` its unit, its `body` one ```json block of ' +
      'one unit’s landing (no `close_milestone`), written to the document path the hooks printed ' +
      '— each landed as written and moved to `applied`. Each step is `record_format_rows` or ' +
      '`update_format_rows`, judged as they are, run in that order; all of it applies or none. ' +
      'Diff by format; writes nothing until `commit: true`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        units: {
          type: 'array',
          description: `Up to ${String(UNITS_MAX)}.`,
          items: {
            type: 'object',
            properties: {
              unit: stringProp('The unit’s ref.'),
              landed: stringProp('`YYYY-MM-DD`; today if left out.'),
              files: stringProp('What it touched.'),
              decision: stringProp('An existing decision’s ref.'),
              decisions: {
                type: 'array',
                description: '`decision` rows.',
                items: { type: 'object', additionalProperties: true },
              },
              review_entries: {
                type: 'array',
                description: '`review_entry` rows.',
                items: { type: 'object', additionalProperties: true },
              },
              close_milestone: stringProp('A milestone’s ref, `open` to `closed`.'),
              commit: stringProp('The git commit carrying its work.'),
              same_commit: booleanProp('The work is in the same commit as this landing.'),
              branch: stringProp('The git branch it lands from.'),
              other_branch: booleanProp('Land it although claimed on another branch.'),
              report: stringProp(`Its builder’s closing report, plain text, up to ${String(REPORT_MAX)} characters.`),
            },
            required: ['unit'],
            additionalProperties: false,
          },
        },
        inbox: {
          type: 'array',
          description: 'Inbox row ids of landing proposals, or `{id, other_branch}`.',
          items: {},
        },
        commit: booleanProp('Write it. Omit or false for the dry run.'),
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const landings = landingsOf(args)
    const proposed = proposalRefsOf(args)
    if (landings.length === 0 && proposed.length === 0) {
      throw new ToolInputError('Name what to land: `units`, the inbox rows that propose them in `inbox`, or both.')
    }
    const what = [
      ...landings.map((each) => each.unit),
      ...(proposed.length === 0 ? [] : [plural(proposed.length, 'inbox proposal', 'inbox proposals')]),
    ].join(', ')
    return mutatingCall(
      path,
      args['commit'] === true,
      stepsMutation(`landing ${what}`, (document) => landingSteps(document, landings, proposed)),
    )
  },
}

// --- claim_units ------------------------------------------------------------------

/**
 * **A take-over** (M51 F4): each unit `in_progress` under the taker named, to
 * the new one with `started` reset, the one it replaced added to
 * `taken_over_from` with the day they took it. Refused whole, by unit, when one
 * is not there, not `in_progress`, or held by someone else — and each edit
 * still `expect`s what was read, so two drivers taking over one unit cannot
 * both get it.
 */
function takeOverSteps(
  document: OpenDocument,
  refs: readonly string[],
  from: string,
  values: Readonly<Record<string, unknown>>,
): { blocked?: string; steps: readonly Step[] } {
  const unitFormat = resolveWritable(document, 'unit')
  if ('refusal' in unitFormat) return { blocked: paragraphs(unitFormat.refusal, NO_PACK), steps: [] }
  const refusals: string[][] = []
  const edits: Record<string, unknown>[] = []
  for (const ref of refs) {
    const row = byRef(document, unitFormat.declaration, ref)
    if (row === undefined) {
      refusals.push([ref, 'No `unit` row has this ref.'])
      continue
    }
    const state = textCell(row, 'state')
    if (state !== 'in_progress') {
      refusals.push([
        ref,
        `It is ${state ?? 'without a state'}, and a take-over is of a unit in_progress` +
          (state === 'planned' ? ' — claim it without `take_over`.' : '.'),
      ])
      continue
    }
    const holder = textCell(row, 'taken_by')
    if (holder?.toLowerCase() !== from.toLowerCase()) {
      refusals.push([ref, `It is held by \`${holder ?? 'nobody'}\`, not \`${from}\`; name whose claim this replaces.`])
      continue
    }
    const since = textCell(row, 'started')
    const before = textCell(row, 'taken_over_from')
    const replaced = since === undefined ? holder : `${holder} (${since})`
    edits.push({
      where: { ref: textCell(row, 'ref') ?? ref },
      expect: { state: 'in_progress', taken_by: holder },
      values: { ...values, taken_over_from: before === undefined ? replaced : `${before}; ${replaced}` },
    })
  }
  if (refusals.length > 0) {
    return {
      blocked: paragraphs(
        `**Nothing was written.** ${plural(refusals.length, 'unit was', 'units were')} refused, and a take-over applies whole or not at all.`,
        table(['Unit', 'Why'], refusals),
      ),
      steps: [],
    }
  }
  return { steps: [stepOf('unit', edits.length, updateMutation('unit', edits))] }
}

export const claimUnitsTool: PluginTool = {
  definition: {
    name: 'claim_units',
    title: 'Claim units',
    description:
      'Take units by `ref`: `planned` to `in_progress` with `taken_by`, the git `branch` they are ' +
      'taken on and `started` (default today), the batch refused unless every one is still planned. ' +
      'With `take_over`, take units already `in_progress` from that taker — a session that stopped ' +
      'mid-unit — refused unless each is held by exactly that taker; `started` is reset and the taker ' +
      'replaced is kept on `taken_over_from`. Writes nothing until `commit: true`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        units: {
          type: 'array',
          description: `Refs, up to ${String(UNITS_MAX)}.`,
          items: { type: 'string' },
        },
        taken_by: stringProp('Who takes them: the host’s name for its session.'),
        branch: stringProp('The git branch they are taken on.'),
        started: stringProp('`YYYY-MM-DD`; today if left out.'),
        take_over: stringProp('The `taken_by` whose claim this replaces, for units already in progress.'),
        commit: booleanProp('Write it. Omit or false for the dry run.'),
      },
      required: ['path', 'units', 'taken_by'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const takenBy = requireString(args, 'taken_by')
    const started = args['started'] === undefined ? toISODate(today()) : requireString(args, 'started')
    const branch = args['branch'] === undefined ? undefined : requireString(args, 'branch').trim()
    const takeOver = args['take_over'] === undefined ? undefined : requireString(args, 'take_over').trim()
    const refs = listOf(args, 'units').map((ref, index) => {
      if (typeof ref !== 'string' || ref.trim() === '') throw new ToolInputError(`\`units[${String(index)}]\` must be a unit's ref.`)
      return ref.trim()
    })
    const values = { state: 'in_progress', taken_by: takenBy, started, ...(branch === undefined ? {} : { branch }) }
    if (takeOver !== undefined) {
      return mutatingCall(
        path,
        args['commit'] === true,
        stepsMutation(`taking over ${refs.join(', ')}`, (document) => takeOverSteps(document, refs, takeOver, values)),
      )
    }
    const edits = refs.map((ref) => ({ where: { ref }, expect: { state: 'planned' }, values }))
    // One format, one step: `update_format_rows`'s own mutation, as it is.
    return mutatingCall(path, args['commit'] === true, updateMutation('unit', edits))
  },
}
