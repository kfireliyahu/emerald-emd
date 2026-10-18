import { useCallback, useEffect, useMemo, useState } from 'react'

import type { CurrencyCode } from '@/core/money.ts'
import type { LocalDate } from '@/core/time.ts'
import {
  readReportByLadder,
  readReportWithTemplate,
  type ReportRead,
} from '@/data/importer/fundLadder.ts'
import {
  cancelDerivation,
  deriveFundReportLines,
  onDerivationProgress,
} from '@/data/runtime/derive.ts'
import { columnRoleIds } from '@/data/repositories/columnRoleRepository.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { readChosenProvider } from '@/data/runtime/provider.ts'
import {
  readRateBasisPoints,
  restateReport,
  retargetToValue,
  valueOnLine,
} from '@/data/importer/fundReportTemplate.ts'
import type {
  FundAccount,
  FundReportAccountFacts,
  FundReportReading,
} from '@/domain/model/funds.ts'
import type { FundReportDocumentTemplate, FundReportTemplate } from '@/domain/model/templates.ts'
import {
  accountChanges,
  editedFacts,
  reviewFundReport,
  type AccountEdits,
} from '@/domain/review.ts'
import { Button } from '@/ui/components/Button.tsx'
import { FlowFrame } from '@/ui/components/FlowFrame.tsx'
import { DocumentTextInput } from '@/ui/documents/DocumentTextInput.tsx'
import {
  openDocumentText,
  readStageText,
  type DocumentSource,
} from '@/ui/documents/openDocumentText.ts'
import {
  clearRead,
  countTokens,
  finishRead,
  noteRead,
  readingNow,
  replaceRead,
  startRead,
  useDocumentRead,
} from '@/state/reading.ts'
import { FormatPicker } from '@/ui/paychecks/FormatPicker.tsx'

import { BatchProgress, BatchStack, type ReportBatch } from './reportBatch.tsx'
import { ReportReview } from './ReportReview.tsx'

/**
 * One report, read — the whole of what survives leaving this screen (D-171).
 * `ReadSlip` holds the same shape for the same reason.
 */
interface ReportReadValue {
  readonly text: string
  readonly notice: string | undefined
  readonly source: DocumentSource | undefined
  readonly attempts: readonly string[]
  readonly outcome: ReportRead | undefined
}

/** The read waiting to be collected, if it is a report's. */
function currentValue(): ReportReadValue | undefined {
  const active = readingNow()
  return active?.kind === 'report' ? (active.value as ReportReadValue | undefined) : undefined
}

/**
 * Reading a pension, hishtalmut, provident or savings report: pick the text up,
 * run F17's ladder over it, and hand what came back to the confirm surface.
 *
 * `ReadSlip` with a different noun, and deliberately so — every hard part is
 * shared code (`documentLadder.ts`, `DocumentTextInput`, `openDocumentText.ts`),
 * so a report gets four decisions' worth of PDF handling for free: lines rebuilt
 * from glyph positions, a page split into panels, a boxed total read from the
 * line beside its name, a font that lies about its own text, and a document that
 * states no text at all read from its glyph order with its words from a local
 * OCR pass.
 *
 * **What is not shared is the proof**, because a report often has none — see
 * `fundReportTemplate.ts` and the strip in `ReportReview`.
 */
export function ReadReport({
  templates,
  fund,
  previousAsOf,
  currency,
  batch,
  onFiles,
  onSkip,
  onAccepted,
  onCancel,
  leaveLabel,
}: {
  templates: readonly FundReportDocumentTemplate[]
  fund: FundAccount
  /** The fund's newest reading, so an overlapping period can be named (D-152). */
  previousAsOf: LocalDate | undefined
  currency: CurrencyCode
  /**
   * The stack of reports being read in one sitting (D-164).
   *
   * Owned by the screen rather than by this component, because accepting a
   * report leaves this screen for the reading form and comes back — and a queue
   * that lived here would be thrown away every time somebody got one right.
   */
  batch: ReportBatch
  onFiles: (files: readonly File[]) => void
  /** This document is not one to read after all; take the next. */
  onSkip: () => void
  /**
   * The reading, the format's name, and what to write to the fund — `undefined`
   * when the user unticked it. The outcome carries the anchors as corrected.
   */
  onAccepted: (
    outcome: ReportRead,
    name: string,
    facts: FundReportAccountFacts | undefined,
  ) => void
  onCancel: () => void
  /**
   * Where leaving goes, named — `FlowFrame`'s rule, and it stopped being a
   * constant when onboarding gained the same flow (D-166). "Back to the list"
   * is a lie in a wizard step that has no list behind it.
   */
  leaveLabel: string
}) {
  const active = useDocumentRead()
  const mine = active?.kind === 'report' ? active : undefined
  const value = mine?.value as ReportReadValue | undefined
  const working = mine?.working ?? false
  const outcome = value?.outcome
  const problem = mine?.problem

  const [text, setText] = useState(() => currentValue()?.text ?? '')
  const [name, setName] = useState(() => currentValue()?.outcome?.stored?.name ?? '')
  /**
   * Whether accepting also updates the fund with what the report says about it.
   *
   * On by default and shown line by line: the report is the fund's own statement
   * of its fees, and a person who read the list and pressed accept has said so.
   */
  const [applyToFund, setApplyToFund] = useState(true)
  /**
   * Which reading the confirm surface's fields were initialised from (M16 U11).
   *
   * Every figure there is a field holding its own text, so `2.` and `-` survive
   * being half-typed (`ReadField.tsx`). Nothing resyncs that text from above,
   * which is right for an edit and wrong for a *replacement* — another format,
   * a fresh read, the next document in a batch. Bumping this remounts the
   * surface, which is the whole of the resync.
   */
  const [generation, setGeneration] = useState(0)

  /** A read replaced rather than edited: refill every field from it. */
  const restart = useCallback((): void => {
    setGeneration((count) => count + 1)
  }, [])

  const provider = useMemo(() => readChosenProvider(), [])
  const db = useDocumentStore((state) => state.db)
  /**
   * This document's deposit-table vocabulary, read from it rather than compiled in (D-212).
   *
   * No document means no vocabulary, and no vocabulary means the model is not
   * asked at all: an empty `enum` is not a closed list, it is a grammar nothing
   * can satisfy.
   */
  const depositRoles = useMemo(
    () => (db === undefined ? undefined : columnRoleIds(db, 'DEPOSIT')),
    [db],
  )

  useEffect(() => {
    if (!working) return undefined
    const id = readingNow()?.id
    if (id === undefined) return undefined
    return onDerivationProgress((tokens) => countTokens(id, tokens))
  }, [working])

  /** The whole read — the file, the ladder and the model pass — as one entry (D-171). */
  const readFrom = useCallback(
    (input: { readonly file: File } | { readonly text: string }, label: string) => {
      const id = startRead({ kind: 'report', label })
      restart()
      let opened: ReportReadValue = {
        text: 'text' in input ? input.text : '',
        notice: undefined,
        source: undefined,
        attempts: [],
        outcome: undefined,
      }

      const gather = async (): Promise<void> => {
        if ('file' in input) {
          const document = await openDocumentText(input.file, (stage) =>
            noteRead(id, readStageText(stage)),
          )
          if (document.kind === 'problem') {
            finishRead(id, { value: opened, problem: document.problem })
            return
          }
          opened = { ...opened, text: document.text, notice: document.notice, source: document.source }
          setText(document.text)
        }

        noteRead(id, 'Working out what this report says…')
        const result = await readReportByLadder({
          text: opened.text,
          templates,
          currency,
          // The one place the model is reached from this screen, and it is
          // behind a choice made on the settings screen. No provider, no call.
          derive:
            provider === undefined || depositRoles === undefined
              ? undefined
              : (document) => deriveFundReportLines(provider, document, depositRoles),
        })

        const read = { ...opened, attempts: result.attempts }
        if (result.kind === 'read') {
          finishRead(id, { value: { ...read, outcome: result } })
          setName(result.stored?.name ?? '')
          return
        }
        finishRead(id, {
          value: read,
          problem:
            result.attempts.join(' ') ||
            'Nothing could read this file. Enter the reading by hand instead.',
        })
      }

      void gather().catch((error: unknown) => {
        finishRead(id, { value: opened, problem: String(error) })
      })
    },
    [currency, depositRoles, provider, restart, templates],
  )

  const read = useCallback((report: string) => readFrom({ text: report }, 'the report'), [readFrom])

  /** The user naming the format instead of letting the match choose one (D-148). */
  const useFormat = useCallback(
    (id: string) => {
      const template = templates.find((one) => one.id === id)
      const held = currentValue()
      if (template === undefined || held === undefined) return
      restart()
      replaceRead({
        ...held,
        outcome: readReportWithTemplate({
          text: held.text,
          template,
          currency,
          attempts: held.attempts,
        }),
      })
      setName(template.name)
    },
    [currency, restart, templates],
  )

  /**
   * A figure typed over on the confirm surface — the whole of what U11 stores
   * for a fund report, and `ReadStatement`'s `editReading` with a third noun.
   *
   * **The edit goes into the reading, not beside it** (D-205), so it survives
   * leaving the flow mid-read exactly as the reading does (D-171) and the
   * accept passes `outcome` through untouched. `restateReport` re-runs all
   * three of the report's equations over the edited figures, which is what
   * makes the strip's verdict a claim about what the accept will write rather
   * than about what the template found.
   */
  const editReading = useCallback(
    (next: FundReportReading): void => {
      const held = currentValue()
      if (held?.outcome === undefined) return
      replaceRead({
        ...held,
        outcome: { ...held.outcome, reading: restateReport(next, currency) },
      })
    },
    [currency],
  )

  /**
   * What the user typed over in the fund panel, and the anchors that follow
   * from it.
   *
   * A correction is applied twice: to the value written to the fund, and — where
   * the typed value is on the page — to the template's anchor, so the next
   * report of this format reads the right line by itself (D-152).
   */
  const [accountEdits, setAccountEdits] = useState<AccountEdits>({})

  const accepted = (): { readonly facts: FundReportAccountFacts; readonly anchors: FundReportTemplate } | undefined => {
    if (outcome === undefined) return undefined
    const facts = editedFacts(outcome.reading.account, accountEdits)
    let anchors = outcome.anchors

    if (accountEdits.feeOnDepositBasisPoints !== undefined) {
      const wanted = facts.feeOnDepositBasisPoints
      anchors = retargetToValue(anchors, 'feeRateOnDepositLine', text, (line) =>
        wanted !== undefined && readRateBasisPoints(line) === wanted,
      )
    }
    if (accountEdits.feeOnAccumulationBasisPoints !== undefined) {
      const wanted = facts.feeOnAccumulationBasisPoints
      anchors = retargetToValue(anchors, 'feeRateOnAccumulationLine', text, (line) =>
        wanted !== undefined && readRateBasisPoints(line) === wanted,
      )
    }
    if (accountEdits.employerName !== undefined) {
      anchors = retargetToValue(anchors, 'employerNameLine', text, (line) =>
        valueOnLine(line) === facts.employerName,
      )
    }
    if (accountEdits.investmentTrack !== undefined) {
      anchors = retargetToValue(anchors, 'investmentTrackLine', text, (line) =>
        valueOnLine(line) === facts.investmentTrack,
      )
    }

    return { facts, anchors }
  }

  const review = useMemo(
    () => (outcome === undefined ? undefined : reviewFundReport(outcome.reading, previousAsOf)),
    [outcome, previousAsOf],
  )

  const changes = useMemo(
    () => (outcome === undefined ? [] : accountChanges(outcome.reading.account, fund)),
    [fund, outcome],
  )

  if (outcome !== undefined && review !== undefined) {
    return (
      <ReportReview
        // Remounted when the reading is *replaced* rather than edited, which is
        // how every field refills its text (M16 U11).
        key={generation}
        outcome={outcome}
        review={review}
        formats={templates}
        currency={currency}
        fundName={fund.name}
        accountChanges={changes}
        accountEdits={accountEdits}
        onAccountEdit={(field, value) =>
          setAccountEdits((current) => ({ ...current, [field]: value }))
        }
        applyToFund={applyToFund}
        onApplyToFund={setApplyToFund}
        name={name}
        notice={value?.notice}
        source={value?.source}
        onReading={editReading}
        onName={setName}
        onUseFormat={useFormat}
        onAccept={() => {
          // Collected, so the foot bar has nothing to point at (D-171).
          clearRead()
          const edited = accepted()
          onAccepted(
            edited === undefined ? outcome : { ...outcome, anchors: edited.anchors },
            name.trim(),
            applyToFund && changes.length > 0 ? (edited?.facts ?? {}) : undefined,
          )
        }}
        // Discard drops the *reading*, not the text: what was read is the only
        // evidence of why it read that way. Leaving is the other verb, and the
        // one the review had no control for at all until D-163.
        onDecline={() => {
          const held = currentValue()
          if (held !== undefined) replaceRead({ ...held, outcome: undefined })
        }}
        onLeave={onCancel}
        leaveLabel={leaveLabel}
        progress={<BatchProgress batch={batch} />}
        {...(batch.opening === undefined ? {} : { onSkip })}
      />
    )
  }

  return (
    <FlowFrame
      title="Read a report"
      leaveLabel={leaveLabel}
      onLeave={onCancel}
      actions={
        <>
          <BatchProgress batch={batch} />
          {batch.opening !== undefined && !working && (
            <Button variant="ghost" size="sm" onClick={onSkip}>
              Skip this one
            </Button>
          )}
          {working && (
            <Button variant="ghost" size="sm" onClick={cancelDerivation}>
              Stop
            </Button>
          )}
        </>
      }
    >
      <div className="px-6 py-4">
        <DocumentTextInput
          noun="report"
          onFiles={onFiles}
          openNow={batch.opening}
          intro={
            <>
              Open the fund’s PDF reports — as many at once as you have, and they are read one
              after another. Or paste one report’s text. Nothing leaves this machine
              {provider === undefined
                ? ', and no model is switched on — a report this document already has a reader for is read by the app, and any other is one you type in.'
                : `, and a report this document already has a reader for is read without asking ${provider.model} anything.`}
            </>
          }
          text={text}
          onText={setText}
          onRead={read}
          onOpen={(file) => readFrom({ file }, file.name)}
          working={working}
          note={mine?.note}
          tokens={mine?.tokens ?? 0}
          problem={problem}
          footer={
            <>
              <p className="text-ink-secondary">
                Nothing was written. Type the reading in by hand, and next time a reader can be
                worked out from a report that read cleanly.
              </p>
              {templates.length > 0 && text.trim() !== '' && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-ink-secondary">
                    Or read it with a reader you already have:
                  </span>
                  <FormatPicker formats={templates} current={undefined} onPick={useFormat} />
                </div>
              )}
            </>
          }
        />

        {/* What is left in the stack, named. Under the input rather than beside
            it, because on the first document of a batch the input is what the
            eye needs and on the sixth this is. */}
        <div className="mx-auto mt-6 max-w-[820px]">
          <BatchStack batch={batch} />
        </div>
      </div>
    </FlowFrame>
  )
}
