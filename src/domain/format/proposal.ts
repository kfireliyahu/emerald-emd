/**
 * **Proposing a format from an example** — M19 U2c, [D-221](../../../docs/09-decision-log.md).
 *
 * The third way a format can come into existence, and the one that needs no
 * vocabulary at all: hand the app a product label, a receipt, a note or a few
 * rows of a spreadsheet, and a *local* model says what columns that kind of
 * thing has. D-215's dial pointed at the format rather than at the rows —
 * `#/formats` → New gives you an empty form, `declare_format` takes a
 * declaration a conversation worked out, and this one starts from a piece of
 * paper.
 *
 * ## It is the third thing D-137 permits, and the first time it is asked under
 * a grammar
 *
 * *A model may produce a mapping, a position or a declaration — never a value
 * and never a program.* D-220 took the third of those from a conversation,
 * where no grammar is involved. This takes it from a constrained decoder, which
 * is the configuration that truncated `סה"כ ברוטו` at its gershayim (D-137) —
 * so the question is what stops a bad string here from being expensive.
 *
 * Two things do, and neither is a hope:
 *
 * 1. **The grammar has no numeric leaf anywhere.** Every leaf is a string, a
 *    boolean or a member of the closed type list. There is nowhere in this
 *    answer for a figure off the example to be written — which is why
 *    `minimum` and `maximum` are *not* asked for even though a declaration
 *    carries them. A bound is the one field where a number read off the paper
 *    could enter a declaration and silently constrain every row typed
 *    afterwards, and it is a judgement the editor has fields for.
 * 2. **The answer is a draft, not a declaration.** It lands in the editor
 *    D-219 built, with `draftProblems` drawn beside every field, and a person
 *    saves it or does not. A truncated name shows up as a red line under the
 *    field that carries it; a truncated title is a word somebody retypes.
 *    Nothing here reaches `db.run` on its own, and nothing here writes a row.
 *
 * **A proposal is always a new format.** It never arrives as a revision of one
 * the document already declares, which is D-220's *creates and never alters*
 * one level down: changing a format is drawn against the rows the table already
 * holds, and an example is not evidence about those rows. A name that collides
 * is an ordinary duplicate-name problem in the editor.
 */

import type { ModelTask } from '../modelTask.ts'

import { COLUMN_TYPES, isChoiceType, type ColumnType } from './declaration.ts'

/**
 * The types a model may propose from an example — **every one but `link` and
 * `quantity`** (U4b, D-224; U4c, D-225).
 *
 * `link` is left out for the reason D-221 left out a bound: not because a model
 * would get it wrong, but because **it has not been shown the thing it would
 * have to be right about.** A bound is a figure off the example that would
 * become a `CHECK` on every row typed afterwards; a link names a *format this
 * document declares*, and what goes to the model is a label, a receipt or a
 * spreadsheet and nothing else. By the privacy cut that is deliberate — the
 * example half carries no document — so a model offered `link` could only
 * invent a target, which is D-114's *a vocabulary handed over rather than
 * discovered* failing in the one place the vocabulary cannot be handed over.
 *
 * **`quantity` is left out by the same rule and it is the clearer case.** Which
 * type a figure is depends on whether the unit varies *from row to row*, and one
 * example is one row: a label printing `250 g` shows a model nothing about the
 * next label, so a model offered the choice would be answering a question about
 * a set of rows it has never seen. Everything it has been shown says `real` with
 * a unit, which is also the right answer almost every time.
 *
 * A person who wants either adds it in the editor, where the other formats are
 * on the screen beside the choice and the rows that already exist are a click
 * away. **Creating is the conversation's and changing is the editor's** (D-220),
 * and this is the third thing that divide has decided rather than the first.
 *
 * **`decimal` is left out for a smaller reason** (M24 U6, D-257): it needs a
 * scale, and the grammar has no field for one. A model that picked it would
 * propose a column that cannot be made; `real` is what it has been shown.
 */
const PROPOSABLE_TYPES = COLUMN_TYPES.filter(
  // A row in another document is never what an example shows (M47 U4), and a
  // path in an example is text until somebody says it is a file (M37 U6).
  (type) =>
    type !== 'link' && type !== 'links' && type !== 'quantity' && type !== 'decimal' && type !== 'elsewhere' && type !== 'file',
)
import { newColumn, suggestedName, type ColumnDraft, type FormatDraft } from './draft.ts'

/** What the model is shown. One example, as text, whatever file it came off. */
export interface ExampleContext {
  readonly text: string
}

/**
 * How much of an example is sent.
 *
 * An example is an example: a label is twenty lines, and a spreadsheet somebody
 * drops in is nine hundred rows of which the first few say everything about the
 * *kind*. The cap is here rather than at the call site so no surface can forget
 * it, and it is what keeps this inside its context window on a document nobody
 * looked at first.
 */
export const EXAMPLE_MAX_LINES = 60
export const EXAMPLE_MAX_CHARS = 6000

export interface Excerpt {
  readonly text: string
  /** How many lines the example had, so a surface can say what it sent. */
  readonly lines: number
  readonly truncated: boolean
}

/** The first `EXAMPLE_MAX_LINES` lines, and never more than the character cap. */
export function exampleExcerpt(text: string): Excerpt {
  const lines = text.split('\n')
  const kept = lines.slice(0, EXAMPLE_MAX_LINES).join('\n')
  const clipped = kept.length > EXAMPLE_MAX_CHARS ? kept.slice(0, EXAMPLE_MAX_CHARS) : kept
  return {
    text: clipped,
    lines: lines.length,
    truncated: lines.length > EXAMPLE_MAX_LINES || clipped.length < kept.length,
  }
}

/**
 * What kind of thing this is one of, asked of a local model.
 *
 * The type list is handed over rather than left to be discovered, which is
 * D-114's rule and the reason `enum` is in the grammar as well as in the prose:
 * a model asked to use an app's vocabulary unaided invents members of it.
 */
export const formatFromExample: ModelTask<ExampleContext> = {
  id: 'format-from-example',
  label: 'Working out the columns from an example',

  system: () =>
    [
      'You are given one example of a kind of thing — a product label, a receipt, a note, a few',
      'rows of a spreadsheet — and you describe the KIND, not the example.',
      '',
      'You answer with a list of COLUMNS: what facts one of these has, what each one is called',
      'and what it holds. You never copy a figure, a price, a date or a name out of the example.',
      'The example is there to tell you what facts exist; the facts themselves are typed in',
      'afterwards by the person who owns them.',
      '',
      'Only these types exist. Do not invent one:',
      '  text    — words: a name, a brand, a source, a note',
      '  integer — a whole number',
      '  real    — a number with a fraction',
      '  date    — a calendar date',
      '  month   — a month as a period, like a billing period: 2026-09',
      '  instant — a moment with its time of day and timezone',
      '  boolean — yes or no',
      '  enum    — one of a small fixed set of words, which you list',
      '  enums   — several of a small fixed set of words, which you list: tags, allergens',
      '  money   — a price, or any amount of money. Always money for a price, never real.',
      '  percent — a rate printed with %: VAT, a fee, a discount. Never real for a rate.',
      '  time    — a time of day, 09:30: a shift start, an opening hour. Never text for an hour.',
      '',
      'A column name is lower-case English, ASCII, with underscores between words, and it carries',
      'its unit: sat_fat_g, sodium_mg, energy_kcal, best_before, brand.',
      '',
      'Rules that decide whether the table is usable:',
      '  - One column per fact. “Sodium 0.4 g” is one column, not a number and a unit.',
      '  - Give the unit the example prints, never a converted one.',
      '  - Required means one of these cannot exist without it. Most columns are not.',
      '  - Use enum or enums only when the example makes the whole set of values plain. If you',
      '    would be guessing at the members, it is text.',
      '  - Leave out what belongs to the paper rather than to the thing: a till number, a page',
      '    number, a document reference.',
      '  - Between three and twenty-five columns. If the example carries more facts than that,',
      '    keep the ones somebody would look the thing up for.',
    ].join('\n'),

  /**
   * Every leaf is a string, a boolean or a member of the closed type list, and
   * **no leaf is a number** — see the head of this file. `minimum` and
   * `maximum` are deliberately absent.
   */
  schema: () => ({
    type: 'object',
    properties: {
      name: { type: 'string' },
      title: { type: 'string' },
      columns: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: { type: 'string', enum: [...PROPOSABLE_TYPES] },
            unit: { type: 'string' },
            required: { type: 'boolean' },
            values: { type: 'array', items: { type: 'string' } },
            note: { type: 'string' },
          },
          required: ['name', 'type'],
        },
      },
    },
    required: ['name', 'title', 'columns'],
  }),

  prompt: ({ text }) =>
    [
      'The example:',
      '',
      exampleExcerpt(text).text,
      '',
      'Describe the kind of thing this is one of:',
      '- name: what the table is called — lower-case English, underscores, singular:',
      '  ingredient, receipt, workout, book',
      '- title: what a person calls one of these, in ordinary words',
      '- columns: one entry per fact, each with its name, its type, its unit where it has one,',
      '  whether it is required, its values when it is an enum or enums, and a short note saying what it',
      '  means when the name does not say so on its own',
      '',
      'Describe the kind. Do not report anything the example says.',
    ].join('\n'),

  limits: { maxTokens: 1500, contextTokens: 8192, deadlineMs: 240_000 },
}

/**
 * A model's answer as a draft, or nothing.
 *
 * **Lenient where the editor can show a problem, strict where it cannot.** This
 * is the opposite of `toPayslipLines`, and deliberately: a template's fields are
 * consumed by code that reads figures off a document, so a bad leaf there has to
 * be dropped before it points somewhere. A draft is consumed by a form, and
 * `draftProblems` says more about a bad name than this function ever could — so
 * a name that breaks the rules is kept and drawn in red beside its own field.
 *
 * What is dropped rather than shown is what the *form* could not draw: a column
 * whose type is not one of the seven — the grammar's enum already forbids it,
 * and a select cannot offer a type that does not exist. A column silently
 * re-typed to `text` would be the invisible failure; a column that is missing is
 * one you can see.
 *
 * `undefined` when nothing survives — a proposal with no columns is not one.
 */
export function toProposedDraft(value: unknown): FormatDraft | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>

  const title = text(record['title'])
  const named = text(record['name'])
  // The name falls back to the title's slug, which is what the editor already
  // does for a person typing one (`suggestedName`). A model that answered
  // `Sat Fat` gets the same courtesy and the same final word from
  // `columnRejection`.
  const name = named === '' ? suggestedName(title) : named

  const rows = record['columns']
  if (!Array.isArray(rows)) return undefined

  const columns: ColumnDraft[] = []
  for (const entry of rows) {
    const column = toColumnDraft(entry)
    if (column !== undefined) columns.push(column)
  }
  if (columns.length === 0) return undefined

  // **No identities, and the H3 question left open on purpose** (U3, D-222).
  // A model is not asked what has to add up — its grammar has nowhere to put a
  // tolerance, which is D-221's *no numeric leaf* rule holding — so a proposal
  // arrives with nothing that must hold and nobody having said so. The editor
  // then refuses to finish quietly, which is the question being asked of the
  // person who owns the data rather than of the model.
  return {
    name,
    title,
    notes: '',
    columns,
    identities: [],
    // **And no aggregates** (U4b, D-224), for a nearer reason than the one
    // above: an aggregate names another format, and a model looking at one
    // label has not been shown the document it is landing in. What a model may
    // produce is a declaration of the thing in front of it (D-137), and a link
    // to a format it never saw is not that.
    aggregates: [],
    revising: undefined,
  }
}

function toColumnDraft(value: unknown): ColumnDraft | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>

  const declared = record['type']
  if (typeof declared !== 'string' || !(PROPOSABLE_TYPES as readonly string[]).includes(declared)) {
    return undefined
  }
  const type = declared as ColumnType

  // Everything a type cannot carry is cleared here rather than trusted, which is
  // `retype`'s rule arriving from outside the form: a `text` column holding a
  // unit nobody can see is the hidden second state D-138 keeps finding.
  return {
    ...newColumn(),
    name: text(record['name']),
    type,
    unit: type === 'money' ? '' : text(record['unit']),
    required: record['required'] === true,
    values: isChoiceType(type) ? members(record['values']) : '',
    note: text(record['note']),
  }
}

/** The enum's members as the form holds them — comma-separated, as typed. */
function members(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return value
    .filter((each): each is string => typeof each === 'string' && each.trim() !== '')
    .map((each) => each.trim())
    .join(', ')
}

/** A string, or nothing at all. Never a number stringified into a name. */
function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
