/**
 * **The density budget, read and judged** (M64 U4, D-615). `probe:screens
 * --budget docs/redesign/budget.json` measures each route (D-612) against its
 * limits; this module reads the file and says which breaches fail the run.
 *
 * The file is `{ limits, exempt, tools }`:
 *   - `limits` — by route hash (`#/year`), `*` for every route, each a set of
 *     maximums named as the measures are (the route's own win over `*`);
 *   - `exempt` — routes not redesigned yet: their breaches are printed and do
 *     not fail. **The list only shrinks** (`src/ui/budget.test.ts` holds it to
 *     the ceiling U4 wrote): the unit that redesigns a route takes it off the
 *     list and tightens its limits in the same commit;
 *   - `tools` — pages that are not screens a person uses (the specimen page),
 *     never budgeted.
 * A plain map of limits, the shape before U4, still reads, with nothing exempt.
 */

/** The file, checked: what is wrong with it is a breach of its own, never skipped. */
export function readBudget(json) {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) throw new Error('A budget is an object.')
  const shaped = 'limits' in json
  const limits = shaped ? json.limits : json
  const exempt = shaped ? (json.exempt ?? []) : []
  const tools = shaped ? (json.tools ?? []) : []
  if (limits === null || typeof limits !== 'object' || Array.isArray(limits)) throw new Error('A budget’s limits are an object keyed by route.')
  for (const list of [exempt, tools]) {
    if (!Array.isArray(list) || list.some((route) => typeof route !== 'string')) throw new Error('`exempt` and `tools` are lists of route hashes.')
  }
  return { limits, exempt: new Set(exempt), tools: new Set(tools) }
}

/**
 * Which breaches fail and which are only reported. `results` are the probe's,
 * each `{ route, theme, breaches }` with its breaches already measured against
 * `limits`. A route in `tools` is left out entirely.
 */
export function judgeBudget(results, budget) {
  const failing = []
  const exempted = []
  for (const result of results) {
    if (budget.tools.has(result.route)) continue
    for (const breach of result.breaches) {
      const line = `${result.route} · ${result.theme}: ${breach}`
      if (budget.exempt.has(result.route)) exempted.push(line)
      else failing.push(line)
    }
  }
  return { failing, exempted }
}
