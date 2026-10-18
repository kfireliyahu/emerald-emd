/**
 * Stored mapping templates for label-value documents — the `DocumentTemplate`
 * of docs/04-data-model.md, and F17's first rung.
 *
 * `importMappingRepository.ts` is the same thing for spreadsheets. What is
 * different here is the version chain: a mapping is edited in place, because a
 * statement re-imported under a corrected mapping simply reads better; a
 * template is **superseded**, because last year's slips still need the map that
 * read them and a payslip already imported is a `paycheck` row that was
 * reconciled against a specific reading.
 *
 * Decoding is defensive throughout, for the reason every repository here is: a
 * `.emd` file is a real SQLite database the user owns and can open in any
 * tool. A template that no longer decodes is skipped, never thrown, and the
 * ladder falls to the next rung exactly as it does when no template exists.
 */

import { integerOf, objectOf, stringListOf } from './json.ts'
import type { ColumnRoleId } from '@/domain/model/columnRoles.ts'
import type { Database } from 'sql.js'

import { newId } from '@/core/id.ts'
import {
  DERIVED_BY,
  TEMPLATE_KINDS,
  carryPinnedFields,
  type DerivedBy,
  type DeductionAnchor,
  type DocumentTemplate,
  type FieldAnchor,
  type TemplateAnchors,
  type TemplateKind,
} from '@/domain/model/templates.ts'
import { columnRoleIds } from './columnRoleRepository.ts'
import { query } from '../db/database.ts'
import { declared, instantOf, millisOf } from '../packs/ledger/tables.ts'
import { insertRows, updateRow } from './formatRowRepository.ts'

export interface SaveTemplateInput {
  readonly kind: TemplateKind
  readonly name: string
  readonly labelSignature: string
  readonly anchors: TemplateAnchors
  readonly derivedBy: DerivedBy
  /**
   * Whether a human has already agreed to this one.
   *
   * Defaults to false and is meant to: a derived template is a proposal until
   * the confirm surface says otherwise, and `readableTemplates` will not hand
   * one out. A seed shipped with the app is no exception — the user has not
   * seen it either.
   */
  readonly confirmed?: boolean | undefined
}

const SELECT = `SELECT id, kind, name, label_signature, anchors, derived_by, confirmed,
                       pinned_fields, version, superseded, last_used, use_count
                  FROM fmt_document_template
                 WHERE state IN ('CURRENT', 'SUPERSEDED')`

const CURRENT = " AND state = 'CURRENT'"

/** Most recently used first, then the newest version — the same order the mappings list takes. */
const ORDER = " ORDER BY COALESCE(last_used, '') DESC, version DESC, name"

/** Every current template, confirmed or not. What the formats screen lists (D-148). */
export function listTemplates(db: Database, kind?: TemplateKind): readonly DocumentTemplate[] {
  const filter = kind === undefined ? '' : ' AND kind = ?'
  const parameters = kind === undefined ? [] : [kind]
  return decodeAll(db, query(db, SELECT + CURRENT + filter + ORDER, parameters))
}

/**
 * The templates the ladder's first rung may actually execute: current, and
 * confirmed.
 *
 * The gate is here rather than at a call site because there is no honest reason
 * for a call site to want the other set. "Nothing is written without a human
 * action" is the milestone's standing rule, and a template nobody has agreed to
 * reading a document unattended is exactly the thing it forbids.
 */
export function readableTemplates(db: Database, kind: TemplateKind): readonly DocumentTemplate[] {
  return decodeAll(db, query(db, `${SELECT}${CURRENT} AND kind = ? AND confirmed IS NOT NULL${ORDER}`, [kind]),
  )
}

export function findTemplateById(db: Database, id: string): DocumentTemplate | undefined {
  return decodeAll(db, query(db, `${SELECT} AND id = ?`, [id]))[0]
}

/** The current template for exactly this signature, confirmed or not. */
export function findTemplateBySignature(
  db: Database,
  kind: TemplateKind,
  signature: string,
): DocumentTemplate | undefined {
  return decodeAll(db, query(db, `${SELECT}${CURRENT} AND kind = ? AND label_signature = ?${ORDER}`, [
      kind,
      signature,
    ]),
  )[0]
}

/**
 * Store a derived template, superseding whatever covered this format before.
 *
 * Never an update. The old row keeps its anchors and is marked `SUPERSEDED`,
 * and the new one starts at the next version — which is what makes "a template
 * that stops verifying is re-derived rather than silently trusted" a thing that
 * can happen without losing the map a paycheck was already read with.
 *
 * The fields the user corrected come across (`carryPinnedFields`), and so does
 * the name they gave the format: re-deriving is the app noticing a document
 * changed, and it is not an occasion to forget that this is the employer the
 * user calls "Software Labs". A fresh derivation arrives **unconfirmed** even
 * when the one it replaces was confirmed, because what was agreed to was the
 * old anchors.
 */
export function saveTemplate(
  db: Database,
  input: SaveTemplateInput,
  now: number,
): DocumentTemplate {
  const previous = findTemplateBySignature(db, input.kind, input.labelSignature)

  const anchors = previous === undefined ? input.anchors : carryPinnedFields(previous, input.anchors)
  const pinnedFields = previous?.pinnedFields ?? []
  const version = (previous?.version ?? 0) + 1
  const name = previous === undefined ? input.name : previous.name

  const templates = declared(db, 'document_template')
  if (previous !== undefined) {
    updateRow(db, templates, previous.id, { state: 'SUPERSEDED', superseded: instantOf(now) })
  }

  const template: DocumentTemplate = {
    id: newId(),
    kind: input.kind,
    name,
    labelSignature: input.labelSignature,
    anchors,
    derivedBy: input.derivedBy,
    confirmedAt: input.confirmed === true ? now : undefined,
    pinnedFields,
    version,
    supersededAt: undefined,
    lastUsedAt: undefined,
    useCount: 0,
  }

  insertRows(
    db,
    templates,
    [
      {
        name: template.name,
        kind: template.kind,
        label_signature: template.labelSignature,
        anchors: JSON.stringify(template.anchors),
        derived_by: template.derivedBy,
        confirmed: template.confirmedAt === undefined ? null : instantOf(template.confirmedAt),
        pinned_fields: JSON.stringify(template.pinnedFields),
        version: template.version,
        state: 'CURRENT',
        use_count: 0,
      },
    ],
    [template.id],
  )

  return template
}

/** What the user calls this format. Set at the confirm step, changed on the formats screen. */
export function renameTemplate(db: Database, id: string, name: string, _now: number): void {
  updateRow(db, declared(db, 'document_template'), id, { name })
}

/**
 * The user moving a field to where it actually is.
 *
 * Two effects, and the second is the durable one: the anchor is replaced, and
 * the field is **pinned** — so the next derivation of this format carries the
 * correction forward instead of proposing the same mistake again. "User
 * overrides win", and a template is where that rule is cheapest to keep.
 */
export function correctTemplateField(
  db: Database,
  id: string,
  anchor: FieldAnchor,
  _now: number,
): DocumentTemplate | undefined {
  const template = findTemplateById(db, id)
  if (template === undefined) return undefined

  const anchors = replaceAnchor(template.anchors, anchor)
  const pinnedFields = template.pinnedFields.includes(anchor.field)
    ? template.pinnedFields
    : [...template.pinnedFields, anchor.field]

  updateRow(db, declared(db, 'document_template'), id, {
    anchors: JSON.stringify(anchors),
    pinned_fields: JSON.stringify(pinnedFields),
  })

  return { ...template, anchors, pinnedFields }
}

/**
 * What the user said this format's deduction rows are.
 *
 * **The one write in this file that stores an answer rather than a location**,
 * and the reason it is allowed to (D-145): a template says where a number is,
 * and this says what the row that number sits on *is* — which is not a figure,
 * is not derivable from the page, and is the only field on a payslip that no
 * arithmetic can ever check. D-132 put naming with the user and it stays there;
 * what changes is that the answer is kept against the format instead of being
 * asked again every month.
 *
 * **Pinned as well as stored**, through the same list `correctTemplateField`
 * uses. A naming is a user override in exactly the sense conventions means it,
 * so a later re-derivation of this format carries it across rather than
 * proposing an unnamed row again — and `carryPinnedFields` keeps the anchor
 * whole, which is what brings the naming with it.
 *
 * Rows the template does not have are ignored rather than appended: a naming
 * for an anchor that no longer exists describes no row on any document, and
 * inventing one to hold it would put a label in the template that the deriver
 * never found.
 */
export function nameDeductionRows(
  db: Database,
  id: string,
  named: ReadonlyMap<string, string>,
  _now: number,
): DocumentTemplate | undefined {
  const template = findTemplateById(db, id)
  if (template === undefined) return undefined
  if (named.size === 0) return template

  // A fund report has no rows to name: its template is single figures, and there
  // is nothing on it that is an answer rather than a location (D-145 is about
  // the payslip's deductions table specifically).
  if (template.anchors.shape !== 'payslip') return template

  const payslip = template.anchors
  let changed = false
  const deductions = payslip.deductions.map((row) => {
    const wanted = named.get(row.field)
    if (wanted === undefined || wanted === row.deductionTypeId) return row
    changed = true
    return { ...row, deductionTypeId: wanted }
  })
  if (!changed) return template

  const anchors: TemplateAnchors = { ...payslip, deductions }
  const pinnedFields = [...template.pinnedFields]
  for (const row of deductions) {
    if (row.deductionTypeId === undefined) continue
    if (!pinnedFields.includes(row.field)) pinnedFields.push(row.field)
  }

  updateRow(db, declared(db, 'document_template'), id, {
    anchors: JSON.stringify(anchors),
    pinned_fields: JSON.stringify(pinnedFields),
  })

  return { ...template, anchors, pinnedFields }
}

/**
 * Record that a template read a document.
 *
 * Called when a reading is committed, not when one is previewed — a template
 * that was executed and whose result was discarded did not read anything, which
 * is `recordMappingUse`'s rule and holds for the same reason.
 */
export function recordTemplateUse(db: Database, id: string, now: number): void {
  db.run('UPDATE fmt_document_template SET last_used = ?, use_count = use_count + 1 WHERE id = ?', [
    instantOf(now),
    id,
  ])
}

/** Soft, like everything else here: nothing is auto-deleted and history is kept. */
export function deleteTemplate(db: Database, id: string, _now: number): void {
  updateRow(db, declared(db, 'document_template'), id, { state: 'REMOVED' })
}

// --- Encoding ---------------------------------------------------------------

function replaceAnchor(anchors: TemplateAnchors, anchor: FieldAnchor): TemplateAnchors {
  const isDeduction =
    anchors.shape === 'payslip' && anchors.deductions.some((row) => row.field === anchor.field)

  if (!isDeduction) {
    const fields = anchors.fields.some((field) => field.field === anchor.field)
      ? anchors.fields.map((field) => (field.field === anchor.field ? anchor : field))
      : [...anchors.fields, anchor]
    return { ...anchors, fields }
  }
  if (anchors.shape !== 'payslip') return anchors

  // A deduction row keeps the column shape it was read with unless the
  // correction states one: the user is moving a label, and where the basis
  // column sits is not what they were asked about.
  const deductions = anchors.deductions.map((row) =>
    row.field === anchor.field ? { ...row, ...anchor } : row,
  )
  return { ...anchors, deductions }
}

const VALID_KINDS: ReadonlySet<string> = new Set<string>(TEMPLATE_KINDS)
const VALID_DERIVED_BY: ReadonlySet<string> = new Set<string>(DERIVED_BY)

/**
 * What this **document** calls a column role, per table (D-213).
 *
 * Read once per decode rather than per row: a stored template may name a role
 * somebody added because a real statement printed a column no release could
 * name (D-208), and checking against the `const` would drop exactly the template
 * the feature exists to keep. Still a closed set, still refuses a role nothing
 * ever declared.
 */
interface TableVocabularies {
  readonly deposit: readonly string[]
}

function vocabularies(db: Database): TableVocabularies {
  return {
    deposit: columnRoleIds(db, 'DEPOSIT'),
  }
}

function decodeAll(
  db: Database,
  rows: readonly Record<string, unknown>[],
): readonly DocumentTemplate[] {
  const vocabulary = vocabularies(db)
  const templates: DocumentTemplate[] = []
  for (const row of rows) {
    const template = decode(row, vocabulary)
    if (template !== undefined) templates.push(template)
  }
  return templates
}

function decode(
  row: Record<string, unknown>,
  vocabulary: TableVocabularies,
): DocumentTemplate | undefined {
  const kind = String(row['kind'])
  const derivedBy = String(row['derived_by'])
  if (!VALID_KINDS.has(kind) || !VALID_DERIVED_BY.has(derivedBy)) return undefined

  const anchors = decodeAnchors(row['anchors'], vocabulary)
  if (anchors === undefined) return undefined

  // **The kind and the shape have to agree.** They are two records of the same
  // fact — the column the schema indexes, and the tag the readers switch on —
  // and a row where they disagree is a row nothing can execute safely: a payslip
  // reader handed a report's anchors finds no deductions, reconciles against
  // nothing, and stores a template that has never once been right. Skipped, and
  // the ladder falls to the next rung exactly as it does when nothing is stored.
  if (SHAPE_OF_KIND[kind as TemplateKind] !== anchors.shape) return undefined

  const version = integerOf(row['version'])
  if (version === undefined) return undefined

  return {
    id: String(row['id']),
    kind: kind as TemplateKind,
    name: String(row['name'] ?? ''),
    labelSignature: String(row['label_signature'] ?? ''),
    anchors,
    derivedBy: derivedBy as DerivedBy,
    confirmedAt: millisOf(row['confirmed']),
    pinnedFields: stringListOf(row['pinned_fields']),
    version,
    supersededAt: millisOf(row['superseded']),
    lastUsedAt: millisOf(row['last_used']),
    useCount: Number(row['use_count'] ?? 0),
  }
}

/** Which anchor shape each kind is stored with. One row's two names for itself. */
const SHAPE_OF_KIND: Readonly<Record<TemplateKind, TemplateAnchors['shape']>> = {
  PAYSLIP: 'payslip',
  FUND_REPORT: 'fundReport',
}

/**
 * A template with no anchors at all does not decode.
 *
 * The alternative is a template that matches a document, executes, and reads
 * nothing — which reconciles to nothing, fails, and re-derives. That is the
 * right outcome reached the expensive way, and it is indistinguishable from a
 * format that genuinely changed.
 */
function decodeAnchors(
  value: unknown,
  vocabulary: TableVocabularies,
): TemplateAnchors | undefined {
  const parsed = objectOf(value)
  if (parsed === undefined) return undefined

  if (parsed['shape'] === 'fundReport') {
    const fields = decodeAnchorList(parsed['fields'])
    if (fields.length === 0) return undefined
    const table = decodeTable(parsed['depositTable'], vocabulary.deposit)
    return { shape: 'fundReport', fields, ...(table === undefined ? {} : { depositTable: table }) }
  }
  if (parsed['shape'] !== 'payslip') return undefined

  const fields = decodeAnchorList(parsed['fields'])
  const deductions = decodeDeductionList(parsed['deductions'])

  if (fields.length === 0 && deductions.length === 0) return undefined
  return { shape: 'payslip', fields, deductions }
}

/**
 * A rows-with-no-labels table: its heading anchor and its column order (D-153,
 * D-188).
 *
 * **This is the half that used to be silently dropped.** The write side has
 * always stored `anchors` whole with `JSON.stringify`, and this function did not
 * exist — so a fund report's deposit table survived being written and did not
 * survive being read back, and rung 1 executed a stored template that had
 * forgotten where its table was. Nothing failed: the reading came back with no
 * deposit rows, which is also what a report with no deposit table looks like.
 * Two shapes needing the same code is what made it visible.
 *
 * Both halves or neither, which is `anchorDepositTable`'s rule on the way in and
 * has to be the same rule on the way out: a heading with no columns describes a
 * table nothing can read.
 */
function decodeTable(
  value: unknown,
  roles: readonly string[],
): { readonly header: FieldAnchor; readonly columns: readonly { readonly index: number; readonly role: ColumnRoleId }[] } | undefined {
  // Already parsed — `parseObject` takes the JSON *string* the column holds,
  // and this is a value inside it.
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const parsed = value as Record<string, unknown>

  const header = decodeAnchor(parsed['header'])
  if (header === undefined) return undefined

  const raw = parsed['columns']
  if (!Array.isArray(raw)) return undefined

  const known = new Set<string>(roles)
  const columns: { readonly index: number; readonly role: ColumnRoleId }[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const index = integerOf(record['index'])
    const role = record['role']
    if (index === undefined || index < 0) continue
    if (typeof role !== 'string' || !known.has(role)) continue
    columns.push({ index, role })
  }

  return columns.length === 0 ? undefined : { header, columns }
}

function decodeAnchorList(value: unknown): readonly FieldAnchor[] {
  if (!Array.isArray(value)) return []
  const anchors: FieldAnchor[] = []
  for (const entry of value) {
    const anchor = decodeAnchor(entry)
    if (anchor !== undefined) anchors.push(anchor)
  }
  return anchors
}

function decodeDeductionList(value: unknown): readonly DeductionAnchor[] {
  if (!Array.isArray(value)) return []
  const rows: DeductionAnchor[] = []
  for (const entry of value) {
    const anchor = decodeAnchor(entry)
    if (anchor === undefined) continue
    const record = entry as Record<string, unknown>
    // A flag that is not `true` is false. A row whose column shape was written
    // by something that did not know about these reads as the narrow case, and
    // the narrow case is the one that cannot invent an employer figure.
    // Absent on every template written before D-145, and absent on every one a
    // deriver writes today — which is the same thing the reader has to do with
    // both: ask. A stored id is not checked against `deduction_type` here; the
    // review ladder does that, because a type can be deleted long after this
    // row was decoded and the answer has to be current rather than stored-true.
    const named = record['deductionTypeId']
    rows.push({
      ...anchor,
      hasEmployerColumn: record['hasEmployerColumn'] === true,
      hasBasisColumn: record['hasBasisColumn'] === true,
      ...(typeof named === 'string' && named !== '' ? { deductionTypeId: named } : {}),
    })
  }
  return rows
}

/**
 * One anchor, or nothing.
 *
 * An anchor missing its label or its field is not a partial anchor, it is no
 * anchor: there is nothing to look for. Dropped, and the arithmetic downstream
 * reports the field as missing.
 */
function decodeAnchor(entry: unknown): FieldAnchor | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined
  const record = entry as Record<string, unknown>

  const field = record['field']
  const label = record['label']
  const occurrence = integerOf(record['occurrence'])
  const derivedLine = integerOf(record['derivedLine'])
  if (typeof field !== 'string' || field === '') return undefined
  if (typeof label !== 'string' || label === '') return undefined
  if (occurrence === undefined || occurrence < 0) return undefined

  return { field, label, occurrence, derivedLine: derivedLine ?? 0 }
}
