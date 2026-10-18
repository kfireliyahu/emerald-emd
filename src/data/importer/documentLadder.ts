/**
 * F17's ladder, for any label-value document: **every document takes the first
 * rung that works, and the ladder always terminates.**
 *
 * 1. A stored template whose signature this document matches → execute it. No
 *    model, no network, nothing asked. This is the rung that makes a template
 *    worth storing, and it is the one M11's done-when clause is about.
 * 2. The stored template no longer verifies, or there is none → derive one. The
 *    deriver is a **parameter**, which is what "provider-agnostic" means here:
 *    the local model supplies one, the plugin could, a shipped seed could, and
 *    this file cannot tell them apart. It is also what makes the rung testable
 *    without a model on the machine running the test.
 * 3. Nothing derived one → the surface says so and a person fills the form in.
 *    That is the terminating rung and it needs nothing from here.
 *
 * **A reading is never thrown away because it failed.** A template that stops
 * verifying drops to the next rung — but if the next rung produces nothing, the
 * failed reading is still what gets returned, because the confirm surface exists
 * precisely to put a reading that did not check out in front of a person.
 * Returning "no template" for a document we read badly would hide the evidence.
 *
 * **Why this is generic and its two callers are twenty lines each.** A payslip
 * and a pension report are the same problem — words that do not change between
 * months, numbers that do — and everything above is a statement about *that*
 * rather than about payroll. What differs is only what a template's fields are
 * called, how a reading is executed and what counts as proof, and those are the
 * three functions a `LadderShape` supplies. The alternative was a second copy of
 * this file with `slip` replaced by `report`, which is how two rungs drift apart
 * without anybody deciding they should.
 *
 * No database here: the caller passes the templates it is willing to trust,
 * which is `readableTemplates` and therefore only the confirmed ones. That is
 * the same rule `matchSavedMapping` follows, and it keeps this testable with no
 * sql.js.
 */

import type { DocumentTemplate, TemplateAnchors } from '@/domain/model/templates.ts'

import { computeLabelSignature, matchLabelTemplate } from './labelTemplate.ts'

/**
 * Where a template came from, in the words the surface uses.
 *
 * `chosen` is the third one and it is not a rung: it is a person overruling the
 * match, which the ladder has no opinion about and the surface needs to say out
 * loud — a reading nobody asked for reads differently from one somebody picked
 * (D-148).
 */
export type LadderSource = 'stored' | 'derived' | 'chosen'

export interface LadderRead<
  Anchors extends TemplateAnchors,
  Reading,
  Stored extends DocumentTemplate,
> {
  readonly kind: 'read'
  readonly source: LadderSource
  /** The document's signature, which is what a derived template gets stored against. */
  readonly signature: string
  /** The anchors that produced this reading, ready to store when a person accepts. */
  readonly anchors: Anchors
  /** Present when rung 1 answered, or when a person named a format: the row already in the document. */
  readonly stored: Stored | undefined
  readonly reading: Reading
  /**
   * What was tried before this, in order, and why it was not enough.
   *
   * The surface says this out loud. "Your stored template no longer adds up, so
   * the model was asked again" is the sentence that turns a re-derivation from
   * something that happened to a person into something they can see happening.
   */
  readonly attempts: readonly string[]
}

export interface LadderUnread {
  readonly kind: 'unread'
  readonly signature: string
  readonly attempts: readonly string[]
}

export type LadderOutcome<
  Anchors extends TemplateAnchors,
  Reading,
  Stored extends DocumentTemplate,
> = LadderRead<Anchors, Reading, Stored> | LadderUnread

/** What a deriving rung provides. A model, the plugin, or a seed. */
export type Derive<Lines> = (text: string) => Promise<
  | { readonly kind: 'lines'; readonly lines: Lines }
  | { readonly kind: 'failed'; readonly reason: string }
>

/**
 * Everything that is particular to one kind of document.
 *
 * Four functions and a noun. Nothing here knows about rungs, and nothing in the
 * ladder knows what a deduction or a management fee is.
 */
export interface LadderShape<Lines, Anchors extends TemplateAnchors, Reading> {
  /** What the surface calls one of these — "slip", "report". Used in sentences. */
  readonly noun: string
  /** Line numbers in, anchors out: the step that turns an answer about one document into a format. */
  readonly anchor: (
    lines: Lines,
    text: string,
  ) => {
    readonly template: Anchors
    readonly unanchored: readonly { readonly field: string; readonly reason: string }[]
  }
  /** Execute a template against a document. */
  readonly execute: (anchors: Anchors, text: string) => Reading
  /** Execute a derivation that anchored nothing at all, by its line numbers. */
  readonly executeLines: (lines: Lines, text: string) => Reading
  /** Whether the document's own arithmetic vouches for this reading. */
  readonly verifies: (reading: Reading) => boolean
  /** Whether a template produced any anchor at all. */
  readonly isEmpty: (anchors: Anchors) => boolean
  /**
   * Whether the document's arithmetic **positively closes** under this reading —
   * stricter than `verifies`, which may pass a reading nothing could check.
   *
   * Present only where that proof exists, and it is what lets a stored template
   * whose labels drifted read a document anyway (rung 1b, M28 F1). A shape
   * without it never takes that rung, because an `unchecked` reading by a
   * template the labels did not choose is a guess.
   */
  readonly proves?: (reading: Reading) => boolean
}

export async function readByLadder<
  Lines,
  Anchors extends TemplateAnchors,
  Reading,
  Stored extends DocumentTemplate & { readonly anchors: Anchors },
>(options: {
  readonly shape: LadderShape<Lines, Anchors, Reading>
  readonly text: string
  readonly templates: readonly Stored[]
  readonly derive?: Derive<Lines> | undefined
}): Promise<LadderOutcome<Anchors, Reading, Stored>> {
  const { shape, text, templates, derive } = options
  const signature = computeLabelSignature(text)
  const attempts: string[] = []

  // --- Rung 1 ---------------------------------------------------------------
  const matched = matchLabelTemplate(text, templates)
  let stored: LadderRead<Anchors, Reading, Stored> | undefined

  if (matched !== undefined) {
    const template = matched.candidate
    const reading = shape.execute(template.anchors, text)
    stored = {
      kind: 'read',
      source: 'stored',
      signature,
      anchors: template.anchors,
      stored: template,
      reading,
      attempts: [],
    }
    if (shape.verifies(reading)) return stored

    attempts.push(
      `The stored template “${template.name}” read this ${shape.noun}, and the figures it found ` +
        `do not add up — so it is not trusted for this document.`,
    )
  }

  // --- Rung 1b: the labels drifted, and the arithmetic still closes ----------
  // **Found on OCR'd slips (M28 F1).** A page read off a picture carries a few
  // garbled labels, different ones every month — the dense lines of small print
  // are where they go wrong — and two months of one layout fell to 0.75 alike,
  // under `CLOSE_ENOUGH`, so the reader one taught was never even tried on the
  // next and the model was asked again for every month. The labels a reader
  // *anchors* on are the big, stable ones, so each template is executed as it
  // is: its own labels have to be on this page for it to read anything, and
  // its figures have to close to the agora. That is a stronger proof than a
  // share of labels in common — it is the one rung 1 asks for after matching.
  if (shape.proves !== undefined) {
    for (const template of templates) {
      if (template === matched?.candidate || shape.isEmpty(template.anchors)) continue
      const reading = shape.execute(template.anchors, text)
      if (!shape.proves(reading)) continue
      return {
        kind: 'read',
        source: 'stored',
        signature,
        anchors: template.anchors,
        stored: template,
        reading,
        attempts: [
          ...attempts,
          `The labels on this ${shape.noun} read differently from “${template.name}”’s, but the ` +
            `labels it reads by are on it and the figures it found add up.`,
        ],
      }
    }
  }
  if (matched === undefined && templates.length > 0) {
    attempts.push('No stored template matches this document’s labels.')
  }

  // --- Rung 2 ---------------------------------------------------------------
  if (derive === undefined) {
    attempts.push('No model is switched on, so nothing derived a template.')
    return stored === undefined ? { kind: 'unread', signature, attempts } : { ...stored, attempts }
  }

  const derived = await derive(text)
  if (derived.kind === 'failed') {
    attempts.push(derived.reason)
    return stored === undefined ? { kind: 'unread', signature, attempts } : { ...stored, attempts }
  }

  const { template: anchors, unanchored } = shape.anchor(derived.lines, text)
  for (const entry of unanchored) {
    attempts.push(`${entry.field}: ${entry.reason}.`)
  }

  // Anchored, and then read **through the anchors** rather than through the line
  // numbers the model answered with. A template that cannot find its own fields
  // on the document it was derived from is broken now rather than next month,
  // and this is where that shows — the alternative reads correctly today and
  // mysteriously tomorrow.
  const reading = shape.isEmpty(anchors)
    ? shape.executeLines(derived.lines, text)
    : shape.execute(anchors, text)

  return { kind: 'read', source: 'derived', signature, anchors, stored: undefined, reading, attempts }
}

/**
 * Read a document with a format the user named, stepping off the ladder.
 *
 * The ladder chooses; this is what "not that one, use this one" means, and it is
 * the click that turns a wrong match from a dead end into a correction (D-148).
 * No matching and no model — the anchors are executed as given, and the
 * arithmetic afterwards says whether the choice was right, exactly as it does
 * for a match nobody made.
 *
 * What came before is carried rather than replaced: the attempts are the only
 * account of *why* somebody had to choose, and dropping them would leave a
 * reading that looks as though it was the first thing tried.
 */
export function readWithTemplate<
  Lines,
  Anchors extends TemplateAnchors,
  Reading,
  Stored extends DocumentTemplate & { readonly anchors: Anchors },
>(options: {
  readonly shape: LadderShape<Lines, Anchors, Reading>
  readonly text: string
  readonly template: Stored
  readonly attempts?: readonly string[]
}): LadderRead<Anchors, Reading, Stored> {
  const { shape, text, template, attempts = [] } = options

  return {
    kind: 'read',
    source: 'chosen',
    signature: computeLabelSignature(text),
    anchors: template.anchors,
    stored: template,
    reading: shape.execute(template.anchors, text),
    attempts: [...attempts, `You chose the format “${template.name}” for this ${shape.noun}.`],
  }
}

/**
 * Whether accepting a reading has a template to **store**, as opposed to a
 * stored one to credit with a use.
 *
 * Three cases and only two of them store. A derived template is new and is the
 * whole reason the deriving rung exists. A stored template that matched is
 * already in the document. And a format **chosen by hand for a document its own
 * labels do not cover** stores a second row carrying the same anchors — because
 * choosing it is the user saying *this format reads documents like this one*,
 * and a correction that has to be repeated every month is not a correction. That
 * is deliberately narrow: a *close* automatic match stores nothing, or a
 * signature drifting a label a month would breed a row a month.
 *
 * Whether the reading verified is a separate question and the caller's: a
 * template is trusted only while it verifies (F17), and this says what there is
 * to store rather than whether to store it.
 */
export function storesTemplate(
  outcome: LadderRead<TemplateAnchors, unknown, DocumentTemplate>,
): boolean {
  if (outcome.stored === undefined) return true
  return outcome.source === 'chosen' && outcome.stored.labelSignature !== outcome.signature
}
