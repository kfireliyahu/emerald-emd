import { readerName, type Reader } from '@/domain/format/reader.ts'
import { Bidi } from '@/ui/Bidi.tsx'

/**
 * What this format is read from — its readers, by the file each last read.
 *
 * Its own module, not `ReadFiles.tsx`'s: the format page draws it, and the
 * format page is the MCP App's frame, which reached SheetJS through that
 * screen — half a megabyte of a reader the frame never runs.
 */
export function ReadersLine({ readers }: { readers: readonly Reader[] }) {
  if (readers.length === 0) {
    return <span className="text-caption text-ink-tertiary">No readers yet</span>
  }
  return (
    <span className="text-caption text-ink-tertiary">
      Read from{' '}
      {readers.map((reader, index) => (
        <span key={reader.signature}>
          {index > 0 && ', '}
          <Bidi className="text-ink-secondary">{readerName(reader)}</Bidi>
        </span>
      ))}
    </span>
  )
}
