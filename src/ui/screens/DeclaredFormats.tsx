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
import { type FormatDeclaration } from '@/domain/format/declaration.ts'
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
import { ConfirmAtButton } from '@/ui/components/ConfirmAtButton.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'
import { SidePanel } from '@/ui/components/SidePanel.tsx'
import { WaitingList, type Waiting } from '@/ui/components/WaitingList.tsx'
import { DeleteAtOnce } from '@/ui/formats/DeleteAtOnce.tsx'
import { useT } from '@/i18n/current.ts'
import { countKey } from '@/i18n/count.ts'
import type { MessageKey } from '@/i18n/catalogue.ts'
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
  // What a waiting line opens beside the list (M64 U13, D-625).
  const [panel, setPanel] = useState<{ readonly kind: 'PENDING' | 'UNREADABLE' | 'ORPHANS' } | undefined>(undefined)
  const t = useT()
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
    return { ...creationOf(draft, problems, t), plan, declaration: declarationOf(draft) }
  }, [db, mode, data?.declared, data?.units, revision, t])

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
    return <Centered>{t('formats.declare.noDocument')}</Centered>
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
          <h1 className="text-body font-medium">{t('formats.declare.newTitle')}</h1>
          <span className="text-caption text-ink-secondary">{t('formats.declare.newSay')}</span>
          <span className="ms-auto">
            <Button variant="ghost" size="sm" onClick={() => setMode(back)}>
              {mode.kind === 'DOORS'
                ? data.formats.length === 0
                  ? t('formats.declare.notNow')
                  : t('formats.declare.backToFormats')
                : t('formats.declare.backToDoors')}
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
            <div className="fc-view-enter px-6 py-4">
              <ExamplePanel onOpen={open} />
            </div>
          )}

          {mode.kind === 'IMPORT' && (
            <div className="fc-view-enter px-6 py-4">
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

  // **The answer, in words** (M64 U13, D-625): how many kinds of things, how
  // many rows, and whether their claims hold — a row counted once at its worst.
  const rows = data.formats.reduce((sum, each) => sum + each.rows, 0)
  const failed = data.formats.reduce((sum, each) => sum + (each.proof?.failed ?? 0), 0)
  const proved = data.formats.reduce((sum, each) => sum + (each.proof?.proved ?? 0), 0)

  // **What waits on the person, one strip below the answer** (M64 U13): a
  // change the app will not make on its own, a format this build cannot read,
  // a table nothing declares — each a sentence and a verb, the detail beside.
  const waiting: Waiting[] = [
    ...data.pending.map((plan) => ({
      key: `pending ${plan.format}`,
      say: t('formats.waiting.pending', {
        title: data.formats.find((each) => each.format.name === plan.format)?.format.title ?? plan.format,
      }),
      why: t('formats.waiting.pendingWhy'),
      verb: t('formats.waiting.see'),
      onDo: () => setPanel({ kind: 'PENDING' }),
    })),
    ...data.unreadable.map((each) => ({
      key: `unreadable ${each.name}`,
      say: t('formats.waiting.unreadable', { name: each.name }),
      verb: t('formats.waiting.why'),
      onDo: () => setPanel({ kind: 'UNREADABLE' }),
    })),
    ...(data.orphans.length === 0
      ? []
      : [
          {
            key: 'orphans',
            say: t(countKey('formats.waiting.orphans', data.orphans.length), { count: data.orphans.length }),
            verb: t('formats.waiting.seeThem'),
            onDo: () => setPanel({ kind: 'ORPHANS' }),
          },
        ]),
  ]

  /**
   * **One format, one row of the table** (M64 U13, D-625): its title opens it,
   * and so does the whole row; its figures are columns, right-aligned. Read a
   * file and Delete are the row's only other actions — Edit was the same place
   * the title opens, and went. Delete cannot be undone (its table goes), so it
   * asks at its own button, naming the format and what goes with it.
   */
  // A column empty on every row is not drawn (M64 U13): no claims anywhere, no marks anywhere.
  const anyChanged = data.formats.some((each) => each.changed !== undefined)
  const anyClaims = data.formats.some((each) => each.proof !== undefined)
  const line = ({ format, rows: held, changed, proof }: Listed): React.ReactNode => {
    const referrers = formatsPointingAt(db, format.name).map(
      // By their titles, as a person knows them — never their names (M54 F2).
      (name) => data.formats.find((each) => each.format.name === name)?.format.title ?? name,
    )
    return (
      // The demo's tour outlines a format the model just made by this (M54 F12): `formats-card-timesheet_day`.
      <tr
        key={format.name}
        data-tour={`formats-card-${format.name}`}
        className="group cursor-pointer border-b border-hairline hover:bg-surface"
        onClick={() => navigate(formatPath(format.name))}
      >
        <td className="py-2 pe-4 align-baseline">
          {/* A title can be Hebrew, and its table's name is machinery, never shown (M54 F2). */}
          <Link
            to={formatPath(format.name)}
            className="font-medium text-ink hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            onClick={(event) => event.stopPropagation()}
          >
            <Bidi>{format.title}</Bidi>
          </Link>
        </td>
        <td className="py-2 pe-4 text-end align-baseline tabular-nums">{held}</td>
        <td className="py-2 pe-8 text-end align-baseline text-ink-secondary tabular-nums">{format.columns.length}</td>
        {anyChanged && (
          <td className="py-2 pe-4 align-baseline text-caption text-ink-secondary tabular-nums" title={t('formats.list.changedHint')}>
            {/* M47 U5 (D-462): absent on a text document written before there were marks. */}
            {changed === undefined ? '' : instantDay(changed)}
          </td>
        )}
        {anyClaims && (
          <td className="py-2 pe-4 align-baseline">
            <ProofChip format={format} proof={proof} />
          </td>
        )}
        <td className="py-1 text-end align-baseline whitespace-nowrap" onClick={(event) => event.stopPropagation()}>
          <span className="inline-flex items-center gap-0.5 opacity-0 transition-opacity duration-[var(--duration-micro)] group-hover:opacity-100 focus-within:opacity-100">
            {/* A pack's format is read only through the pack (M25 E5, D-269). */}
            {rowWriteRefusal(format) === undefined && (
              <IconAction label={t('formats.list.readFile', { title: format.title })} onClick={() => navigate(readPath(format.name))}>
                <path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8Z" />
                <path d="M14 3v5h5" />
                <path d="M12 11v6" />
                <path d="m9 14 3 3 3-3" />
              </IconAction>
            )}
            {deleteFormatRefusal(format) === undefined &&
              (referrers.length > 0 ? (
                // **Refused rather than cascaded** (D-224): it names the formats, because the fix is there.
                <DeleteAtOnce
                  label={t('formats.deleteFormat.label', { title: format.title })}
                  onDelete={() => ({
                    say: (
                      <Phrase
                        text={t('formats.deleteFormat.kept')}
                        parts={{ title: <Bidi>{format.title}</Bidi>, others: <Bidi>{referrers.join(', ')}</Bidi> }}
                      />
                    ),
                    why: t('formats.deleteFormat.keptWhy'),
                  })}
                />
              ) : (
                <ConfirmAtButton
                  label={t('formats.deleteFormat.label', { title: format.title })}
                  question={<Phrase text={t('formats.deleteFormat.question')} parts={{ title: <Bidi>{format.title}</Bidi> }} />}
                  cost={
                    held === 0
                      ? t('formats.deleteFormat.empty')
                      : t(countKey('formats.deleteFormat.cost', held), { count: held })
                  }
                  confirm={t('formats.deleteFormat.confirm')}
                  cancel={t('formats.deleteFormat.cancel')}
                  onConfirm={() => mutate((database) => deleteFormat(database, format.name))}
                />
              ))}
          </span>
        </td>
      </tr>
    )
  }

  const head = (
    <thead>
      <tr className="border-b border-hairline text-start text-label text-ink-secondary uppercase">
        <th scope="col" className="py-2 pe-4 text-start font-medium">{t('formats.list.head.format')}</th>
        <th scope="col" className="py-2 pe-4 text-end font-medium">{t('formats.list.head.rows')}</th>
        <th scope="col" className="py-2 pe-8 text-end font-medium">{t('formats.list.head.columns')}</th>
        {anyChanged && <th scope="col" className="py-2 pe-4 text-start font-medium">{t('formats.list.head.changed')}</th>}
        {anyClaims && <th scope="col" className="py-2 pe-4 text-start font-medium">{t('formats.list.head.claims')}</th>}
        <th scope="col" className="w-16 py-2" />
      </tr>
    </thead>
  )

  return (
    <div key="list" className="fc-view-enter flex h-full">
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-1.5 px-6 pt-5 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          {/* The screen names itself with a heading (M54 F2). */}
          <h1 className="m-0 text-title leading-tight font-medium">{t('formats.list.title')}</h1>
          {/* **One way in rather than three** (M20 U2), withheld while the list is
              empty, because the three doors are already on the screen under it. */}
          {data.formats.length > 0 && (
            <Button variant="primary" icon="add" data-tour="new-format" onClick={() => setMode({ kind: 'DOORS' })}>
              {t('formats.list.newFormat')}
            </Button>
          )}
        </div>
        <p className="m-0 text-lede">
          {data.formats.length === 0
            ? t('formats.list.nothing')
            : t(countKey('formats.list.answer', data.formats.length), { count: data.formats.length })}
        </p>
        {data.formats.length > 0 && (
          <p className="m-0 flex min-h-6 flex-wrap items-baseline gap-x-2 text-caption text-ink-secondary tabular-nums">
            <span>{t(countKey('formats.list.rows', rows), { count: rows })}</span>
            {failed > 0 ? (
              <span className="text-negative">· {t(countKey('formats.list.fails', failed), { count: failed })}</span>
            ) : (
              proved > 0 && <span>· {t('formats.list.holds')}</span>
            )}
          </p>
        )}
        <WaitingList label={t('formats.waiting.label')} items={waiting} />
      </header>

      <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
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
          /* **A table of the kinds of things** (M64 U13, D-625): their own first,
             then each pack's under its name (M33 F3), so a person's two formats
             are not found by reading past the ledger's twenty. */
          <table className="w-full border-collapse text-body" data-block>
            {head}
            {grouped.own.length > 0 && <tbody>{grouped.own.map(line)}</tbody>}
            {grouped.packs.map((group) => (
              <tbody key={group.pack} aria-label={group.title} data-tour={`formats-pack-${group.pack}`}>
                <tr>
                  <th scope="rowgroup" colSpan={4 + (anyChanged ? 1 : 0) + (anyClaims ? 1 : 0)} className="pt-5 pb-1 text-start text-caption font-medium text-ink-secondary">
                    {group.title}
                  </th>
                </tr>
                {group.formats.map(line)}
              </tbody>
            ))}
          </table>
        )}
      </div>
    </div>

      {/* **The detail beside the page** (M64 U13): what a waiting line is about. */}
      {panel?.kind === 'PENDING' && (
        <SidePanel title={t('formats.waiting.pendingPanel')} onClose={() => setPanel(undefined)}>
          <p className="mb-4 text-body text-ink-secondary">{t('formats.waiting.pendingSay')}</p>
          {data.pending.map((plan) => (
            <PlanView key={plan.format} plan={plan} />
          ))}
        </SidePanel>
      )}
      {panel?.kind === 'UNREADABLE' && (
        <SidePanel title={t('formats.waiting.unreadablePanel')} onClose={() => setPanel(undefined)}>
          {data.unreadable.map((each) => (
            <p key={each.name} className="mb-2 text-body">
              <span className="font-medium">{each.name}</span>
              <span className="text-ink-secondary"> — {each.reason}</span>
            </p>
          ))}
        </SidePanel>
      )}
      {panel?.kind === 'ORPHANS' && (
        <SidePanel title={t('formats.waiting.orphansPanel')} onClose={() => setPanel(undefined)}>
          <p className="mb-4 text-body text-ink-secondary">{t('formats.waiting.orphansWhy')}</p>
          <ul className="m-0 list-none p-0">
            {data.orphans.map((name) => (
              <li key={name} className="border-t border-hairline py-2 font-mono text-caption">
                {name}
              </li>
            ))}
          </ul>
        </SidePanel>
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
  const t = useT()
  // No claims, nothing said: the column's head names what would be here (M64 U13).
  if (proof === undefined) return null
  const claims = format.identities.length
  if (proof.proved + proof.failed + proof.unchecked === 0) {
    return (
      <span className="text-caption text-ink-secondary">
        {t(countKey('formats.declare.claimsNoRows', claims), { count: claims })}
      </span>
    )
  }
  return (
    <span className="flex items-baseline gap-2 text-caption tabular-nums">
      <span className="text-ink-secondary">{t(countKey('formats.declare.claims', claims), { count: claims })}</span>
      {proof.proved > 0 && (
        <span className="text-positive">
          {t(countKey('formats.declare.proved', proof.proved), { count: proof.proved })}
        </span>
      )}
      {proof.failed > 0 && (
        <span className="text-negative">
          {t(countKey('formats.declare.failed', proof.failed), { count: proof.failed })}
        </span>
      )}
      {proof.unchecked > 0 && (
        <span className="text-ink-secondary">
          {t(countKey('formats.declare.unchecked', proof.unchecked), { count: proof.unchecked })}
        </span>
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
  const t = useT()
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
      <h2 className="mb-1 font-medium">{t('formats.declare.importTitle')}</h2>
      <p className="mb-2 max-w-prose text-caption text-ink-secondary">
        <Phrase
          text={t('formats.declare.importSay')}
          parts={{
            extension: (
              <Bidi>
                <code>{ARTEFACT_EXTENSION}</code>
              </Bidi>
            ),
          }}
        />
      </p>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        rows={8}
        className={`${FIELD_MULTILINE} w-full font-mono text-caption`}
        placeholder={t('formats.declare.importExample')}
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
        {t('formats.declare.readIt')}
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
  const t = useT()
  if (planIsSettled(plan)) {
    return (
      <p className="text-caption text-ink-secondary">
        <Phrase
          text={t('formats.declare.matches')}
          parts={{
            table: (
              <Bidi>
                <code>{plan.table}</code>
              </Bidi>
            ),
          }}
        />
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
          <Phrase
            text={t(describe(step.kind))}
            parts={{
              what: (
                <Bidi>
                  <code>{step.column === undefined ? plan.table : `${plan.table}.${step.column}`}</code>
                </Bidi>
              ),
            }}
          />
        </p>
      ))}
    </div>
  )
}

/** What a step does, as a sentence its table or column goes into. */
function describe(kind: ReconcilePlan['steps'][number]['kind']): MessageKey {
  switch (kind) {
    case 'CREATE_TABLE':
      return 'formats.declare.step.create'
    case 'ADD_COLUMN':
      return 'formats.declare.step.add'
    case 'DROP_COLUMN':
      return 'formats.declare.step.drop'
    case 'RENAME_COLUMN':
      return 'formats.declare.step.rename'
    case 'LOOSEN_COLUMN':
      return 'formats.declare.step.loosen'
    case 'REBUILD_TABLE':
      return 'formats.declare.step.rebuild'
    case 'ADD_INDEX':
      return 'formats.declare.step.addIndex'
    case 'DROP_INDEX':
      return 'formats.declare.step.dropIndex'
    case 'ADD_CHECK':
      return 'formats.declare.step.addCheck'
    case 'DROP_CHECK':
      return 'formats.declare.step.dropCheck'
  }
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center px-6 text-center text-ink-secondary">
      <p className="max-w-prose">{children}</p>
    </div>
  )
}
