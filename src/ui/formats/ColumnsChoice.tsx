import { useEffect, useRef, useState } from 'react'

import { Bidi } from '@/ui/Bidi.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { useDismiss } from '@/ui/components/useDismiss.ts'

import type { ColumnChoice } from './addressFilter.ts'
import type { Choosable } from './lineColumns.ts'

/**
 * **Which columns a format's lines draw** (M37 U5, D-478) — the roadmap's
 * folds, the ready list's lines and the board's cards. Asked on 2026-10-14:
 * *"in roadmap user should be able to choose to hide columns under the item
 * that is being roadmapped"* — units with their title and state, and not the
 * rest. The name is never offered: a line is its name, and the link to its
 * entry. Neither is a state the view already draws another way (a board's
 * lanes), nor the link a roadmap folds through.
 *
 * The choice is the address's (`columns:unit=title,state`), beside the
 * filter, so reload, Back and a bookmark keep it; a format left as its view
 * declares has no key at all.
 */
export function ColumnsChoice({
  formats,
  chosen,
  onChange,
}: {
  readonly formats: readonly Choosable[]
  readonly chosen: ColumnChoice
  readonly onChange: (next: ColumnChoice) => void
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const dismiss = useDismiss(open, box, () => setOpen(false))
  // What was last ticked, ahead of the address: a navigation renders in a
  // transition, and a second tick before it lands must build on the first.
  const [mine, setMine] = useState(chosen)
  const said = JSON.stringify(chosen)
  useEffect(() => setMine(JSON.parse(said) as ColumnChoice), [said])
  const offered = formats.filter((each) => each.columns.length > 0)
  if (offered.length === 0) return null
  const changed = offered.some((each) => mine[each.format.name] !== undefined)

  const write = (each: Choosable, next: readonly string[] | undefined): void => {
    const { [each.format.name]: _was, ...rest } = mine
    const same = next !== undefined && sameList(next, each.drawn)
    const written = next === undefined || same ? rest : { ...rest, [each.format.name]: next }
    setMine(written)
    onChange(written)
  }

  return (
    <span ref={box} className="relative inline-flex" onKeyDown={dismiss}>
      <Button
        variant="secondary"
        size="sm"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Which columns each line draws"
        onClick={() => setOpen((was) => !was)}
      >
        {changed ? 'Columns ·' : 'Columns'}
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label="Columns"
          className="fc-pop-enter absolute top-full right-0 z-30 mt-1 flex max-h-[70vh] w-64 flex-col gap-3 overflow-y-auto rounded-md border border-hairline-strong bg-elevated p-2 text-left text-[13px] font-normal whitespace-normal shadow-[var(--shadow-pop)]"
        >
          {offered.map((each) => {
            const shown = mine[each.format.name] ?? each.drawn
            const own = mine[each.format.name] !== undefined
            return (
              <section key={each.format.name} aria-label={`${each.format.title}, its columns`} className="flex flex-col">
                <div className="flex items-baseline gap-2 px-1 pb-1">
                  <Bidi className="fc-label min-w-0 flex-1 truncate">{each.format.title}</Bidi>
                  {own && (
                    <button
                      type="button"
                      className="text-caption text-ink-secondary underline decoration-hairline underline-offset-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                      onClick={() => write(each, undefined)}
                    >
                      As declared
                    </button>
                  )}
                </div>
                <ul>
                  {each.columns.map((column) => {
                    const on = shown.includes(column.name)
                    return (
                      <li key={column.name}>
                        <label className="flex h-7 cursor-pointer items-center gap-2 rounded px-1 select-none hover:bg-accent-soft">
                          <input
                            type="checkbox"
                            checked={on}
                            onChange={() =>
                              write(
                                each,
                                each.columns
                                  .map((one) => one.name)
                                  .filter((name) => (name === column.name ? !on : shown.includes(name))),
                              )
                            }
                          />
                          <Bidi className="min-w-0 flex-1 truncate">{column.name}</Bidi>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </span>
  )
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((each) => b.includes(each))
}
