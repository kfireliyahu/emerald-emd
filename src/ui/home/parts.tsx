import { useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'

import { formatMoney, type Money } from '@/core/money.ts'
import { SUPPORTED_EXTENSIONS } from '@/data/importer/sheetTable.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { BundledFiles } from '@/demo/BundledFiles.tsx'
import { ActionGlyph } from '@/ui/components/ActionGlyph.tsx'
import { Button } from '@/ui/components/Button.tsx'
import { isDemo } from '@/ui/edition.ts'
import { addStatementFiles } from '@/ui/home/statementIntake.ts'

/**
 * The pieces Home's Month and Year share — M28 U5, the approved mockup
 * (`docs/mockups/m28-u5/home.html`).
 */

/** The four flows (D-313): each a colour on a headline, a chart or a total, never on a row. */
export type Flow = 'in' | 'out' | 'saved' | 'tax'

export const FLOW_TEXT: Readonly<Record<Flow, string>> = {
  in: 'text-flow-in',
  out: 'text-flow-out',
  saved: 'text-flow-saved',
  tax: 'text-flow-tax',
}

export const FLOW_BG: Readonly<Record<Flow, string>> = {
  in: 'bg-flow-in',
  out: 'bg-flow-out',
  saved: 'bg-flow-saved',
  tax: 'bg-flow-tax',
}

/** Every file Home reads: statements, and the PDFs it hands to Paychecks or to a fund. */
export const READ_ACCEPT = [...SUPPORTED_EXTENSIONS, '.pdf', '.txt', 'application/pdf'].join(',')

/**
 * Read files: what Home's band, the header and the keyboard all do — add the
 * files to the batch and open it. Nothing is written until Write.
 */
export function useReadFiles(): (files: readonly File[]) => void {
  const db = useDocumentStore((state) => state.db)
  const navigate = useNavigate()
  return (files) => {
    if (db === undefined || files.length === 0) return
    navigate('/read')
    void addStatementFiles(db, files)
  }
}

/**
 * A hidden file picker and the way to open it, for a button that is not a label.
 * **In the demo it is a list of the files bundled with it** (M33 U5): a visitor
 * has no file of theirs there, and what is picked is read as a picked file is.
 */
export function useFilePicker(onFiles: (files: readonly File[]) => void): {
  readonly open: () => void
  readonly input: ReactNode
} {
  const ref = useRef<HTMLInputElement>(null)
  const [listing, setListing] = useState(false)
  if (isDemo()) {
    return {
      open: () => setListing(true),
      input: listing ? <BundledFiles onFiles={onFiles} onClose={() => setListing(false)} /> : null,
    }
  }
  return {
    open: () => ref.current?.click(),
    input: (
      <input
        ref={ref}
        type="file"
        multiple
        accept={READ_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          const chosen = Array.from(event.target.files ?? [])
          event.target.value = ''
          if (chosen.length > 0) onFiles(chosen)
        }}
      />
    ),
  }
}

/**
 * **The place to drop statements and payslips** (choice 3, A): a
 * band at the top of Month, always there, with Read files and Add by hand in it.
 * Its own drop stops the window's, so a file dropped here is read like one
 * dropped anywhere else — but this is the place that says so.
 */
export function IntakeBand({ onAddByHand }: { readonly onAddByHand: () => void }) {
  const read = useReadFiles()
  const picker = useFilePicker(read)
  const [over, setOver] = useState(false)
  return (
    <div
      data-guide="home.read"
      className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border border-dashed px-5 py-4 transition-colors duration-[var(--duration-micro)] ${
        over ? 'border-accent bg-accent-soft' : 'border-hairline-strong hover:border-accent hover:bg-accent-soft'
      }`}
      onDragOver={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault()
        event.stopPropagation()
        setOver(false)
        read(Array.from(event.dataTransfer.files))
      }}
    >
      <div className="flex min-w-0 items-center gap-3.5 text-ink-secondary">
        <ActionGlyph name="read" size={24} />
        <span>
          <b className="block font-medium text-ink">Drop statements, paychecks and fund reports here, any number</b>
          Card and bank exports, paycheck and fund report PDFs. Each goes to the reader that knows it, and nothing is
          written until you press Write.
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon="add" onClick={onAddByHand} title="A paycheck, typed in">
          Add by hand
        </Button>
        <Button variant="primary" icon="read" onClick={picker.open} title="Read files (Ctrl+Shift+O)" data-tour="read-files">
          Read files
        </Button>
      </div>
      {picker.input}
    </div>
  )
}

/** The way between periods: arrows, with the neighbours named beside them. */
export function Pager({
  label,
  prev,
  next,
  onPrev,
  onNext,
}: {
  readonly label: string
  readonly prev: string | undefined
  readonly next: string | undefined
  readonly onPrev: () => void
  readonly onNext: () => void
}) {
  return (
    <nav className="flex items-center gap-1" aria-label={label}>
      <span className="min-w-18 px-1 text-right text-caption text-ink-secondary tabular-nums">{prev ?? ''}</span>
      <PageButton label="Previous" glyph="left" disabled={prev === undefined} onClick={onPrev} />
      <PageButton label="Next" glyph="right" disabled={next === undefined} onClick={onNext} />
      <span className="min-w-18 px-1 text-caption text-ink-secondary tabular-nums">{next ?? 'newest'}</span>
    </nav>
  )
}

function PageButton({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string
  glyph: 'left' | 'right'
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={`${label} (${glyph === 'left' ? '←' : '→'})`}
      disabled={disabled}
      onClick={onClick}
      className="flex size-8 items-center justify-center border border-transparent text-ink-secondary transition-colors duration-[var(--duration-micro)] hover:border-hairline-strong hover:text-ink disabled:cursor-default disabled:opacity-30 disabled:hover:border-transparent"
    >
      <ActionGlyph name={glyph} />
    </button>
  )
}

/** One headline figure: a keyed label, the figure in its flow's colour, a line under it. */
export function Figure({
  label,
  flow,
  value,
  children,
}: {
  readonly label: string
  readonly flow: Flow | undefined
  readonly value: Money | undefined
  readonly children?: ReactNode
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3.5 first:pl-0">
      <span className="fc-label flex items-center text-ink-secondary uppercase">
        {flow !== undefined && <span aria-hidden className={`mr-1.5 inline-block size-2 ${FLOW_BG[flow]}`} />}
        {label}
      </span>
      <span
        // Scaled with the row's width, never past 24px: a year's ₪194,608.80 spilled out of a
        // tile when five sat in a row at 48rem (M33 F12).
        className={`text-[length:clamp(17px,2.25cqi,24px)] leading-tight font-medium tracking-[-0.01em] tabular-nums ${
          value === undefined ? 'text-ink-tertiary' : flow === undefined ? '' : FLOW_TEXT[flow]
        }`}
      >
        {value === undefined ? '—' : formatMoney(value)}
      </span>
      <small className="text-caption text-ink-secondary">{children}</small>
    </div>
  )
}

/** The row of five: came in, went out, saved, taxes, and left over in ink. */
export function Figures({ children }: { readonly children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-hairline border-y border-hairline @[48rem]:grid-cols-5">{children}</div>
  )
}

/** A key for a chart: a swatch and the flow's word, so colour is never alone. */
export function Legend({ children }: { readonly children: ReactNode }) {
  return <div className="flex flex-wrap gap-4 text-caption text-ink-secondary">{children}</div>
}

export function Key({ flow, children, bar = false }: { flow: Flow; children: ReactNode; bar?: boolean }) {
  return (
    <span className="inline-flex items-center">
      <i aria-hidden className={`mr-1.5 inline-block ${bar ? 'size-2' : 'h-0.5 w-3.5'} ${FLOW_BG[flow]}`} />
      {children}
    </span>
  )
}

/** A small uppercase heading over a block, with an optional aside. */
export function BlockHead({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="fc-label m-0 font-medium text-ink-secondary uppercase">{title}</h2>
      {aside !== undefined && <span className="font-mono text-caption text-ink-tertiary">{aside}</span>}
    </div>
  )
}
