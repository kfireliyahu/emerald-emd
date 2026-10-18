import type { Database } from 'sql.js'
import { readFormat } from '@/data/repositories/formatRepository.ts'
import { listRows } from '@/data/repositories/formatRowRepository.ts'
import { openEncoded } from '@/data/storage/encoding.ts'
import type { StoredValue } from '@/domain/format/row.ts'
import type { TourDeclare } from './declare.ts'
import { scenesOf, type Speaker, type Tour, type TourAction, type TourStep, type TourWrite } from './steps.ts'

/**
 * **A tour is rows** (M33 U3, D-413): the declared `tour` and `tour_step`
 * formats of `tours.emd`, read through the engine like any document. The
 * formats are `fixtures/synthetic/demo/tour.format.md` and
 * `tour_step.format.md`, rows and all; `scripts/make-demo-document.mjs` puts
 * them beside the app page as the two parts of a text document.
 *
 * **Not in the document a tour plays** (D-414): a visitor's first screen there
 * is the app over what the tour is about, and a format of tour steps in its
 * rail would be the first thing they read.
 *
 * The frame reads this itself, so the title and the first caption are up while
 * the app page is still loading, and the app page knows nothing about tours.
 */

/** Beside the frame's page, with the documents the tours play. */
const TOURS_DOCUMENT = 'tours.emd'

const ACTIONS: readonly TourAction[] = ['click', 'type', 'press', 'wait', 'say', 'write']
const SPEAKERS: readonly Speaker[] = ['person', 'model']

/** Every tour the document holds, its steps in order — or a sentence saying why not. */
function toursIn(db: Database): readonly Tour[] {
  const tourFormat = readFormat(db, 'tour')
  const stepFormat = readFormat(db, 'tour_step')
  if (tourFormat === undefined || stepFormat === undefined) {
    throw new Error(`${TOURS_DOCUMENT} declares no tour and tour_step formats.`)
  }
  const steps = listRows(db, stepFormat, { order: 'position' })
  // By name, so `custom` — what `?tour=` falls back to (D-418) — is first whatever the ids are.
  return listRows(db, tourFormat, { order: 'name' }).map((row) => {
    const name = text(row.cells['name'])
    const tour: Tour = {
      name,
      title: text(row.cells['title']),
      description: text(row.cells['description']),
      document: text(row.cells['document']),
      steps: steps.filter((step) => step.cells['tour'] === row.id).map((step) => stepOf(step.cells)),
    }
    if (tour.steps.length === 0) throw new Error(`The tour ${name} has no steps.`)
    // A tour whose first step says nothing is refused here, before it plays.
    scenesOf(tour.steps)
    return tour
  })
}

/** The tours, from the bytes of a tours document. */
export async function toursFrom(bytes: Uint8Array): Promise<readonly Tour[]> {
  const { db } = await openEncoded(bytes)
  try {
    return toursIn(db)
  } finally {
    db.close()
  }
}

/** Every tour, fetched from beside the page and read. */
export async function loadTours(base: string): Promise<readonly Tour[]> {
  const response = await fetch(`${base}${TOURS_DOCUMENT}`)
  if (!response.ok) throw new Error(`${TOURS_DOCUMENT}: ${String(response.status)} ${response.statusText}`)
  return toursFrom(new Uint8Array(await response.arrayBuffer()))
}

function stepOf(cells: Readonly<Record<string, StoredValue>>): TourStep {
  const action = text(cells['action'])
  if (!ACTIONS.includes(action as TourAction)) throw new Error(`A step's action is ${action}.`)
  const optional = (name: string): string | undefined => {
    const value = cells[name]
    return typeof value === 'string' && value !== '' ? value : undefined
  }
  const anchor = optional('anchor')
  const value = optional('value')
  const caption = optional('caption')
  const beside = optional('beside')
  const highlight = optional('highlight')
  const chat = optional('chat')
  const from = optional('from')
  if (chat !== undefined && !SPEAKERS.includes(from as Speaker)) throw new Error(`A chat line says who it is from: ${chat}`)
  const write = action === 'write' ? writeOf(value) : undefined
  return {
    action: action as TourAction,
    ...(anchor === undefined ? {} : { anchor }),
    ...(value === undefined ? {} : { value }),
    ...(cells['replace'] === 1 ? { replace: true } : {}),
    ...(caption === undefined ? {} : { caption }),
    ...(beside === undefined ? {} : { beside }),
    ...(highlight === undefined ? {} : { highlight }),
    ...(write === undefined ? {} : { write }),
    ...(chat === undefined ? {} : { chat, from: from as Speaker }),
  }
}

/**
 * A `write` step's value (M33 F5): `{"format": …, "rows": [...]}`, what
 * `record_format_rows` is handed — or `{"declare": {"format": …, …}}`, a format
 * as `declare_format` and `extend_format` are handed one (M33 U7). Refused here when it is not that shape, so a
 * tour that cannot write never starts; whether the engine takes the rows is
 * the write's own answer, when it plays.
 */
function writeOf(value: string | undefined): TourWrite {
  let parsed: unknown
  try {
    parsed = JSON.parse(value ?? '')
  } catch {
    throw new Error(`A write step's value is not JSON: ${value ?? '(empty)'}`)
  }
  const { format, rows, declare } = (parsed ?? {}) as { format?: unknown; rows?: unknown; declare?: unknown }
  // A format made or added to (M33 U7): whether the engine takes it is the
  // write's own answer, when it plays, as a batch's is.
  if (typeof declare === 'object' && declare !== null && typeof (declare as { format?: unknown }).format === 'string') {
    return { declare: declare as TourDeclare }
  }
  if (typeof format !== 'string' || !Array.isArray(rows) || rows.some((row) => typeof row !== 'object' || row === null)) {
    throw new Error(`A write step names a format and its rows: ${value ?? ''}`)
  }
  return { format, rows: rows as readonly Readonly<Record<string, unknown>>[] }
}

function text(value: StoredValue | undefined): string {
  return typeof value === 'string' ? value : ''
}
