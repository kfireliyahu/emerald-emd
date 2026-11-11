import { useLocation, useNavigate } from 'react-router-dom'

import { useDocumentStore } from '@/state/documentStore.ts'
import { countKey } from '@/i18n/count.ts'
import { useT } from '@/i18n/current.ts'
import { batchLine, useStatementBatch } from '@/state/statementBatch.ts'
import { Button } from '@/ui/components/Button.tsx'
import { Working } from '@/ui/components/Working.tsx'
import { useWindowTaken } from '@/ui/useFullWindow.ts'

/** Where the batch is read, and where a file that does not add up shows its gap. */
const READ_FILES = '/read'

/**
 * The statements on Read files, at the foot of the window, while you are
 * somewhere else — M28 F14, `SlipBatchBar`'s bargain (D-311) for this batch.
 *
 * 2026-10-04: files were read, more were added, Esc put the guide away,
 * and Read files closed — *"it should be in the bottom bar if its closed,
 * like reading the payslips."* The batch was never thrown away (the store has
 * kept it since M28 U5); it was only invisible. This bar names it and goes back
 * to it. It offers no Discard, as the payslip bar does not: a file comes out of
 * the batch on Read files, row by row, where you can see what you are dropping.
 */
export function ReadFilesBar() {
  const db = useDocumentStore((state) => state.db)
  const batch = useStatementBatch()
  const line = batchLine(batch, db)
  const t = useT()
  const taken = useWindowTaken()
  const location = useLocation()
  const navigate = useNavigate()

  const here = location.pathname === READ_FILES || location.pathname.startsWith(`${READ_FILES}/`)
  if (line === undefined || taken || here) return null
  // The batch's line in the language now (M60 U4): `batchLine` says when, and these its words.
  const total = batch.files.length
  const still = batch.files.filter((file) => file.kind === 'reading').length
  const title = line.reading ? t('reading.bar.reading') : t(countKey('reading.bar.filesRead', total), { count: total })
  const detail = line.reading ? t('reading.bar.readOf', { read: total - still, total }) : t('reading.bar.notWritten')

  return (
    <div className="fc-view-enter flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline bg-surface px-6 py-2">
      {line.reading && <Working size={20} />}
      <span className="text-ink">{title}</span>
      <span className="text-caption text-ink-secondary" aria-live="polite">
        {detail}
      </span>
      <span className="ms-auto flex items-center gap-2">
        <Button variant={line.reading ? 'secondary' : 'primary'} size="sm" onClick={() => navigate(READ_FILES)}>
          {line.reading ? t('reading.bar.goBack') : t('reading.bar.check')}
        </Button>
      </span>
    </div>
  )
}
