import { Bidi } from '@/ui/Bidi.tsx'
import { memberText, toneOf } from '@/ui/formats/tone.ts'

/**
 * A state as an uppercase chip in its tone (M27 U8, D-306), or nothing for a
 * row with none. `live` is the only tone that wears accent.
 */
export function StateChip({ member }: { member: string | undefined }) {
  if (member === undefined) return null
  return (
    <span className="fc-state" data-tone={toneOf(member)}>
      <Bidi>{memberText(member)}</Bidi>
    </span>
  )
}
