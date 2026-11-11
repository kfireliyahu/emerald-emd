import { Fragment, type ReactNode } from 'react'

import type { CardCount } from '@/data/importer/statementBatch.ts'
import { countKey } from '@/i18n/count.ts'
import type { Translate } from '@/i18n/current.ts'
import { fillNodes } from '@/i18n/nodes.tsx'
import { Bidi } from '@/ui/Bidi.tsx'

/**
 * **What a read says when it found two cards or more** — `2 cards: ••4821 · 4
 * rows, ••9356 · 3 rows` (M59 U2, D-578), in the language now (M60 U4,
 * D-589). The words are the catalogue's and each card's number is isolated, so
 * `••4821` reads the same way round in Hebrew. Nothing for one card.
 *
 * `cardsSentence` in the importer says the same in English for the plugin.
 */
export function cardsLine(t: Translate, cards: readonly CardCount[]): ReactNode | undefined {
  if (cards.length < 2) return undefined
  const list = cards.map((card, index) => (
    <Fragment key={index}>
      {index > 0 && ', '}
      {fillNodes(t('reading.cards.card'), {
        card: card.last4 === undefined ? t('reading.cards.noNumber') : <Bidi>••{card.last4}</Bidi>,
        rows: t(countKey('reading.cards.rows', card.rows), { count: card.rows }),
      })}
    </Fragment>
  ))
  return fillNodes(t('reading.cards.line'), {
    cards: t(countKey('reading.cards.count', cards.length), { count: cards.length }),
    list,
  })
}
