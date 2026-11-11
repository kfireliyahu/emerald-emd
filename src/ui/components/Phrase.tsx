import type { ReactNode } from 'react'

import { fillNodes } from '@/i18n/nodes.tsx'

/**
 * **A translated sentence with things inside it** — M60 U5 (D-590). A word
 * whose `{name}` placeholders are drawn, not typed: a category's name in its
 * `Bidi`, a figure, a link. Hebrew puts the parts where its grammar does, so a
 * sentence is one word in the catalogue rather than English fragments glued
 * round the value.
 *
 *   <Phrase text={t('plan.covers')} parts={{ name: <Bidi>{name}</Bidi> }} />
 *
 * It is `fillNodes` (M60 U4, D-589) as a component — one way to fill a
 * sentence, two ways to call it.
 */
export function Phrase({ text, parts }: { readonly text: string; readonly parts: Readonly<Record<string, ReactNode>> }) {
  return <>{fillNodes(text, parts)}</>
}
