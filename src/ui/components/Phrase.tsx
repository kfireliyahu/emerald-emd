import { Fragment, type ReactNode } from 'react'

/**
 * **A translated sentence with things inside it** — M60 U4 and U5 (D-589,
 * D-590), one name since M60 F1. `fill` puts text into a word's `{name}`
 * placeholders; this draws elements there — a merchant's name in its `Bidi`, a
 * figure in `Amount`, a link — so a sentence is one word in the catalogue, and
 * Hebrew puts the parts where its grammar does rather than English fragments
 * glued round the value:
 *
 *   <Phrase text={t('plan.covers')} parts={{ name: <Bidi>{name}</Bidi> }} />
 *
 * It is an element, so it goes wherever a sentence does: a child, a menu
 * item's `label`, a notice's `message`. A placeholder with nothing for it stays
 * as written, as `fill`'s does.
 */
export function Phrase({ text, parts }: { readonly text: string; readonly parts: Readonly<Record<string, ReactNode>> }) {
  const pieces = text.split(/(\{\w+\})/g)
  return (
    <>
      {pieces.map((piece, index) => {
        const name = /^\{(\w+)\}$/.exec(piece)?.[1]
        const part = name === undefined ? piece : name in parts ? parts[name] : piece
        return <Fragment key={index}>{part}</Fragment>
      })}
    </>
  )
}
