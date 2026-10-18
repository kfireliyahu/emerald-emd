import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import {
  cancelDerivation,
  deriveFormatFromExample,
  onDerivationProgress,
} from '@/data/runtime/derive.ts'
import { isProviderSupported, readChosenProvider } from '@/data/runtime/provider.ts'
import type { FormatDraft } from '@/domain/format/draft.ts'
import { exampleExcerpt, EXAMPLE_MAX_LINES } from '@/domain/format/proposal.ts'
import { Button } from '@/ui/components/Button.tsx'
import { FIELD_MULTILINE } from '@/ui/components/fieldLook.ts'
import { readStageText } from '@/ui/documents/openDocumentText.ts'
import { openExampleText } from '@/ui/documents/openExampleText.ts'

/**
 * **A format from an example** — M19 U2c, D-221.
 *
 * The third way into the editor, beside *New format* and *Import a
 * declaration*: a product label, a receipt, a note or a spreadsheet goes in, and
 * a local model says what columns that kind of thing has. It is D-215's dial
 * pointed at the format rather than at the rows.
 *
 * **What comes back is a draft and the editor is where it lands** (D-219). The
 * columns arrive as fields with their problems drawn beside them, the plan is
 * still drawn before Save, and nothing is written until somebody presses it —
 * the same *see it before it happens* rule as the import box next to it.
 *
 * **The affordance is shown even with no model chosen**, which is the opposite
 * of what the mapper does with the same button (`MappingBar`). There it sits on
 * a crowded toolbar beside a guesser that is right most of the time; here it is
 * the only thing on the panel and a person who has never opened
 * `#/settings/model` would otherwise never learn the app can do this. Showing it
 * costs nothing — no socket is opened until the button is pressed (D-134).
 */
export function ExamplePanel({ onOpen }: { onOpen: (draft: FormatDraft) => void }) {
  // Read once: the choice is a machine preference and changing it is a trip to
  // the settings screen, which unmounts this one anyway (D-134).
  const provider = useMemo(() => readChosenProvider(), [])
  const supported = useMemo(() => isProviderSupported(), [])

  const [text, setText] = useState('')
  /**
   * Opening a file and asking a model are two waits, and only one of them can be
   * stopped — `cancelDerivation` cancels a generation and has nothing to say to
   * a PDF reader. A Stop button beside a file read would be a control that does
   * nothing, which is the shape of every confirm-surface bug D-138 keeps
   * finding, so the two states are a union rather than one `working` flag.
   */
  const [phase, setPhase] = useState<Phase>({ kind: 'IDLE' })
  const [tokens, setTokens] = useState(0)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)

  const asking = phase.kind === 'ASKING'
  useEffect(() => {
    if (!asking) return undefined
    return onDerivationProgress(setTokens)
  }, [asking])

  const excerpt = exampleExcerpt(text)

  const open = (file: File): void => {
    setProblem(undefined)
    setNotice(undefined)
    setPhase({ kind: 'OPENING', note: `Opening ${file.name}…` })
    openExampleText(file, (stage) => setPhase({ kind: 'OPENING', note: readStageText(stage) }))
      .then((document) => {
        if (document.kind === 'problem') {
          setProblem(document.problem)
          return
        }
        setText(document.text)
        setNotice(document.notice)
      })
      .catch((error: unknown) => setProblem(String(error)))
      .finally(() => setPhase({ kind: 'IDLE' }))
  }

  const propose = (): void => {
    if (provider === undefined || text.trim() === '') return
    setProblem(undefined)
    setTokens(0)
    setPhase({ kind: 'ASKING', note: `Working out the columns with ${provider.model}…` })
    deriveFormatFromExample(provider, text)
      .then((result) => {
        if (result.kind === 'failed') {
          setProblem(result.reason)
          return
        }
        onOpen(result.lines)
      })
      .catch((error: unknown) => setProblem(String(error)))
      .finally(() => setPhase({ kind: 'IDLE' }))
  }

  const working = phase.kind !== 'IDLE'

  return (
    <section className="mb-6 rounded-lg border border-hairline-strong bg-elevated p-4">
      <h2 className="mb-1 font-medium">Work it out from an example</h2>
      <p className="mb-2 max-w-prose text-caption text-ink-secondary">
        A product label, a receipt, a note, a spreadsheet — one of the things you want to keep. A
        model on this machine reads it and says what columns that kind of thing has, and the answer
        opens in the editor for you to correct. It describes the kind; the figures on your example
        stay on your example.
      </p>

      {!supported ? (
        <p className="max-w-prose text-caption text-ink-secondary">
          This one needs the desktop app: a model runs beside it on your own machine, and a page in
          a browser has no way to reach one.
        </p>
      ) : provider === undefined ? (
        <p className="max-w-prose text-caption text-ink-secondary">
          No local model is switched on.{' '}
          <Link to="/settings/model" className="text-accent underline-offset-2 hover:underline">
            Choose one
          </Link>{' '}
          and this panel will use it. Everything it reads stays on this machine.
        </p>
      ) : (
        <>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            rows={10}
            dir="auto"
            className={`${FIELD_MULTILINE} w-full font-mono text-caption`}
            placeholder={'Paste the label, the receipt or the note here — or open a file below.'}
          />

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button
              variant="primary"
              busy={working ? 'Working…' : undefined}
              disabled={text.trim() === ''}
              onClick={propose}
            >
              Work out the columns
            </Button>

            <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-hairline-strong bg-elevated px-4 font-medium text-ink transition-colors duration-[var(--duration-micro)] hover:border-ink-tertiary focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
              Open a file
              <input
                type="file"
                accept=".pdf,.txt,.text,.md,.csv,.xlsx,.xls"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file !== undefined) open(file)
                }}
              />
            </label>

            {asking && (
              <Button variant="ghost" onClick={cancelDerivation}>
                Stop
              </Button>
            )}

            {/* What is taking the time, named (D-171). The PDF path is 1.7 MB of
                reader, sometimes a second pass over the file and four seconds of
                OCR a page, and the model pass is a minute of somebody waiting. */}
            {phase.kind !== 'IDLE' && (
              <span className="text-caption text-ink-tertiary" aria-live="polite">
                {phase.note}
                {tokens > 0 && <span className="tabular-nums"> · {tokens} tokens</span>}
              </span>
            )}
          </div>

          {excerpt.truncated && (
            <p className="mt-2 text-caption text-ink-tertiary">
              The first {EXAMPLE_MAX_LINES} lines of {excerpt.lines} are what gets sent — an example
              is an example, and the rest of the rows say nothing new about the columns.
            </p>
          )}

          {notice !== undefined && (
            <p className="mt-2 max-w-prose text-caption text-ink-secondary">{notice}</p>
          )}

          {problem !== undefined && <p className="mt-2 text-caption text-negative">{problem}</p>}
        </>
      )}
    </section>
  )
}

/** Which of the two waits this is in, or neither. */
type Phase =
  | { readonly kind: 'IDLE' }
  | { readonly kind: 'OPENING'; readonly note: string }
  | { readonly kind: 'ASKING'; readonly note: string }
