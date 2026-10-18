import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { adoptFormat, listFormats, planFor } from '@/data/repositories/formatRepository.ts'
import { applyFoundLink, planFoundLink } from '@/data/repositories/formatRuleRepository.ts'
import { listUnits } from '@/data/repositories/unitRepository.ts'
import {
  clearGraphPlaces,
  graphPlaces,
  setGraphPlaces,
} from '@/data/repositories/formatViewRepository.ts'
import {
  edgesOf,
  edgeWords,
  graphOf,
  NEW_FIGURE_WORDS,
  NEW_LINK_WORDS,
  proposalFor,
  type Edge,
  type Port,
  type Proposal,
} from '@/domain/format/connections.ts'
import { sourceText } from '@/domain/format/aggregate.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { declarationOf, draftProblems, type FormatDraft } from '@/domain/format/draft.ts'
import type { FindPlan } from '@/domain/format/foundBy.ts'
import { declarationChangeRefusal, rowWriteRefusal } from '@/domain/format/owner.ts'
import type { ReconcilePlan } from '@/domain/format/reconcile.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { FIELD } from '@/ui/components/fieldLook.ts'
import { ConnectionGraph } from '@/ui/formats/ConnectionGraph.tsx'
import { ConnectionPanel } from '@/ui/formats/ConnectionPanel.tsx'
import { FORMATS_PATH, formatPath } from '@/ui/nav.ts'

/**
 * **Connections — the graph across formats.** M20 U5,
 * [D-233](../../docs/09-decision-log.md).
 *
 * The third arrow of the spec has a place now: *read a document / talk with a
 * model → format → **make connections to other formats***. Each format is a
 * bubble, its columns are endpoints around it, and a connection is a drag from
 * one endpoint to another.
 *
 * ## Why this is a screen and not two sections of the editor
 *
 * A `link` and an aggregate are facts about **two** formats, and the editor can
 * only see one. That is not an aesthetic complaint: the aggregate section had
 * to tell a person *"nothing points at this format yet — declare that one
 * first, then come back"*, which is the ordering problem printed on the screen
 * as an apology. Here both bubbles are already on the surface, so the gesture
 * that needs a link and a figure writes both, and there is no *create this one
 * first* to get wrong.
 *
 * ## The list beside the graph is not a fallback
 *
 * `docs/11` pairs every chart with its numbers, and this is that rule on a
 * graph: every connection is also a row, in words, that opens the same dialog.
 * Take the picture away and nothing is lost — which is also what makes the
 * screen reachable by a keyboard and checkable by a session.
 *
 * ## Where a bubble is, is the document's
 *
 * Since M26 U4 (D-291) the graph is a canvas: pan, zoom, and a bubble moved by
 * its grip stays where it was left — in `format_graph_place`, beside the
 * declarations, so the arrangement travels with the file and a second window
 * sees it (D-115 rules out the browser). A pack's formats are one bubble until
 * opened (D-269); which packs are open is this visit's and nobody else's.
 *
 * ## Nothing here is a new kind of thing
 *
 * Every save goes through `adoptFormat` on an ordinary `FormatDeclaration`, and
 * the dry run shown before it is `planFor`. So a conversation reading this
 * document back sees columns and aggregates, not connections — there is nothing
 * else for it to see (M20's parity rule, D-232's argument).
 */
export function Connections() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)

  const [armed, setArmed] = useState<Port | undefined>(undefined)
  const [open, setOpen] = useState<Opened | undefined>(undefined)
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set())
  /** The format a search went to: its pack opened, and the view brought to it. */
  const [found, setFound] = useState<{ readonly name: string; readonly at: number } | undefined>(undefined)
  const [query, setQuery] = useState('')

  const data = useMemo(() => {
    if (db === undefined) return undefined
    const declarations = listFormats(db)
    return {
      declarations,
      nodes: graphOf(declarations),
      edges: edgesOf(declarations),
      units: listUnits(db),
      places: graphPlaces(db),
      packOf: new Map(
        declarations.flatMap((each) =>
          each.owner === undefined ? [] : [[each.name, each.owner.pack] as const],
        ),
      ),
    }
    // `revision` is the dependency that matters: every mutation bumps it, so a
    // connection made below redraws the graph without anything here saying so.
  }, [db, revision])

  if (db === undefined || data === undefined) {
    return <Centered>Open a document to see the connections between its formats.</Centered>
  }

  if (data.declarations.length === 0) {
    return (
      <Centered>
        This document declares no formats yet. A connection is between two of them, so{' '}
        <Link to={FORMATS_PATH} className="text-accent">
          declare one
        </Link>{' '}
        first.
      </Centered>
    )
  }

  /**
   * The problems and the dry run for what the panel is holding.
   *
   * **The same two answers the editor gets.** `draftProblems` is asked with the
   * *other* formats as this document would be once every draft in hand is
   * saved, which is what lets a figure over a link that does not exist yet be
   * judged honestly in the one gesture that writes both.
   */
  const judge = (
    drafts: readonly FormatDraft[],
  ): { problems: readonly string[]; plans: readonly ReconcilePlan[] } => {
    const merged = data.declarations.map((declaration) => {
      const draft = drafts.find((each) => each.revising === declaration.name)
      return draft === undefined ? declaration : declarationOf(draft)
    })
    const problems = drafts.flatMap((draft) =>
      draftProblems(
        draft,
        merged.filter((each) => each.name !== draft.revising),
        data.units,
      ).map((problem) => problem.message),
    )
    // A link or a figure added to a pack's format is a person's own column
    // (D-269); asked against the format as it is, which `merged` no longer holds.
    for (const draft of drafts) {
      const before = data.declarations.find((each) => each.name === draft.revising)
      const owned = before === undefined ? undefined : declarationChangeRefusal(before, declarationOf(draft))
      if (owned !== undefined) problems.push(owned)
    }
    return {
      problems,
      // A plan against a declaration nobody would accept describes a table
      // nobody has described, so it is not asked for until the draft is clean.
      plans: problems.length > 0 ? [] : drafts.map((draft) => planFor(db, declarationOf(draft))),
    }
  }

  /**
   * What filling a found link's empty cells would do (M29 F11, D-353) — none on
   * a pack's format, whose rows the pack writes (D-269), and none when the
   * link is not found by a date.
   */
  const findPlan = (format: string, column: string): FindPlan | undefined => {
    const declaration = data.declarations.find((each) => each.name === format)
    if (declaration === undefined || rowWriteRefusal(declaration) !== undefined) return undefined
    const plan = planFoundLink(db, declaration, column, data.declarations)
    return typeof plan === 'string' ? undefined : plan
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-hairline px-6 py-2">
        <span className="text-ink-secondary tabular-nums">
          {data.edges.length === 1 ? '1 connection' : `${data.edges.length} connections`}
        </span>
        <span className="max-w-prose text-caption text-ink-tertiary">
          Drag <em>{NEW_LINK_WORDS}</em> from one format onto another — or press one and then the
          other. Nothing is written until you say so.
        </span>
        <span className="ml-auto flex items-baseline gap-3 text-caption">
          <FindFormat
            declarations={data.declarations}
            query={query}
            onQuery={setQuery}
            onFind={(name) => {
              const pack = data.packOf.get(name)
              if (pack !== undefined) setOpened((now) => new Set([...now, pack]))
              setFound({ name, at: Date.now() })
            }}
          />
          {[...opened].sort().map((pack) => (
            <button
              key={pack}
              type="button"
              className="text-accent"
              onClick={() =>
                setOpened((now) => new Set([...now].filter((each) => each !== pack)))
              }
            >
              Fold <Bidi>{pack}</Bidi>
            </button>
          ))}
          {data.places.length > 0 && (
            <button
              type="button"
              className="text-accent"
              title="Forget where every bubble was moved, and lay them out by what names what"
              onClick={() => mutate((database) => clearGraphPlaces(database))}
            >
              Arrange
            </button>
          )}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 min-w-0 flex-1">
          <ConnectionGraph
            nodes={data.nodes}
            edges={data.edges}
            armed={armed}
            onArm={setArmed}
            onConnect={(from, to) =>
              setOpen({ proposal: proposalFor(from, to, data.declarations), existing: undefined })
            }
            onOpen={(edge) => {
              setArmed(undefined)
              setOpen({ proposal: proposalOf(edge), existing: edge })
            }}
            packOf={data.packOf}
            opened={opened}
            onOpenPack={(pack) => setOpened((now) => new Set([...now, pack]))}
            found={found}
            places={data.places}
            onPlace={(places) => mutate((database) => setGraphPlaces(database, places))}
            focus={open === undefined ? undefined : focusOf(open.proposal)}
          />
        </div>

        <aside className="w-72 shrink-0 overflow-auto border-l border-hairline px-4 py-3">
          <h2 className="mb-2 text-caption text-ink-secondary">Every connection, in words</h2>
          {data.edges.length === 0 ? (
            <p className="text-caption text-ink-tertiary">
              None yet. The two accented ports on each format — <em>{NEW_LINK_WORDS}</em> and{' '}
              <em>{NEW_FIGURE_WORDS}</em> — are where one starts.
            </p>
          ) : (
            <ul className="space-y-1">
              {data.edges.map((edge) => {
                const said = edgeWords(edge, data.declarations)
                return (
                <li key={keyOf(edge)}>
                  <button
                    type="button"
                    onClick={() => {
                      setArmed(undefined)
                      setOpen({ proposal: proposalOf(edge), existing: edge })
                    }}
                    className="w-full rounded-md px-2 py-1 text-left text-caption hover:bg-surface"
                  >
                    <span className={edge.dangling ? 'text-negative' : 'text-ink'}>
                      <Bidi>{said.says}</Bidi>
                    </span>
                    <span className="block text-ink-tertiary">
                      <Bidi>{said.under}</Bidi>
                    </span>
                  </button>
                </li>
                )
              })}
            </ul>
          )}

          <p className="mt-4 text-caption text-ink-tertiary">
            A connection is a column on one format, or a total on the other — nothing else. Read
            one back in{' '}
            <Link to={FORMATS_PATH} className="text-accent">
              Formats
            </Link>
            , or open{' '}
            {data.declarations.slice(0, 1).map((each) => (
              <Link key={each.name} to={formatPath(each.name)} className="text-accent">
                its rows
              </Link>
            ))}
            .
          </p>
        </aside>
      </div>

      {open !== undefined && (
        <ConnectionPanel
          key={keyFor(open)}
          proposal={open.proposal}
          existing={open.existing}
          declarations={data.declarations}
          judge={judge}
          onPropose={(proposal, edge) => {
            setArmed(undefined)
            setOpen({ proposal, existing: edge })
          }}
          onCancel={() => setOpen(undefined)}
          findPlan={findPlan}
          offerApply={open.offerApply}
          onApplyFound={(format, column) =>
            mutate((database) => {
              const declaration = listFormats(database).find((each) => each.name === format)
              if (declaration !== undefined) applyFoundLink(database, declaration, column)
            })
          }
          onSave={(drafts) => {
            // In order, and one `adoptFormat` each: the link before the figure
            // that folds over it. Both plans were clean before the button was
            // offered, which is what keeps two writes from leaving one behind.
            mutate((database) => {
              const now = Date.now()
              for (const draft of drafts) adoptFormat(database, declarationOf(draft), now)
            })
            // A link just set to match by date fills only the rows saved from
            // now on (D-350), so the ones already there are offered at once
            // (M29 F11): the window stays open on that question.
            const after = listFormats(db)
            setOpen(
              offerFor(drafts, data.declarations, after, (format, column) => {
                if (rowWriteRefusal(format) !== undefined) return false
                const plan = planFoundLink(db, format, column, after)
                return typeof plan !== 'string' && plan.empty > 0
              }),
            )
          }}
        />
      )}
    </div>
  )
}

/** What the panel is open on: a gesture's proposal, and the edge it came from. */
interface Opened {
  readonly proposal: Proposal
  readonly existing: Edge | undefined
  /** Opened right after its link was set to match by date, to offer the rows already there. */
  readonly offerApply?: boolean | undefined
}

/**
 * The link a save just set to match by date, when rows already there have it
 * empty — the window reopens on it to offer them (M29 F11). Nothing otherwise.
 */
function offerFor(
  drafts: readonly FormatDraft[],
  before: readonly FormatDeclaration[],
  after: readonly FormatDeclaration[],
  hasEmpty: (format: FormatDeclaration, column: string) => boolean,
): Opened | undefined {
  for (const draft of drafts) {
    const now = after.find((each) => each.name === declarationOf(draft).name)
    if (now === undefined) continue
    const was = before.find((each) => each.name === now.name)
    for (const column of now.columns) {
      if (column.type !== 'link' || column.foundBy === undefined) continue
      const earlier = was?.columns.find((each) => each.name === column.name)?.foundBy
      if (earlier !== undefined && JSON.stringify(earlier) === JSON.stringify(column.foundBy)) continue
      if (!hasEmpty(now, column.name)) continue
      const edge = edgesOf(after).find(
        (each) => each.kind === 'LINK' && each.format === now.name && each.column === column.name,
      )
      if (edge !== undefined) return { proposal: proposalOf(edge), existing: edge, offerApply: true }
    }
  }
  return undefined
}

/** An edge, as the proposal that would make it again — which is how it is edited. */
function proposalOf(edge: Edge): Proposal {
  return edge.kind === 'LINK'
    ? { kind: 'LINK', from: edge.format, to: edge.target, column: edge.column, retyping: false }
    : { kind: 'FIGURE', format: edge.format, over: edge.over }
}

/** The formats the window is about, which the graph keeps in sight while it is open. */
function focusOf(proposal: Proposal): readonly string[] | undefined {
  switch (proposal.kind) {
    case 'LINK':
      return [proposal.from, proposal.to]
    case 'FIGURE':
      return [proposal.format, proposal.over.format]
    case 'LINK_AND_FIGURE':
      return [proposal.from, proposal.format]
    case 'NOTHING':
      return undefined
  }
}

function keyOf(edge: Edge): string {
  return edge.kind === 'LINK'
    ? `link:${edge.format}.${edge.column}`
    : `figure:${edge.format}.${edge.figure}`
}

/** The panel remounts per gesture, so its fields start from the right defaults. */
function keyFor(open: Opened): string {
  const { proposal } = open
  switch (proposal.kind) {
    case 'LINK':
      return `link:${proposal.from}:${proposal.to}:${proposal.column ?? ''}${open.offerApply === true ? ':offer' : ''}`
    case 'FIGURE':
      return `figure:${proposal.format}:${sourceText(proposal.over)}:${open.existing?.kind === 'FIGURE' ? open.existing.figure : ''}`
    case 'LINK_AND_FIGURE':
      return `both:${proposal.format}:${proposal.from}`
    case 'NOTHING':
      return `nothing:${proposal.reason}`
  }
}

/**
 * **Find a format by name** (M29 F9). A pack is one bubble until it is opened
 * (D-269), and a paycheck was looked for on a canvas where it was one
 * of 34 inside `ledger`. Typing finds it whether it is folded or not: the pack
 * opens and the view goes to it.
 */
function FindFormat({
  declarations,
  query,
  onQuery,
  onFind,
}: {
  declarations: readonly FormatDeclaration[]
  query: string
  onQuery: (query: string) => void
  onFind: (name: string) => void
}) {
  const list = useId()
  const wanted = query.trim().toLowerCase()
  const matches =
    wanted === ''
      ? []
      : declarations.filter(
          (each) => each.name.toLowerCase().includes(wanted) || each.title.toLowerCase().includes(wanted),
        )
  const exact = declarations.find(
    (each) => each.title.toLowerCase() === wanted || each.name.toLowerCase() === wanted,
  )
  return (
    <span className="flex items-baseline gap-2">
      <input
        type="search"
        list={list}
        value={query}
        aria-label="Find a format"
        placeholder="Find a format…"
        dir="auto"
        onChange={(event) => {
          onQuery(event.target.value)
          // Picked from the list: it is the whole title, so it goes at once.
          const picked = declarations.find((each) => each.title === event.target.value)
          if (picked !== undefined) onFind(picked.name)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          const go = exact ?? matches[0]
          if (go !== undefined) onFind(go.name)
        }}
        className={`${FIELD} h-7 w-44 text-caption`}
      />
      <datalist id={list}>
        {declarations.map((each) => (
          <option key={each.name} value={each.title}>
            {each.name}
          </option>
        ))}
      </datalist>
      {wanted !== '' && matches.length === 0 && (
        <span className="text-ink-tertiary">No format is called that.</span>
      )}
    </span>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-prose">{children}</p>
    </div>
  )
}
