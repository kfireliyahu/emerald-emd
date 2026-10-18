/**
 * **A stack of payslips, read in one go** — M28 U3.
 *
 * From M26's review: bulk reading reached only declared formats and
 * only spreadsheets, and it was expected on the paychecks screen. So this is
 * `ReadFiles`' bargain (D-292) for the document that has no header row: every
 * file is read, each is **ticked when it reconciles**, and nothing is written
 * until Write.
 *
 * ## How a slip fits a reader when there is no header row
 *
 * A spreadsheet fits a reader when its header is the reader's, cell for cell. A
 * PDF payslip has no header — its rows change from month to month as a bonus or
 * a loan repayment comes and goes — so the header's two jobs are split:
 *
 * - **The labels stand in for the header.** A reader is chosen by its label
 *   signature, exactly or closely (`matchLabelTemplate`), which is what the
 *   ladder's first rung already did for one slip.
 * - **The slip's own arithmetic is the fit.** A reader *fits* when the reading it
 *   produces reconciles — gross less deductions is net, and the deductions sum to
 *   the printed total. A reader whose labels match and whose figures do not add
 *   up is **close**: named, never trusted, and the slip goes on to the model or to
 *   a person (F17). There is no third test, because a match by labels with
 *   arithmetic that closes to the agora is a stronger proof than any header.
 *
 * ## A reader worked out in the batch reads the rest of it
 *
 * Twelve months of an employer the document has never seen would otherwise be
 * twelve model calls and twelve readers. A slip the model read *and that
 * reconciled* becomes a candidate for every later slip in the same batch — not
 * stored, because nothing is written until Write, and not trusted on its say-so,
 * because the later slip has to reconcile under it too. On Write it is stored
 * once.
 */

import type { CurrencyCode } from '@/core/money.ts'
import { formatYearMonth, type LocalDate, type YearMonth } from '@/core/time.ts'
import type { DeductionType } from '@/domain/model/paycheck.ts'
import type { PayslipDocumentTemplate } from '@/domain/model/templates.ts'
import { draftFromSlip, draftProblems, type PaycheckDraft } from '@/domain/paycheckEntry.ts'
import { reviewPayslip, type PayslipReview, type ReviewRow } from '@/domain/review.ts'

import { readSlipByLadder, type DerivePayslip, type SlipOutcome } from './payslipLadder.ts'

/** One file, opened: its text and what identifies its bytes. */
export interface SlipFile {
  readonly id: string
  readonly name: string
  /** Of the bytes, so the same file twice in one batch is caught. */
  readonly hash: string
  readonly text: string
  /** What the PDF reader had to say about the text, if anything. */
  readonly notice?: string | undefined
}

/** The id a reader worked out in this batch carries until Write stores it. */
export const LEARNED = 'new:'

export function isLearned(reader: string): boolean {
  return reader.startsWith(LEARNED)
}

/**
 * How a slip and the readers met — the sentence the screen says per file.
 *
 * `fits` and `new` are the two that reconciled; `close` read the slip and its
 * figures do not add up; `none` read nothing.
 */
export type SlipFit =
  | { readonly kind: 'fits'; readonly reader: string; readonly name: string }
  | { readonly kind: 'new'; readonly reader: string }
  | { readonly kind: 'close'; readonly name: string | undefined }
  | { readonly kind: 'none' }

export interface BatchSlip {
  readonly file: SlipFile
  readonly outcome: SlipOutcome
  /**
   * The reader that read it: a stored reader's id, or `new:<file id>` for one
   * this batch worked out. Names given on the screen are kept against it, so a
   * row named on one slip is named on every slip the same reader read.
   * Undefined when nothing read the slip.
   */
  readonly reader: string | undefined
  readonly fit: SlipFit
  /**
   * The reader this slip taught the batch, when it is the one that taught it —
   * so a file added to the batch later can be tried with it too.
   */
  readonly taught: PayslipDocumentTemplate | undefined
}

/**
 * What a slip's rows are named against on the screen: its reader, so a row
 * named on one slip is named on every slip that reader read — or, for a slip no
 * reader is kept from, the slip itself.
 *
 * **The second half is M28 F1's fault (3).** A slip the model read whose figures
 * do not add up has no reader (nothing is learned from it), and the screen
 * named its rows against `reader` only — so choosing a type for one of its rows
 * was dropped on the floor, and the picker sat on *Choose a deduction…* however
 * often it was changed. Every read slip has a key now.
 */
export function namingKey(slip: BatchSlip): string {
  return slip.reader ?? `slip:${slip.file.id}`
}

function learnedFrom(
  file: SlipFile,
  outcome: Extract<SlipOutcome, { kind: 'read' }>,
): PayslipDocumentTemplate {
  return {
    id: `${LEARNED}${file.id}`,
    kind: 'PAYSLIP',
    name: file.name.replace(/\.[^.]+$/, ''),
    labelSignature: outcome.signature,
    anchors: outcome.anchors,
    derivedBy: 'LOCAL_MODEL',
    confirmedAt: undefined,
    pinnedFields: [],
    version: 1,
    supersededAt: undefined,
    lastUsedAt: undefined,
    useCount: 0,
  }
}

function fitOf(outcome: SlipOutcome): SlipFit {
  if (outcome.kind === 'unread') return { kind: 'none' }
  if (!outcome.reading.reconciles) return { kind: 'close', name: outcome.stored?.name }
  if (outcome.stored === undefined) return { kind: 'new', reader: '' }
  if (isLearned(outcome.stored.id)) return { kind: 'new', reader: outcome.stored.id }
  return { kind: 'fits', reader: outcome.stored.id, name: outcome.stored.name }
}

/**
 * Read every file, one after another, through F17's ladder.
 *
 * In order, not in parallel: a model on this machine reads one slip at a time
 * anyway, and a reader one slip works out is what the next slip is tried with.
 */
export async function readSlipBatch(options: {
  readonly files: readonly SlipFile[]
  readonly templates: readonly PayslipDocumentTemplate[]
  readonly derive?: DerivePayslip | undefined
  readonly currency?: CurrencyCode
  /** Called as each file lands, so a screen can show the batch filling in. */
  readonly onRead?: (slip: BatchSlip, index: number) => void
  /** Asked before each file; true stops the batch where it is. */
  readonly stopped?: () => boolean
}): Promise<readonly BatchSlip[]> {
  const { files, templates, derive, currency = 'ILS', onRead, stopped } = options
  const learned: PayslipDocumentTemplate[] = []
  const slips: BatchSlip[] = []

  for (const [index, file] of files.entries()) {
    if (stopped?.() === true) break
    const outcome = await readSlipByLadder({
      text: file.text,
      // The batch's own first, so a layout learned a slip ago is not passed over
      // for a stored reader that only nearly matches.
      templates: [...learned, ...templates],
      derive,
      currency,
    })

    let fit = fitOf(outcome)
    let reader = outcome.kind === 'read' ? outcome.stored?.id : undefined
    let taught: PayslipDocumentTemplate | undefined
    if (outcome.kind === 'read' && fit.kind === 'new' && fit.reader === '') {
      const made = learnedFrom(file, outcome)
      learned.unshift(made)
      taught = made
      reader = made.id
      fit = { kind: 'new', reader: made.id }
    }

    const slip: BatchSlip = { file, outcome, reader, fit, taught }
    slips.push(slip)
    onRead?.(slip, index)
  }

  return slips
}

/** What a slip of the batch would write, and whether it can. */
export interface SlipPlan {
  readonly review: PayslipReview | undefined
  readonly draft: PaycheckDraft | undefined
  /** Rows the reader cannot name — each is asked on the screen, once per reader. */
  readonly unnamed: readonly ReviewRow[]
  /** Its own arithmetic closes (D-138: on the employee column, which is what it checks). */
  readonly reconciles: boolean
  /** Nothing stops it being written: read, a salary month, every row named, a valid slip. */
  readonly writable: boolean
  /** Why it is not writable, in a sentence. */
  readonly problem: string | undefined
}

const DRAFT_PROBLEM: Readonly<Record<string, string>> = {
  NEGATIVE_NET: 'its net is negative',
  NEGATIVE_GROSS: 'its gross is negative',
  NET_ABOVE_GROSS: 'its net is more than its gross',
  NEGATIVE_LINE: 'a line is negative',
  MIXED_CURRENCY: 'it mixes currencies',
}

/**
 * The plan for one slip: its review under what is named, and the paycheck it
 * would write. The same `reviewPayslip` and `draftFromSlip` the single slip's
 * confirm surface runs, so the two cannot disagree about a slip.
 */
export function planSlip(
  slip: BatchSlip,
  options: {
    readonly types: readonly DeductionType[]
    readonly currency: CurrencyCode
    /** What a person named this reader's rows on the screen, by anchor field. */
    readonly named: ReadonlyMap<string, string>
    readonly today: LocalDate
  },
): SlipPlan {
  const { outcome } = slip
  if (outcome.kind === 'unread') {
    return {
      review: undefined,
      draft: undefined,
      unnamed: [],
      reconciles: false,
      writable: false,
      problem: outcome.attempts.join(' ') || 'Nothing could read this slip.',
    }
  }

  const resolved = new Map<string, string>()
  for (const row of outcome.anchors.deductions) {
    if (row.deductionTypeId !== undefined) resolved.set(row.field, row.deductionTypeId)
  }
  for (const [field, id] of options.named) resolved.set(field, id)

  const review = reviewPayslip(outcome.reading, options.types, options.currency, resolved)
  const draft = draftFromSlip(review, options.currency, options.today)
  const unnamed = review.rows.filter((row) => row.deductionTypeId === undefined)

  const problem =
    review.salaryMonth === undefined
      ? 'No salary month was read off it.'
      : unnamed.length > 0
        ? `${unnamed.length === 1 ? 'One row needs' : `${unnamed.length} rows need`} a deduction type.`
        : draftProblems(draft)
            .map((code) => DRAFT_PROBLEM[code])
            .filter((text): text is string => text !== undefined)
            .map((text, index) => (index === 0 ? `It cannot be written: ${text}` : text))
            .join(', ') || undefined

  return {
    review,
    draft,
    unnamed,
    reconciles: review.reconciles,
    writable: problem === undefined,
    problem: problem === undefined ? undefined : problem.endsWith('.') ? problem : `${problem}.`,
  }
}

/** A reason not to tick a slip by itself. */
export interface SlipDoubt {
  readonly sentence: string
  /** The same bytes as an earlier file: never written twice. */
  readonly same: boolean
}

/**
 * Why a slip should not be ticked by itself even though it reconciles: the same
 * bytes earlier in the batch, a salary month an earlier slip of the batch
 * already has, or one the document already holds. A person may still tick a
 * second slip for a month — a 13th salary is one on purpose — but not the same
 * file twice, which is written once (`same`).
 */
export function batchDoubts(
  slips: readonly {
    readonly id: string
    readonly hash: string
    readonly period: YearMonth | undefined
  }[],
  alreadyThere: (period: YearMonth) => number,
): ReadonlyMap<string, SlipDoubt> {
  const doubts = new Map<string, SlipDoubt>()
  const hashes = new Set<string>()
  const months = new Set<string>()

  for (const slip of slips) {
    if (hashes.has(slip.hash)) {
      doubts.set(slip.id, { sentence: 'The same file is earlier in this batch — it is written once.', same: true })
      continue
    }
    hashes.add(slip.hash)
    if (slip.period === undefined) continue
    const month = formatYearMonth(slip.period)
    if (months.has(month)) {
      doubts.set(slip.id, { sentence: `Another slip in this batch is for ${month}.`, same: false })
    } else if (alreadyThere(slip.period) > 0) {
      doubts.set(slip.id, { sentence: `The document already has a slip for ${month}.`, same: false })
    }
    months.add(month)
  }

  return doubts
}
