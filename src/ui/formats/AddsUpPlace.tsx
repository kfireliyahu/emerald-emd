import type { Tally } from '@/domain/format/row.ts'
import { Button } from '@/ui/components/Button.tsx'

/**
 * **Claims, as a place on the editor** — M29 U1, D-331; named *Claims* since M33 U3a.
 *
 * It was a 16px `=` icon among the toolbar's others, titled *Edit what adds
 * up*, and the verdict on a new-user run was that the button *"is
 * small and not intuitive"*. It is the thing the product is named after —
 * *won't let you be wrong quietly* is an identity, nothing else — so it is a
 * band of its own under the toolbar, named in words, saying what this format
 * holds itself to before anybody presses anything.
 *
 * Two states: identities, listed as they are written; or **nothing has to**,
 * which is what a format with none says. There was a third, *not answered
 * yet*, that Create waited on until somebody pressed *Nothing does*; the
 * verdict was *"just let the user continue"* (M29 F4, D-345).
 * The verdicts across the entries are reported in `positive` and `negative`;
 * the button is the only `accent` here (D-125).
 *
 * The panel it opens is `ShapePanel`'s `ADDS_UP` focus, the same one a column
 * header opens on a column. A column worked out from others (M29 U3b) is a
 * column, so it will be opened from its header; this band stays the one about
 * what has to agree.
 */
export function AddsUpPlace({
  identities,
  proof,
  open,
  onOpen,
}: {
  identities: readonly { readonly name: string; readonly expression: string }[]
  /** The verdicts over the entries, for a format that has some. */
  proof?: Tally | undefined
  /** Whether the panel underneath is open on this. */
  open: boolean
  /** Absent where the claims cannot be changed — the MCP App's frame (M41 U2). */
  onOpen: (() => void) | undefined
}) {
  const shown = identities.filter((each) => each.expression.trim() !== '')
  return (
    <section
      aria-label="Claims"
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline px-6 py-2"
    >
      <span className="text-label text-ink-tertiary uppercase">Claims</span>

      {shown.length > 0 ? (
        <ul className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          {shown.map((each) => (
            <li key={each.name} title={each.name}>
              <code className="text-caption text-ink">{each.expression}</code>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-caption text-ink-secondary">
          {/* Where there is no button, nothing invites a claim (M41 U2). */}
          {onOpen === undefined ? 'None.' : 'None. If something should agree — a total, a sum, a balance — claim it here.'}
        </span>
      )}

      <span className="ml-auto flex items-center gap-3">
        {proof !== undefined && shown.length > 0 && <Verdicts proof={proof} />}
        {onOpen !== undefined && (
          <Button
            size="sm"
            icon="equals"
            aria-pressed={open}
            disabled={open}
            onClick={onOpen}
            data-tour="claims"
          >
            {shown.length > 0 ? 'Change the claims' : 'Add a claim'}
          </Button>
        )}
      </span>
    </section>
  )
}

/** Across the entries: `unchecked` in ordinary ink, as the format list draws it (D-222). */
function Verdicts({ proof }: { proof: Tally }) {
  if (proof.proved + proof.failed + proof.unchecked === 0) {
    return <span className="text-caption text-ink-tertiary">No entries to check yet</span>
  }
  return (
    <span className="flex items-baseline gap-2 text-caption tabular-nums">
      {proof.proved > 0 && <span className="text-positive">{proof.proved} proved</span>}
      {proof.failed > 0 && <span className="text-negative">{proof.failed} failed</span>}
      {proof.unchecked > 0 && <span className="text-ink-secondary">{proof.unchecked} unchecked</span>}
    </span>
  )
}
