import { Bidi } from '@/ui/Bidi.tsx'

export interface Waiting {
  readonly key: string
  /** What is waiting, said as a finding: `3 charges have no category`. */
  readonly say: string
  /** Why it matters, in one line: `They change this month's totals.` */
  readonly why?: string | undefined
  /** The one verb that deals with it: `Answer them`. */
  readonly verb: string
  readonly onDo: () => void
  /** A tour's anchor on the verb (`choose-categories`), for the demo's tours. */
  readonly tour?: string | undefined
}

/**
 * **What is waiting, as one quiet list** (M64 U4, D-614 from C, D-615): every
 * item that asks something of the person, below the answer and never above it,
 * one row each — the finding, why it matters, one verb as a text action. No
 * alarm colour, no carousel, no count badge: an item is a sentence, and the
 * list is as long as what is waiting. Nothing waiting draws nothing — the
 * caller decides whether that is worth a sentence.
 */
export function WaitingList({ items, label }: { readonly items: readonly Waiting[]; readonly label: string }) {
  if (items.length === 0) return null
  return (
    <section aria-label={label} className="flex flex-col">
      <ul className="m-0 list-none p-0" data-block>
        {items.map((item) => (
          <li key={item.key} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-hairline py-3">
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Bidi className="font-medium">{item.say}</Bidi>
              {item.why !== undefined && <span className="text-ink-secondary">{item.why}</span>}
            </span>
            <button type="button" onClick={item.onDo} className="fc-text-action" data-tour={item.tour}>
              {item.verb}
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * **An empty state** (M64 U4, D-615): one sentence in `ink-secondary` and at
 * most one text action, with no illustration (*An empty state is one
 * sentence*). The kit's displays take the sentence as `empty` and draw it the
 * same way.
 */
export function EmptyState({
  say,
  verb,
  onDo,
}: {
  readonly say: string
  readonly verb?: string | undefined
  readonly onDo?: (() => void) | undefined
}) {
  return (
    <p className="m-0 flex flex-wrap items-baseline gap-x-3 text-ink-secondary">
      <span>{say}</span>
      {verb !== undefined && onDo !== undefined && (
        <button type="button" onClick={onDo} className="fc-text-action">
          {verb}
        </button>
      )}
    </p>
  )
}
