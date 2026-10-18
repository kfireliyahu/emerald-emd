import { useLocation, useNavigate } from 'react-router-dom'

import { cancelDerivation } from '@/data/runtime/derive.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { isLive, stopSlipBatch, useSlipBatch } from '@/state/slipBatch.ts'
import { Button } from '@/ui/components/Button.tsx'
import { Working } from '@/ui/components/Working.tsx'
import { useWindowTaken } from '@/ui/useFullWindow.ts'

/** Where the batch is read. */
export const READ_SLIPS = '/paychecks/read'

/**
 * The payslips being read, at the foot of the window, while you are somewhere
 * else — M28 F1, `ReadingBar`'s bargain (D-171) for the batch.
 *
 * On leaving `#/paychecks/read` mid-batch, the batch was gone while the
 * model went on reading. The batch is the store's now, so leaving loses
 * nothing; this bar is what keeps it from reading *invisibly*: it names what is
 * being read, goes back to it, and stops it. Once the reading is over it stays
 * while slips wait to be written, because those are work somebody did.
 */
export function SlipBatchBar() {
  const batch = useSlipBatch()
  const db = useDocumentStore((state) => state.db)
  const taken = useWindowTaken()
  const location = useLocation()
  const navigate = useNavigate()

  if (!isLive(batch, db) || taken || location.pathname === READ_SLIPS) return null

  const working = batch.progress !== undefined
  const count = batch.slips.length

  return (
    <div className="fc-view-enter flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline bg-surface px-6 py-2">
      {working && <Working size={20} />}
      <span className="text-ink">
        {working ? 'Reading paychecks' : `${count === 1 ? '1 paycheck' : `${String(count)} paychecks`} read`}
      </span>
      <span className="text-caption text-ink-secondary" aria-live="polite">
        {working ? batch.progress : 'Not written yet.'}
      </span>
      <span className="ml-auto flex items-center gap-2">
        <Button variant={working ? 'secondary' : 'primary'} size="sm" onClick={() => navigate(READ_SLIPS)}>
          {working ? 'Go back to it' : 'Check them over'}
        </Button>
        {working && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              stopSlipBatch()
              cancelDerivation()
            }}
          >
            Stop
          </Button>
        )}
      </span>
    </div>
  )
}
