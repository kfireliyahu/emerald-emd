import { readerName, type Reader } from '@/domain/format/reader.ts'
import { useT } from '@/i18n/current.ts'
import { Bidi } from '@/ui/Bidi.tsx'
import { Phrase } from '@/ui/components/Phrase.tsx'

/**
 * What this format is read from — its readers, by the file each last read.
 *
 * Its own module, not `ReadFiles.tsx`'s: the format page draws it, and the
 * format page is the MCP App's frame, which reached SheetJS through that
 * screen — half a megabyte of a reader the frame never runs.
 */
export function ReadersLine({ readers }: { readers: readonly Reader[] }) {
  const t = useT()
  if (readers.length === 0) {
    return <span className="text-caption text-ink-secondary">{t('formats.table.noReaders')}</span>
  }
  const names = readers.map((reader, index) => (
    <span key={reader.signature}>
      {index > 0 && ', '}
      <Bidi className="text-ink-secondary">{readerName(reader)}</Bidi>
    </span>
  ))
  return (
    <span className="text-caption text-ink-secondary">
      <Phrase text={t('formats.table.readFrom')} parts={{ readers: names }} />
    </span>
  )
}
