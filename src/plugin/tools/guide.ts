/**
 * **`guide_status`** — the guide's list, from a conversation (M28 U9, S7, D-330).
 *
 * The app's *Guide me* moves a person between screens, which a conversation has
 * no use for; what it can use is the same list and what is done, so a model can
 * say "next is Plan" from the **same checks** the line on Home reads
 * (`guideRepository.ts`) — the two cannot disagree. It replaces
 * `onboarding_status` and `advance_onboarding`: there is no flow left to move,
 * and the guide adds no write of its own (choice b, A). Each step is done with
 * the tool its screen already has, which this answer names.
 */

import { guideFor, packsKeptBy } from '@/data/packs/packs.ts'
import { doneCount, firstOpen, stepState } from '@/domain/guide.ts'

import { readDocument, type OpenDocument } from '../document.ts'
import { paragraphs, section, table } from '../format.ts'
import { today } from '../today.ts'
import { PATH_PROP, requireString, type PluginTool } from './tool.ts'

/** The tools a conversation does each of the ledger's steps with. */
const DONE_WITH: Readonly<Record<string, string>> = {
  read: '`statement_preview` then `import_statement`; paychecks with `record_paychecks`',
  categories: '`category_tree`, then `create_category` and `edit_categories`',
  merchant: '`uncategorized_merchants` then `assign_category`',
  fixed: '`fixed_expense_candidates` then `track_fixed_expenses`',
  split: '`set_plan`',
  opening: '`set_opening_balances`',
  cushion: '`set_cushion`',
}

function renderGuide(document: OpenDocument): string {
  const guide = guideFor(packsKeptBy(document.db))
  if (guide === undefined) {
    return `${document.path} keeps no pack with a guide. The ledger has one; a document of declared formats does not yet.`
  }

  const { steps } = guide
  const checks = guide.checks(document.db, today())
  const done = doneCount(steps, checks)
  const next = done === steps.length ? undefined : steps[firstOpen(steps, checks)]

  return paragraphs(
    `${document.path}: ${String(done)} of ${String(steps.length)} places done.` +
      (next === undefined ? ' Every one is.' : ` Next: **${next.title}** (${next.where}).`),
    table(
      ['#', 'Place', 'Step', 'State', 'What the document has', 'Done with'],
      steps.map((step, index) => {
        const state = stepState(step, checks)
        return [
          String(index + 1),
          step.where,
          step.title,
          state.kind,
          state.kind === 'done'
            ? state.says
            : state.kind === 'later'
              ? `fills once ${state.until}`
              : `ticks itself when ${step.test}`,
          DONE_WITH[step.id] ?? '—',
        ]
      }),
    ),
    section(
      'How this works',
      'A step is done when the document shows it, never by a tool marking it so: there is nothing ' +
        'to advance. Do the step with the tool named, and call this again only to see what is left. ' +
        'Every step is optional.',
    ),
  )
}

export const guideStatusTool: PluginTool = {
  definition: {
    name: 'guide_status',
    title: 'Guide: what to set up, and what is done',
    description:
      'In a document that keeps the ledger: the places worth setting up, in order — reading statements and paychecks, ' +
      'making the list of categories yours, giving each merchant a category, the bills, the plan, the opening balance and the ' +
      'cushion — with which are done and what the document shows for each, and the tool that does ' +
      'each one. The same list and the same checks as the app’s Guide me. Call it after ' +
      'create_document, or when the user asks what is left to set up. Reads the document; changes ' +
      'nothing.',
    inputSchema: {
      type: 'object',
      properties: { path: PATH_PROP },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  run: async (args) => readDocument(requireString(args, 'path'), renderGuide),
}
