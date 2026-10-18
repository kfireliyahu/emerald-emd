import { Link } from 'react-router-dom'

/**
 * **By merchant · All rows**, the switch in the header of the one Transactions
 * page (M28 U6, choice 1 B). By merchant is where a pile of
 * uncategorized rows is worked through, one decision per shop; All rows is the
 * month, row by row. They are two views of one place, so the rail has one item,
 * and the count of names still waiting sits on the switch where it is a reason to
 * press it.
 */
export function ViewSwitch({
  view,
  waiting,
}: {
  readonly view: 'merchants' | 'rows'
  /** How many merchants are waiting, or nothing while it is not known. */
  readonly waiting?: number | undefined
}) {
  const item = (active: boolean): string =>
    [
      'relative -ml-px inline-flex h-8 items-center gap-2 border px-3.5 text-[13px] transition-colors duration-[var(--duration-micro)] first:ml-0',
      'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
      active
        ? 'z-10 border-accent bg-accent-soft text-ink'
        : 'border-hairline-strong text-ink-secondary hover:text-ink',
    ].join(' ')

  return (
    <nav aria-label="Transactions view" className="flex">
      <Link to="/transactions/merchants" aria-current={view === 'merchants' ? 'page' : undefined} className={item(view === 'merchants')}>
        By merchant
        {waiting !== undefined && waiting > 0 && (
          <span className="font-mono text-caption text-ink-secondary">{waiting}</span>
        )}
      </Link>
      <Link to="/transactions" aria-current={view === 'rows' ? 'page' : undefined} className={item(view === 'rows')}>
        All rows
      </Link>
    </nav>
  )
}
