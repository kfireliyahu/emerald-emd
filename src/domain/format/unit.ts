/**
 * **Dimension and conversion — the engine's half of a unit** (M19 U4a,
 * [H7](../../../docs/engine.md), D-223).
 *
 * D-216 stored a column's unit and refused to read it: *"recorded and not yet
 * interpreted"*, with the reason written down at the time — the engine owning
 * conversion is H7, and H7 was U4's decision. This file is that decision, made
 * the way this project makes them, which is by building the smallest version of
 * the thing rather than by reasoning one more time.
 *
 * ## Where the line is
 *
 * > **The engine owns dimension and conversion. A factor that crosses a
 * > dimension is a column somebody declared.**
 *
 * `kg` to `g` is arithmetic and belongs here: it is true in every domain, it
 * needs nothing from the document but the two symbols, and a pack that rebuilt
 * it would rebuild it badly — which is the `cost`-role bug (D-208) one level up.
 * `ml` to `g` is **not** arithmetic. It needs a density, and a density is a fact
 * about *pasta* rather than about volume; H7's own words are that cooking
 * retention factors are clearly not universal and grams and millilitres clearly
 * are. So this file converts inside a dimension, and across one it stops and
 * says exactly what it would need — which is a column the user already declares
 * by hand in the vault this engine is specified against (D-210).
 *
 * That refusal is the decision. Everything else here is a table.
 *
 * ## Why the table is rows in the document and not a `const`
 *
 * The same argument as the four reading vocabularies (D-212), and it has
 * already been paid for once: a vocabulary compiled into the binary cannot name
 * a thing a real document prints. A user weighing in `oz`, portioning in
 * `slice` or dosing in `IU` would be back to the wall that cost M16 a
 * ₪3,639 discrepancy, and the fix would again be a release.
 *
 * There is a second reason here that the roles never had. **A tablespoon is
 * 15 ml in this build and 20 ml in Australia**, a cup is 240 ml here and 250 ml
 * in a metric kitchen, and a fluid ounce is two different volumes on two sides
 * of an ocean. Those are not facts the engine gets to be right about; they are
 * conventions a document should record and a person should be able to correct.
 * A seeded row says what this build assumed; the row is in the file, so the
 * assumption is visible and editable rather than compiled in.
 *
 * **The list stays closed at the moment it is used** (D-114), exactly as the
 * roles do: it is built from the document's rows rather than from this array,
 * and this array is only what a new document is seeded with and what a caller
 * with no document in its hand falls back to.
 *
 * ## What U4c added, and what it did not
 *
 * A **quantity** is a number carrying its own unit per row — `150 g` on one
 * recipe line and `200 ml` on the next — and it is the type this file said it
 * was not, arriving one unit later (D-225). It changes nothing here: a quantity
 * is a value and a symbol, and the symbol is looked up in this table like every
 * other.
 *
 * What U4c did change is that the refusal above now has a **way through**, and
 * it is the shape H7 predicted rather than a retreat from it. `convertAcross`
 * crosses a dimension **only when handed the fact that crosses it** — a ratio a
 * person declared, as one unit per another — and it still knows no density of
 * its own. The engine performs the arithmetic; the document supplies the fact.
 * A build that ever puts a density in this file has made the mistake, whatever
 * `convertAcross` says.
 *
 * Not a dimensional checker either. **Conversion happens where somebody asked
 * for it and nowhere else**, which is `identity.ts`'s `in`. The reason is one
 * line of evidence: `4*protein_g + 4*carbs_g + 9*fat_g + 2*fiber_g = kcal` adds
 * grams and compares them to an energy, and it is *correct* — Atwater's 4 is
 * `kcal/g` and the engine has no idea. An engine that checked dimensions on
 * every sum would report the flagship identity of this whole milestone as
 * `unchecked`, so it does not check them; it converts when asked.
 */

/**
 * What a unit measures.
 *
 * **Physics, not food.** Mass, volume, length, time, energy and count are the
 * dimensions any domain has — a workout format needs time, a woodworking format
 * needs length — and the reason the list reaches past the three the recipe vault
 * needs is that a unit model shaped by one pack is the outcome H7 warns about in
 * its first paragraph.
 *
 * `COUNT` is the odd one and is here deliberately. It is seeded with `each` and
 * nothing else, because *one clove* and *one can* are both one thing and neither
 * converts to the other: what a `clove` weighs is a fact about garlic, which is
 * the far side of this file's line.
 */
export const DIMENSIONS = ['MASS', 'VOLUME', 'LENGTH', 'TIME', 'ENERGY', 'COUNT', 'RATIO'] as const

export type Dimension = (typeof DIMENSIONS)[number]

/** What each dimension counts in. Every `perBase` below is a multiple of these. */
export const BASE_UNITS: Readonly<Record<Dimension, string>> = {
  MASS: 'g',
  VOLUME: 'ml',
  LENGTH: 'mm',
  TIME: 's',
  ENERGY: 'kJ',
  COUNT: 'each',
  // A part of a whole (M24 U6, D-257). The percent is the base because it is
  // what a fee schedule prints; a basis point is a hundredth of one.
  RATIO: '%',
}

/**
 * `SEEDED` is one this build shipped; `USER` is one somebody added because they
 * measure in something this build never heard of.
 *
 * The distinction is the same one `column_role` draws (D-212) and it is not
 * decoration: it is what lets a later build change a seeded factor it got wrong
 * without silently overwriting a number a person entered on purpose.
 */
export type UnitOrigin = 'SEEDED' | 'USER'

/** One unit the document knows. */
export interface UnitRow {
  /** `kg`, `tbsp`, `µg` — written in a declaration and after an `in`. */
  readonly symbol: string
  readonly dimension: Dimension
  /**
   * How many of this dimension's base units one of these is. `kg` is `1000`.
   *
   * A plain `number` rather than anything cleverer, and that is a considered
   * limit: a conversion factor is a ratio of measurements, not money, so
   * D-003's rule does not reach it. **A `money` column carries no unit at all**
   * — `columnRejection` refuses one — so there is no path from this multiply to
   * an amount.
   */
  readonly perBase: number
  readonly origin: UnitOrigin
  /** What it is, or which convention it follows. Prose, stored, never parsed. */
  readonly note: string
}

export type UnitTable = readonly UnitRow[]

/**
 * `kg`, `µg`, `tbsp` — no space, no arithmetic, short.
 *
 * Tighter than a column name and for a different reason: a unit symbol is read
 * back out of an identity's text, where a space would end the token and a `-`
 * would be a subtraction. Case is kept, because `mg` and `Mg` are a thousandfold
 * apart in every table that has ever printed both.
 */
const SYMBOL_PATTERN = /^[\p{L}%°][\p{L}\p{N}%°_]*$/u

const MAX_SYMBOL_LENGTH = 16

/** Why this row cannot be a unit, in a sentence, or nothing. */
export function unitRejection(row: UnitRow): string | undefined {
  if (row.symbol.trim() === '') return 'A unit needs a symbol.'
  if (!SYMBOL_PATTERN.test(row.symbol)) {
    return `${row.symbol} is not a usable unit symbol. Use letters and digits with no spaces and no arithmetic — g, kg, µg, tbsp.`
  }
  if (row.symbol.length > MAX_SYMBOL_LENGTH) {
    return `The unit symbol ${row.symbol} is longer than ${MAX_SYMBOL_LENGTH} characters.`
  }
  if (!(DIMENSIONS as readonly string[]).includes(row.dimension)) {
    return `The unit ${row.symbol} measures ${String(row.dimension)}, which is not one of ${DIMENSIONS.join(', ')}.`
  }
  if (!Number.isFinite(row.perBase) || row.perBase <= 0) {
    return `The unit ${row.symbol} needs to say how many ${BASE_UNITS[row.dimension]} one of them is, as a number above zero.`
  }
  return undefined
}

/* ------------------------------------------------------------- the seeding */

function seeded(
  dimension: Dimension,
  symbol: string,
  perBase: number,
  note = '',
): UnitRow {
  return { symbol, dimension, perBase, origin: 'SEEDED', note }
}

/**
 * What a new document is seeded with, and what a caller holding no document
 * falls back to.
 *
 * **Every factor here is either exact or named as a convention.** The imperial
 * masses and the fluid ounce are exact by definition and are written to their
 * full precision rather than rounded, because a rounded factor is a figure that
 * is wrong in a way nothing will ever report. The spoons and the cup are *not*
 * definitions — they are the convention this build assumed — and each says so
 * in its note, which is the sentence a person needs in order to know that
 * changing the row is allowed.
 *
 * **`in` is not a unit and never will be.** It is the word that asks for a
 * conversion, and `declaration.ts` refuses it as a column name for the same
 * reason. The inch is the one unit this table cannot have, which is a small
 * price for an identity that reads like a sentence.
 */
export const SEEDED_UNITS: UnitTable = [
  // Mass. The base is the gram because it is what a label prints.
  seeded('MASS', 'µg', 0.000001),
  seeded('MASS', 'mcg', 0.000001, 'The same as µg, for a keyboard without one.'),
  seeded('MASS', 'mg', 0.001),
  seeded('MASS', 'g', 1),
  seeded('MASS', 'kg', 1000),
  seeded('MASS', 'oz', 28.349523125, 'The avoirdupois ounce, exact by definition.'),
  seeded('MASS', 'lb', 453.59237, 'Exact by definition.'),

  // Volume.
  seeded('VOLUME', 'ml', 1),
  seeded('VOLUME', 'cl', 10),
  seeded('VOLUME', 'dl', 100),
  seeded('VOLUME', 'l', 1000),
  seeded('VOLUME', 'tsp', 5, 'A convention, not a definition. The metric teaspoon.'),
  seeded('VOLUME', 'tbsp', 15, 'A convention, not a definition. 20 ml in Australia — change this row if that is your kitchen.'),
  seeded('VOLUME', 'cup', 240, 'A convention, not a definition. The US legal cup; a metric cup is 250.'),
  seeded('VOLUME', 'floz', 29.5735295625, 'The US fluid ounce. The imperial one is 28.4131.'),

  // Length.
  seeded('LENGTH', 'mm', 1),
  seeded('LENGTH', 'cm', 10),
  seeded('LENGTH', 'm', 1000),
  seeded('LENGTH', 'km', 1000000),

  // Time.
  seeded('TIME', 's', 1),
  seeded('TIME', 'min', 60),
  seeded('TIME', 'h', 3600),
  seeded('TIME', 'day', 86400),
  seeded('TIME', 'week', 604800),

  // Energy. The base is the kilojoule because the calorie is defined from it
  // and not the other way round, so every factor here stays exact.
  seeded('ENERGY', 'kJ', 1),
  seeded('ENERGY', 'kj', 1, 'The same as kJ, because a label prints it both ways.'),
  seeded('ENERGY', 'kcal', 4.184, 'The thermochemical calorie, exact by definition.'),

  // Count. One and only one, and the reason is in `DIMENSIONS` above.
  seeded('COUNT', 'each', 1),

  // Ratio (M24 U6, D-257): a fee in basis points is a unit rather than a
  // spelling in a column's name. **Nothing converts a ratio into money** — a
  // dimension converts only inside itself, and a money column has no unit
  // (D-223). Per mille is not here because `‰` is not a symbol this table
  // accepts, and a seeded unit its own rule refuses would be a first.
  seeded('RATIO', '%', 1, 'Parts per hundred. The base of the dimension.'),
  seeded('RATIO', 'bp', 0.01, 'A basis point, a hundredth of a percent.'),
]

/* --------------------------------------------------------- the conversion */

/** The row for a symbol, or nothing. Exact, because `mg` is not `Mg`. */
export function unitNamed(units: UnitTable, symbol: string): UnitRow | undefined {
  return units.find((each) => each.symbol === symbol)
}

/**
 * A conversion, or the sentence explaining why there is not one.
 *
 * **Total, and every way out is a sentence rather than a throw**, because every
 * caller of this is putting the answer beside a field or into a verdict: the
 * declaration's refusal, the identity's `unchecked`, the editor's problem list.
 * None of them can ask a follow-up question (D-219).
 */
export type Conversion =
  | { readonly factor: number }
  | { readonly problem: string }

/**
 * How many `to` one `from` is, against the units this document knows.
 *
 * The cross-dimension sentence is the one that matters and it is written to be
 * read by somebody who is about to fix it. It names both dimensions, names the
 * kind of fact that is missing, and says where such a fact is allowed to live —
 * which is a column of their own, because **the engine owning that factor is
 * precisely what H7 decided against.**
 */
export function conversionBetween(units: UnitTable, from: string, to: string): Conversion {
  if (from === to) return { factor: 1 }

  const source = unitNamed(units, from)
  if (source === undefined) return { problem: unknownUnit(units, from) }
  const target = unitNamed(units, to)
  if (target === undefined) return { problem: unknownUnit(units, to) }

  if (source.dimension !== target.dimension) {
    return {
      problem: `${from} measures ${word(source.dimension)} and ${to} measures ${word(target.dimension)}. A factor between them — ${bridge(source.dimension, target.dimension)} — is a fact about the thing being measured rather than about the units, so it belongs in a column of this format rather than in the app.`,
    }
  }

  const factor = source.perBase / target.perBase
  if (!Number.isFinite(factor) || factor === 0) {
    return { problem: `The factor between ${from} and ${to} did not come out as a number.` }
  }
  return { factor }
}

/**
 * A figure and what it is in — what a `quantity` column holds (U4c, D-225).
 *
 * Two cells in the table and one value here, exactly as `money` is, and for a
 * reason with the same shape: a number whose unit lives somewhere other than
 * beside it is a number that will eventually be read in the wrong one. `150`
 * and `g` travel together or the pair means nothing.
 */
export interface Quantity {
  readonly amount: number
  readonly unit: string
}

/**
 * The fact that crosses a dimension, as a person declared it: **one `per` is
 * `amount` of `unit`** (U4c, D-225).
 *
 * `{ amount: 0.94, unit: 'g', per: 'ml' }` is a density — one millilitre is
 * 0.94 grams. `{ amount: 60, unit: 'g', per: 'each' }` is what one egg weighs.
 * Both are columns somebody declared and neither is anything this file knows;
 * what this file knows is how to do the arithmetic once it has been handed one.
 *
 * The two unit symbols come from the column's own declaration — `unit` and
 * `per` — so the pair is visible in the artefact, refused by the reconciler
 * when it changes, and never a convention this build assumed.
 */
export interface Ratio {
  readonly amount: number
  readonly unit: string
  readonly per: string
}

/** The dimension a symbol measures, or nothing if this document has no such unit. */
export function dimensionOf(units: UnitTable, symbol: string): Dimension | undefined {
  return unitNamed(units, symbol)?.dimension
}

/**
 * A conversion that may cross a dimension, given the declared fact that crosses
 * it (U4c, D-225).
 *
 * **The bridge is used only when it is needed.** `150 g in g` and `2 kg in g`
 * are arithmetic and take the ordinary path with the ratio untouched — which is
 * not a convenience but the whole of what makes a quantity worth having: a
 * recipe line is `150 g` on one row and `200 ml` on the next, and one written
 * `amount in g via ingredient.density` has to answer both without the person
 * writing two identities.
 *
 * **It works in either direction**, because a ratio is a fact rather than an
 * arrow: *one millilitre is 0.94 grams* converts grams to millilitres by
 * dividing, and refusing to would be this file having an opinion about which
 * side of somebody's fact is the input.
 *
 * Every refusal names the ratio it was handed and what was asked of it, because
 * the reader is somebody holding a column that does not bridge what they
 * thought it bridged.
 */
export function convertAcross(
  units: UnitTable,
  value: number,
  from: string,
  to: string,
  ratio: Ratio,
): { readonly value: number } | { readonly problem: string } {
  const direct = conversionBetween(units, from, to)
  if ('factor' in direct) {
    // Same dimension, so the fact is not needed and is deliberately not
    // consulted. A bridge that fired here would be a second factor applied to a
    // figure that was already right.
    return { value: value * direct.factor }
  }

  const source = dimensionOf(units, from)
  const target = dimensionOf(units, to)
  if (source === undefined || target === undefined) return direct

  const held = dimensionOf(units, ratio.unit)
  const per = dimensionOf(units, ratio.per)
  if (held === undefined) return { problem: unknownUnit(units, ratio.unit) }
  if (per === undefined) return { problem: unknownUnit(units, ratio.per) }

  if (ratio.amount === 0 || !Number.isFinite(ratio.amount)) {
    return {
      problem: `The figure bridging ${word(source)} and ${word(target)} is ${String(ratio.amount)} ${ratio.unit} per ${ratio.per}, which nothing can be converted through.`,
    }
  }

  // Forward: the figure is in the dimension the ratio is *per*, and multiplying
  // by it lands in the dimension the ratio is *of*.
  if (source === per && target === held) {
    const into = convert(units, value, from, ratio.per)
    if ('problem' in into) return into
    return finish(units, into.value * ratio.amount, ratio.unit, to)
  }
  // Backward, and it is the same fact read the other way.
  if (source === held && target === per) {
    const into = convert(units, value, from, ratio.unit)
    if ('problem' in into) return into
    return finish(units, into.value / ratio.amount, ratio.per, to)
  }

  return {
    problem: `${ratio.unit} per ${ratio.per} relates ${word(held)} and ${word(per)}, and this converts ${word(source)} into ${word(target)}. It is the wrong fact for the crossing — ${bridge(source, target)} is what this needs.`,
  }
}

function finish(
  units: UnitTable,
  value: number,
  from: string,
  to: string,
): { readonly value: number } | { readonly problem: string } {
  const converted = convert(units, value, from, to)
  if ('problem' in converted) return converted
  if (!Number.isFinite(converted.value)) {
    return { problem: `The conversion into ${to} did not come out as a number.` }
  }
  return converted
}

/** The converted figure, or the sentence saying there is no converting it. */
export function convert(
  units: UnitTable,
  value: number,
  from: string,
  to: string,
): { readonly value: number } | { readonly problem: string } {
  const conversion = conversionBetween(units, from, to)
  if ('problem' in conversion) return conversion
  const converted = value * conversion.factor
  if (!Number.isFinite(converted)) {
    return { problem: `${value} ${from} in ${to} did not come out as a number.` }
  }
  return { value: converted }
}

/** `mass`, `volume` — the dimension as a person says it. */
export function word(dimension: Dimension): string {
  return dimension.toLowerCase()
}

/**
 * What a document would have to know to cross these two dimensions, named as
 * the thing rather than as a gap.
 *
 * Every one of these is a column the vault (D-210) already keeps by hand —
 * `density_g_per_ml`, `unit_weight_g` — which is the evidence that this side of
 * the line is where the factors were already living (D-210).
 */
function bridge(from: Dimension, to: Dimension): string {
  const pair = [from, to].sort().join('-')
  switch (pair) {
    case 'MASS-VOLUME':
      return 'a density'
    case 'COUNT-MASS':
      return 'what one of them weighs'
    case 'COUNT-VOLUME':
      return 'what one of them measures'
    case 'ENERGY-MASS':
      return 'an energy density'
    default:
      return 'a factor'
  }
}

function unknownUnit(units: UnitTable, symbol: string): string {
  const known = units.map((each) => each.symbol)
  const near = known.filter((each) => each.toLowerCase() === symbol.toLowerCase())
  if (near.length > 0) {
    return `This document has no unit called ${symbol}. It has ${near.join(' and ')}, and a unit symbol is read exactly as written — mg and Mg are a thousand apart.`
  }
  return `This document has no unit called ${symbol}. Add it, saying what it measures and how many of that dimension's base unit one of them is — ${known.length === 0 ? 'this document knows none at all' : `it knows ${known.slice(0, 8).join(', ')}`}.`
}

/**
 * The units of one dimension, in the order a person would offer them.
 *
 * Smallest first, which is the order every table of units has ever been printed
 * in and the order a picker should show.
 */
export function unitsOf(units: UnitTable, dimension: Dimension): UnitTable {
  return units
    .filter((each) => each.dimension === dimension)
    .slice()
    .sort((a, b) => a.perBase - b.perBase || a.symbol.localeCompare(b.symbol))
}
