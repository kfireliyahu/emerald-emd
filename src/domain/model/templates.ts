/**
 * What a stored mapping template is, for the documents that have no header row.
 *
 * Pure TypeScript: no React, no sql.js, no DOM. See docs/f17-mapping-templates.md
 * and D-132 — a model produces a template, never a value, and this is the
 * artifact it produces. `src/data/importer/labelTemplate.ts` builds and resolves
 * one; `documentTemplateRepository.ts` stores it.
 *
 * **A field is anchored to the words on its line, not to the line.** The model
 * answers with line numbers (D-137: a JSON grammar truncates `סה"כ ברוטו` at the
 * gershayim, so it is never asked for text), and code reads the label off that
 * line before anything is stored. Line numbers are a fact about one document;
 * labels are a fact about the format, which is the difference between a template
 * that survives next month's slip and one that does not.
 *
 * **Nothing here holds a figure.** A template says where a number is. Reading it
 * happens every time the document is opened, in `payslipTemplate.ts`.
 */

import type { ColumnRoleId } from './columnRoles.ts'

export const TEMPLATE_KINDS = ['PAYSLIP', 'FUND_REPORT'] as const

export type TemplateKind = (typeof TEMPLATE_KINDS)[number]

/**
 * Which rung of F17's ladder produced a template. The three deriving rungs emit
 * the same artifact and are told apart only so the confirm surface can say
 * where a proposal came from; `MANUAL` is the user pointing at the fields, the
 * rung that always terminates.
 */
export const DERIVED_BY = ['LOCAL_MODEL', 'PLUGIN', 'SEED', 'MANUAL'] as const

export type DerivedBy = (typeof DERIVED_BY)[number]

/**
 * One field, pinned to the words that introduce it.
 *
 * `occurrence` is which line carrying that label this is, counting from zero. A
 * payslip prints `מס הכנסה` in its deductions table and again under the
 * year-to-date totals; without an ordinal the two are the same anchor, and the
 * template would read the cumulative figure for the monthly one.
 */
export interface FieldAnchor {
  readonly field: string
  /** The normalized label. `labelOf` in `labelTemplate.ts` is what produced it. */
  readonly label: string
  readonly occurrence: number
  /**
   * The line it sat on when the template was derived.
   *
   * A hint for the confirm surface — "this is what it read" — and never how the
   * field is found again. Anything that resolves a template by this number has
   * undone the point of anchoring.
   */
  readonly derivedLine: number
}

/**
 * A deduction row, which is an anchor plus what the row's columns are.
 *
 * The flags say a row carries an employer or a basis figure. **No deriver ever
 * says what kind of deduction it is**: the template says a deduction line lives
 * here, and the user says it is pension and what it pays into (D-132).
 *
 * `deductionTypeId` is that answer, kept — and it narrows D-132 without
 * reversing it (D-145). The model still never names a type; what changed is
 * that the user's naming is remembered against the **format** rather than
 * re-asked every month. A label like `פנסיה אלפא מקיפה` is the employer's
 * wording for a fund, and no exact match against a deduction type's name will
 * ever find it — so the second slip of that format asked the same question the
 * first one already answered.
 *
 * **Set only by a human action.** Nothing that derives a template may write it:
 * `derivePayslipLines` produces anchors with this absent, and it arrives only
 * through `nameDeductionRows`, from the confirm surface. A row whose named type
 * has since been deleted resolves to nothing and is asked again, which is the
 * same answer an unnamed row gets.
 */
export interface DeductionAnchor extends FieldAnchor {
  readonly hasEmployerColumn: boolean
  readonly hasBasisColumn: boolean
  readonly deductionTypeId?: string
}

/**
 * The columns a fund report's deposit table can have, as roles.
 *
 * `COLUMN_ROLES`'s vocabulary for the one table that lives inside a label-value
 * document, and it is a closed list for D-114's reason: unaided, a model asked
 * to use an app's vocabulary invents members of it.
 *
 * `ignore` earns its place because a role here is **positional** — a report
 * prints a running total or a policy number between the columns that matter,
 * and a list that could only name the useful ones could not say where they are.
 */
export const DEPOSIT_COLUMN_ROLES = [
  'employerName',
  'depositDate',
  'salaryMonth',
  'salary',
  'employee',
  'employer',
  'severance',
  'total',
  'ignore',
] as const

export type DepositColumnRole = (typeof DEPOSIT_COLUMN_ROLES)[number]

export interface DepositColumn {
  /** Counting from zero, in the order the row's cells read. */
  readonly index: number
  /**
   * A role from **this document's** deposit-table vocabulary (D-213).
   *
   * `ColumnRoleId` rather than the union, because a mapping may name a role
   * somebody added when a real file printed a column no release could name
   * (D-208). Readers ask `isDepositRole` first; past that guard the union is
   * back and a `switch` over it is exhaustive again. An added role is **named,
   * not stored** — it reaches the mapping and no cell (D-211).
   */
  readonly role: ColumnRoleId
}

/**
 * The deposit table, as a template describes it: **one anchor and an order**
 * (D-153).
 *
 * The one place F17's "anchor every field to its label" does not fit, and the
 * reason is that a deposit table has no labels — every cell in it is data, and
 * the number of rows changes every quarter. A template naming this quarter's
 * row lines would be wrong by construction the next time one is read.
 *
 * So what is stored is what is actually stable about the table: the **heading
 * line**, which is words that do not change, and the **order of its columns**,
 * which is a fact about the format exactly as a statement's column roles are.
 * The rows are found by walking down from the heading and taking every line
 * that still parses as a row — a shape test, run on the document, every time.
 */
export interface DepositTableAnchor {
  readonly header: FieldAnchor
  readonly columns: readonly DepositColumn[]
}

/**
 * The field name the deposit table answers to, for pinning and for a correction.
 *
 * It is not a member of `fields` and never resolves to a figure; it exists so
 * that "the format found the wrong table" is a correction a user can make in the
 * one vocabulary every other correction already uses.
 */
export const DEPOSIT_TABLE_FIELD = 'depositTable'

/**
 * A payslip's field map. `fields` are the single figures — gross, net, the
 * stated deductions total, the dates; `deductions` are the rows of the
 * deductions table, in the order they are printed.
 */
export interface PayslipTemplate {
  readonly shape: 'payslip'
  readonly fields: readonly FieldAnchor[]
  readonly deductions: readonly DeductionAnchor[]
}

/**
 * A fund report's field map — a pension, hishtalmut, provident or savings
 * statement.
 *
 * **The same artifact as a payslip's, and its repeating part is a different
 * shape.** A slip's deductions are rows whose *names* are stable and whose count
 * is stable, so each one is anchored to its own label. A report's deposits are
 * rows with no labels at all and a count that changes every quarter, so the
 * table is anchored once at its heading and its rows are found by shape
 * (`DepositTableAnchor`, D-153). Everything F17 says about anchoring holds for
 * both — the words that do not change between quarters are the schema and the
 * numbers are the data.
 *
 * What *is* different is the proof. A payslip carries its own arithmetic
 * internally; a report prints only sometimes enough to check, which is why the
 * reading has a third state and not a boolean (`fundReportTemplate.ts`).
 */
export interface FundReportTemplate {
  readonly shape: 'fundReport'
  readonly fields: readonly FieldAnchor[]
  /**
   * The deposit table, where the report prints one (D-153).
   *
   * Optional, and absent is the ordinary case: an annual statement often prints
   * only totals. Kept beside `fields` rather than among them because it is not
   * a field — it is one anchor plus an order, and it resolves by a different
   * rule (a heading carries no figure, so the digit guard every field goes
   * through would reject it).
   */
  readonly depositTable?: DepositTableAnchor
}

/**
 * Every shape a stored template can take.
 *
 * Two, and they are the two `TEMPLATE_KINDS` names. A shape and a kind are
 * kept separate because the kind is what the schema stores and the shape is what
 * a reader switches on; the repository is where they are checked against each
 * other, and a row whose two disagree does not decode.
 */
export type TemplateAnchors = PayslipTemplate | FundReportTemplate

/** Every anchor in a template, whatever its shape. */
export function anchorsOf(template: TemplateAnchors): readonly FieldAnchor[] {
  return template.shape === 'payslip'
    ? [...template.fields, ...template.deductions]
    : template.fields
}

/** The rows a template names, which only a payslip has. */
export function deductionsOf(template: TemplateAnchors): readonly DeductionAnchor[] {
  return template.shape === 'payslip' ? template.deductions : []
}

/** A stored template whose anchors are a payslip's. Narrowed, never asserted. */
export interface PayslipDocumentTemplate extends DocumentTemplate {
  readonly anchors: PayslipTemplate
}

/** And the same for a fund report. */
export interface FundReportDocumentTemplate extends DocumentTemplate {
  readonly anchors: FundReportTemplate
}

/**
 * The two guards a caller uses instead of trusting `kind`.
 *
 * The repository will not decode a row whose kind and shape disagree, so in
 * practice these never reject anything — which is exactly why they are cheap to
 * keep. A reader that took the union and switched inside itself would have to
 * answer "what does a payslip reader do with a fund report" at every step; a
 * list filtered once has nothing to answer.
 */
export function isPayslipTemplate(
  template: DocumentTemplate,
): template is PayslipDocumentTemplate {
  return template.anchors.shape === 'payslip'
}

export function isFundReportTemplate(
  template: DocumentTemplate,
): template is FundReportDocumentTemplate {
  return template.anchors.shape === 'fundReport'
}

/** A stored template, as the document holds it. */
export interface DocumentTemplate {
  readonly id: string
  readonly kind: TemplateKind
  readonly name: string
  readonly labelSignature: string
  readonly anchors: TemplateAnchors
  readonly derivedBy: DerivedBy
  /** Null until a human agreed to it. An unconfirmed template is a proposal. */
  readonly confirmedAt: number | undefined
  readonly pinnedFields: readonly string[]
  readonly version: number
  readonly supersededAt: number | undefined
  readonly lastUsedAt: number | undefined
  readonly useCount: number
}

/**
 * Carry the fields the user fixed by hand across a re-derivation.
 *
 * "User overrides win" ([conventions](../../../docs/conventions.md)) applied to
 * a template, and it is the one rule that makes re-derivation safe to do
 * automatically. A format that changed in one place re-derives whole — that is
 * what a signature miss means — and without this, the correction the user made
 * last month is silently replaced by the guess it was made to fix.
 *
 * A pinned field the fresh template does not have is **kept**, not dropped: the
 * user said that field is there, and a deriver that missed it is the thing being
 * corrected. A pinned field the previous template never had is not a correction
 * of anything, and carries nothing.
 */
export function carryPinnedFields(
  previous: DocumentTemplate,
  derived: TemplateAnchors,
): TemplateAnchors {
  const pinned = new Set(previous.pinnedFields)
  if (pinned.size === 0) return derived

  const kept = new Map<string, FieldAnchor>()
  for (const anchor of anchorsOf(previous.anchors)) {
    if (pinned.has(anchor.field)) kept.set(anchor.field, anchor)
  }
  if (kept.size === 0) return derived

  // A shape carries nothing across to another shape. Two templates of different
  // shapes describe different documents, so a "correction" from one to the other
  // would be a label from a payslip pinned onto a fund report — which names no
  // line on either.
  if (previous.anchors.shape !== derived.shape) return derived

  if (derived.shape === 'fundReport') {
    const fields = replaceAnchors(derived.fields, kept)
    const present = new Set(fields.map((anchor) => anchor.field))
    const missing = [...kept.values()].filter((anchor) => !present.has(anchor.field))
    // The deposit table travels whole or not at all: a pinned heading with a
    // freshly derived column order describes a table that exists on neither
    // document. `depositTable` is the field name a user pins to say "you found
    // the wrong table", and what they corrected was both halves at once.
    const table =
      kept.has(DEPOSIT_TABLE_FIELD) && previous.anchors.shape === 'fundReport'
        ? previous.anchors.depositTable
        : derived.depositTable
    return {
      shape: 'fundReport',
      fields: [...fields, ...missing],
      ...(table === undefined ? {} : { depositTable: table }),
    }
  }

  const fields = replaceAnchors(derived.fields, kept)
  const deductions = derived.deductions.map((row) => {
    const held = kept.get(row.field)
    // A pinned deduction keeps its anchor and its column flags together: they
    // were corrected as one row, and a label from one template with the column
    // shape of another describes no row that exists.
    return held !== undefined && isDeduction(held) ? held : row
  })

  // Anything pinned that the fresh template lost. Appended rather than
  // interleaved — a template that dropped a field has no position to restore
  // it to, and the confirm surface is what orders these for a person anyway.
  const present = new Set([...fields, ...deductions].map((anchor) => anchor.field))
  const missing = [...kept.values()].filter((anchor) => !present.has(anchor.field))

  return {
    shape: derived.shape,
    fields: [...fields, ...missing.filter((anchor) => !isDeduction(anchor))],
    deductions: [...deductions, ...missing.filter(isDeduction)],
  }
}

function replaceAnchors(
  anchors: readonly FieldAnchor[],
  kept: ReadonlyMap<string, FieldAnchor>,
): readonly FieldAnchor[] {
  return anchors.map((anchor) => kept.get(anchor.field) ?? anchor)
}

function isDeduction(anchor: FieldAnchor): anchor is DeductionAnchor {
  return 'hasEmployerColumn' in anchor
}
