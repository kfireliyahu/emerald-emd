import { Fragment, type ReactNode } from 'react'

/**
 * **A translated sentence with things inside it** — M60 U5 (D-590). A word
 * whose `{name}` placeholders are drawn, not typed: a category's name in its
 * `Bidi`, a figure, a link. Hebrew puts the parts where its grammar does, so a
 * sentence is one word in the catalogue rather than English fragments glued
 * round the value.
 *
 *   <Phrase text={t('plan.covers')} parts={{ name: <Bidi>{name}</Bidi> }} />
 */
export function Phrase({ text, parts }: { readonly text: string; readonly parts: Readonly<Record<string, ReactNode>> }) {
  const pieces = text.split(/\{(\w+)\}/)
  return (
    <>
      {pieces.map((piece, index) => (
        <Fragment key={index}>{index % 2 === 0 ? piece : (parts[piece] ?? `{${piece}}`)}</Fragment>
      ))}
    </>
  )
}
