import { useEffect, useRef } from 'react'

import { Button } from '@/ui/components/Button.tsx'
import { FIELD_MULTILINE } from '@/ui/components/fieldLook.ts'

/**
 * Open a document, or paste it — the input half of every reading surface.
 *
 * One component because a payslip and a fund report ask a person for exactly the
 * same thing, and because the sentences under it were expensive: what a scan is,
 * what a document that lies about its own text is, and what it means that the
 * words were inferred. Two copies of that would drift the moment one of them
 * gained a decision (`openDocumentText.ts` carries the rest of the argument).
 *
 * **Pasting still works and is the way out of everything.** A photographed
 * document has no text layer, is told so in a sentence, and leaves the textarea
 * exactly where it was — which is the terminating rung of F17's ladder wearing
 * its ordinary clothes.
 *
 * **It opens nothing itself any more** (D-171). A file used to be turned into
 * text here, and the flow above was handed the result — which meant the
 * expensive half of a read lived in a component that a person leaving the
 * screen unmounts. The file goes up instead, the flow runs the whole read
 * through the store that outlives it, and what comes back down is `working` and
 * a sentence saying what is happening.
 */
export function DocumentTextInput({
  noun,
  intro,
  text,
  onText,
  onRead,
  onOpen,
  working,
  note,
  tokens,
  problem,
  footer,
  onFiles,
  openNow,
  beside,
}: {
  /** What this document is called, in the sentences: "payslip", "report". */
  readonly noun: string
  /** What the surface says about where the reading will come from. */
  readonly intro: React.ReactNode
  readonly text: string
  readonly onText: (text: string) => void
  /** Read what is in the box. */
  readonly onRead: (text: string) => void
  /**
   * Read a file the person picked — text, notices, page geometry and all.
   *
   * **The flow does the opening** (D-171), because the flow is what survives
   * somebody leaving the screen while a four-second OCR pass is running.
   */
  readonly onOpen: (file: File) => void
  readonly working: boolean
  /** What the read is doing, while it is doing it. */
  readonly note?: string | undefined
  readonly tokens: number
  readonly problem: string | undefined
  /** What to say under the problem, which differs by document. */
  readonly footer?: React.ReactNode
  /**
   * Given: the picker takes **several** documents and hands them all up
   * unopened, and this component opens none of them (D-164).
   *
   * A backfill is eight files of one format, and the second is only cheap
   * because the first was accepted — which stores the format the other seven
   * are read with. So the batch is a queue somebody else owns, and the one
   * being read now arrives back here as `text` like any other.
   */
  readonly onFiles?: ((files: readonly File[]) => void) | undefined
  /**
   * One of those files, handed back to be opened — the same path a picked file
   * takes, so the notices about scans and lying fonts are stated in one place
   * whether a document was opened one at a time or as the third of eight.
   */
  readonly openNow?: File | undefined
  /** Anything that belongs beside the buttons — what is still queued. */
  readonly beside?: React.ReactNode
}) {
  // The queued document, opened once. A ref rather than a dependency because
  // re-opening a PDF on a re-render would be a second OCR pass nobody asked for.
  const opened = useRef<File | undefined>(undefined)
  useEffect(() => {
    if (openNow === undefined || opened.current === openNow) return
    opened.current = openNow
    onOpen(openNow)
  }, [onOpen, openNow])

  return (
    <div className="mx-auto max-w-[820px] space-y-4">
      <p className="text-ink-secondary">{intro}</p>

      <textarea
        className={`${FIELD_MULTILINE} h-72 w-full font-mono text-caption`}
        value={text}
        onChange={(event) => onText(event.target.value)}
        placeholder={`Open a PDF above, or paste the ${noun}’s text here…`}
        dir="auto"
        spellCheck={false}
      />

      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="primary"
          icon="read"
          busy={working ? 'Reading…' : undefined}
          disabled={text.trim() === ''}
          onClick={() => onRead(text)}
        >
          Read it
        </Button>

        <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-hairline-strong bg-elevated px-4 font-medium text-ink transition-colors duration-[var(--duration-micro)] hover:border-ink-tertiary focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
          {onFiles === undefined ? `Open a ${noun}` : `Open ${noun}s`}
          <input
            type="file"
            accept=".pdf,.txt,.text,application/pdf,text/plain"
            className="sr-only"
            {...(onFiles === undefined ? {} : { multiple: true })}
            onChange={(event) => {
              const picked = [...(event.target.files ?? [])]
              event.target.value = ''
              if (picked.length === 0) return
              if (onFiles !== undefined) {
                onFiles(picked)
                return
              }
              const file = picked[0]
              if (file !== undefined) onOpen(file)
            }}
          />
        </label>

        {beside}

        {/* What is taking the time, named (D-171). The PDF paths were silent
            through 1.7 MB of reader, a second read of the file and four seconds
            of OCR a page, which is the whole of what a person waits through. */}
        {working && (note !== undefined || tokens > 0) && (
          <span className="text-caption text-ink-tertiary" aria-live="polite">
            {note ?? `${String(tokens)} tokens so far`}
            {note !== undefined && tokens > 0 && (
              <span className="tabular-nums"> · {tokens} tokens</span>
            )}
          </span>
        )}
      </div>

      {problem !== undefined && (
        <div className="space-y-2">
          <p className="text-negative">{problem}</p>
          {footer}
        </div>
      )}
    </div>
  )
}
