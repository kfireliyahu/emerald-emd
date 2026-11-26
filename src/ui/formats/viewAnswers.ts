import type { AgendaData, ReadyData, RoadmapData, ViewLine } from '@/data/repositories/formatLinkViewRepository.ts'
import { readValue } from '@/domain/format/row.ts'
import { countKey } from '@/i18n/count.ts'
import type { Translate } from '@/i18n/current.ts'
import type { ListPicture } from '@/ui/formats/listView.ts'
import { memberText, toneOf } from '@/ui/formats/tone.ts'

/**
 * **What each engine view answers first, in words** (M64 U14, D-626, after
 * D-616's *the answer comes first*). A view's question is its inventory row's
 * (`docs/redesign/screens.md`) — the board *where does each thing stand?*, the
 * list *what is on it and what is done?*, the roadmap *what comes next?*, ready
 * *what can start now?*, the agenda *what is coming up, and what is late?* —
 * and its answer is one sentence at the lede step above everything else.
 *
 * Plain functions of what the view already read, so a test can hold them; the
 * words are the catalogue's (`views.*`), and a member's name is the document's,
 * said as it is written.
 */

/** A document's word inside a sentence that is one string: first-strong isolated, as `Bidi` isolates an element. */
export function isolated(text: string): string {
  return `${String.fromCharCode(0x2068)}${text}${String.fromCharCode(0x2069)}`
}

/** `a`, `a and b`, `a, b and c` — in the catalogue's own *and*. */
export function joined(t: Translate, parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('')
  return t('views.and', { rest: parts.slice(0, -1).join(', '), last: parts[parts.length - 1] ?? '' })
}

/** `4 planned, 1 in progress and 30 built`: each member that holds something, in its declared order. */
export function byMember(t: Translate, counts: readonly (readonly [member: string | undefined, count: number])[]): string {
  return joined(
    t,
    counts
      .filter(([, count]) => count > 0)
      .map(([member, count]) => isolated(t('views.part', { count, member: member === undefined ? '—' : memberText(member) }))),
  )
}

/** The board: how many cards in each lane. */
export function boardAnswer(t: Translate, lanes: readonly { readonly member: string | undefined; readonly rows: readonly unknown[] }[]): string {
  const said = byMember(t, lanes.map((lane) => [lane.member, lane.rows.length] as const))
  return said === '' ? t('views.board.none') : t('views.board.answer', { parts: said })
}

/** The list: how many are open and how many done — or how many rows, when nothing ticks a row off. */
export function listAnswer(t: Translate, picture: ListPicture): string {
  const lines = picture.groups.flatMap((group) => group.rows)
  if (lines.length === 0) return t('views.list.none')
  if (picture.shape.done === undefined) return t(countKey('views.list.rows', lines.length), { count: lines.length })
  const done = lines.filter((line) => line.ticked).length
  const open = lines.length - done
  return `${joined(t, [
    t(countKey('views.list.open', open), { count: open }),
    t(countKey('views.list.done', done), { count: done }),
  ])}.`
}

/** The roadmap: its own rows by state, then each fold's rows that are done. */
export function roadmapAnswer(t: Translate, data: RoadmapData): string {
  if (data.rows.length === 0) return t('views.roadmap.none')
  const members = data.shape.state?.values ?? []
  const states = data.rows.map(({ line }) => stateOf(line))
  const parts = [byMember(t, members.map((member) => [member, states.filter((each) => each === member).length] as const))]
  for (const fold of data.shape.folds) {
    const lines = data.rows.flatMap(({ folds }) => folds.filter((each) => each.fold === fold)).flatMap((each) => each.lines)
    if (lines.length === 0) continue
    const done = lines.filter((line) => toneOf(stateOf(line)) === 'done').length
    parts.push(t('views.roadmap.folded', { done, total: lines.length, title: isolated(fold.format.title) }))
  }
  return `${parts.filter((each) => each !== '').join('; ')}.`
}

/** Ready: how many can start, and how many are held. */
export function readyAnswer(t: Translate, data: ReadyData): string {
  if (data.ready.length === 0 && data.held.length === 0) return t('views.ready.none')
  const parts = [t(countKey('views.ready.answer', data.ready.length), { count: data.ready.length })]
  if (data.held.length > 0) parts.push(t(countKey('views.ready.held', data.held.length), { count: data.held.length }))
  return `${joined(t, parts)}.`
}

/** The agenda: what is overdue, and how many rows lie ahead in the window. */
export function agendaAnswer(t: Translate, data: AgendaData, ahead: string): string {
  if (data.formats.length === 0) return t('views.agenda.noFormat')
  const coming = data.days.reduce((sum, day) => sum + day.rows.length, 0)
  if (coming === 0 && data.overdue.length === 0) return t('views.agenda.nothing', { ahead })
  const parts: string[] = []
  if (data.overdue.length > 0) parts.push(t(countKey('views.agenda.overdue', data.overdue.length), { count: data.overdue.length }))
  if (coming > 0) parts.push(t(countKey('views.agenda.ahead', coming), { count: coming, ahead }))
  return `${joined(t, parts)}.`
}

/** A format's dashboard: how many blocks it holds, or that it holds none yet. */
export function dashboardAnswer(t: Translate, blocks: number): string {
  return blocks === 0 ? t('views.dashboard.none') : t(countKey('views.dashboard.blocks', blocks), { count: blocks })
}

/** A line's state, as the views read it: the member its state column holds. */
function stateOf(line: ViewLine): string | undefined {
  const column = line.shape.state
  const value = column === undefined ? undefined : readValue(column, line.row)
  return typeof value === 'string' && value !== '' ? value : undefined
}
