import { type Money } from '@/core/money.ts'
import { Bidi } from '@/ui/Bidi.tsx'

import { drawn, kitMoney, share } from './kit.ts'

export interface Part {
  readonly key: string
  readonly name: string
  readonly value: Money
  /** A colour token: a category's (`category-2`), or `bar` / `bar-quiet`. */
  readonly hue: string
  /** A few words on where it came from: `off the slip`. */
  readonly note?: string | undefined
}

/**
 * **A part of a whole** (M64 U4, D-615): one thin bar — 8px, the parts in the
 * order given, 2px of the page between them, ends fully rounded — over a list
 * of the parts, each with its dot, its amount and its share. The bar is an
 * image named by its parts; the list carries every number. A negative part
 * (money taken back out) is left out of the bar and listed with its minus sign
 * and no share, since it is not a piece of the whole.
 */
export function PartOfWhole({
  parts,
  label,
  empty,
}: {
  readonly parts: readonly Part[]
  /** What the whole is, for the bar's accessible name: `Saved`. */
  readonly label: string
  readonly empty: string
}) {
  const positive = parts.filter((part) => part.value.minor > 0)
  if (positive.length === 0 && parts.every((part) => part.value.minor === 0)) {
    return <p className="m-0 text-ink-secondary">{empty}</p>
  }
  const whole = positive.reduce((sum, part) => sum + drawn(part.value), 0)
  return (
    <div className="flex flex-col gap-2">
      {positive.length > 0 && (
        <div
          role="img"
          aria-label={`${label}: ${positive.map((part) => `${part.name} ${kitMoney(part.value)}`).join(', ')}`}
          className="flex h-2 gap-0.5"
        >
          {positive.map((part) => (
            <span
              key={part.key}
              className="h-full rounded-full"
              style={{ flexGrow: drawn(part.value), flexBasis: 0, backgroundColor: `var(--color-${part.hue})` }}
            />
          ))}
        </div>
      )}
      <ul className="m-0 list-none p-0" data-block>
        {parts.map((part) => (
          <li key={part.key} className="flex h-8 items-center gap-2 border-b border-hairline">
            <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: `var(--color-${part.hue})` }} />
            <Bidi className="min-w-0 truncate">{part.name}</Bidi>
            {part.note !== undefined && <span className="shrink-0 text-caption text-ink-secondary">{part.note}</span>}
            <span className="ms-auto shrink-0 text-caption text-ink-secondary tabular-nums">
              {part.value.minor > 0 ? `${String(share(drawn(part.value), whole))}%` : ''}
            </span>
            <span className="w-24 shrink-0 text-end tabular-nums" dir="ltr">
              {kitMoney(part.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
