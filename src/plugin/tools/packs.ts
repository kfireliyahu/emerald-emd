/**
 * **Which packs a document keeps, from a conversation** — M38 U7 (D-405).
 *
 * 2026-10-06: every document the MCP created was a ledger document, and no
 * tool could enable a pack, so formats were declared by hand because the
 * development pack's were not reachable. `create_document` takes `packs` now,
 * and `keep_packs` is the Packs screen's *Keep this pack here* for a document
 * that exists. Both go through `keepPack` (`data/packs/packs.ts`), the one write
 * the screen's button runs, so a conversation and a person keep a pack the same
 * way — generic over `PACKS`, with no branch naming a pack.
 */

import {
  clashSentence,
  keepPack,
  keptParts,
  PACKS,
  packById,
  planKeep,
  planParts,
  upToDate,
  type KeepPlan,
  type PackDescription,
} from '@/data/packs/packs.ts'

import type { OpenDocument } from '../document.ts'
import { mutatingCall, type Mutation } from '../write.ts'
import { booleanProp, PATH_PROP, requireString, ToolInputError, type Args, type PluginTool } from './tool.ts'

/** The JSON Schema for a list of packs, by id, from the packs this build has. */
export function packsProp(description: string): Record<string, unknown> {
  return {
    type: 'array',
    items: { type: 'string', enum: PACKS.map((pack) => pack.id) },
    description: `${description} One of: ${PACKS.map((pack) => `\`${pack.id}\` (${pack.title.toLowerCase()})`).join(', ')}.`,
  }
}

/**
 * The packs a call names, in the order `PACKS` lists them — or `undefined` when
 * it names none at all. An id this build has no pack for is refused naming the
 * ones it has.
 */
export function packsArg(args: Args, name: string): readonly PackDescription[] | undefined {
  const value = args[name]
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.some((each) => typeof each !== 'string')) {
    throw new ToolInputError(`\`${name}\` must be a list of pack ids, e.g. ["development"].`)
  }
  const unknown = (value as string[]).filter((id) => packById(id) === undefined)
  if (unknown.length > 0) {
    throw new ToolInputError(
      `No pack called ${unknown.map((id) => `"${id}"`).join(', ')}. This build has ${PACKS.map((pack) => `"${pack.id}"`).join(', ')}.`,
    )
  }
  return PACKS.filter((pack) => (value as string[]).includes(pack.id))
}

// --- keep_packs ------------------------------------------------------------

type Planned = { readonly pack: PackDescription } & (
  | { readonly ok: true; readonly plan: KeepPlan }
  | { readonly ok: false; readonly error: string }
)

/** One pack's line in the dry run or the answer. */
function describePlan(planned: Planned, done: boolean): string {
  const title = planned.pack.title
  if (!planned.ok) return `- **${title}** — cannot be read: ${planned.error}`
  const { plan } = planned
  // What a person chose that a newer pack does not overwrite, said either way (D-491).
  const kept = keptParts(plan)
  const theirs = kept.length > 0 ? ` Kept as this document has it: ${kept.join('; ')}.` : ''
  if (upToDate(plan)) return `- **${title}** — this document keeps it already. Nothing to do.${theirs}`
  if (!plan.kept && plan.clashes.length > 0) return `- **${title}** — REFUSED. ${clashSentence(plan)}`
  // The Packs screen says the same phrases (`planParts`), so both halves show one plan.
  const parts = [
    ...planParts(plan, done),
    ...(plan.holds.length > 0 && !plan.kept
      ? [`leaves ${plan.holds.join(', ')} as ${plan.holds.length === 1 ? 'it is' : 'they are'}`]
      : []),
  ]
  const verb = plan.kept ? (done ? 'brought up to date' : 'bringing it up to date') : done ? 'kept' : 'keeping it'
  return `- **${title}** — ${verb}: ${parts.join('; ')}.${theirs}`
}

function keepPacksMutation(packs: readonly PackDescription[]): Mutation<readonly Planned[]> {
  return {
    // Whole or not at all, and nothing at all when every pack is kept already and up to date (D-443).
    refuses: (plans) =>
      plans.some((each) => !each.ok || each.plan.clashes.length > 0 && !each.plan.kept) ||
      plans.every((each) => each.ok && upToDate(each.plan)),
    plan: (document: OpenDocument) =>
      packs.map((pack): Planned => {
        const planned = planKeep(document.db, pack)
        return planned.ok ? { pack, ok: true, plan: planned.value } : { pack, ok: false, error: planned.error }
      }),
    describe: (plans) =>
      [
        plans.every((each) => each.ok && upToDate(each.plan))
          ? 'This document keeps every pack named already, as this build declares it; nothing would change.'
          : 'Keeping these packs in the document:',
        ...plans.map((each) => describePlan(each, false)),
      ].join('\n'),
    apply: (document, plans) => {
      if (plans.some((each) => !each.ok || each.plan.clashes.length > 0 && !each.plan.kept)) {
        return ['Nothing was written.', ...plans.map((each) => describePlan(each, false))].join('\n')
      }
      if (plans.every((each) => each.ok && upToDate(each.plan))) {
        return ['This document keeps every pack named already, as this build declares it. Nothing was written.', ...plans.map((each) => describePlan(each, true))].join('\n')
      }
      const now = Date.now()
      const lines: string[] = []
      for (const each of plans) {
        const kept = keepPack(document.db, each.pack, now)
        // Planned and refused nothing a moment ago, inside this transaction:
        // a failure now is the install's own and undoes the whole call.
        if (!kept.ok) throw new Error(kept.error)
        lines.push(describePlan({ pack: each.pack, ok: true, plan: kept.value }, true))
      }
      return ['Done.', ...lines, '', '`formats` lists what the document declares now.'].join('\n')
    },
  }
}

export const keepPacksTool: PluginTool = {
  definition: {
    name: 'keep_packs',
    title: 'Keep packs in a document',
    description:
      'Keep packs in an existing document (the Packs screen’s *Keep this pack here*): declares ' +
      'the pack’s formats it lacks, adds missing optional columns to those it holds, renames a ' +
      'column the pack renamed with its values, changes no row; a pack kept already is ' +
      'brought up to date this way, its formats’ notes and views’ settings too wherever the document still holds an ' +
      'earlier build’s — one a person changed is kept, and the dry run names it. Refused, naming the column, where a ' +
      'format of the same name is not the pack’s. Dry run until `commit: true`.',
    inputSchema: {
      type: 'object',
      properties: {
        path: PATH_PROP,
        packs: packsProp('The packs to keep, by id.'),
        commit: booleanProp('Keep them. Omit or false for the dry run.'),
      },
      required: ['path', 'packs'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  run: async (args) => {
    const path = requireString(args, 'path')
    const packs = packsArg(args, 'packs')
    if (packs === undefined || packs.length === 0) {
      throw new ToolInputError('`packs` is required: name at least one pack to keep, e.g. ["development"].')
    }
    return mutatingCall(path, args['commit'] === true, keepPacksMutation(packs))
  },
}
