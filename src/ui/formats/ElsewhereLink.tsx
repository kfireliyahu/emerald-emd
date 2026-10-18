/**
 * **A row in another document, in a cell** (M47 U4, D-461) — the row's name and
 * the document it is in, drawn as a link that opens that document.
 *
 * The page cannot read another file to say what the row holds now: the shell
 * hands the page only paths a person picked (D-128), and a browser hands it
 * none. So the cell names the row and opens the document, and what the row
 * holds is the conversation's to say (`format_rows`, `start_here`), which can
 * read the file. Outside the shell there is nothing to open, and the cell is
 * the name with the path on hover.
 */

import { documentNameOf, parseElsewhere, pathFrom } from '@/domain/format/elsewhere.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'

export function ElsewhereLink({ value }: { readonly value: string }) {
  const canOpen = useDocumentStore((state) => state.adapter.openPath !== undefined)
  const holder = useDocumentStore((state) => state.adapter.location?.())
  const parsed = parseElsewhere(value)
  if (!parsed.ok) return <Bidi className="block truncate">{value}</Bidi>
  const { name, path } = parsed.value
  const where = pathFrom(path, holder)
  const words = (
    <>
      <Bidi>{name}</Bidi>
      <span className="text-ink-tertiary"> · {documentNameOf(path)}</span>
    </>
  )
  if (!canOpen || where === undefined) {
    return (
      <span className="block truncate" title={`${name} in ${path} — opens from the desktop app`}>
        {words}
      </span>
    )
  }
  return (
    <button
      type="button"
      data-elsewhere={value}
      className="block max-w-full cursor-pointer truncate border-0 bg-transparent p-0 text-left text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      title={`Open ${where} — ${name} is a row there`}
      // The row's own click opens the row; this one opens the other document.
      onClick={(event) => {
        event.stopPropagation()
        void useDocumentStore.getState().requestOpen(where)
      }}
    >
      {words}
    </button>
  )
}
