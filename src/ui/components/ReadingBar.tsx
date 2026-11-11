import { useNavigate } from 'react-router-dom'

import { useT } from '@/i18n/current.ts'
import { Button } from '@/ui/components/Button.tsx'
import { Working } from '@/ui/components/Working.tsx'
import { clearRead, showRead, useDocumentRead } from '@/state/reading.ts'
import { useWindowTaken } from '@/ui/useFullWindow.ts'

/**
 * The document being read, at the foot of the window, while you are somewhere
 * else (D-171).
 *
 * **It is the way back, and building it is what made leaving allowed.** docs/08
 * F5 says so in as many words: navigation was blocked during a read precisely
 * because there was nothing to return to, and letting somebody leave means
 * building the way back first. So this is not an indicator with a link bolted
 * on — it *is* the permission.
 *
 * **Never while the flow is on screen.** A reading flow claims the window
 * (D-163), so `taken` is exactly "you are looking at the thing this bar is
 * about", and a bar under it saying what you can already see would be the
 * second answer to a question that has one. The same reason `ViewTabs`
 * disappears there.
 *
 * **It says which document.** A person who left a read running has by
 * definition stopped watching it, and *"a document is being read"* is not worth
 * looking up from what you moved on to; the file's name is.
 */
export function ReadingBar() {
  const t = useT()
  const read = useDocumentRead()
  const taken = useWindowTaken()
  const navigate = useNavigate()

  // Nothing while the flow is on screen — `taken` is a flow having the window
  // (D-163) — and nothing while this read's own flow is open, which is the case
  // the window claim does not cover: the editor a slip was accepted into.
  if (read === undefined || read.open || taken) return null

  const done = !read.working

  return (
    <div className="fc-view-enter flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline bg-surface px-6 py-2">
      {!done && <Working size={20} />}
      <span className="text-ink">
        {done ? t('chrome.components.reading.read') : t('chrome.components.reading.reading')} <span className="font-medium">{read.label}</span>
      </span>

      {/* What it is doing, or what came of it. `aria-live` on the sentence
          rather than on the row: a region that announced the whole bar would
          re-read the file's name every four seconds. */}
      <span className="text-caption text-ink-secondary" aria-live="polite">
        {read.working
          ? [read.note, read.tokens > 0 ? t('chrome.components.reading.tokens', { n: read.tokens }) : undefined]
              .filter((part) => part !== undefined)
              .join(' · ')
          : read.problem !== undefined
            ? read.problem
            : t('chrome.components.reading.ready')}
      </span>

      <span className="ms-auto flex items-center gap-2">
        <Button
          variant={done && read.problem === undefined ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => {
            // Both, and in this order: the flow is a state of a screen rather
            // than a route, so navigating alone lands on the screen with the
            // reader shut — and does nothing at all when you are already there.
            showRead()
            navigate(read.at.replace(/^#/, ''))
          }}
        >
          {done ? t('chrome.components.reading.check') : t('chrome.components.reading.back')}
        </Button>
        {/* Only once it has landed. Dismissing a running read would leave it
            running with nothing saying so, which is the state this exists to
            make impossible. */}
        {done && (
          <Button variant="ghost" size="sm" onClick={clearRead}>
            {t('chrome.components.reading.dismiss')}
          </Button>
        )}
      </span>
    </div>
  )
}
