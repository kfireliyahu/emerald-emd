import { useMemo, type ReactElement, type ReactNode } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'

import {
  readyData,
  roadmapData,
  startPicture,
  type RoadmapData,
  type ViewLine,
} from '@/data/repositories/formatLinkViewRepository.ts'
import type { RowFilter } from '@/data/repositories/formatFilterRepository.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import { readValue } from '@/domain/format/row.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { filterAddress, type ColumnChoice } from '@/ui/formats/addressFilter.ts'
import { ReadyView, RoadmapView } from '@/ui/formats/LinkViews.tsx'
import { liveIndex, toneOf } from '@/ui/formats/tone.ts'
import { AGENDA_PATH, boardPath, formatPath, listPath, readyPath, roadmapPath } from '@/ui/nav.ts'
import { Agenda } from '@/ui/screens/Agenda.tsx'
import { FormatPage, FormatReady, FormatRoadmap } from '@/ui/screens/FormatLinkViews.tsx'
import { FormatRows } from '@/ui/screens/FormatRows.tsx'

import type { FrameView } from './contract.ts'

/**
 * **What the frame draws, as data** (M41 U2): the app's own format pages, at
 * the paths the app routes them at, so a link or a button inside them lands on
 * the same component it lands on in the app — and nothing snaps back to the
 * sheet, which is what failed on 2026-10-08 when Roadmap did.
 *
 * `routes.test.ts` holds both lists to the app's: every format route in
 * `App.tsx` is drawn here or is in `NOT_IN_FRAME` with the control that would
 * reach it and why that control is hidden, and every link the frame's pages
 * render lands on a path drawn here. **No control leads nowhere**
 * (2026-10-08).
 */

/** The frame's own page: `start_here`'s picture. Not a route of the app. */
export const START_PATH = '/start'

export const FRAME_ROUTES: readonly { readonly path: string; readonly element: ReactElement }[] = [
  { path: START_PATH, element: <StartPicture /> },
  { path: AGENDA_PATH, element: <Agenda /> },
  { path: '/formats/:name', element: <FormatRows /> },
  { path: '/formats/:name/entry/:entry', element: <FormatRows /> },
  { path: '/formats/:name/board', element: <FormatRows board /> },
  { path: '/formats/:name/list', element: <FormatRows list /> },
  { path: '/formats/:name/roadmap', element: <FormatRoadmap /> },
  { path: '/formats/:name/ready', element: <FormatReady /> },
  { path: '/formats/:name/page/:entry', element: <FormatPage /> },
  // Where a page goes when its format is not in the document. The server sends
  // a copy only of a format that is, so this is a stale link inside one.
  { path: '/formats', element: <Said>That format is not in this copy.</Said> },
]

/**
 * The app's format routes the frame does not draw, each with what reaches it
 * in the app and why that is hidden here. The frame is read-only (`ReadOnly`),
 * which every control below already honours as it honours a pack's lock.
 */
export const NOT_IN_FRAME: Readonly<Record<string, string>> = {
  '/formats/:name/read':
    'Reading files writes rows. Its button, Read on the table, is hidden wherever a format is locked, and the frame locks every one.',
}

/**
 * Where a tool's answer opens the frame: the view it asked for, of the format
 * it named — with the rows it asked for in the address (M44 U6), where the
 * app's own views read a filter from, so the frame draws only those and every
 * other view of the format a click away keeps them.
 */
export function firstPath(view: FrameView, format: string, filter: RowFilter = {}, columns: ColumnChoice = {}): string {
  const held = filterAddress(filter, { columns })
  switch (view) {
    case 'start':
      return START_PATH
    case 'board':
      return boardPath(format) + held
    case 'list':
      return listPath(format) + held
    case 'roadmap':
      return roadmapPath(format) + held
    case 'ready':
      return readyPath(format) + held
    case 'sheet':
      return formatPath(format) + held
    case 'agenda':
      return AGENDA_PATH + held
  }
}

export function FrameRoutes() {
  return (
    <Routes>
      {FRAME_ROUTES.map((each) => (
        <Route key={each.path} path={each.path} element={each.element} />
      ))}
      {/* Never reached from a control (`routes.test.ts`); said rather than
          snapped back, so a miss is a sentence somebody can report. */}
      <Route path="*" element={<NotDrawn />} />
    </Routes>
  )
}

function NotDrawn() {
  const { pathname } = useLocation()
  return <Said>This view is not drawn in the conversation: {pathname}. Open the document in Emerald to see it.</Said>
}

function Said({ children }: { children: ReactNode }) {
  return <p className="px-6 py-4 text-ink-secondary">{children}</p>
}

/**
 * **`start_here`, as a picture** (M41 U2): the roadmaps the ready rows fold
 * under, cut to the open milestone with its units, and then what is ready —
 * the app's own `RoadmapView` and `ReadyView`, one after the other, each
 * headed by a link to its whole view.
 */
function StartPicture() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const drawn = useMemo(() => {
    if (db === undefined) return undefined
    const declarations = listFormats(db)
    const picture = startPicture(db, declarations)
    const named = (name: string) => declarations.find((each) => each.name === name)
    return {
      roadmaps: picture.roadmaps.flatMap((name) => {
        const declaration = named(name)
        const whole = declaration === undefined ? undefined : roadmapData(db, declaration, declarations)
        const data = whole === undefined ? undefined : liveOnly(whole)
        return declaration === undefined || data === undefined ? [] : [{ declaration, data }]
      }),
      ready: picture.ready.flatMap((name) => {
        const declaration = named(name)
        const data = declaration === undefined ? undefined : readyData(db, declaration, declarations)
        return declaration === undefined || data === undefined ? [] : [{ declaration, data }]
      }),
    }
    // `revision` is the dependency that matters: every write bumps it.
  }, [db, revision])

  if (drawn === undefined) return null
  if (drawn.roadmaps.length === 0 && drawn.ready.length === 0) {
    return <Said>This document’s views draw no roadmap and nothing ready to start. The answer is in the conversation.</Said>
  }
  return (
    <div className="flex flex-col">
      {drawn.roadmaps.map(({ declaration, data }) => (
        <section key={`roadmap-${declaration.name}`} aria-label={`Roadmap of ${declaration.title}`}>
          <Heading to={roadmapPath(declaration.name)} title={declaration.title} what="Roadmap" />
          <RoadmapView data={data} />
        </section>
      ))}
      {drawn.ready.map(({ declaration, data }) => (
        <section key={`ready-${declaration.name}`} aria-label={`Ready to start in ${declaration.title}`}>
          <Heading to={readyPath(declaration.name)} title={declaration.title} what="Ready to start" />
          <ReadyView data={data} />
        </section>
      ))}
    </div>
  )
}

/**
 * A roadmap cut to the rows that are under way — the live row the roadmap's
 * rail marks (`liveIndex`), every row in a live state when there are several,
 * or the first not yet done when none is. The whole roadmap is a link away;
 * a first picture of twenty-seven milestones is a scroll, not a picture.
 */
function liveOnly(data: RoadmapData): RoadmapData {
  const toneOfLine = (line: ViewLine) => {
    const column = line.shape.state
    const value = column === undefined ? undefined : readValue(column, line.row)
    return toneOf(typeof value === 'string' && value !== '' ? value : undefined)
  }
  const tones = data.rows.map(({ line }) => toneOfLine(line))
  const live = data.rows.filter((_, index) => tones[index] === 'live')
  const ahead = data.rows[liveIndex(tones)]
  return { ...data, rows: live.length > 0 ? live : ahead === undefined ? [] : [ahead], loose: [] }
}

/** The bar a view of the app has above it, here naming which view and opening it whole. */
function Heading({ to, title, what }: { to: string; title: string; what: string }) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-hairline px-6 py-2">
      <Link
        to={to}
        className="text-caption text-ink-secondary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      >
        <Bidi>{title}</Bidi> · {what} →
      </Link>
    </div>
  )
}
