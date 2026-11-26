import type { Spoken } from '@/domain/format/connections.ts'
import type { Translate } from '@/i18n/current.ts'

/**
 * **A sentence the engine built, said in the language now** (M64 F35): its key
 * with its parts, each part that is a sentence of its own said first — *Each
 * {one} {adds}*, where *adds* is *counts {rows}*.
 */
export function spoken(t: Translate, said: Spoken): string {
  const parts = Object.fromEntries(
    Object.entries(said.parts ?? {}).map(([name, value]) => [name, typeof value === 'object' ? spoken(t, value) : value]),
  )
  return t(said.key, parts)
}
