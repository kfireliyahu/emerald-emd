import { Fragment, type ReactNode } from 'react'

/**
 * **A sentence with things in it** — M60 U4 (D-589). `fill` puts text into a
 * word's `{name}` placeholders; this puts elements there — a merchant's name
 * in `Bidi`, a figure in `Amount`, a link — so a translated sentence can hold
 * a document's own value isolated from the words around it, in whichever order
 * the language puts them:
 *
 * `fillNodes(t('transactions.movedTo'), { name: <Bidi>{name}</Bidi> })`
 *
 * A placeholder with nothing for it stays as written, as `fill`'s does.
 */
export function fillNodes(pattern: string, parts: Readonly<Record<string, ReactNode>>): ReactNode {
  const pieces = pattern.split(/(\{\w+\})/g)
  return pieces.map((piece, index) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1]
    const part = name === undefined ? piece : name in parts ? parts[name] : piece
    return <Fragment key={index}>{part}</Fragment>
  })
}
