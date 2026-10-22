import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import type { Database } from 'sql.js'

import { capitalize } from '@/core/text.ts'
import { planBatch, writeBatch, type BatchFile } from '@/data/intake/batchReading.ts'
import { readTableOf } from '@/data/intake/sheetReading.ts'
import {
  lineCounts,
  planReading,
  planWrites,
  reconciles,
  type ReadingPlan,
  planChanges,
  removableGone,
  type PlannedRereading,
} from '@/data/intake/readingPlan.ts'
import { hashBytes } from '@/data/importer/naturalKey.ts'
import {
  isSupportedFileName,
  readWorkbook,
  SUPPORTED_EXTENSIONS,
} from '@/data/importer/sheetTable.ts'
import { isJsonFileName, jsonRowsTables } from '@/domain/format/jsonRows.ts'
import { inTransaction } from '@/data/db/database.ts'
import {
  forgetReader,
  listReaders,
  renameReader,
  supersedeIntake,
  type Intake,
} from '@/data/repositories/formatIntakeRepository.ts'
import { formatsNamed, indexOf, type FormatIndex } from '@/data/repositories/formatJoinRepository.ts'
import { listFormats } from '@/data/repositories/formatRepository.ts'
import type { FormatDeclaration } from '@/domain/format/declaration.ts'
import { verdictSentence } from '@/domain/format/identity.ts'
import { keySentence } from '@/domain/format/reread.ts'
import { rowWriteRefusal } from '@/domain/format/owner.ts'
import {
  closeSentence,
  fitReader,
  readerName,
  type CloseWhy,
  type Reader,
} from '@/domain/format/reader.ts'
import {
  guessReading,
  readingHeaderCells,
  readingSignature,
  proseLinkNames,
  rowLabel,
  type ReadTable,
  type Reading,
} from '@/domain/format/reading.ts'
import {
  itemSections,
  itemsFileName,
  itemsHash,
  itemsTable,
  noteIndex,
  noteItems,
  notesDigestText,
  parseNote,
  type ItemsFrom,
  type ParsedNote,
} from '@/domain/format/notes.ts'
import { listUnits } from '@/data/repositories/unitRepository.ts'
import {
  droppedFiles,
  formatNamedBy,
  inputFiles,
  sortPicked,
  tablesAcross,
  type PickedFile,
} from '@/ui/formats/noteFiles.ts'
import { offeredKeysOf } from '@/domain/format/row.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { NAMED_COPY_ROWS } from '../../../electron/bridge.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Chip } from '@/ui/components/Chip.tsx'
import { IconAction, removableRow } from '@/ui/components/IconAction.tsx'
import { FIELD, SELECT } from '@/ui/components/fieldLook.ts'
import { Fixed, Mapper } from '@/ui/formats/IntakePanel.tsx'
import { ReadersLine } from '@/ui/formats/ReadersLine.tsx'
import { WhatLooksWrong } from '@/ui/formats/WhatLooksWrong.tsx'
import { tallyAccounts, type FormatAudit } from '@/domain/format/audit.ts'
import { entryPath, formatPath } from '@/ui/nav.ts'
import { formatsByPack, useKeptPacks } from '@/ui/packs.ts'

/**
 * **Reading files onto a format, any number at once** — M26 U5.
 *
 * Reported twice: bulk reading was *"still not in the UI"*, and a second
 * payslip layout got *"a dialog, not an answer"* (D-283). So each file is tried
 * against **every reader the format has** and read by the one that fits
 * (`fitReader`); when none does, the file says so in a sentence — *your reader
 * for card-08.xlsx doesn't fit this file* — and offers to make a new one, which
 * is the mapper this screen opens under it.
 *
 * ## A review step before anything is written
 *
 * 2026-10-01: *"Can we really know it was fully reconciled without
 * anything missing?"* — so nothing is written until a person presses Write, and
 * what they press it on is a list of files, each with its counts and its proof.
 * **A file that reconciles is ticked; it is never written past this screen.**
 * `reconciles` is narrow (D-138): every line read, nothing refused, and every
 * check the format declares proved — on the lines and on the header row, where a
 * printed total is what catches a line that is missing. A format that declares
 * nothing to add up has nothing to reconcile, and its files are left for a
 * person to tick.
 *
 * The plan for each file is `planReading` — the same one `read_onto_format`
 * prints — so this screen and a conversation cannot disagree about a file
 * (D-227). The write is `recordIntake` per file, all in one transaction: a
 * batch is written whole or not at all.
 *
 * ## Each file onto its format (M34 U2, D-395)
 *
 * A file goes onto the format whose reader fits it — this screen's first — or
 * the one picked beside it, so three linked spreadsheets are one drop. The
 * files are judged and written by `planBatch` and `writeBatch`, the same two
 * `read_onto_format` takes `files` through: in the order their links need, so a
 * line can name a row from a file above it.
 *
 * ## A folder of notes, and a guess shown in place (M34 U7)
 *
 * Markdown notes picked, or a folder chosen or dropped, are one table per
 * folder (`noteFiles.ts`) — a note a row — read like any spreadsheet. A file no
 * reader fits is read **by the guessed mapping, shown on its row**, and the
 * guess becomes its reader when it is written: no step to make one first. It
 * goes onto the format its name names (`recipes/` onto Recipe) when one does.
 */
export function ReadFiles() {
  const { name } = useParams<{ name: string }>()
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)
  const keepCopy = useDocumentStore((state) => state.keepCopy)
  const navigate = useNavigate()

  const [files, setFiles] = useState<readonly Loaded[]>([])
  const [made, setMade] = useState<ReadonlyMap<string, Made>>(new Map())
  const [onto, setOnto] = useState<ReadonlyMap<string, string>>(new Map())
  const [ticks, setTicks] = useState<ReadonlyMap<string, boolean>>(new Map())
  // Per file read again, whether its gone entries are taken away (M38 U3, D-408).
  const [removing, setRemoving] = useState<ReadonlyMap<string, boolean>>(new Map())
  const [editing, setEditing] = useState<Editing | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const [written, setWritten] = useState<
    { readonly intakes: readonly Intake[]; readonly audits: readonly FormatAudit[] } | undefined
  >(undefined)

  const context = useMemo(() => {
    if (db === undefined || name === undefined) return undefined
    const declarations = listFormats(db)
    const declaration = declarations.find((each) => each.name === name)
    if (declaration === undefined) return { declaration: undefined }
    // Every format a file may be read onto — a pack's own is the pack's (D-269).
    const writable = declarations.filter((each) => rowWriteRefusal(each) === undefined)
    return {
      declaration,
      declarations,
      writable,
      formats: indexOf(declarations),
      readers: listReaders(db, declaration.name),
      readersOf: new Map(writable.map((each) => [each.name, listReaders(db, each.name)])),
    }
  }, [db, name, revision])

  // The units an item's figure may be in are the document's (M38 U4).
  const units = useMemo(() => (db === undefined ? [] : listUnits(db).map((unit) => unit.symbol)), [db, revision])

  const reviewed = useMemo(() => {
    if (db === undefined || context?.declaration === undefined) return []
    return review(db, context.declaration, context.writable, context.readersOf, context.formats, files, made, onto, removing)
  }, [db, context, files, made, onto, removing, revision])

  // The ticked files, judged again as the batch they are: a file whose parent
  // is left unticked, or that repeats a unique value another ticked file holds,
  // would not be written as it reads alone.
  const batch = useMemo(() => {
    const accepted = reviewed.filter((each) => each.writable && (ticks.get(each.file.id) ?? each.preAccepted))
    if (db === undefined || context?.declaration === undefined || accepted.length === 0) {
      return { accepted, across: [] as readonly string[], audits: [] as readonly FormatAudit[] }
    }
    const planned = planBatch(db, accepted.map((each) => batchFileOf(each, removing)), context.formats, Date.now())
    const across = accepted.flatMap((each, at) => {
      const plan = planned.plans[at]
      if (plan === undefined || planWrites(plan)) return []
      return [`${each.file.name}: ${refusalsOf(plan)[0] ?? 'no line of it reads without the files it links to.'}`]
    })
    // What the engine would see once the lot is in (M34 U3, D-396).
    return { accepted, across, audits: planned.audits }
  }, [db, context, reviewed, ticks, removing])

  if (db === undefined) return null
  if (context === undefined || context.declaration === undefined) return <Navigate to="/formats" replace />
  const { declaration, declarations, writable, formats, readers } = context

  const locked = rowWriteRefusal(declaration)
  const isTicked = (each: Reviewed): boolean =>
    each.writable && (ticks.get(each.file.id) ?? each.preAccepted)
  const { accepted, across } = batch
  const titles = [...new Set([declaration, ...reviewed.map((each) => each.declaration)].map((each) => each.title))]
  const acceptedTitles = [...new Set(accepted.map((each) => each.declaration.title))]

  const add = (picked: readonly PickedFile[]): void => {
    setProblem(undefined)
    setWritten(undefined)
    const load = async (): Promise<readonly Loaded[]> => {
      const { folders, others, hidden } = await sortPicked(picked)
      const refused = others.filter((each) => !isSupportedFileName(each.name) && !isJsonFileName(each.name))
      // A .json file of rows is read as a .csv is (M48 U2); one that holds none is said here.
      const jsons = await Promise.all(
        others
          .filter((each) => isJsonFileName(each.name))
          .map(async (each) => {
            const bytes = new Uint8Array(await each.arrayBuffer())
            return { each, bytes, read: jsonRowsTables(new TextDecoder().decode(bytes)) }
          }),
      )
      const problems = [
        refused.length === 0
          ? undefined
          : `${refused.map((each) => each.name).join(', ')} ${refused.length === 1 ? 'is' : 'are'} not one of ${SUPPORTED_EXTENSIONS.join(', ')}, .json or .md.`,
        ...jsons.map(({ each, read }) => (read.ok ? undefined : `${each.name} is not a file of rows: ${read.reason}.`)),
        // A name starting with a dot is a hidden file — not read, and said so (M38 U1).
        hidden.length === 0
          ? undefined
          : `Not read, as hidden: ${hidden.slice(0, 10).join(', ')}${hidden.length > 10 ? ', …' : ''}.`,
      ].filter((each) => each !== undefined)
      if (problems.length > 0) setProblem(problems.join(' '))
      const sheets = await Promise.all(
        others
          .filter((each) => isSupportedFileName(each.name))
          .map(async (each): Promise<Loaded> => {
            const bytes = new Uint8Array(await each.arrayBuffer())
            const workbook = readWorkbook(each.name, bytes)
            return {
              id: `${each.name}-${String(each.size)}-${String(each.lastModified)}-${Math.random().toString(36).slice(2, 8)}`,
              name: each.name,
              hash: await hashBytes(bytes),
              sheets: workbook.sheets.map((sheet) => sheet.name),
              tables: workbook.sheets.map((sheet) => readTableOf(sheet)),
            }
          }),
      )
      const rowFiles = await Promise.all(
        jsons.flatMap(({ each, bytes, read }) =>
          read.ok
            ? [
                (async (): Promise<Loaded> => ({
                  id: `${each.name}-${String(each.size)}-${String(each.lastModified)}-${Math.random().toString(36).slice(2, 8)}`,
                  name: each.name,
                  hash: await hashBytes(bytes),
                  sheets: read.tables.map((table) => (table.name === '' ? each.name : table.name)),
                  tables: read.tables.map((table) => table.table),
                }))(),
              ]
            : [],
        ),
      )
      // A folder of notes is one table, hashed as the plugin hashes it.
      const notes = await Promise.all(
        folders.map(
          async (folder): Promise<Loaded> => ({
            id: `${folder.name}-${Math.random().toString(36).slice(2, 8)}`,
            name: folder.name,
            hash: await hashBytes(new TextEncoder().encode(notesDigestText(folder.notes))),
            sheets: [],
            tables: [],
            notes: folder.notes.map(parseNote),
            skipped: folder.skipped,
          }),
        ),
      )
      // Each folder's list items and table rows, as files of their own (M38 U4).
      const items = notes.flatMap((folder) => itemFilesOf(folder))
      return [...sheets, ...rowFiles, ...notes, ...items]
    }
    load()
      .then((loaded) => setFiles((current) => withNoteTables([...current, ...loaded], units)))
      .catch((error: unknown) => setProblem(String(error)))
  }

  const drop = (id: string): void => {
    // A folder's items go with it.
    setFiles((current) => withNoteTables(current.filter((each) => each.id !== id && each.items?.of !== id), units))
    setMade((current) => without(current, id))
    setOnto((current) => without(current, id))
    setTicks((current) => without(current, id))
    setRemoving((current) => without(current, id))
    if (editing?.fileId === id) setEditing(undefined)
  }

  // Which heading a folder's items are read from (M38 U4).
  const under = (id: string, heading: string | undefined): void => {
    setFiles((current) =>
      withNoteTables(
        current.map((each) => (each.id === id && each.items !== undefined ? { ...each, items: { ...each.items, under: heading } } : each)),
        units,
      ),
    )
    setTicks((current) => without(current, id))
  }

  const write = async (): Promise<void> => {
    if (accepted.length === 0 || across.length > 0) return
    // A read of many lines keeps a named copy first, as `read_onto_format`
    // does (M34 U6, D-399); one that could not be kept writes nothing.
    if (entries >= NAMED_COPY_ROWS) {
      const what = accepted.length === 1 ? `reading ${accepted[0]?.file.name ?? ''}` : `reading ${accepted.length} files`
      if ((await keepCopy(what)) === undefined) return
    }
    const now = Date.now()
    mutate((database) => {
      // In the order the links need, whole or not at all (D-395).
      const done = writeBatch(
        database,
        accepted.map((each) => batchFileOf(each, removing)),
        indexOf(listFormats(database)),
        now,
      )
      setWritten({
        intakes: done.order.flatMap((at) => {
          const intake = done.intakes[at]
          return intake === undefined ? [] : [intake]
        }),
        audits: done.audits,
      })
    })
    setFiles([])
    setMade(new Map())
    setOnto(new Map())
    setTicks(new Map())
    setRemoving(new Map())
    setEditing(undefined)
  }

  const undo = (intakes: readonly Intake[]): void => {
    mutate((database) =>
      inTransaction(database, () => {
        const all = indexOf(listFormats(database))
        // The last read first, so a line goes before the row it names.
        for (const intake of [...intakes].reverse()) {
          const format = all.get(intake.format)
          if (format !== undefined) supersedeIntake(database, intake.id, format, all)
        }
      }),
    )
    setWritten(undefined)
  }

  const entries = accepted.reduce((sum, each) => sum + (each.plan === undefined ? 0 : entriesOf(each.plan)), 0)

  return (
    <div className="fc-view-enter flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-hairline px-6 py-2">
        <span className="font-medium">
          Read onto{' '}
          <Link to={formatPath(declaration.name)} className="hover:underline">
            <Bidi>{declaration.title}</Bidi>
          </Link>
          {titles.length > 1 && (
            <span className="font-normal text-ink-secondary">
              , <Bidi>{titles.slice(1).join(', ')}</Bidi>
            </span>
          )}
        </span>
        <ReadersLine readers={readers} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">
        {locked !== undefined ? (
          <p className="max-w-prose text-ink-secondary">{locked}</p>
        ) : written !== undefined ? (
          <Written
            formats={formats}
            intakes={written.intakes}
            audits={written.audits}
            onOpen={() => navigate(formatPath(declaration.name))}
            onEntry={(format, row) => navigate(entryPath(format, row))}
            onUndo={() => undo(written.intakes)}
            onMore={() => setWritten(undefined)}
          />
        ) : (
          <>
            <ReaderList
              readers={readers}
              onRename={(reader, next) =>
                mutate((database) => renameReader(database, declaration.name, reader.signature, next))
              }
              onForget={(reader) =>
                mutate((database) => forgetReader(database, declaration.name, reader.signature))
              }
            />
            <Picker onFiles={add} empty={files.length === 0} />
            {problem !== undefined && <p className="mt-2 text-caption text-negative">{problem}</p>}

            {reviewed.length > 0 && (
              <ul className="mt-4 space-y-2">
                {reviewed.map((each) => (
                  <FileRow
                    key={each.file.id}
                    db={db}
                    declarations={declarations}
                    writable={writable}
                    formats={formats}
                    reviewed={each}
                    others={reviewed.filter((other) => other.writable && other.file.id !== each.file.id).map((other) => batchFileOf(other, removing))}
                    anyReader={readers.length > 0 || made.size > 0}
                    ticked={isTicked(each)}
                    onTick={(value) => setTicks((current) => new Map(current).set(each.file.id, value))}
                    onOnto={(format) => {
                      setOnto((current) => new Map(current).set(each.file.id, format))
                      setMade((current) => without(current, each.file.id))
                      setTicks((current) => without(current, each.file.id))
                      if (editing?.fileId === each.file.id) setEditing(undefined)
                    }}
                    editing={editing?.fileId === each.file.id ? editing : undefined}
                    onEdit={(next) => setEditing(next)}
                    onUse={(next) => {
                      setMade((current) =>
                        new Map(current).set(next.fileId, { format: next.format, sheet: next.sheet, reading: next.reading }),
                      )
                      setTicks((current) => without(current, next.fileId))
                      setEditing(undefined)
                    }}
                    onRemove={() => drop(each.file.id)}
                    onUnder={(heading) => under(each.file.id, heading)}
                    removeGone={removing.get(each.file.id) === true}
                    onRemoveGone={(value) => setRemoving((current) => new Map(current).set(each.file.id, value))}
                    onSupersede={(intake) =>
                      mutate((database) =>
                        supersedeIntake(database, intake.id, each.declaration, indexOf(listFormats(database))),
                      )
                    }
                  />
                ))}
              </ul>
            )}
            {new Set(reviewed.map((each) => each.declaration.name)).size > 1 && (
              <p className="mt-2 text-caption text-ink-tertiary">
                Read in this order, so an entry can name one from a file above it.
              </p>
            )}

            {reviewed.length > 0 && (
              <div className="mt-4">
                <WhatLooksWrong audits={batch.audits} framed={false} />
              </div>
            )}
            {reviewed.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-hairline pt-3">
                <Button
                  variant="primary"
                  disabled={accepted.length === 0 || across.length > 0}
                  onClick={() => void write()}
                >
                  Write {accepted.length === 1 ? '1 file' : `${String(accepted.length)} files`}
                </Button>
                <span className="text-caption text-ink-secondary tabular-nums">
                  {entries === 1 ? '1 entry' : `${String(entries)} entries`} onto{' '}
                  <Bidi>{(acceptedTitles.length === 0 ? [declaration.title] : acceptedTitles).join(', ')}</Bidi>,
                  in one go or not at all
                </span>
                {across.length > 0 && (
                  <div className="basis-full space-y-1">
                    {across.slice(0, 10).map((each) => (
                      <p key={each} className="text-caption text-negative">
                        <Bidi>{each}</Bidi>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------- state */

interface Loaded {
  readonly id: string
  readonly name: string
  readonly hash: string
  /** The workbook's sheets, by name; a folder of notes has none. */
  readonly sheets: readonly string[]
  /** Every sheet, read once: each one is tried. A folder of notes is one table. */
  readonly tables: readonly ReadTable[]
  /** A folder of notes (M34 U7): each note, a row. */
  readonly notes?: readonly ParsedNote[]
  /** What the folder held that is not a note, and was not read. */
  readonly skipped?: readonly string[]
  /**
   * A folder's list items or table rows, read as a file of their own (M38 U4):
   * the folder it is of, which items, and the headings they sit under.
   */
  readonly items?: {
    readonly of: string
    readonly source: string
    readonly folderHash: string
    readonly from: ItemsFrom
    readonly under: string | undefined
    readonly sections: readonly string[]
  }
}

/** A folder's list items and table rows, each a file of its own when any note has one (M38 U4). */
function itemFilesOf(folder: Loaded): readonly Loaded[] {
  const notes = folder.notes ?? []
  return (['list', 'table'] as const).flatMap((from) =>
    notes.some((note) => noteItems(note.body, from).length > 0)
      ? [
          {
            id: `${folder.id}#${from}`,
            name: itemsFileName(folder.name, from),
            hash: itemsHash(folder.hash, from),
            sheets: [],
            tables: [],
            notes,
            items: { of: folder.id, source: folder.name, folderHash: folder.hash, from, under: undefined, sections: itemSections(notes, from) },
          },
        ]
      : [],
  )
}

/**
 * Every folder of notes on the screen as its table, its links resolved
 * against every note on the screen — so a folder added later still fills the
 * links of one added before it. A folder's items are its notes' items table,
 * named for the heading they are read from (M38 U4).
 */
function withNoteTables(files: readonly Loaded[], units: readonly string[]): readonly Loaded[] {
  const folders = files.flatMap((each) => (each.notes === undefined || each.items !== undefined ? [] : [each.notes]))
  if (folders.length === 0) return files
  const tables = tablesAcross(folders)
  const index = noteIndex(folders.flat())
  let at = 0
  return files.map((each) => {
    if (each.notes === undefined) return each
    const items = each.items
    if (items !== undefined) {
      return {
        ...each,
        name: itemsFileName(items.source, items.from, items.under),
        hash: itemsHash(items.folderHash, items.from, items.under),
        tables: [itemsTable(each.notes, { ...items, units }, index)],
      }
    }
    const table = tables[at]
    at += 1
    return table === undefined ? each : { ...each, tables: [table] }
  })
}


/** A reader a person made on this screen for one file, not written yet. */
interface Made {
  /** The format it reads onto. */
  readonly format: string
  readonly sheet: number
  readonly reading: Reading
}

interface Editing extends Made {
  readonly fileId: string
}

type How =
  | { readonly kind: 'FITS'; readonly reader: Reader; readonly session: boolean; readonly moved: boolean }
  | { readonly kind: 'MADE' }
  | { readonly kind: 'CLOSE'; readonly reader: Reader; readonly why: CloseWhy }
  | { readonly kind: 'NONE' }

interface Reviewed {
  readonly file: Loaded
  /** The format this file is read onto (M34 U2). */
  readonly declaration: FormatDeclaration
  readonly sheet: number
  readonly table: ReadTable
  readonly how: How
  readonly reading: Reading | undefined
  readonly plan: ReadingPlan | undefined
  /** An earlier file in this batch with the same bytes. */
  readonly sameAs: string | undefined
  readonly writable: boolean
  readonly preAccepted: boolean
}

/**
 * A file as a batch reads it. Only a file with a reading is ever written.
 * `removing` says, per file read again, whether its gone entries go (D-408).
 */
function batchFileOf(
  each: {
    readonly file: Loaded
    readonly table: ReadTable
    readonly declaration: FormatDeclaration
    readonly reading: Reading | undefined
  },
  removing: ReadonlyMap<string, boolean> = new Map(),
): BatchFile {
  return {
    name: each.file.name,
    hash: each.file.hash,
    table: each.table,
    declaration: each.declaration,
    reading: each.reading ?? guessReading(each.declaration, each.table),
    removeGone: removing.get(each.file.id) === true,
  }
}

/** The entries a plan writes: every line of a first read; what changed, of a read again (D-408). */
function entriesOf(plan: ReadingPlan): number {
  const again = plan.again
  return again === undefined ? lineCounts(plan).typed : again.changed.length + again.added.length
}

/** Everything that stops a file being written, in a sentence each. */
function refusalsOf(plan: ReadingPlan): readonly string[] {
  return [
    ...(plan.blocked === undefined ? [] : [plan.blocked]),
    ...plan.problems.map((each) => each.message),
    ...plan.dangling,
    ...plan.repeated,
    ...plan.broken,
    ...(plan.header?.read.cells === undefined && plan.header !== undefined
      ? [plan.header.read.problem ?? 'The header row does not read.']
      : []),
    ...(plan.header?.dangling ?? []),
  ]
}

/**
 * Each file, read by the reader that fits it, onto the format that reader is
 * for — the one asked for, else the first format with a reader that fits (this
 * screen's format first), else this screen's format.
 *
 * The readers made on this screen are tried first, so a reader made for one
 * file of a batch reads the rest of that layout too, before anything is
 * written. Every sheet of a workbook is tried; a file that no reader fits is
 * judged on its first sheet, with the reader that came closest named.
 *
 * **The files are judged as one batch** (M34 U2, D-395): in the order their
 * links need, each against the ones before it — so a line naming a row another
 * file of the batch writes reads — and listed in that order.
 */
function review(
  db: Database,
  route: FormatDeclaration,
  writable: readonly FormatDeclaration[],
  readersOf: ReadonlyMap<string, readonly Reader[]>,
  formats: FormatIndex,
  files: readonly Loaded[],
  made: ReadonlyMap<string, Made>,
  onto: ReadonlyMap<string, string>,
  removing: ReadonlyMap<string, boolean>,
): readonly Reviewed[] {
  const session = new Map<string, Reader[]>()
  for (const file of files) {
    const mine = made.get(file.id)
    const table = mine === undefined ? undefined : file.tables[mine.sheet]
    if (mine === undefined || table === undefined) continue
    session.set(mine.format, [
      ...(session.get(mine.format) ?? []),
      {
        signature: readingSignature(table, mine.reading.headerRow),
        reading: mine.reading,
        headerCells: readingHeaderCells(table, mine.reading.headerRow),
        files: [file.name],
        lastReadAt: Number.MAX_SAFE_INTEGER,
      },
    ])
  }

  // A folder's items go onto the one format that links to the folder's (M38 U4).
  const linking = (parent: FormatDeclaration | undefined): FormatDeclaration | undefined => {
    if (parent === undefined) return undefined
    const found = writable.filter(
      (each) => each.name !== parent.name && each.columns.some((column) => column.type === 'link' && column.target === parent.name),
    )
    return found.length === 1 ? found[0] : undefined
  }
  const pick = (file: Loaded, index: number, parent: FormatDeclaration | undefined) => {
    const sameAs = files.slice(0, index).find((each) => each.hash === file.hash)?.name
    const mine = made.get(file.id)
    const asked = onto.get(file.id)
    const fallback =
      (asked === undefined ? undefined : formats.get(asked)) ??
      (file.items === undefined ? formatNamedBy(file.name, writable) : linking(parent)) ??
      route

    let declaration = fallback
    let sheet = 0
    let how: How = { kind: 'NONE' }
    let reading: Reading | undefined

    if (mine !== undefined) {
      declaration = formats.get(mine.format) ?? fallback
      sheet = mine.sheet
      how = { kind: 'MADE' }
      reading = mine.reading
    } else {
      const tried = asked === undefined ? [fallback, ...writable.filter((each) => each.name !== fallback.name)] : [fallback]
      search: for (const format of tried) {
        const ours = session.get(format.name) ?? []
        const candidates = [...ours, ...(readersOf.get(format.name) ?? [])]
        for (const [at, table] of file.tables.entries()) {
          const fit = fitReader(format, candidates, table, formats)
          if (fit.kind === 'FITS') {
            declaration = format
            sheet = at
            how = {
              kind: 'FITS',
              reader: fit.reader,
              session: ours.some((each) => each.signature === fit.reader.signature),
              moved: fit.moved,
            }
            reading = fit.reading
            break search
          }
          // The reader that came closest is named only for the format the file falls back to.
          if (fit.kind === 'CLOSE' && how.kind === 'NONE' && format.name === fallback.name) {
            sheet = at
            how = { kind: 'CLOSE', reader: fit.reader, why: fit.why }
          }
        }
      }
    }
    const table = file.tables[sheet] ?? { rows: [], columnCount: 0 }
    // A folder's items onto nothing that links back to it are not offered.
    const offered =
      file.items === undefined || asked !== undefined || mine !== undefined || how.kind === 'FITS' || linking(parent) !== undefined
    return { file, declaration, sheet, table, how, reading, sameAs, offered, parent: parent?.name }
  }
  const first = files.map((file, index) => (file.items === undefined ? pick(file, index, undefined) : undefined))
  const chosen = files
    .map((file, index) => first[index] ?? pick(file, index, first[files.findIndex((other) => other.id === file.items?.of)]?.declaration))
    .filter((each) => each.offered)
    .map((each, _at, all) => {
    if (each.reading !== undefined) return each
    // **No reader fits, so the guess reads it** — shown on the row and kept
    // as its reader when it is written (M34 U7): no step to make one first.
    // A body's links go onto the column pointing where they resolve (M38 U2):
    // rows the document holds, or notes another folder on the screen writes.
    const mentioned = proseLinkNames(each.table)
    // A folder's own notes count: a link between two of them is filled (M38 U4).
    const alongside = all.flatMap((other) =>
      other.file.notes === undefined || other.file.items !== undefined
        ? []
        : [{ format: other.declaration.name, names: new Set(other.file.notes.map((note) => note.title)) }],
    )
    const into = mentioned.length === 0 ? undefined : formatsNamed(db, each.declaration, mentioned, formats, alongside)
    return { ...each, reading: guessReading(each.declaration, each.table, formats, into, each.parent) }
  })

  // One batch of the files that read and are not a file again, rehearsed in
  // link order; a file again is judged alone, to say what it would write.
  const inBatch = chosen.flatMap((each, at) => (each.reading !== undefined && each.sameAs === undefined ? [at] : []))
  const planned = planBatch(
    db,
    inBatch.flatMap((at) => {
      const each = chosen[at]
      return each === undefined ? [] : [batchFileOf(each, removing)]
    }),
    formats,
    Date.now(),
  )
  const plans = new Map(inBatch.map((at, k) => [at, planned.plans[k]]))
  const order = [
    ...planned.order.flatMap((k) => {
      const at = inBatch[k]
      return at === undefined ? [] : [at]
    }),
    ...chosen.flatMap((_, at) => (inBatch.includes(at) ? [] : [at])),
  ]

  return order.flatMap((at) => {
    const each = chosen[at]
    if (each === undefined) return []
    const plan =
      plans.get(at) ??
      (each.reading === undefined
        ? undefined
        : planReading(db, each.declaration, each.table, each.file, each.reading, formats))
    // A source read again with nothing changed in it has nothing to write (D-408).
    const writable =
      plan !== undefined &&
      planWrites(plan) &&
      planChanges(plan, removing.get(each.file.id) === true) &&
      each.sameAs === undefined
    return [
      {
        ...each,
        plan,
        writable,
        // Ticked only when it reconciles and is not this file again — a file
        // already read would write its entries a second time.
        preAccepted: writable && plan !== undefined && reconciles(plan) && plan.prior === undefined,
      },
    ]
  })
}

function without<T>(map: ReadonlyMap<string, T>, key: string): ReadonlyMap<string, T> {
  const next = new Map(map)
  next.delete(key)
  return next
}

/* ------------------------------------------------------------------- parts */

function Picker({ onFiles, empty }: { onFiles: (files: readonly PickedFile[]) => void; empty: boolean }) {
  const [over, setOver] = useState(false)
  const take = (input: HTMLInputElement): void => {
    const chosen = Array.from(input.files ?? [])
    input.value = ''
    if (chosen.length > 0) onFiles(inputFiles(chosen))
  }
  return (
    <div
      className={`flex flex-col items-start gap-1 border border-dashed px-4 py-3 text-caption transition-colors duration-[var(--duration-micro)] ${
        over ? 'border-ink-tertiary bg-surface' : 'border-hairline-strong'
      }`}
      // The window's own drop is the ledger's statement mapper (D-227); a
      // drop here is this screen's, and stops before it gets there.
      onDragOver={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setOver(false)
        // A dropped folder is walked into its folders of notes (M34 U7).
        void droppedFiles(event.dataTransfer).then(onFiles)
      }}
    >
      <span className="flex flex-wrap items-baseline gap-x-3 text-ink">
        <label className="cursor-pointer text-accent underline-offset-2 hover:underline">
          {empty ? 'Choose files' : 'Add files'}
          <input
            type="file"
            multiple
            accept={[...SUPPORTED_EXTENSIONS, '.json', '.md'].join(',')}
            className="sr-only"
            onChange={(event) => take(event.target)}
          />
        </label>
        <label className="cursor-pointer text-accent underline-offset-2 hover:underline">
          {empty ? 'Choose a folder of notes' : 'Add a folder'}
          <input
            type="file"
            multiple
            // A folder pick: each file comes with its path under the folder.
            ref={(input) => input?.setAttribute('webkitdirectory', '')}
            className="sr-only"
            onChange={(event) => take(event.target)}
          />
        </label>
        <span className="text-ink-secondary">{empty ? 'or drop them here' : 'or drop more here'}</span>
      </span>
      <span className="text-ink-tertiary">
        {SUPPORTED_EXTENSIONS.join(', ')}, a .json file of rows, or Markdown notes — a folder of them is a table, a note a row.
        Each file is read by the reader that fits it, or by a guess you can check, and nothing is
        written until you press Write.
      </span>
    </div>
  )
}

function FileRow({
  db,
  declarations,
  writable,
  formats,
  reviewed,
  others,
  anyReader,
  ticked,
  onTick,
  onOnto,
  editing,
  onEdit,
  onUse,
  onRemove,
  onUnder,
  onSupersede,
  removeGone,
  onRemoveGone,
}: {
  db: Database
  declarations: readonly FormatDeclaration[]
  writable: readonly FormatDeclaration[]
  formats: FormatIndex
  reviewed: Reviewed
  /** The other files of the batch that would be written. */
  others: readonly BatchFile[]
  anyReader: boolean
  ticked: boolean
  onTick: (value: boolean) => void
  /** Read this file onto another format (M34 U2). */
  onOnto: (format: string) => void
  editing: Editing | undefined
  onEdit: (editing: Editing | undefined) => void
  onUse: (editing: Editing) => void
  onRemove: () => void
  /** A folder's items: read the ones under this heading, or every one (M38 U4). */
  onUnder: (heading: string | undefined) => void
  onSupersede: (intake: Intake) => void
  /** A file read again: whether its gone entries are taken away (D-408). */
  removeGone: boolean
  onRemoveGone: (value: boolean) => void
}) {
  const { file, how, plan, declaration } = reviewed
  const sheets = file.sheets
  // A person's own formats first, then each pack's under its name (M33 F3).
  const onto = formatsByPack(writable, useKeptPacks(), (each) => each.name)
  const fresh = (): Editing => {
    const table = file.tables[reviewed.sheet] ?? { rows: [], columnCount: 0 }
    return {
      fileId: file.id,
      format: declaration.name,
      sheet: reviewed.sheet,
      reading: reviewed.reading ?? guessReading(declaration, table, formats),
    }
  }

  const removable = removableRow(onRemove)
  return (
    <li {...removable} className={`border border-hairline-strong bg-elevated px-4 py-3 ${removable.className}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <input
          type="checkbox"
          checked={ticked}
          disabled={!reviewed.writable}
          onChange={(event) => onTick(event.target.checked)}
          aria-label={`Write ${file.name}`}
        />
        <Bidi className="font-medium">{file.name}</Bidi>
        {sheets.length > 1 && (
          <span className="text-caption text-ink-tertiary">
            sheet <Bidi>{sheets[reviewed.sheet] ?? ''}</Bidi>
          </span>
        )}
        {file.items !== undefined && (
          <ItemsLine
            name={file.name}
            from={file.items.from}
            count={Math.max(0, reviewed.table.rows.length - 1)}
            sections={file.items.sections}
            under={file.items.under}
            onUnder={onUnder}
          />
        )}
        {file.notes !== undefined && file.items === undefined && (
          <span className="text-caption text-ink-tertiary tabular-nums">
            {file.notes.length === 1 ? '1 note' : `${String(file.notes.length)} notes`}
            {(file.skipped ?? []).length > 0 && (
              <>
                {' '}· not read: <Bidi>{(file.skipped ?? []).join(', ')}</Bidi>
              </>
            )}
          </span>
        )}
        {writable.length > 1 && (
          <label className="flex items-center gap-1.5 text-caption text-ink-secondary">
            onto
            <select
              className={SELECT}
              value={declaration.name}
              aria-label={`The format ${file.name} is read onto`}
              onChange={(event) => onOnto(event.target.value)}
            >
              {onto.own.map((each) => (
                <option key={each.name} value={each.name}>
                  {each.title}
                </option>
              ))}
              {onto.packs.map((group) => (
                <optgroup key={group.pack} label={group.title}>
                  {group.formats.map((each) => (
                    <option key={each.name} value={each.name}>
                      {each.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        )}
        {reviewed.writable && plan !== undefined && reconciles(plan) && <Chip>reconciled</Chip>}
        <span className="ml-auto flex items-center gap-1">
          {editing === undefined && (
            <Button size="sm" variant="ghost" onClick={() => onEdit(fresh())}>
              Change
            </Button>
          )}
          <IconAction label="Remove" onClick={onRemove}>
            <path d="M6 6l12 12M18 6 6 18" />
          </IconAction>
        </span>
      </div>

      <p className="mt-1 text-caption text-ink-secondary">
        <HowLine how={how} title={declaration.title} any={anyReader} />
      </p>
      {(how.kind === 'NONE' || how.kind === 'CLOSE') && editing === undefined && reviewed.reading !== undefined && (
        <GuessLine table={reviewed.table} reading={reviewed.reading} />
      )}

      {reviewed.sameAs !== undefined && (
        <p className="mt-1 text-caption text-ink-secondary">
          The same file as <Bidi>{reviewed.sameAs}</Bidi>, above — it is written once.
        </p>
      )}

      {plan?.prior !== undefined && (
        <p className="mt-1 text-caption text-ink-secondary">
          Read before, on {new Date(plan.prior.readAt).toLocaleDateString()}:{' '}
          {plan.prior.rowCount === 1 ? '1 entry' : `${String(plan.prior.rowCount)} entries`}. Writing
          it again adds them a second time.{' '}
          <button
            type="button"
            className="text-accent underline-offset-2 hover:underline"
            onClick={() => {
              const prior = plan.prior
              if (prior !== undefined) onSupersede(prior)
            }}
          >
            Remove what it wrote
          </button>
        </p>
      )}

      {plan?.again !== undefined && (
        <AgainLines again={plan.again} removeGone={removeGone} onRemoveGone={onRemoveGone} />
      )}

      {/* Nothing to find an entry by, said once (M50 U3, D-224). */}
      {plan?.unkeyed !== undefined && plan.prior === undefined && lineCounts(plan).typed > 0 && (
        <p className="mt-1 text-caption text-ink-tertiary">{plan.unkeyed}</p>
      )}

      {plan !== undefined && <PlanLines declaration={declaration} plan={plan} table={reviewed.table} />}

      {editing !== undefined && (
        <ReaderEditor
          db={db}
          declaration={declaration}
          declarations={declarations}
          formats={formats}
          file={file}
          others={others}
          editing={editing}
          onChange={onEdit}
          onUse={() => onUse(editing)}
          onCancel={() => onEdit(undefined)}
        />
      )}
    </li>
  )
}

/** A folder's items: how many, and the heading they are read from (M38 U4). */
function ItemsLine({
  name,
  from,
  count,
  sections,
  under,
  onUnder,
}: {
  name: string
  from: ItemsFrom
  count: number
  sections: readonly string[]
  under: string | undefined
  onUnder: (heading: string | undefined) => void
}) {
  const what = from === 'list' ? 'item' : 'table row'
  return (
    <span className="flex items-center gap-1.5 text-caption text-ink-tertiary tabular-nums">
      {count === 1 ? `1 ${what}` : `${String(count)} ${what}s`}
      {sections.length > 0 && (
        <>
          {' '}from
          <select
            className={SELECT}
            value={under ?? ''}
            aria-label={`The heading ${name} is read from`}
            onChange={(event) => onUnder(event.target.value === '' ? undefined : event.target.value)}
          >
            <option value="">every heading</option>
            {sections.map((each) => (
              <option key={each} value={each}>
                {each}
              </option>
            ))}
          </select>
        </>
      )}
    </span>
  )
}

/** Which reader read this file, or plainly that none fits. */
function HowLine({ how, title, any }: { how: How; title: string; any: boolean }) {
  switch (how.kind) {
    case 'FITS':
      return (
        <>
          Read with {how.session ? 'the reader you just made for ' : 'your reader for '}
          <Bidi className="text-ink">{readerName(how.reader)}</Bidi>
          {how.moved ? (
            <>
              {' '}— this file has its columns in another order, and each one was followed by its
              header. Check the entries before you write.
            </>
          ) : (
            '.'
          )}
        </>
      )
    case 'MADE':
      return <>Read with the reader you made for this file. It is kept when the file is written.</>
    case 'CLOSE':
      return (
        <>
          <span className="text-negative">
            Your reader for <Bidi>{readerName(how.reader)}</Bidi> doesn&rsquo;t fit this file:{' '}
            {closeSentence(how.why)}
          </span>{' '}
          Its columns are guessed instead — check them below; the guess is kept as a new reader when you write.
        </>
      )
    case 'NONE':
      return (
        <>
          {any ? <>No reader of <Bidi>{title}</Bidi> fits this file</> : <><Bidi>{title}</Bidi> has no reader yet</>}, so its
          columns are guessed — check them below; the guess is kept as its reader when you write.
        </>
      )
  }
}

/** The guessed mapping, in a line: each header the guess read, and the key it read it onto. */
function GuessLine({ table, reading }: { table: ReadTable; reading: Reading }) {
  const header = table.rows[reading.headerRow] ?? []
  return (
    <p className="mt-1 text-caption text-ink-tertiary">
      {reading.columns.length === 0 ? (
        'No column is recognised — Change to say which is which.'
      ) : (
        <Bidi>
          {reading.columns
            .map((each) => `${header[each.index]?.text ?? ''} → ${each.key}`)
            .join(' · ')}
        </Bidi>
      )}
    </p>
  )
}

/** At most this many entries named in each line of a read again. */
const AGAIN_NAMED = 5

/**
 * **A file read before, read again** (M38 U3, D-408): what it changes, adds and
 * finds gone, each entry named — and, for the gone, a box to take them away,
 * since nothing is removed unasked.
 */
function AgainLines({
  again,
  removeGone,
  onRemoveGone,
}: {
  again: PlannedRereading
  removeGone: boolean
  onRemoveGone: (value: boolean) => void
}) {
  const named = (rows: readonly { readonly key: string; readonly name: string | undefined }[]): string =>
    rows
      .slice(0, AGAIN_NAMED)
      .map((row) => row.name ?? row.key)
      .join(', ') + (rows.length > AGAIN_NAMED ? `, and ${String(rows.length - AGAIN_NAMED)} more` : '')
  const removable = removableGone(again).length
  const linked = again.gone.length - removable
  const nothing = again.changed.length === 0 && again.added.length === 0 && !(removeGone && removable > 0)
  const counts = [
    `${String(again.changed.length)} changed`,
    `${String(again.added.length)} added`,
    `${String(again.same)} as before`,
    ...(again.edited.length === 0 ? [] : [`${String(again.edited.length)} changed here`]),
    ...(again.gone.length === 0 ? [] : [`${String(again.gone.length)} gone`]),
  ]
  return (
    <div className="mt-1 space-y-1 text-caption">
      <p className="text-ink-secondary tabular-nums">
        {again.readBefore ? (
          <>Read before, from <Bidi>{again.from}</Bidi>: </>
        ) : (
          // Not this file before, but its entries are here already (M50 U3).
          <>Already here, each found {keySentence(again.key)}: </>
        )}
        {counts.join(' · ')}
        {nothing && (
          <span className="text-ink-tertiary">
            {again.readBefore
              ? ' — nothing has changed since, so there is nothing to write'
              : ' — every entry already says what the file says, so there is nothing to write'}
          </span>
        )}
      </p>
      {again.changed.length > 0 && (
        <p className="text-ink-secondary">
          Changed:{' '}
          <Bidi>
            {again.changed
              .slice(0, AGAIN_NAMED)
              .map((row) => `${row.name ?? row.key} (${row.columns.join(', ')})`)
              .join(', ')}
          </Bidi>
          {again.changed.length > AGAIN_NAMED && `, and ${String(again.changed.length - AGAIN_NAMED)} more`}
        </p>
      )}
      {again.added.length > 0 && (
        <p className="text-ink-secondary">
          Added: <Bidi>{named(again.added.map((key) => ({ key, name: undefined })))}</Bidi>
        </p>
      )}
      {again.edited.length > 0 && (
        <p className="text-ink-secondary">
          Changed here since the last read, so left as {again.edited.length === 1 ? 'it is' : 'they are'}:{' '}
          <Bidi>{named(again.edited)}</Bidi>
        </p>
      )}
      {again.gone.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 text-ink-secondary">
          <span>
            Gone from the file: <Bidi>{named(again.gone)}</Bidi>
            {linked > 0 && (
              <span className="text-ink-tertiary">
                {' '}— {linked === 1 ? 'one is' : `${String(linked)} are`} linked to, and stay{linked === 1 ? 's' : ''}
              </span>
            )}
          </span>
          {removable > 0 && (
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={removeGone} onChange={(event) => onRemoveGone(event.target.checked)} />
              Remove {removable === 1 ? 'it' : `these ${String(removable)}`}
            </label>
          )}
        </p>
      )}
    </div>
  )
}

/**
 * What writing this file would do — the two counts and the proof, kept apart
 * for D-138's reason — and anything that stops it.
 */
function PlanLines({
  declaration,
  plan,
  table,
}: {
  declaration: FormatDeclaration
  plan: ReadingPlan
  /** The file read, so a refused row of a folder is named by its note (M34 U7). */
  table?: ReadTable
}) {
  const { typed, failed } = lineCounts(plan)
  const refusals = refusalsOf(plan)
  const proof = plan.proof
  const failedRows = (plan.read?.rows ?? []).filter((row) => row.cells === undefined)
  // A body link naming no row is left out, the note still read (M38 U2).
  const unlinked = (plan.read?.rows ?? []).flatMap((row) =>
    row.cells === undefined ? [] : (row.unlinked ?? []).map((each) => ({ line: row.line, each })),
  )
  const failing = plan.failing

  return (
    <div className="mt-1 space-y-1 text-caption">
      {plan.read !== undefined && (
        <p className="text-ink-secondary tabular-nums">
          {[
            // A read again counts what it changes above (D-408), not every entry.
            ...(plan.again === undefined ? [<span key="entries">{typed === 1 ? '1 entry' : `${String(typed)} entries`}</span>] : []),
            ...(failed > 0
              ? [
                  <span key="failed" className="text-negative">
                    {failed === 1 ? '1 line will not be read' : `${String(failed)} lines will not be read`}
                  </span>,
                ]
              : []),
            ...(declaration.identities.length > 0 && proof !== undefined
              ? [
                  <span key="proof">
                    {proof.proved} proved · {proof.failed} failed · {proof.unchecked} unchecked
                  </span>,
                ]
              : []),
            ...(declaration.identities.length === 0 && plan.header === undefined
              ? [
                  <span key="nothing" className="text-ink-tertiary">
                    {plan.again !== undefined && failed === 0 ? 'This' : 'this'} format makes no claim, so
                    nothing was checked
                  </span>,
                ]
              : []),
          ].flatMap((part, at) => (at === 0 ? [part] : [<span key={`dot-${String(at)}`}> · </span>, part]))}
        </p>
      )}
      {plan.lines !== undefined && (
        <LineAccount
          lines={plan.lines}
          notes={table?.rowNames === undefined ? undefined : table.keyedBy !== undefined ? 'item' : 'note'}
        />
      )}
      {(plan.header?.verdicts ?? []).map((each) => (
        <p
          key={each.identity.name}
          className={each.verdict.kind === 'FAILED' ? 'text-negative' : 'text-ink-secondary'}
        >
          <Bidi>{verdictSentence(each.identity, each.verdict)}</Bidi>
        </p>
      ))}
      {refusals.slice(0, 8).map((each) => (
        <p key={each} className="text-negative">
          <Bidi>{each}</Bidi>
        </p>
      ))}
      {failedRows.slice(0, 5).map((row) => (
        <p key={row.line} className="text-ink-secondary">
          <span className="text-ink-tertiary tabular-nums">
            <Bidi>{capitalize(rowLabel(table, row.line))}</Bidi>
          </span>{' '}
          —{' '}
          <Bidi>{row.problem ?? ''}</Bidi>
        </p>
      ))}
      {failedRows.length > 5 && (
        <p className="text-ink-tertiary">and {failedRows.length - 5} more.</p>
      )}
      {unlinked.slice(0, 5).map(({ line, each }) => (
        <p key={`${String(line)}:${each.key}:${each.name}`} className="text-ink-secondary">
          <span className="text-ink-tertiary tabular-nums">
            <Bidi>{capitalize(rowLabel(table, line))}</Bidi>
          </span>{' '}
          — <Bidi>{each.reason}</Bidi>
        </p>
      ))}
      {unlinked.length > 5 && (
        <p className="text-ink-tertiary">and {unlinked.length - 5} more links left out.</p>
      )}
      {failing.slice(0, 5).map((each) => (
        <p key={each.id} className="text-negative">
          <span className="tabular-nums">{capitalize(each.id)}</span> fails a claim —{' '}
          <Bidi>{each.sentences.join(' ')}</Bidi>
        </p>
      ))}
      {failing.length > 5 && (
        <p className="text-ink-tertiary">and {failing.length - 5} more that fail one.</p>
      )}
    </div>
  )
}

/**
 * The readers this format has, each one renamed or forgotten in place (M26 F1).
 *
 * Forgetting asks first, in a line, and says what it does not do: the entries a
 * reader wrote stay, and so does taking them back.
 */
function ReaderList({
  readers,
  onRename,
  onForget,
}: {
  readers: readonly Reader[]
  onRename: (reader: Reader, name: string) => void
  onForget: (reader: Reader) => void
}) {
  const [renaming, setRenaming] = useState<{ signature: string; text: string } | undefined>(undefined)
  const [forgetting, setForgetting] = useState<string | undefined>(undefined)
  if (readers.length === 0) return null

  return (
    <ul className="mb-4 divide-y divide-hairline border-y border-hairline text-caption">
      {readers.map((reader) => (
        <li key={reader.signature} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
          {renaming?.signature === reader.signature ? (
            <form
              className="fc-view-enter flex items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                onRename(reader, renaming.text)
                setRenaming(undefined)
              }}
            >
              <input
                autoFocus
                className={FIELD}
                value={renaming.text}
                placeholder={reader.files[0] ?? ''}
                aria-label="Reader name"
                onChange={(event) => setRenaming({ signature: reader.signature, text: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setRenaming(undefined)
                }}
              />
              <Button size="sm" variant="primary" type="submit">
                Rename
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRenaming(undefined)}>
                Cancel
              </Button>
            </form>
          ) : (
            <Bidi className="text-ink">{readerName(reader)}</Bidi>
          )}
          {/* Unnamed, it is called after the file it last read; the rest are the history. */}
          {(reader.name === undefined ? reader.files.slice(1) : reader.files).length > 0 && (
            <span className="text-ink-tertiary">
              {reader.name === undefined ? 'also read ' : 'has read '}
              {(reader.name === undefined ? reader.files.slice(1) : reader.files).map((file, index) => (
                <span key={file}>
                  {index > 0 && ', '}
                  <Bidi>{file}</Bidi>
                </span>
              ))}
            </span>
          )}
          {forgetting === reader.signature ? (
            <span className="ml-auto flex items-center gap-2">
              <span className="text-ink-secondary">
                Forget it? The entries it wrote stay.
              </span>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  onForget(reader)
                  setForgetting(undefined)
                }}
              >
                Forget
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setForgetting(undefined)}>
                Cancel
              </Button>
            </span>
          ) : (
            renaming?.signature !== reader.signature && (
              <span className="ml-auto flex items-center gap-1">
                <IconAction
                  label="Rename"
                  onClick={() => setRenaming({ signature: reader.signature, text: reader.name ?? '' })}
                >
                  <path d="M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4" />
                </IconAction>
                <IconAction label="Forget" tone="negative" onClick={() => setForgetting(reader.signature)}>
                  <path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />
                </IconAction>
              </span>
            )
          )}
        </li>
      ))}
    </ul>
  )
}

/**
 * Making a reader for one file: the grid, the values that hold for the whole
 * file, and what it would read — judged live by the same `planReading`.
 */
function ReaderEditor({
  db,
  declaration,
  declarations,
  formats,
  file,
  others,
  editing,
  onChange,
  onUse,
  onCancel,
}: {
  db: Database
  declaration: FormatDeclaration
  declarations: readonly FormatDeclaration[]
  formats: FormatIndex
  file: Loaded
  /** The batch's other files that would be written, as a batch reads them. */
  others: readonly BatchFile[]
  editing: Editing
  onChange: (editing: Editing) => void
  onUse: () => void
  onCancel: () => void
}) {
  const table = file.tables[editing.sheet] ?? { rows: [], columnCount: 0 }
  // Judged with the batch's other files, so a link to a row one of them writes
  // reads here as it will on Write (M34 U2).
  const plan =
    planBatch(
      db,
      [...others, { name: file.name, hash: file.hash, table, declaration, reading: editing.reading }],
      formats,
      Date.now(),
    ).plans[others.length] ?? planReading(db, declaration, table, file, editing.reading, formats)
  const sheets = file.sheets

  return (
    <div className="fc-pop-enter mt-3 border-t border-hairline pt-3">
      {sheets.length > 1 && (
        <label className="mb-3 flex items-center gap-2 text-caption">
          <span className="text-ink-secondary">Sheet</span>
          <select
            className={SELECT}
            value={editing.sheet}
            onChange={(event) => {
              const sheet = Number(event.target.value)
              const next = file.tables[sheet] ?? { rows: [], columnCount: 0 }
              onChange({ ...editing, sheet, reading: guessReading(declaration, next, formats) })
            }}
          >
            {sheets.map((sheet, index) => (
              <option key={sheet} value={index}>
                {sheet}
              </option>
            ))}
          </select>
        </label>
      )}
      <Mapper
        declaration={declaration}
        table={table}
        reading={editing.reading}
        keys={offeredKeysOf(declaration)}
        onChange={(reading) => onChange({ ...editing, reading })}
      />
      <Fixed
        db={db}
        declaration={declaration}
        declared={declarations}
        reading={editing.reading}
        onChange={(reading) => onChange({ ...editing, reading })}
      />
      <PlanLines declaration={declaration} plan={plan} table={table} />
      <span className="mt-3 flex gap-2">
        <Button size="sm" variant="primary" disabled={!planWrites(plan)} onClick={onUse}>
          Use
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </span>
    </div>
  )
}

/** What was written, and the one way back out of it. */
function Written({
  formats,
  intakes,
  audits,
  onOpen,
  onEntry,
  onUndo,
  onMore,
}: {
  formats: FormatIndex
  intakes: readonly Intake[]
  audits: readonly FormatAudit[]
  onOpen: () => void
  onEntry: (format: string, row: string) => void
  onUndo: () => void
  onMore: () => void
}) {
  // A file read again wrote what changed, not every row it holds (D-408).
  const writtenBy = (each: Intake): number =>
    each.again === undefined ? each.rowCount : each.again.changed + each.again.added
  const rows = intakes.reduce((sum, each) => sum + writtenBy(each), 0)
  const again = intakes.some((each) => each.again !== undefined)
  const title = (intake: Intake): string => formats.get(intake.format)?.title ?? intake.format
  const titles = [...new Set(intakes.map(title))]
  return (
    <div className="fc-view-enter max-w-prose">
      <p className="mb-2">
        {rows === 1 ? '1 entry' : `${String(rows)} entries`} written from{' '}
        {intakes.length === 1 ? '1 file' : `${String(intakes.length)} files`} onto{' '}
        <Bidi>{titles.join(', ')}</Bidi>.
      </p>
      <ul className="mb-3 text-caption text-ink-secondary">
        {intakes.map((each) => (
          <li key={each.id}>
            <Bidi>{each.fileName}</Bidi> —{' '}
            {each.again === undefined
              ? each.rowCount === 1
                ? '1 entry'
                : `${String(each.rowCount)} entries`
              : `${String(each.again.changed)} changed · ${String(each.again.added)} added` +
                (each.again.removed === 0 ? '' : ` · ${String(each.again.removed)} removed`) +
                (each.again.gone === 0 ? '' : ` · ${String(each.again.gone)} gone, kept`)}
            {titles.length > 1 && (
              <>
                {' '}onto <Bidi>{title(each)}</Bidi>
              </>
            )}
          </li>
        ))}
      </ul>
      <WhatLooksWrong audits={audits} onOpen={onEntry} framed={false} />
      <span className="flex gap-2">
        <Button variant="primary" onClick={onOpen}>
          Open
        </Button>
        <Button variant="ghost" onClick={onMore}>
          Read more
        </Button>
        {/* A read again wrote over entries, and taking the reading back would
            remove them rather than restore them — so it has no Undo (D-408). */}
        {!again && (
          <Button variant="ghost" onClick={onUndo}>
            Undo
          </Button>
        )}
      </span>
    </div>
  )
}

/**
 * **Every line of the file, accounted for** (M34 U3, D-396): the heading, the
 * lines read, refused and empty, summing to the file — so a line cannot go
 * missing quietly between the file and the entries.
 */
function LineAccount({ lines, notes }: { lines: NonNullable<ReadingPlan['lines']>; notes?: 'note' | 'item' | undefined }) {
  // A folder's heading row is the table's, not a file's: count its notes (M34
  // U7), or its items (M38 U4).
  if (notes !== undefined) {
    const count = lines.lines - lines.heading
    return (
      <p className="text-ink-tertiary tabular-nums">
        {count === 1 ? `1 ${notes}` : `${String(count)} ${notes}s`}: {lines.read} read · {lines.refused} refused
        {!tallyAccounts(lines) && <span className="text-negative"> · some {notes}s are not accounted for</span>}
      </p>
    )
  }
  const parts = [
    `${String(lines.heading)} heading`,
    ...(lines.header === 0 ? [] : [`${String(lines.header)} header row`]),
    `${String(lines.read)} read`,
    `${String(lines.refused)} refused`,
    ...(lines.empty === 0 ? [] : [`${String(lines.empty)} empty`]),
  ]
  return (
    <p className="text-ink-tertiary tabular-nums">
      {lines.lines === 1 ? '1 line' : `${String(lines.lines)} lines`}: {parts.join(' · ')}
      {!tallyAccounts(lines) && <span className="text-negative"> · some lines are not accounted for</span>}
    </p>
  )
}
