import { useState, type KeyboardEvent } from 'react'

import { draftOfMembers, membersOfDraft } from '@/domain/format/rowDraft.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { ChoiceField, type Choice } from '@/ui/components/ChoiceField.tsx'

/**
 * **A link to several rows, as chips** — M27 U2 (D-300).
 *
 * The members a `links` column holds, each by its row's name with a way to
 * take it out, and a field after them that finds one more the way a `link`'s
 * field does: typed and narrowed, kept by id. One control for the sheet's foot
 * and the entry page, so the two cannot come to read a list differently.
 *
 * **The text is the JSON list of ids** (`draftOfMembers`), so a name with a
 * comma in it is never split. A name typed that is no choice's — a row past
 * the page of choices, or one not written yet — is kept as typed when Enter
 * takes it, and the write resolves it by name or refuses it with the name,
 * which is what a `link`'s field does with one too.
 */
export function MembersField({
  value,
  choices,
  label,
  compact = false,
  onChange,
  onEnter,
  onOpen,
}: {
  value: string
  choices: readonly Choice[]
  label: string
  /** The sheet's cell, where the chips sit on one line with the field. */
  compact?: boolean
  onChange: (text: string) => void
  /** Enter on an empty field — the sheet moves on. */
  onEnter?: () => void
  /** Open a member's row — on an entry, where a name is a way to it (M35 U2). */
  onOpen?: ((id: string) => void) | undefined
}) {
  // Text that is not a list is one member typed or pasted, kept as it came.
  const members = membersOfDraft(value) ?? (value.trim() === '' ? [] : [value])
  const [typed, setTyped] = useState('')
  const named = (id: string): string => choices.find((each) => each.value === id)?.label ?? id
  const set = (next: readonly string[]): void => onChange(draftOfMembers(next))
  const add = (id: string): void => {
    setTyped('')
    if (id.trim() === '' || members.includes(id)) return
    set([...members, id])
  }

  return (
    <span className={`flex min-w-0 flex-wrap items-center gap-1 ${compact ? 'px-1 py-0.5' : 'py-1'}`}>
      {members.map((id) => (
        <span
          key={id}
          className="inline-flex max-w-full items-center gap-1 rounded-md border border-hairline px-1.5 py-0.5 text-caption text-ink"
        >
          {onOpen === undefined ? (
            <Bidi>{named(id)}</Bidi>
          ) : (
            <button
              type="button"
              className="text-accent underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
              onClick={() => onOpen(id)}
            >
              <Bidi>{named(id)}</Bidi>
            </button>
          )}
          <button
            type="button"
            className="text-ink-tertiary hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            aria-label={`Take ${named(id)} out of ${label}`}
            onClick={() => set(members.filter((each) => each !== id))}
          >
            ×
          </button>
        </span>
      ))}
      <ChoiceField
        className={`min-w-24 flex-1 bg-transparent px-2 py-1 outline-none focus:bg-surface ${compact ? '' : 'max-w-sm'}`}
        filter
        dir="auto"
        aria-label={label}
        placeholder={members.length === 0 ? 'Type to find one' : 'One more'}
        text={typed}
        choices={choices.filter((each) => !members.includes(each.value))}
        onText={setTyped}
        onPick={(choice) => add(choice.value)}
        onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            if (typed.trim() === '') {
              onEnter?.()
              return
            }
            const exact = choices.filter((each) => each.label === typed.trim())
            add(exact.length === 1 && exact[0] !== undefined ? exact[0].value : typed.trim())
          } else if (event.key === 'Backspace' && typed === '' && members.length > 0) {
            set(members.slice(0, -1))
          }
        }}
      />
    </span>
  )
}
