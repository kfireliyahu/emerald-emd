/**
 * **An input refused with a sentence** — what a tool's caller, the command line
 * or the app is told instead of an answer. The plugin's tools catch it and say
 * the sentence; `src/data/export/formatExport.ts` throws it from code the app
 * runs too, which is why it lives here and not in `src/plugin/` (M63 U4).
 */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolInputError'
  }
}
