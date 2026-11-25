export interface ReadBudget {
  readonly limits: Readonly<Record<string, Readonly<Record<string, number>>>>
  readonly exempt: ReadonlySet<string>
  readonly tools: ReadonlySet<string>
}

export function readBudget(json: unknown): ReadBudget

export function judgeBudget(
  results: readonly { readonly route: string; readonly theme: string; readonly breaches: readonly string[] }[],
  budget: ReadBudget,
): { readonly failing: string[]; readonly exempted: string[] }
