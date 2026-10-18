import { useCallback, useEffect, useMemo, useState } from 'react'

import type { CurrencyCode } from '@/core/money.ts'
import {
  readSlipByLadder,
  readSlipWithTemplate,
  type SlipRead,
} from '@/data/importer/payslipLadder.ts'
import {
  cancelDerivation,
  derivePayslipLines,
  onDerivationProgress,
} from '@/data/runtime/derive.ts'
import { readChosenProvider } from '@/data/runtime/provider.ts'
import { restateSlip } from '@/data/importer/payslipTemplate.ts'
import type {
  DeductionKind,
  DeductionType,
  PayslipReading,
} from '@/domain/model/paycheck.ts'
import type { PayslipDocumentTemplate } from '@/domain/model/templates.ts'
import type { TypeGroup } from '@/domain/paycheckEntry.ts'
import { reviewPayslip, type PayslipReview } from '@/domain/review.ts'
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

import { SlipReview } from './SlipReview.tsx'

/**
 * One document, read — the whole of what survives leaving this screen (D-171).
 *
 * Five pieces of state before; one fact now, because the store that outlives
 * the flow holds one value and because they are one fact: *this document, as
 * this app read it*.
 */
interface SlipReadValue {
  readonly text: string
  readonly notice: string | undefined
  readonly source: DocumentSource | undefined
  readonly attempts: readonly string[]
  readonly outcome: SlipRead | undefined
}

/** The read waiting to be collected, if it is a payslip's. Read once, on mount. */
function currentValue(): SlipReadValue | undefined {
  const active = readingNow()
  return active?.kind === 'payslip' ? (active.value as SlipReadValue | undefined) : undefined
}

/**
 * Reading a payslip: pick the text up, run F17's ladder over it, and hand what
 * came back to the confirm surface.
 *
 * **The ladder is what this component is.** A stored template that still
 * verifies answers with nothing asked of anything; a slip this document has
 * never seen goes to the local model, if and only if one is switched on; and
 * when neither answers, the way out is the form, typed by hand. That last rung
 * is not a failure state — it is the app being whole with the feature off,
 * which is the milestone's standing rule and the reason the button that opens
 * this says nothing about AI.
 *
 * **Getting the text out of a file is not here**, and has not been since a fund
 * report needed the same four decisions' worth of PDF handling:
 * `DocumentTextInput` and `openDocumentText.ts` are shared with the funds
 * screen. What is left here is the ladder and what a *payslip* is.
 */
export function ReadSlip({
  templates,
  types,
  groups,
  currency,
  onCreateType,
  onAccepted,
  onCancel,
  leaveLabel,
}: {
  templates: readonly PayslipDocumentTemplate[]
  types: readonly DeductionType[]
  groups: readonly TypeGroup[]
  currency: CurrencyCode
  onCreateType: (name: string, kind: DeductionKind) => string | undefined
  onAccepted: (
    outcome: SlipRead,
    review: PayslipReview,
    name: string,
    named: ReadonlyMap<string, string>,
  ) => void
  onCancel: () => void
  /**
   * Where leaving goes, named — `FlowFrame`'s rule, and it stopped being a
   * constant when onboarding gained the same flow (D-166). "Back to the list"
   * is a lie in a wizard step that has no list behind it.
   */
  leaveLabel: string
}) {
  /**
   * Everything a read produced, and the only thing that survives leaving this
   * screen (D-171).
   *
   * It is one object rather than five pieces of state because it is one fact —
   * *this document, read* — and because the store that outlives the flow holds
   * one value. The text is in it so that returning to a finished read can still
   * offer *read it with another format*, which needs the document's text and
   * would otherwise have an empty box behind it.
   */
  const active = useDocumentRead()
  const mine = active?.kind === 'payslip' ? active : undefined
  const value = mine?.value as SlipReadValue | undefined
  const working = mine?.working ?? false
  const outcome = value?.outcome
  const problem = mine?.problem

  /**
   * The textarea, which is the one thing here a person types into.
   *
   * Seeded from the store on mount so that coming back to a landed read finds
   * the document it read, and set from a read as it lands. Local afterwards,
   * because what somebody is halfway through typing is not a read.
   */
  const [text, setText] = useState(() => currentValue()?.text ?? '')
  const [name, setName] = useState(() => currentValue()?.outcome?.stored?.name ?? '')
  /**
   * What the user has said this slip's deduction rows are, keyed by anchor.
   *
   * Held here rather than written as it is picked, because a naming is only
   * worth keeping alongside the template it belongs to, and the template is
   * stored on accept. Declining drops both together, which is the same bargain
   * every other field on this surface already makes.
   */
  const [named, setNamed] = useState<ReadonlyMap<string, string>>(new Map())
  /**
   * Which reading the confirm surface's fields were initialised from (M16 U11).
   *
   * Every figure there is a field holding its own text, so `2.` and `-` survive
   * being half-typed (`ReadField.tsx`). Nothing resyncs that text from above,
   * which is right for an edit and wrong for a *replacement* — another format,
   * a fresh read. Bumping this remounts the surface, which is the whole of the
   * resync and the reason those two places are the only ones that touch it.
   */
  const [generation, setGeneration] = useState(0)

  /** A read replaced rather than edited: refill every field from it. */
  const restart = useCallback((): void => {
    setGeneration((count) => count + 1)
  }, [])

  const provider = useMemo(() => readChosenProvider(), [])

  // Only while something is running: a subscription that outlives the work is a
  // listener nobody unsubscribed, and this one is on the bridge.
  useEffect(() => {
    if (!working) return undefined
    const id = readingNow()?.id
    if (id === undefined) return undefined
    return onDerivationProgress((tokens) => countTokens(id, tokens))
  }, [working])

  /**
   * Read a document, from wherever it came — a file, or the box.
   *
   * **The whole read is one entry in the store**: opening the PDF, the OCR
   * rung, the ladder and the model pass are one thing a person is waiting for,
   * and splitting them into two would put a gap in the middle of the sentence
   * the foot bar is saying.
   */
  const readFrom = useCallback(
    (input: { readonly file: File } | { readonly text: string }, label: string) => {
      const id = startRead({ kind: 'payslip', label })
      restart()
      let opened: SlipReadValue = {
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

        noteRead(id, 'Working out what this paycheck says…')
        const result = await readSlipByLadder({
          text: opened.text,
          templates,
          currency,
          // **The one place the model is reached from a screen**, and it is
          // behind a choice the user made on the settings screen. No provider,
          // no call — the ladder then goes straight to its last rung.
          derive:
            provider === undefined
              ? undefined
              : (document) => derivePayslipLines(provider, document),
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
            'Nothing could read this file. Enter the paycheck by hand instead.',
        })
      }

      void gather().catch((error: unknown) => {
        finishRead(id, { value: opened, problem: String(error) })
      })
    },
    [currency, provider, restart, templates],
  )

  const read = useCallback((slip: string) => readFrom({ text: slip }, 'the paycheck'), [readFrom])

  /**
   * The user naming the format instead of letting the match choose one.
   *
   * No model and no ladder — `readSlipWithTemplate` executes the anchors as
   * given, and the reconciliation strip below judges the choice exactly as it
   * judges a match nobody made. The text is whatever is already on screen, so
   * changing one's mind costs a select and not a re-open.
   */
  const useFormat = useCallback(
    (id: string) => {
      const template = templates.find((one) => one.id === id)
      const held = currentValue()
      if (template === undefined || held === undefined) return
      restart()
      replaceRead({
        ...held,
        outcome: readSlipWithTemplate({
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
   * for a payslip, and `ReadStatement`'s `editReading` with a different noun.
   *
   * **The edit goes into the reading, not beside it** (D-205). An overlay would
   * have meant two versions of every figure with one of them reaching the
   * accept, which is the shape D-138's law says goes wrong: a screen proving
   * one set of numbers while another is written. Because the reading is what
   * the read entry already holds, an edit survives leaving the flow mid-read
   * exactly as the reading does (D-171), and the accept passes `outcome`
   * through untouched.
   *
   * `restateSlip` is what keeps the screen honest about itself: both of the
   * slip's own equations are re-run over the edited figures rather than left as
   * the template's claim about them.
   */
  const editReading = useCallback(
    (next: PayslipReading): void => {
      const held = currentValue()
      if (held?.outcome === undefined) return
      replaceRead({
        ...held,
        outcome: { ...held.outcome, reading: restateSlip(next, currency) },
      })
    },
    [currency],
  )

  /**
   * What the format already says its rows are, with anything named on this
   * screen laid over it.
   *
   * The stored half comes off the anchors rather than out of a second lookup:
   * `outcome.anchors` is the stored template's own anchors on the rung that
   * read this slip with one, and the deriving rung produces anchors with no
   * naming on them at all — which is D-132 holding, not a gap.
   */
  const resolved = useMemo(() => {
    const map = new Map<string, string>()
    if (outcome !== undefined) {
      for (const row of outcome.anchors.deductions) {
        if (row.deductionTypeId !== undefined) map.set(row.field, row.deductionTypeId)
      }
    }
    for (const [field, id] of named) map.set(field, id)
    return map
  }, [named, outcome])

  const review = useMemo(
    () =>
      outcome === undefined
        ? undefined
        : reviewPayslip(outcome.reading, types, currency, resolved),
    [currency, outcome, resolved, types],
  )

  if (outcome !== undefined && review !== undefined) {
    return (
      <SlipReview
        // Remounted when the reading is *replaced* rather than edited, which is
        // how every field refills its text (M16 U11).
        key={generation}
        outcome={outcome}
        review={review}
        groups={groups}
        formats={templates}
        currency={currency}
        name={name}
        onName={setName}
        onReading={editReading}
        onUseFormat={useFormat}
        onNameRow={(field, deductionTypeId) =>
          setNamed((previous) => new Map(previous).set(field, deductionTypeId))
        }
        onCreateType={onCreateType}
        notice={value?.notice}
        source={value?.source}
        onAccept={() => {
          // The read has been collected, so the foot bar has nothing left to
          // offer a way back to (D-171).
          clearRead()
          onAccepted(outcome, review, name.trim(), resolved)
        }}
        // Discard drops the *reading*, not the text. What was read is the only
        // evidence of why it read that way, and clearing it makes a slip that
        // came out wrong impossible to look at without opening the file again.
        onDecline={() => {
          const held = currentValue()
          if (held !== undefined) replaceRead({ ...held, outcome: undefined })
        }}
        onLeave={onCancel}
        leaveLabel={leaveLabel}
      />
    )
  }

  return (
    <FlowFrame
      title="Read a paycheck"
      leaveLabel={leaveLabel}
      onLeave={onCancel}
      actions={
        working ? (
          <Button variant="ghost" size="sm" onClick={cancelDerivation}>
            Stop
          </Button>
        ) : undefined
      }
    >
      <div className="px-6 py-4">
        <DocumentTextInput
          noun="paycheck"
          intro={
            <>
              Open the paycheck PDF, or paste its text. Nothing leaves this machine
              {provider === undefined
                ? ', and no model is switched on — a paycheck this document already has a reader for is read by the app, and any other is one you enter by hand.'
                : `, and a paycheck this document already has a reader for is read without asking ${provider.model} anything.`}
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
                Nothing was written. Enter the paycheck by hand, and next month a reader can be
                worked out from a paycheck that read cleanly.
              </p>
              {/* Or say which of the stored formats this is. A slip nothing
                  matched is the case a hand-picked format is *for*: the
                  arithmetic still judges the choice, so the worst it costs is a
                  reading that visibly does not add up. */}
              {templates.length > 0 && text.trim() !== '' && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-ink-secondary">Or read it with a reader you already have:</span>
                  <FormatPicker formats={templates} current={undefined} onPick={useFormat} />
                </div>
              )}
            </>
          }
        />
      </div>
    </FlowFrame>
  )
}
