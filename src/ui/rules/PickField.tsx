import { useState, type InputHTMLAttributes } from 'react'

import { ChoiceField, type Choice } from '@/ui/components/ChoiceField.tsx'
import { SELECT } from '@/ui/components/fieldLook.ts'

/** The most choices drawn as a menu; past it a list is an autocomplete (*Choices are ChoiceField*). */
export const MENU_MOST = 8

/**
 * **A choice over a value, drawn by `ChoiceField`** (M64 F6) — what the rule
 * editor, the test box, re-applying and New category drew with the platform's
 * select until *Choices are ChoiceField* reached them.
 *
 * It shows the chosen one's label and stays a text field, so a paste lands on
 * it: a label or a stored value typed or pasted that names one of the choices
 * picks it (`ILS`, `Contains`, an account's name), and anything else is put
 * back to the chosen one's label when the field is left. A handful of choices is
 * a menu; `filter` makes it an autocomplete for a list that can be long.
 */
export function PickField({
  value,
  choices,
  onChange,
  filter = false,
  className = SELECT,
  ...input
}: {
  value: string
  choices: readonly Choice[]
  onChange: (value: string) => void
  filter?: boolean
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [typed, setTyped] = useState<string | undefined>()
  const chosen = choices.find((choice) => choice.value === value)?.label ?? ''

  const named = (text: string): Choice | undefined => {
    const needle = text.trim().toLocaleLowerCase()
    if (needle === '') return undefined
    return choices.find(
      (choice) => choice.label.toLocaleLowerCase() === needle || choice.value.toLocaleLowerCase() === needle,
    )
  }

  return (
    <ChoiceField
      // As wide as its longest choice, as the platform's select sized itself — `ChoiceMenu`'s measure.
      size={input.size ?? Math.max(4, ...choices.map((choice) => choice.label.length + 2))}
      {...input}
      className={className}
      text={typed ?? chosen}
      choices={choices}
      filter={filter}
      onText={(text) => {
        setTyped(text)
        const hit = named(text)
        if (hit !== undefined && hit.value !== value) onChange(hit.value)
      }}
      onPick={(choice) => {
        setTyped(undefined)
        if (choice.value !== value) onChange(choice.value)
      }}
      onBlur={(event) => {
        setTyped(undefined)
        input.onBlur?.(event)
      }}
    />
  )
}
