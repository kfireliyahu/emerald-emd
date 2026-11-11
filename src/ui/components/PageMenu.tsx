import { useState } from 'react'

import { ContextMenu, type MenuItem } from './ContextMenu.tsx'
import { useT } from '@/i18n/current.ts'
import { startEdge } from '@/ui/direction.ts'

/**
 * **A screen's own menu: the ⋯ beside its title** (M36 U11) — what Funds and Debts
 * already had, for the screens that kept a *Show archived* box in their body. A
 * view setting is a menu item, not a control on the page: it is asked rarely,
 * and the page reads the same with it gone.
 */
export function PageMenu({ title, items }: { title: string; items: readonly MenuItem[] }) {
  const t = useT()
  const [at, setAt] = useState<{ x: number; y: number } | undefined>()
  return (
    <>
      <button
        type="button"
        aria-label={t('chrome.components.moreAbout', { title: title.toLowerCase() })}
        title={t('chrome.components.more')}
        onClick={(event) => {
          const box = event.currentTarget.getBoundingClientRect()
          setAt(startEdge(box))
        }}
        className="fc-icon-action"
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" aria-hidden>
          <circle cx="3.5" cy="8" r="1.2" />
          <circle cx="8" cy="8" r="1.2" />
          <circle cx="12.5" cy="8" r="1.2" />
        </svg>
      </button>
      {at !== undefined && <ContextMenu at={at} items={items} onClose={() => setAt(undefined)} header={{ title }} />}
    </>
  )
}
