import { useState } from 'react'

import {
  keepPack,
  keptParts,
  PACKS,
  planKeep,
  planParts,
  upToDate,
  type KeepPlan,
  type PackDescription,
  type PlaceKind,
} from '@/data/packs/packs.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Button } from '@/ui/components/Button.tsx'
import { useKeptPacks } from '@/ui/packs.ts'

/**
 * **Which packs this document keeps** — M20 U0 (D-227), per document since M25
 * U8.
 *
 * Until U8 this was a switch that hid the ledger from the rail on this machine
 * (D-228). The ledger has been per document since D-266 — a document keeps it
 * by declaring its formats — so what is left to do here is add a pack to a
 * document that does not keep it. There is no removing one from here: its
 * formats are the document's, and a person who wants them gone deletes them
 * where every format is deleted.
 *
 * **Every pack is listed** (M27 U7), each with whether this document keeps it,
 * and **every pack has the button** (M38 U7, D-405): *Keep this pack here*, the
 * one write `keepPack`, which `keep_packs` and `create_document` share. Under
 * it, what keeping it does to formats the document already holds of it —
 * completes the ones that are the pack's, and refuses, naming the column, the
 * ones that only share a name — and the button is not offered over a clash.
 * **A kept pack a newer build changed** is offered again, *Bring it up to
 * date*, with the same phrases `keep_packs` says (`planParts`, D-491): the
 * columns it grew or renamed, its formats' notes and its views' settings — and,
 * under it, what this document chose that keeping it leaves (`keptParts`).
 *
 * `accent` marks what you can act on and colours no figure (D-125); there are
 * none here, and the buttons are the actions.
 */
const PLACE_LABEL: Record<PlaceKind, string> = { roadmap: 'Roadmap', board: 'Boards', ready: 'Ready to start' }

/** The ledger's places are hand-drawn in `ui/nav.ts`, from before a pack could declare a view. */
const LEDGER_PLACES = 'Home · Transactions · Paychecks · Plan · Wealth · Categories'

export function Packs() {
  const kept = useKeptPacks()
  const db = useDocumentStore((state) => state.db)
  const mutate = useDocumentStore((state) => state.mutate)
  const [problem, setProblem] = useState<{ readonly pack: string; readonly text: string } | undefined>(undefined)

  const keep = (pack: PackDescription): void => {
    setProblem(undefined)
    try {
      mutate((db) => {
        const kept = keepPack(db, pack, Date.now())
        if (!kept.ok) throw new Error(kept.error)
      })
    } catch (error) {
      setProblem({ pack: pack.id, text: error instanceof Error ? error.message : String(error) })
    }
  }

  return (
    <div className="fc-view-enter h-full overflow-auto px-6 py-4">
      <p className="mb-4 max-w-prose text-caption text-ink-secondary">
        A pack is a set of formats and the screens for one kind of work. A document keeps the packs
        it uses: their tables are in the file, and so is everything you put in them.
      </p>

      {PACKS.map((pack, index) => {
        // Read with `kept`, which moves on every mutation.
        const planned = db === undefined ? undefined : planKeep(db, pack)
        const plan = planned?.ok === true ? planned.value : undefined
        const places =
          pack.id === 'ledger'
            ? LEDGER_PLACES
            : [...new Set([...pack.places().map((place) => PLACE_LABEL[place.kind]), 'Formats'])].join(' · ')
        // A kept pack is offered again when this build's has grown or renamed
        // a column since the document kept it (D-443).
        const behind = plan !== undefined && kept.has(pack.id) && !upToDate(plan)
        const offered = plan !== undefined && (behind || (!kept.has(pack.id) && plan.clashes.length === 0))
        return (
          <section
            key={pack.id}
            aria-label={pack.title}
            className={`${index > 0 ? 'mt-4 ' : ''}max-w-prose rounded-lg border border-hairline-strong bg-elevated p-4`}
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-medium">{pack.title}</span>
              <span className="text-caption text-ink-tertiary">{places}</span>
              {offered && (
                <span className="ml-auto">
                  <Button variant="primary" size="sm" onClick={() => keep(pack)}>
                    {behind ? 'Bring it up to date' : 'Keep this pack here'}
                  </Button>
                </span>
              )}
            </div>
            <p className="mt-3 max-w-prose text-caption text-ink-secondary">
              {pack.summary}{' '}
              {kept.has(pack.id) ? (
                <span className="text-ink">
                  This document keeps it
                  {behind && plan !== undefined ? <>, as an older build declared it: {catchingUp(plan)}</> : '.'}
                </span>
              ) : (
                <WhatKeepingDoes pack={pack} plan={plan} />
              )}
            </p>
            {plan !== undefined && keptParts(plan).length > 0 && (
              <p className="mt-2 max-w-prose text-caption text-ink-tertiary">
                Kept as this document has it, over what the pack says: {keptParts(plan).join('; ')}.
              </p>
            )}
            {planned?.ok === false && <p className="mt-2 text-negative">{planned.error}</p>}
            {plan !== undefined && !kept.has(pack.id) && plan.clashes.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-caption text-negative">
                {plan.clashes.map((clash) => (
                  <li key={clash}>{clash}</li>
                ))}
              </ul>
            )}
            {problem?.pack === pack.id && <p className="mt-2 text-negative">{problem.text}</p>}
          </section>
        )
      })}

      <p className="mt-4 max-w-prose text-caption text-ink-tertiary">
        The engine underneath them — the formats you declare, their rows, their units and their
        claims — is not a pack, and every document has it.
      </p>
    </div>
  )
}

/** What bringing a kept pack up to date does, in a sentence's second half — `keep_packs`' own phrases. */
function catchingUp(plan: KeepPlan): string {
  return `bringing it up to date ${planParts(plan, false).join('; ')}.`
}

/** The sentence under a pack the document does not keep: what pressing the button would do. */

function WhatKeepingDoes({ pack, plan }: { readonly pack: PackDescription; readonly plan: KeepPlan | undefined }) {
  if (plan === undefined) return <>No document is open.</>
  const total = pack.formats().size
  const held = [
    ...new Set([...plan.holds, ...plan.completes.map((each) => each.format), ...plan.renames.map((each) => each.format)]),
  ].sort()
  if (plan.clashes.length > 0) {
    return (
      <>
        This document declares formats of the same names that are not the pack’s, so it cannot keep it
        until they are renamed or removed:
      </>
    )
  }
  if (held.length === 0) {
    return pack.id === 'ledger' ? (
      <>This document keeps none; keeping it declares its formats and starts its setup.</>
    ) : (
      <>This document keeps none; keeping it declares its {total} formats.</>
    )
  }
  const completing = [
    ...plan.renames.map((each) => `${each.format} by renaming ${each.from} to ${each.to}, its values kept`),
    ...plan.completes.map((each) => `${each.format} with ${each.columns.join(', ')}`),
  ]
  // Notes and view settings an earlier build of the pack wrote (D-491), in `keep_packs`' words.
  const bringing = planParts({ ...plan, declares: [], renames: [], completes: [] }, false)
  return (
    <>
      This document declares {held.length} of its {total} formats ({held.join(', ')}), so it is not shown: a
      pack is kept whole. Keeping it declares the other {plan.declares.length}
      {completing.length > 0 ? <> and completes {completing.join('; ')}</> : null}
      {bringing.length > 0 ? <>, and {bringing.join('; ')}</> : null}; what those formats hold stays as it
      is.
    </>
  )
}
