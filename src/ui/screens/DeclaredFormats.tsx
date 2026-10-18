import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { joinedTally } from '@/data/repositories/formatAuditRepository.ts'
import { indexOf } from '@/data/repositories/formatJoinRepository.ts'
import { documentCurrency, listUnits, setDocumentCurrency } from '@/data/repositories/unitRepository.ts'
import { instantDay } from '@/core/instant.ts'
import {
  adoptFormat,
  changeMarks,
  deleteFormat,
  formatsPointingAt,
  listFormats,
  observe,
  orphanedTables,
  pendingPlans,
  planFor,
  unreadableFormats,
} from '@/data/repositories/formatRepository.ts'
import { ARTEFACT_EXTENSION, read, write } from '@/domain/format/artefact.ts'
import { tableNameFor, type FormatDeclaration } from '@/domain/format/declaration.ts'
import {
  declarationOf,
  draftOf,
  draftProblems,
  newDraft,
  pruned,
  type FormatDraft,
} from '@/domain/format/draft.ts'
import { planIsSettled, type ReconcilePlan } from '@/domain/format/reconcile.ts'
import type { Tally } from '@/domain/format/row.ts'
import type { UnitTable } from '@/domain/format/unit.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { formatPath, readPath } from '@/ui/nav.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { Chip } from '@/ui/components/Chip.tsx'
import { IconAction } from '@/ui/components/IconAction.tsx'
import { FIELD_MULTILINE } from '@/ui/components/fieldLook.ts'
import { ExamplePanel } from '@/ui/formats/ExamplePanel.tsx'
import { FormatDoors } from '@/ui/formats/FormatDoors.tsx'
import { NewFormat } from '@/ui/formats/NewFormat.tsx'
import { creationOf, openingShape, type Shape } from '@/ui/formats/shape.ts'
import type { ImportedShape } from '@/ui/screens/FormatRows.tsx'
import { deleteFormatRefusal, rowWriteRefusal } from '@/domain/format/owner.ts'
import { formatsByPack, useKeptPacks } from '@/ui/packs.ts'

/**
 * **The formats this document declares** — M19 U1 (D-216), rebuilt by U2a
 * (D-219).
 *
 * ## What changed, and what deliberately did not
 *
 * D-216 made this the *review* step of a loop that ran through a file:
 * *conversation → declaration → paste it here → compile → fill*. It was driven
 * on 2026-09-16 and rejected in about ten seconds, and rightly —
 * pasting markdown is not a thing a person does to get a table. **Declaring one
 * is now the first arrow**, and the markdown is what it always actually was: an
 * import and an export, for a diff or for a conversation with a model.
 *
 * Nothing underneath moved. The types, `money` as two columns, the
 * reconciler's four refusals, the `fmt_` guard and all five plugin tools sit on
 * a `FormatDeclaration` and never saw the markdown in the first place, which is
 * why the fault was one screen wide and the fix is too.
 *
 * ## The list you land on, and the three doors out of it
 *
 * The screen is the list of formats; since M20 U2, **a chooser of three** — an
 * example, a declaration, nothing — which is the screen for as long as you are
 * choosing rather than a panel opening above the list; and, since M29 U1
 * (D-331), **the editor on a format not made yet** (`NewFormat`). The example
 * panel is U2c's (D-221), where a local model works the columns out from a
 * label or a receipt; the import box is D-219's.
 *
 * **All three ways in land in the one editor rather than in the document** —
 * the same sheet, band and panel a format that exists is changed in, with the
 * draft filled in as far as the door got it, and Create underneath. The walk
 * (T1, D-237) and the blank sheet (M23 U2, D-248) were two more ways to author
 * one, and one was asked for. A declaration naming a format the document
 * already has opens *that* format's editor, with the change waiting under it.
 *
 * **A format that exists is changed on its own sheet** (M26 U3) — a column's
 * header, the `+` after the last one, what has to add up — and only removed
 * here. This screen creates, and it never alters.
 *
 * `accent` marks the actions and never a figure, per D-125.
 */
export function DeclaredFormats() {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  const mutate = useDocumentStore((state) => state.mutate)

  const [mode, setMode] = useState<Mode>({ kind: 'LIST' })
  const navigate = useNavigate()
  const [deleting, setDeleting] = useState<FormatDeclaration | undefined>(undefined)
  // Which packs the document keeps — whose each format is (M33 F3).
  const kept = useKeptPacks()

  const data = useMemo(() => {
    if (db === undefined) return undefined
    const formats = listFormats(db)
    // **The document's units, not the build's** (U4a, D-223). A conversion is
    // resolved against what this file knows, so a person who corrected `tbsp`
    // to 20 ml sees their own answer here rather than this build's opinion.
    const units = listUnits(db)
    const index = indexOf(formats)
    const marks = changeMarks(db)
    return {
      // What a new amount starts in (M29 F3, D-344).
      currency: documentCurrency(db),
      formats: formats.map((format) => ({
        format,
        rows: observe(db, format)?.rowCount ?? 0,
        // When a row of it was last added, changed or removed (M47 U5, D-462).
        changed: marks.get(format.name),
        // **Recomputed here rather than stored with the rows** (D-222): a
        // verdict is a fact about the declaration as it is now, and a stored
        // one is the frozen table of totals the vault already suffered from
        // (D-210). A format is a vault's worth of rows, not a ledger's.
        proof:
          format.identities.length === 0
            ? undefined
            : joinedTally(db, format, index, units),
      })),
      names: formats.map((format) => format.name),
      // **The declarations and not only the names** (U4b, D-224): a link picks
      // a format, an aggregate folds one, and which of another format's columns
      // points back here is a question only its declaration can answer.
      declared: formats,
      units,
      pending: pendingPlans(db),
      unreadable: unreadableFormats(db),
      orphans: orphanedTables(db),
    }
    // `revision` is the dependency that matters: every mutation bumps it.
  }, [db, revision])

  /**
   * The format being made, judged, and what Create would do — recomputed on
   * every keystroke, because that is what makes a problem useful while it is
   * being caused rather than after. **Judged without its blank columns**
   * (`pruned`), which is also what Create declares.
   *
   * **The plan is only asked for once the draft is a declaration the document
   * would accept.** Planning against a half-typed name would compare the table
   * to something nobody has described yet.
   */
  const judged = useMemo(() => {
    if (db === undefined || mode.kind !== 'NEW') return undefined
    const draft = pruned(mode.shape.draft)
    const problems = draftProblems(draft, data?.declared ?? [], data?.units)
    const plan = problems.length > 0 ? undefined : planFor(db, declarationOf(draft))
    return { ...creationOf(draft, problems), plan, declaration: declarationOf(draft) }
  }, [db, mode, data?.declared, data?.units, revision])

  /** Where a door lands: the editor on its draft, or on the format it names. */
  const open = (draft: FormatDraft): void => {
    if (draft.revising !== undefined) {
      const state: ImportedShape = { imported: declarationOf(draft) }
      navigate(formatPath(draft.revising), { state })
      return
    }
    setMode({ kind: 'NEW', shape: openingShape(draft) })
  }

  if (db === undefined || data === undefined) {
    return <Centered>Open a document to see the formats it declares.</Centered>
  }

  if (mode.kind === 'NEW' && judged !== undefined) {
    const { declaration } = judged
    return (
      <NewFormat
        shape={mode.shape}
        others={data.declared}
        units={data.units}
        currency={{
          code: data.currency,
          onChange: (code) => mutate((database) => void setDocumentCurrency(database, code)),
        }}
        problems={judged.shown}
        waiting={judged.waiting}
        plan={judged.plan}
        onShape={(shape) => setMode({ kind: 'NEW', shape })}
        onCancel={() => setMode({ kind: 'LIST' })}
        onCopy={() => {
          void navigator.clipboard?.writeText(write(declaration))
        }}
        onCreate={() => {
          mutate((database) => adoptFormat(database, declaration, Date.now()))
          setMode({ kind: 'LIST' })
          navigate(formatPath(declaration.name))
        }}
      />
    )
  }

  /**
   * **The three ways in are the screen while you are choosing between them**
   * (M20 U2).
   *
   * They were panels that opened *above* the list, which left a person looking
   * at a chooser and a table of formats at once and no clue which one they were
   * in. A door is a place you go through: the list is behind it and comes back
   * when you press Cancel.
   */
  if (
    mode.kind === 'DOORS' ||
    mode.kind === 'EXAMPLE' ||
    mode.kind === 'IMPORT'
  ) {
    const back = mode.kind === 'DOORS' ? { kind: 'LIST' as const } : { kind: 'DOORS' as const }
    return (
      <div key="doors" className="fc-view-enter flex h-full flex-col">
        <div className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-hairline px-6 py-2">
          <span className="font-medium">A new format</span>
          <span className="text-caption text-ink-tertiary">
            A format is a kind of thing this document can hold. Nothing is written until you save.
          </span>
          <span className="ml-auto">
            <Button variant="ghost" size="sm" onClick={() => setMode(back)}>
              {mode.kind === 'DOORS'
                ? data.formats.length === 0
                  ? 'Not now'
                  : 'Back to the formats'
                : 'Back to the ways in'}
            </Button>
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {mode.kind === 'DOORS' && (
            <FormatDoors
              onExample={() => setMode({ kind: 'EXAMPLE' })}
              onImport={() => setMode({ kind: 'IMPORT' })}
              onEmpty={() => setMode({ kind: 'NEW', shape: openingShape(newDraft()) })}
            />
          )}

          {mode.kind === 'EXAMPLE' && (
            <div className="fc-view-enter mx-auto max-w-[56rem] px-6 py-4">
              <ExamplePanel onOpen={open} />
            </div>
          )}

          {mode.kind === 'IMPORT' && (
            <div className="fc-view-enter mx-auto max-w-[56rem] px-6 py-4">
              <ImportPanel
                existingNames={data.names}
                declared={data.declared}
                units={data.units}
                onOpen={open}
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  const grouped = formatsByPack(data.formats, kept, (each) => each.format.name)

  /** One format's card — the same wherever it is listed. */
  const card = ({ format, rows, changed, proof }: Listed): React.ReactNode => (
    <li key={format.name} className="fc-card group">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {/* A title can be Hebrew — typed, imported, or proposed from
            a Hebrew receipt since U2c — and a raw one scrambles beside
            the table name next to it. */}
        <Link to={formatPath(format.name)} className="fc-card-link font-medium text-ink">
          <Bidi>{format.title}</Bidi>
        </Link>
        <code className="text-caption text-ink-tertiary">{tableNameFor(format)}</code>
        <Chip>
          {format.columns.length === 1 ? '1 column' : `${format.columns.length} columns`}
        </Chip>
        <span className="text-caption text-ink-secondary tabular-nums">
          {rows === 1 ? '1 row' : `${rows} rows`}
        </span>
        {/* M47 U5 (D-462): a format nobody writes says so. Absent on a
            text document written before there were marks, until its next
            write — a date it does not know would be a guess. */}
        {changed !== undefined && (
          <span
            className="text-caption text-ink-secondary tabular-nums"
            title="The day a row was last added, changed or removed, or the format itself was changed"
          >
            last changed {instantDay(changed)}
          </span>
        )}
        <ProofChip format={format} proof={proof} />
        <span className="relative z-10 ml-auto flex items-center gap-0.5 self-center">
          {/* **Edit is the sheet** (M26 U3): a format is changed
              where its entries are — a column's header, the `+`
              after the last one, and its claims. */}
          <IconAction label="Edit" onClick={() => navigate(formatPath(format.name))}>
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </IconAction>
          {/* Kept on the card (D-288), and since M26 U5 it opens
              the reading screen, where any number of files are read
              at once, each by the reader that fits it. A pack's
              format is read only through the pack (M25 E5, D-269). */}
          {rowWriteRefusal(format) === undefined && (
            <IconAction
              label="Read a file"
              onClick={() => navigate(readPath(format.name))}
            >
              <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Z" />
              <path d="M14 3v5h5" />
              <path d="M12 11v6" />
              <path d="m9 14 3 3 3-3" />
            </IconAction>
          )}
          {deleteFormatRefusal(format) === undefined && (
            <IconAction label="Delete" tone="negative" onClick={() => setDeleting(format)}>
              <path d="M4 7h16" />
              <path d="M10 11v6M14 11v6" />
              <path d="M6 7l1 13h10l1-13" />
              <path d="M9 7V4h6v3" />
            </IconAction>
          )}
        </span>
      </div>
    </li>
  )

  return (
    <div key="list" className="fc-view-enter flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-6 gap-y-1 border-b border-hairline px-6 py-2">
        <span className="text-ink-secondary tabular-nums">
          {data.formats.length === 1 ? '1 format' : `${data.formats.length} formats`}
        </span>
        <span className="text-caption text-ink-tertiary">
          A format is a kind of thing this document can hold. The declaration is the source of
          truth; its table is made to match on every open.
        </span>
        {/* **One way in rather than three** (M20 U2). The three ways are a
            choice, and a choice belongs in the middle of the screen where it
            can be read, not spread across a toolbar where two of them look
            like afterthoughts beside the primary. */}
        {/* Withheld while the list is empty, because the three doors are
            already on the screen underneath it and this button is the same
            action twice (M20 U2). */}
        {data.formats.length > 0 && (
          <span className="ml-auto flex items-center gap-2">
            <Button variant="primary" size="sm" data-tour="new-format" onClick={() => setMode({ kind: 'DOORS' })}>
              New format
            </Button>
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-4">

        {data.pending.length > 0 && (
          <section className="mb-6 rounded-lg border border-hairline-strong bg-elevated p-4">
            <h2 className="mb-2 font-medium">Waiting for an answer</h2>
            <p className="mb-3 text-caption text-ink-secondary">
              These are the changes the app will not make on its own. Nothing has been written and
              nothing has been lost — empty the column first, or take the format away and declare
              it again.
            </p>
            {data.pending.map((plan) => (
              <PlanView key={plan.format} plan={plan} />
            ))}
          </section>
        )}

        {data.unreadable.length > 0 && (
          <section className="mb-6 rounded-lg border border-hairline-strong bg-elevated p-4">
            <h2 className="mb-2 font-medium">Not readable by this build</h2>
            {data.unreadable.map((each) => (
              <p key={each.name} className="text-caption text-ink-secondary">
                <span className="text-ink">{each.name}</span> — {each.reason}
              </p>
            ))}
          </section>
        )}

        {data.orphans.length > 0 && (
          <p className="mb-6 text-caption text-ink-tertiary">
            {data.orphans.join(', ')} {data.orphans.length === 1 ? 'is a table' : 'are tables'} with
            no declaration behind {data.orphans.length === 1 ? 'it' : 'them'}. Left exactly as{' '}
            {data.orphans.length === 1 ? 'it is' : 'they are'} — the app only touches what it can
            see a declaration for.
          </p>
        )}

        {data.formats.length === 0 ? (
          /* **The empty state is the choice itself** (M20 U2), not a paragraph
             describing three buttons in a toolbar. A person opening a new
             document lands here, and what they need is somewhere to press. */
          <FormatDoors
            onExample={() => setMode({ kind: 'EXAMPLE' })}
            onImport={() => setMode({ kind: 'IMPORT' })}
            onEmpty={() => setMode({ kind: 'NEW', shape: openingShape(newDraft()) })}
          />
        ) : (
          /* **A card is the way in, and its icons are the only other things
             on it** (M26 U1, D-288). The whole card opens the table — a
             stretched link, so the icons stay buttons rather than buttons
             nested inside a link — and every sentence that said what a button
             would do is gone: *Edit*, *Read a document*, *Delete* are a title
             on hover, not a label. Square corners and the hover are
             `.fc-card`'s, in `tokens.css`, and this is the only screen that
             wears them until the maintainer has judged it. */
          /* **Their own first, then each pack's under its name** (M33 F3): a
             person's two formats are not to be found by reading past the
             ledger's twenty. Indented, not folded away — it is a list to
             scan, and a heading is all a group needs. */
          <div className="space-y-6">
            {grouped.own.length > 0 && <ul className="space-y-2">{grouped.own.map(card)}</ul>}
            {grouped.packs.map((group) => (
              <section key={group.pack} aria-label={group.title} data-tour={`formats-pack-${group.pack}`}>
                <h2 className="mb-2 text-caption font-medium text-ink-secondary">{group.title}</h2>
                <ul className="space-y-2 border-l border-hairline pl-5">{group.formats.map(card)}</ul>
              </section>
            ))}
          </div>
        )}
      </div>

      {deleting !== undefined && (
        <DeletePanel
          format={deleting}
          referrers={formatsPointingAt(db, deleting.name)}
          rows={data.formats.find((each) => each.format.name === deleting.name)?.rows ?? 0}
          onCancel={() => setDeleting(undefined)}
          onDelete={() => {
            const name = deleting.name
            setDeleting(undefined)
            mutate((database) => deleteFormat(database, name))
          }}
        />
      )}
    </div>
  )
}

/**
 * What this format's identities say about the rows it holds — U3, D-222.
 *
 * **The tally over every row of the format**, which is the question this list
 * answers and the row screen does not: `#/formats/<name>` draws a verdict per
 * row, and this is whether the format as a whole adds up (M20 U1, D-229).
 *
 * `positive` reports what the app found and `negative` reports what it found
 * wrong; neither is `accent`, which marks only what you can act on (D-125).
 * **`unchecked` is drawn in ordinary ink** rather than in a warning colour —
 * the third state is not a small failure, it is a row that has nothing in a
 * column an identity names, and most rows of a half-filled format are in it.
 */
function ProofChip({ format, proof }: { format: FormatDeclaration; proof: Tally | undefined }) {
  if (proof === undefined) {
    return (
      <span className="text-caption text-ink-tertiary">
        no claims
      </span>
    )
  }
  const counted = format.identities.length === 1 ? '1 claim' : `${format.identities.length} claims`
  if (proof.proved + proof.failed + proof.unchecked === 0) {
    return <span className="text-caption text-ink-tertiary">{counted}, no rows to check yet</span>
  }
  return (
    <span className="flex items-baseline gap-2 text-caption tabular-nums">
      <span className="text-ink-tertiary">{counted}</span>
      {proof.proved > 0 && <span className="text-positive">{proof.proved} proved</span>}
      {proof.failed > 0 && <span className="text-negative">{proof.failed} failed</span>}
      {proof.unchecked > 0 && (
        <span className="text-ink-secondary">{proof.unchecked} unchecked</span>
      )}
    </span>
  )
}

/**
 * The screen's four states.
 *
 * A discriminated union rather than three booleans and a nullable draft, per the
 * house style: "editing", "importing" and "working one out" are not independent,
 * and the draft exists exactly when the first of them is true.
 */
/** A format as the list shows it: its declaration, its rows, what adds up. */
interface Listed {
  readonly format: FormatDeclaration
  readonly rows: number
  /** When it last changed, in epoch milliseconds; absent when the document has no mark for it. */
  readonly changed: number | undefined
  readonly proof: Tally | undefined
}

type Mode =
  | { readonly kind: 'LIST' }
  /** The three ways a format begins, in the middle of the screen (M20 U2). */
  | { readonly kind: 'DOORS' }
  | { readonly kind: 'IMPORT' }
  /** A local model working the columns out from an example (U2c, D-221). */
  | { readonly kind: 'EXAMPLE' }
  /**
   * Making one, in the editor a format is changed in (M29 U1, D-331) — it
   * replaced the walk (T1, D-237) and the blank sheet (M23 U2, D-248).
   */
  | { readonly kind: 'NEW'; readonly shape: Shape }

/**
 * A declaration somebody else wrote, on its way into the editor.
 *
 * **It opens the editor; it does not touch the document.** A model can emit a
 * declaration and a person can keep one in a file, and both are worth
 * importing — but neither is worth adopting unread, and the fields are where a
 * person actually reads one.
 *
 * `revising` is set only when the document already has a format of that name,
 * because that is what decides whether this is an edit or a new table: the name
 * of an existing format is fixed, and the name of a new one is not.
 */
function ImportPanel({
  existingNames,
  declared,
  units,
  onOpen,
}: {
  existingNames: readonly string[]
  declared: readonly FormatDeclaration[]
  units: UnitTable
  onOpen: (draft: FormatDraft) => void
}) {
  const [text, setText] = useState('')
  // Judged against the document's units, so a declaration converting into
  // something this file has never heard of is refused here rather than opening
  // into a form whose every identity would come back `unchecked` (U4a, D-223).
  //
  // **And against the document's other formats** (U6, D-234). Without them a
  // `link` was refused here in every case — it is checked against the format it
  // points at, and the reader was handed none — so a declaration a conversation
  // can write could not come back through this door. The audit's first finding
  // was this one.
  const parsed = useMemo(
    () => (text.trim() === '' ? undefined : read(text, units, declared)),
    [text, units, declared],
  )

  return (
    <section className="mb-6 rounded-lg border border-hairline-strong bg-elevated p-4">
      {/* The door’s own words, so arriving here reads as having gone where
          you meant to (M20 U2). */}
      <h2 className="mb-1 font-medium">From a declaration</h2>
      <p className="mb-2 max-w-prose text-caption text-ink-secondary">
        A <code>{ARTEFACT_EXTENSION}</code> file, from a conversation with a model or from another
        document. It opens in the editor with its columns filled in — nothing is written until
        you create it.
      </p>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        rows={8}
        className={`${FIELD_MULTILINE} w-full font-mono text-caption`}
        placeholder={'---\nformat: book\ntitle: Book\nlanguage: 1\n---'}
      />
      {parsed !== undefined && !parsed.ok && (
        <p className="mt-2 text-caption text-negative">{parsed.error}</p>
      )}
      <Button
        className="mt-3"
        disabled={parsed === undefined || !parsed.ok}
        onClick={() => {
          if (parsed === undefined || !parsed.ok) return
          const declaration = parsed.value
          onOpen({
            ...draftOf(declaration),
            revising: existingNames.includes(declaration.name) ? declaration.name : undefined,
          })
        }}
      >
        Read it
      </Button>
    </section>
  )
}

/**
 * What a plan will do, and what it will not.
 *
 * The refusals come first and are the only thing here drawn in `negative`: they
 * are the reason to read this at all, and a list that buried them under six
 * `ADD COLUMN`s would be the confirm surface D-138 keeps catching.
 */
function PlanView({ plan }: { plan: ReconcilePlan }) {
  if (planIsSettled(plan)) {
    return (
      <p className="text-caption text-ink-secondary">
        <code>{plan.table}</code> already matches.
      </p>
    )
  }

  return (
    <div className="space-y-1">
      {plan.refusals.map((refusal) => (
        <p key={`${refusal.reason}-${refusal.column}`} className="text-caption text-negative">
          {refusal.detail}
        </p>
      ))}
      {/* A constraint taken down and put back around a rebuild is held throughout (M48 U1). */}
      {plan.steps.filter((step) => !('kept' in step && step.kept === true)).map((step, index) => (
        <p key={`${step.kind}-${step.column ?? index}`} className="text-caption text-ink-secondary">
          {describe(step.kind)}
          {step.column === undefined ? (
            <code> {plan.table}</code>
          ) : (
            <code>
              {' '}
              {plan.table}.{step.column}
            </code>
          )}
        </p>
      ))}
    </div>
  )
}

function describe(kind: ReconcilePlan['steps'][number]['kind']): string {
  switch (kind) {
    case 'CREATE_TABLE':
      return 'Create '
    case 'ADD_COLUMN':
      return 'Add '
    case 'DROP_COLUMN':
      return 'Remove '
    case 'RENAME_COLUMN':
      return 'Rename to '
    case 'LOOSEN_COLUMN':
      return 'May be left empty: '
    case 'REBUILD_TABLE':
      return 'Made again, every row kept, for: '
    case 'ADD_INDEX':
      return 'Make unique: '
    case 'DROP_INDEX':
      return 'No longer unique: '
    case 'ADD_CHECK':
      return 'Hold every row to: '
    case 'DROP_CHECK':
      return 'No longer held to: '
  }
}

/**
 * Deleting takes the table with it, so the panel says so in the figure the user
 * will actually mind — the row count — rather than in a general warning.
 */
/**
 * **The sentence here used to be *"nothing else in the document refers to
 * it"***, and U4b made that false in the one place it was load-bearing (D-224).
 * A format another one links to is a format whose ids are in that other table,
 * and dropping it leaves a column full of ids resolving to nothing and an
 * aggregate folding to `unchecked` for ever.
 *
 * So it is **refused rather than cascaded**: nothing in this app is
 * auto-deleted, and deleting somebody else's column to make this delete
 * possible would be the app doing the thinking the user came to do. The
 * refusal names the formats, because the fix is to edit them.
 */
function DeletePanel({
  format,
  rows,
  referrers,
  onCancel,
  onDelete,
}: {
  format: FormatDeclaration
  rows: number
  /** The formats that link to this one or fold its rows. */
  referrers: readonly string[]
  onCancel: () => void
  onDelete: () => void
}) {
  const blocked = referrers.length > 0

  return (
    <div className="fc-pop-enter shrink-0 border-t border-hairline bg-elevated px-6 py-4">
      <p className="mb-3 max-w-prose text-body">
        {blocked ? (
          <>
            <span className="font-medium">
              <Bidi>{format.title}</Bidi>
            </span>{' '}
            cannot go while {referrers.length === 1 ? 'another format refers' : 'other formats refer'}{' '}
            to it: <code>{referrers.join('</code>, <code>')}</code>. Take the link or the total
            out there first — deleting it here would leave a column of ids pointing at nothing, and
            nothing in this document is removed on your behalf.
          </>
        ) : (
          <>
            Delete{' '}
            <span className="font-medium">
              <Bidi>{format.title}</Bidi>
            </span>
            ? Its declaration and <code>{tableNameFor(format)}</code> both go, and{' '}
            {rows === 0
              ? 'the table is empty'
              : `${rows === 1 ? '1 row' : `${rows} rows`} go with it`}
            . Nothing else in the document refers to it.
          </>
        )}
      </p>
      <div className="flex gap-2">
        {!blocked && (
          <Button variant="primary" onClick={onDelete}>
            Delete the format
          </Button>
        )}
        <Button variant="ghost" onClick={onCancel}>
          Keep it
        </Button>
      </div>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-prose">{children}</p>
    </div>
  )
}
