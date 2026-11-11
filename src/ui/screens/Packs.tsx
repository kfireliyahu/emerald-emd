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
import type { MessageKey } from '@/i18n/catalogue.ts'
import { currentLanguage, useT, type Translate } from '@/i18n/current.ts'
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
 * and **every pack has the button** (M38 U7, D-405): *Keep this pack here* (since M54 F6 *Keep the ledger here*, naming its pack), the
 * one write `keepPack`, which `keep_packs` and `create_document` share. Under
 * it, what keeping it does to formats the document already holds of it —
 * completes the ones that are the pack's, and refuses, naming the column, the
 * ones that only share a name — and the button is not offered over a clash.
 * **A kept pack a newer build changed** is offered again, *Bring it up to
 * date*, with the same phrases `keep_packs` says (`planParts`, D-491): the
 * columns it grew or renamed, its formats' and columns' notes and its views' settings — and,
 * under it, what this document chose that keeping it leaves (`keptParts`).
 *
 * `accent` marks what you can act on and colours no figure (D-125); there are
 * none here, and the buttons are the actions.
 *
 * **One heading, one primary, and each button naming its pack** (M54 F6): the
 * first pack offered is the filled one and the rest are secondary, *Keep the
 * ledger here* rather than two alike; and the packs are sections between
 * hairlines, square and unboxed (No card borders by default).
 */
const PLACE_LABEL: Record<PlaceKind, MessageKey> = {
  roadmap: 'settings.packs.places.roadmap',
  board: 'settings.packs.places.board',
  ready: 'settings.packs.places.ready',
}

/** The ledger's places are hand-drawn in `ui/nav.ts`, from before a pack could declare a view. */
const LEDGER_PLACES: readonly MessageKey[] = ['rail.home', 'rail.transactions', 'rail.paychecks', 'rail.plan', 'rail.wealth', 'rail.categories']

/** The pack in a button's words: *the ledger*, *the development pack*. */
function packObject(pack: Pick<PackDescription, 'id' | 'title'>, t: Translate): string {
  const object = /^the /i.test(pack.title) ? pack.title.replace(/^The /, 'the ') : `the ${pack.title.toLowerCase()} pack`
  return t('settings.packs.object', { object, title: packWord(pack, 'titles', pack.title, t) })
}

/**
 * A pack's title or summary in the language now, by its id (M60 U5, D-590);
 * the pack's own words for one the catalogue does not name.
 */
function packWord(pack: Pick<PackDescription, 'id'>, part: 'titles' | 'summaries', own: string, t: Translate): string {
  const key = `settings.packs.${part}.${pack.id}`
  const found = t(key as MessageKey)
  return found === key ? own : found
}

export function Packs() {
  const t = useT()
  const kept = useKeptPacks()
  const db = useDocumentStore((state) => state.db)
  const mutate = useDocumentStore((state) => state.mutate)
  const [problem, setProblem] = useState<{ readonly pack: string; readonly text: string } | undefined>(undefined)

  const keep = (pack: PackDescription): void => {
    setProblem(undefined)
    try {
      mutate((db) => {
        const kept = keepPack(db, pack, Date.now(), currentLanguage())
        if (!kept.ok) throw new Error(kept.error)
      })
    } catch (error) {
      setProblem({ pack: pack.id, text: error instanceof Error ? error.message : String(error) })
    }
  }

  // The first pack offered is this screen's one primary (M54 F6).
  let primaryTaken = false

  return (
    <div className="fc-view-enter h-full overflow-auto px-6 py-4">
      <h1 className="m-0 text-title">{t('rail.packs')}</h1>
      <p className="mt-2 mb-4 max-w-prose text-ink-secondary">{t('settings.packs.lead')}</p>

      {PACKS.map((pack) => {
        // Read with `kept`, which moves on every mutation.
        const planned = db === undefined ? undefined : planKeep(db, pack)
        const plan = planned?.ok === true ? planned.value : undefined
        const places =
          pack.id === 'ledger'
            ? LEDGER_PLACES.map((place) => t(place)).join(' · ')
            : [...new Set([...pack.places().map((place) => t(PLACE_LABEL[place.kind])), t('rail.formats')])].join(' · ')
        // A kept pack is offered again when this build's has grown or renamed
        // a column since the document kept it (D-443).
        const behind = plan !== undefined && kept.has(pack.id) && !upToDate(plan)
        const offered = plan !== undefined && (behind || (!kept.has(pack.id) && plan.clashes.length === 0))
        const primary = offered && !primaryTaken
        if (offered) primaryTaken = true
        return (
          <section key={pack.id} aria-labelledby={`pack-${pack.id}`} className="max-w-prose border-t border-hairline py-4">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id={`pack-${pack.id}`} className="m-0 text-body font-medium">
                {packWord(pack, 'titles', pack.title, t)}
              </h2>
              <span className="text-caption text-ink-secondary">{places}</span>
              {offered && (
                <span className="ms-auto">
                  <Button variant={primary ? 'primary' : 'secondary'} size="sm" onClick={() => keep(pack)}>
                    {behind
                      ? t('settings.packs.bringUpToDate', { pack: packObject(pack, t) })
                      : t('settings.packs.keepHere', { pack: packObject(pack, t) })}
                  </Button>
                </span>
              )}
            </div>
            <p className="mt-3 max-w-prose text-caption text-ink-secondary">
              {packWord(pack, 'summaries', pack.summary, t)}{' '}
              {kept.has(pack.id) ? (
                <span className="text-ink">
                  {t('settings.packs.keeps')}
                  {/* What bringing it up to date does — `keep_packs`' own phrases, the pack's words. */}
                  {behind && plan !== undefined ? t('settings.packs.keepsOlder', { parts: planParts(plan, false).join('; ') }) : '.'}
                </span>
              ) : (
                <WhatKeepingDoes pack={pack} plan={plan} />
              )}
            </p>
            {plan !== undefined && keptParts(plan).length > 0 && (
              <p className="mt-2 max-w-prose text-caption text-ink-secondary">
                {t('settings.packs.keptOver', { parts: keptParts(plan).join('; ') })}
              </p>
            )}
            {planned?.ok === false && <p className="mt-2 text-negative">{planned.error}</p>}
            {plan !== undefined && !kept.has(pack.id) && plan.clashes.length > 0 && (
              <ul className="mt-2 list-disc ps-5 text-caption text-negative">
                {plan.clashes.map((clash) => (
                  <li key={clash}>{clash}</li>
                ))}
              </ul>
            )}
            {problem?.pack === pack.id && <p className="mt-2 text-negative">{problem.text}</p>}
          </section>
        )
      })}

      <p className="max-w-prose border-t border-hairline pt-4 text-caption text-ink-secondary">
        {t('settings.packs.engine')}
      </p>
    </div>
  )
}

/** The sentence under a pack the document does not keep: what pressing the button would do. */

function WhatKeepingDoes({ pack, plan }: { readonly pack: PackDescription; readonly plan: KeepPlan | undefined }) {
  const t = useT()
  if (plan === undefined) return <>{t('settings.packs.noDocument')}</>
  const total = pack.formats().size
  const held = [
    ...new Set([...plan.holds, ...plan.completes.map((each) => each.format), ...plan.renames.map((each) => each.format)]),
  ].sort()
  if (plan.clashes.length > 0) {
    return (
      <>{t('settings.packs.clashes')}</>
    )
  }
  if (held.length === 0) {
    return pack.id === 'ledger' ? (
      <>{t('settings.packs.noneLedger')}</>
    ) : (
      <>{t('settings.packs.none', { total })}</>
    )
  }
  const completing = [
    ...plan.renames.map((each) => t('settings.packs.renaming', { format: each.format, from: each.from, to: each.to })),
    ...plan.completes.map((each) => t('settings.packs.completing', { format: each.format, columns: each.columns.join(', ') })),
  ]
  // Notes and view settings an earlier build of the pack wrote (D-491), in `keep_packs`' words.
  const bringing = planParts({ ...plan, declares: [], renames: [], completes: [] }, false)
  return (
    <>
      {t('settings.packs.partly', {
        held: held.length,
        total,
        names: held.join(', '),
        other: plan.declares.length,
        completes: completing.length > 0 ? t('settings.packs.completes', { parts: completing.join('; ') }) : '',
        bringing: bringing.length > 0 ? t('settings.packs.bringing', { parts: bringing.join('; ') }) : '',
      })}
    </>
  )
}
