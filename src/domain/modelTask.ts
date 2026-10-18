/**
 * The shape of a question a local model may be asked — and nothing about what
 * the questions are.
 *
 * **Why this is its own file, which is a rule rather than tidiness.** The four
 * questions in `modelTasks.ts` are the ledger pack's: a payslip, a fund report,
 * a broker statement, a card statement's columns, each carrying a vocabulary
 * out of `domain/model/`. The engine has a question of its own now
 * (`format/proposal.ts`, M19 U2c), and `src/domain/format/` imports nothing
 * from the pack — so the *shape* the two share had to sit where neither owns
 * it. Extracting it was the whole of the structural change U2c made.
 *
 * `id` is a plain string here for the same reason: the set of tasks is not one
 * list any more, and a union naming the pack's four would have been the pack
 * reaching into the engine through a type.
 */

/**
 * One job a model can be given: who it is, what it is handed, what shape the
 * answer takes, and what it may spend getting there.
 */
export interface ModelTask<Context> {
  readonly id: string
  /** What a progress line calls it. */
  readonly label: string
  /**
   * Who the model is, and the vocabulary it is allowed to use.
   *
   * **A function of the context rather than a string since M19 U1** (D-212),
   * for `schema`'s reason below: the two must name the same roles, so they move
   * together or they drift.
   */
  readonly system: (context: Context) => string
  /**
   * A JSON Schema. Handed to the runtime as a grammar, never asked for in prose.
   *
   * **Built from the context** (D-212). The `enum` naming a column's role is
   * the *document's* vocabulary rather than this build's, because a document
   * may carry a role somebody added when a real file printed a column no
   * release had a name for (D-208). It is still a closed list at the moment the
   * model is asked, which is the whole of what D-114 requires - what changed is
   * where the list is read from, not whether there is one.
   */
  readonly schema: (context: Context) => unknown
  /**
   * Everything the model is told, built from the document and the vocabulary
   * it needs — the "preloaded rather than discovered" half of D-114.
   */
  readonly prompt: (context: Context) => string
  readonly limits: {
    readonly maxTokens: number
    readonly contextTokens: number
    readonly deadlineMs: number
  }
}
