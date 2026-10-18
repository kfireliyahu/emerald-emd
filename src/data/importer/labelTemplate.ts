/**
 * Recognising a **label-value** document as one the user has already mapped, and
 * mapping it by its own words rather than by where they happen to fall.
 *
 * `signature.ts` does this for the tabular half — statements, where the schema is
 * the header row. This is the other half of F17: payslips and fund reports, which
 * have no header row and no grid. Their schema is **the words that do not change
 * between months** — the field labels, the employer or provider name, the page
 * furniture — and the numbers are the data. Normalize those, sort them, and that
 * is a signature in exactly the sense `signature.ts` already means it.
 *
 * Two things follow from anchoring to labels rather than to coordinates, and both
 * are the point:
 *
 * 1. **A template survives the document moving.** A logo that grew a line, a page
 *    that reflowed, a footer that gained a disclaimer — every one of those changes
 *    every line number on the page and none of them changes a label.
 * 2. **A format change is detected rather than predicted.** The signature misses,
 *    or the arithmetic afterwards fails; both mean the same thing and both route
 *    to re-derivation. Nobody has to know in advance that the user changed jobs.
 *
 * Pure TypeScript over strings. No database: the caller supplies the candidates,
 * which is the rule `matchSavedMapping` already follows.
 */

import { cleanText, containsLetter } from '@/core/text.ts'
import {
  fundReportFieldLines,
  payslipFieldLines,
  resolveFieldLines,
  type FieldLine,
  type FundReportLines,
  type PayslipLines,
  type ResolvedTemplate,
} from '@/domain/modelTasks.ts'
import {
  DEPOSIT_TABLE_FIELD,
  type DeductionAnchor,
  type DepositTableAnchor,
  type FieldAnchor,
  type FundReportTemplate,
  type PayslipTemplate,
} from '@/domain/model/templates.ts'

/**
 * Versioned for `signature.ts`'s reason: a signature written by an older
 * normalization has to be recognised as unreadable rather than silently
 * mis-matched. `lv` for label-value, so the two never collide.
 */
const SIGNATURE_VERSION = 'lv1'

/** ASCII unit separator, which normalization cannot leave inside a label. */
const SEPARATOR = '\u001f'

/**
 * Below this share of labels in common, two documents are different formats.
 *
 * Higher than the tabular threshold, and it can afford to be: a slip carries
 * thirty-odd labels where a statement carries a dozen columns, so the noise a
 * single changed line contributes is smaller. What has to survive is the handful
 * of lines that legitimately differ month to month — the month's name in a title,
 * a seniority count that reads in words — and on the fixture that is one label in
 * thirty.
 */
const CLOSE_ENOUGH = 0.8

/**
 * And below this many labels in common, the share means nothing. Two unrelated
 * documents that both say "date" and "total" agree on 2 of 2.
 */
const MIN_COMMON_LABELS = 6

/** A label shorter than this is a stray letter, not a word the format uses. */
const MIN_LABEL_LENGTH = 2

/**
 * The label a line carries: its words, with everything that varies removed.
 *
 * **Every token holding a digit goes**, which is the whole rule and the reason it
 * is this crude. An amount, a date, an ID number, a percentage and a seniority
 * count are all data, they are all what changes between two documents of one
 * format, and they all contain a digit. What is left is the words — and Hebrew
 * financial vocabulary keeps its punctuation through this untouched, because
 * `סה"כ` and `ח.פ.` have no digits in them. The label is read off the document
 * here, which is what stops a grammar mangling it (D-137); nothing upstream is
 * ever asked to copy one.
 *
 * Rules and ruled lines (`────`, `—`) carry no letter and contribute nothing.
 */
export function labelOf(line: string): string {
  const words = cleanText(line)
    .split(' ')
    .filter((token) => containsLetter(token) && !/[0-9]/.test(token))

  const label = words.join(' ').toLocaleLowerCase('he')
  return label.length < MIN_LABEL_LENGTH ? '' : label
}

/** Every line's label, in document order, blanks kept so an index is a line. */
export function labelsByLine(text: string): readonly string[] {
  return text.split(/\r?\n/).map(labelOf)
}

/** The distinct labels a document carries, sorted. The format, without the data. */
export function documentLabels(text: string): readonly string[] {
  const labels = new Set(labelsByLine(text).filter((label) => label !== ''))
  // By code point rather than by locale: a signature is compared as text between
  // one machine and the next, and `localeCompare` is the one comparison in reach
  // whose answer depends on which ICU build is installed.
  return [...labels].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

export function computeLabelSignature(text: string): string {
  const labels = documentLabels(text)
  return [SIGNATURE_VERSION, String(labels.length), ...labels].join(SEPARATOR)
}

/** The labels back out of a signature, or undefined if a different version wrote it. */
export function labelsFromSignature(signature: string): readonly string[] | undefined {
  const parts = signature.split(SEPARATOR)
  if (parts[0] !== SIGNATURE_VERSION) return undefined

  const declared = Number(parts[1])
  const labels = parts.slice(2)
  if (!Number.isInteger(declared) || declared !== labels.length) return undefined
  return labels
}

export interface LabelDifference {
  /** Labels the stored template has that this document does not. */
  readonly missingLabels: readonly string[]
  /** Labels this document has that the stored template does not. */
  readonly addedLabels: readonly string[]
  /** Labels in common as a share of the two documents' labels taken together. */
  readonly similarity: number
}

export type LabelMatch =
  | { readonly kind: 'exact' }
  | ({ readonly kind: 'close' } & LabelDifference)
  | { readonly kind: 'none' }

/**
 * What changed between a stored signature and the document in front of us.
 *
 * A set comparison, where the tabular side needs a sequence alignment: a header
 * has an order that a role points into by index, and a page's labels do not —
 * an anchor names a label, so a label that moved has not moved anything. Which
 * makes the intersection over the union the honest measure of "the same format".
 */
export function diffLabels(
  saved: readonly string[],
  current: readonly string[],
): LabelDifference {
  const savedSet = new Set(saved)
  const currentSet = new Set(current)

  const missingLabels = [...savedSet].filter((label) => !currentSet.has(label))
  const addedLabels = [...currentSet].filter((label) => !savedSet.has(label))

  const common = savedSet.size - missingLabels.length
  const union = savedSet.size + addedLabels.length
  return { missingLabels, addedLabels, similarity: union === 0 ? 0 : common / union }
}

export function compareLabelSignatures(saved: string, current: string): LabelMatch {
  if (saved === current) return { kind: 'exact' }

  const savedLabels = labelsFromSignature(saved)
  const currentLabels = labelsFromSignature(current)
  if (savedLabels === undefined || currentLabels === undefined) return { kind: 'none' }

  const difference = diffLabels(savedLabels, currentLabels)
  const common = savedLabels.length - difference.missingLabels.length
  if (common < MIN_COMMON_LABELS) return { kind: 'none' }
  if (difference.similarity < CLOSE_ENOUGH) return { kind: 'none' }
  return { kind: 'close', ...difference }
}

/** The shape `matchLabelTemplate` needs. The repository's `DocumentTemplate` satisfies it. */
export interface TemplateCandidate {
  readonly labelSignature: string
}

export interface TemplateMatch<T extends TemplateCandidate> {
  readonly candidate: T
  readonly comparison: Exclude<LabelMatch, { kind: 'none' }>
}

/**
 * The stored template that best fits this document, if any.
 *
 * An exact match wins outright; otherwise the closest one does. There is no
 * re-pointing step here of the kind `fitMapping` performs, and that is the
 * dividend of anchoring: a stored template already describes where its fields are
 * in terms this document can answer, so a close match needs nothing done to it
 * before it is executed. Whether it *should* be executed is settled afterwards,
 * by the arithmetic.
 */
export function matchLabelTemplate<T extends TemplateCandidate>(
  text: string,
  candidates: readonly T[],
): TemplateMatch<T> | undefined {
  const signature = computeLabelSignature(text)
  let best: TemplateMatch<T> | undefined

  for (const candidate of candidates) {
    const comparison = compareLabelSignatures(candidate.labelSignature, signature)
    if (comparison.kind === 'none') continue
    if (comparison.kind === 'exact') return { candidate, comparison }
    if (best !== undefined && comparison.similarity <= rank(best.comparison)) continue
    best = { candidate, comparison }
  }

  return best
}

function rank(comparison: Exclude<LabelMatch, { kind: 'none' }>): number {
  return comparison.kind === 'exact' ? 1 : comparison.similarity
}

/**
 * The candidates close enough to each other that one document could match
 * either, as pairs — so a list can say so on both rows.
 *
 * This answers something reported from real use (08 C14): four months read in a
 * row produced two templates for one employer, and slips then seemed to be read
 * by “a random one of the same keywords”. It is not random and neither template
 * is wrong — a natively read slip and an OCR-read one carry *slightly different
 * labels* (D-146, D-147), so they sign differently even though a person calls
 * them one format, and the matcher then chooses between them by which was used
 * last. What was missing was anywhere to see that there were two.
 *
 * The same relation `matchLabelTemplate` uses, applied between stored templates
 * instead of between a template and a document: if a document could be exact for
 * one and close to the other, these two are competing for the same slips.
 */
export function pairsThatReadAlike<T extends TemplateCandidate>(
  candidates: readonly T[],
): readonly (readonly [T, T])[] {
  const pairs: (readonly [T, T])[] = []

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const one = candidates[i]
      const other = candidates[j]
      if (one === undefined || other === undefined) continue
      if (compareLabelSignatures(one.labelSignature, other.labelSignature).kind === 'none') continue
      pairs.push([one, other])
    }
  }

  return pairs
}

// --- Line numbers in, anchors out -------------------------------------------

/**
 * Anchor a set of field-and-line pairs to the words on those lines.
 *
 * This is the step that turns a model's answer — which is about *one document* —
 * into a template, which is about a *format*. It runs once, before anything is
 * stored, and the line numbers do not survive it except as the hint on each
 * anchor.
 *
 * A field whose line carries no label is not anchored: a figure alone on a line
 * has nothing to find it by next month, and an anchor on the empty string would
 * match the first blank line in the document. Saying so is the whole of the
 * handling — the confirm surface is where a person supplies what a deriver
 * could not.
 */
export function anchorFields(
  entries: readonly FieldLine[],
  text: string,
): {
  readonly anchors: readonly FieldAnchor[]
  readonly unanchored: readonly { readonly field: string; readonly reason: string }[]
} {
  const lines = labelsByLine(text)
  const anchors: FieldAnchor[] = []
  const unanchored: { field: string; reason: string }[] = []

  // How many lines carrying this label come before it, so the second `מס הכנסה`
  // on a slip — the year-to-date one — is a different anchor from the first.
  const occurrenceAt = (index: number): number | undefined => {
    const label = lines[index]
    if (label === undefined || label === '') return undefined
    let count = 0
    for (let i = 0; i < index; i++) if (lines[i] === label) count++
    return count
  }

  for (const { field, line } of entries) {
    const label = lines[line - 1]
    if (label === undefined) {
      unanchored.push({ field, reason: `the document has no line ${line}` })
      continue
    }
    if (label === '') {
      unanchored.push({ field, reason: `line ${line} carries no label to anchor to` })
      continue
    }
    anchors.push({ field, label, occurrence: occurrenceAt(line - 1) ?? 0, derivedLine: line })
  }

  return { anchors, unanchored }
}

/**
 * A model's payslip answer, anchored. The artifact that gets stored.
 *
 * The column flags travel with their row, because they were read off the same
 * line: a row that prints three figures has a basis, and that is a fact about
 * the format rather than about the month.
 */
export function anchorPayslip(
  template: PayslipLines,
  text: string,
): {
  readonly template: PayslipTemplate
  readonly unanchored: readonly { readonly field: string; readonly reason: string }[]
} {
  const { anchors, unanchored } = anchorFields(payslipFieldLines(template), text)

  const fields: FieldAnchor[] = []
  const deductions: DeductionAnchor[] = []

  for (const anchor of anchors) {
    const index = deductionIndexOf(anchor.field)
    if (index === undefined) {
      fields.push(anchor)
      continue
    }
    const row = template.deductionLines[index]
    if (row === undefined) continue
    deductions.push({
      ...anchor,
      hasEmployerColumn: row.hasEmployerColumn,
      hasBasisColumn: row.hasBasisColumn,
    })
  }

  return { template: { shape: 'payslip', fields, deductions }, unanchored }
}

/**
 * A model's fund-report answer, anchored. The artifact that gets stored.
 *
 * The single figures are the payslip's code exactly — labels rather than line
 * numbers, an occurrence ordinal so a figure printed twice is two anchors. What
 * differs is the repeating part, and it differs because the two documents repeat
 * differently: a slip's deduction rows have stable names and a stable count, so
 * each is anchored to its own label, and a report's deposit rows have no labels
 * and a count that changes every quarter, so the table is anchored once at its
 * heading and its rows are found by shape (`anchorDepositTable`, D-153).
 */
export function anchorFundReport(
  template: FundReportLines,
  text: string,
): {
  readonly template: FundReportTemplate
  readonly unanchored: readonly { readonly field: string; readonly reason: string }[]
} {
  const { anchors, unanchored } = anchorFields(fundReportFieldLines(template), text)
  const table = anchorDepositTable(template, text)
  return {
    template: {
      shape: 'fundReport',
      fields: anchors,
      ...(table.anchor === undefined ? {} : { depositTable: table.anchor }),
    },
    unanchored: [...unanchored, ...table.unanchored],
  }
}

/**
 * The deposit table's heading, anchored, with the column order it was given.
 *
 * Separate from `anchorFields` for the reason `DepositTableAnchor` exists: a
 * heading is words and no figure, and the columns are not a field at all. Both
 * halves have to be present — a heading with no column order describes a table
 * nothing can read, and an order with no heading names no table — so a template
 * with one of them gets neither, and says which half was missing.
 */
function anchorDepositTable(
  template: FundReportLines,
  text: string,
): {
  readonly anchor: DepositTableAnchor | undefined
  readonly unanchored: readonly { readonly field: string; readonly reason: string }[]
} {
  const line = template.depositTableHeaderLine
  const columns = template.depositColumns ?? []
  if (line === undefined && columns.length === 0) return { anchor: undefined, unanchored: [] }

  const missing = (reason: string) => ({
    anchor: undefined,
    unanchored: [{ field: DEPOSIT_TABLE_FIELD, reason }],
  })

  if (line === undefined) return missing('a deposit table’s columns were named but its heading was not')
  if (columns.length === 0) {
    return missing('a deposit table’s heading was named but not what its columns hold')
  }

  const { anchors, unanchored } = anchorFields([{ field: DEPOSIT_TABLE_FIELD, line }], text)
  const header = anchors[0]
  if (header === undefined) {
    return { anchor: undefined, unanchored }
  }
  return { anchor: { header, columns }, unanchored: [] }
}

const DEDUCTION_FIELD = /^deduction\[(\d+)\]$/

function deductionIndexOf(field: string): number | undefined {
  const match = DEDUCTION_FIELD.exec(field)
  const index = match?.[1]
  return index === undefined ? undefined : Number(index)
}

// --- Anchors in, this document's lines out ----------------------------------

/**
 * Find each anchored field in a document, and say what could not be found.
 *
 * The reverse of `anchorFields`, and the path a *stored* template takes every
 * time — which is to say the path that runs with no model anywhere near it. The
 * lines it works out are then handed to the same guards a model's answer goes
 * through (`resolveFieldLines`), because a label that resolves to a heading is
 * the same error whichever route proposed it.
 *
 * A label the document repeats resolves by ordinal. Where the ordinal is gone —
 * the document dropped a row above this one — but the label is now unique, the
 * one line carrying it is taken: that is a document with *fewer* of something,
 * which is the ordinary shape of a month with no loan deduction, and refusing it
 * would re-derive a template that is working.
 */
export function resolveAnchors(
  anchors: readonly FieldAnchor[],
  text: string,
): ResolvedTemplate {
  const located: FieldLine[] = []
  const unresolved: { field: string; reason: string }[] = []

  const linesFor = labelIndex(text)

  for (const anchor of anchors) {
    const matches = linesFor.get(anchor.label) ?? []
    const line = matches[anchor.occurrence] ?? (matches.length === 1 ? matches[0] : undefined)
    if (line === undefined) {
      unresolved.push({
        field: anchor.field,
        reason:
          matches.length === 0
            ? `no line reads “${anchor.label}”`
            : `“${anchor.label}” appears ${matches.length} times and none of them is the one this field was on`,
      })
      continue
    }
    located.push({ field: anchor.field, line })
  }

  const resolved = resolveFieldLines(located, text)
  return { fields: resolved.fields, unresolved: [...unresolved, ...resolved.unresolved] }
}

/** Every line a label appears on, one-based, in document order. */
function labelIndex(text: string): ReadonlyMap<string, number[]> {
  const linesFor = new Map<string, number[]>()
  labelsByLine(text).forEach((label, index) => {
    if (label === '') return
    const found = linesFor.get(label)
    if (found === undefined) linesFor.set(label, [index + 1])
    else found.push(index + 1)
  })
  return linesFor
}

/**
 * One anchor's line, found by its label alone — **without the digit guard**.
 *
 * `resolveAnchors` hands what it finds to `resolveFieldLines`, which rejects a
 * line carrying no digit because a model's cheapest error is to point a figure
 * field at a table's headings. The deposit table's anchor *is* those headings
 * (D-153), so it takes the same label lookup and stops before the guard. It is
 * the only caller that may, and the guard stays exactly as strong for
 * everything that does point at a figure.
 */
export function resolveAnchorLine(anchor: FieldAnchor, text: string): number | undefined {
  const matches = labelIndex(text).get(anchor.label) ?? []
  return matches[anchor.occurrence] ?? (matches.length === 1 ? matches[0] : undefined)
}
