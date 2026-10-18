/**
 * **A file on this computer, in a cell** (M37 U6) — the `file` column, shown
 * and filled.
 *
 * In the desktop app the cell is the file's name, and a click hands the file
 * to the system's own app (`electron/linkedFiles.ts` is the gate), with *show
 * in folder* beside it; a file that has gone reads *missing*, and nothing else
 * changes — a save never waits on it. A page in a browser cannot open a file
 * on this computer, so there the cell copies the path instead.
 *
 * Filled three ways, each the same write: picked in the system's dialog, a file
 * dropped on the field, or a path typed or pasted. A file under the document's
 * folder is kept beside it (`fileValueFor`), so the folder can move.
 */

import { useEffect, useState } from 'react'

import { PROGRAM_EXTENSIONS } from '../../../electron/bridge.ts'
import { shellFiles } from '@/data/storage/desktop.ts'
import { fileNameOf, fileValueFor, fileWhere } from '@/domain/format/file.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { Bidi } from '@/ui/Bidi.tsx'

const LINK =
  'flex min-w-0 cursor-pointer border-0 bg-transparent p-0 text-left text-accent hover:underline ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'

/** Whether a path names a program, which the shell shows in its folder and never runs from a cell. */
function isProgramFile(path: string): boolean {
  const name = path.split('/').pop() ?? ''
  const dot = name.lastIndexOf('.')
  return dot > 0 && PROGRAM_EXTENSIONS.includes(name.slice(dot + 1).toLowerCase())
}

/** Whether the file at an absolute path is there — asked of the shell, and again when the window comes back. */
function useFilePresent(path: string | undefined): boolean | undefined {
  const [present, setPresent] = useState<boolean | undefined>(undefined)
  useEffect(() => {
    const files = shellFiles()
    if (path === undefined || files === undefined) {
      setPresent(undefined)
      return
    }
    let live = true
    const check = (): void => {
      files.present([path]).then(
        ([one]) => {
          if (live) setPresent(one)
        },
        () => undefined,
      )
    }
    check()
    window.addEventListener('focus', check)
    return () => {
      live = false
      window.removeEventListener('focus', check)
    }
  }, [path])
  return present
}

/** The document's own path, which a relative value is beside — the shell's only. */
function useHolder(): string | undefined {
  return useDocumentStore((state) => state.adapter.location?.())
}

/** A cell's file: its name, opened by the system — or, outside the shell, its path copied. */
export function FileLink({ value }: { readonly value: string }) {
  const holder = useHolder()
  const files = shellFiles()
  const where = fileWhere(value, holder)
  const path = where.kind === 'path' ? where.path : undefined
  const present = useFilePresent(path)
  const [said, setSaid] = useState<string | undefined>(undefined)
  const name = fileNameOf(value)

  // The row's own click opens the row; these act on the file.
  const act = (event: React.MouseEvent, work: () => Promise<string | undefined>): void => {
    event.stopPropagation()
    work().then(setSaid, (error: unknown) => setSaid(String(error)))
  }

  if (files === undefined || (where.kind === 'path' && path === undefined)) {
    const full = path ?? value
    return (
      <button
        type="button"
        data-file={value}
        className={LINK}
        title={`${full} — a page cannot open a file on this computer; this copies the path`}
        onClick={(event) =>
          act(event, async () => {
            await navigator.clipboard.writeText(full)
            return 'copied'
          })
        }
      >
        <Bidi className="min-w-0 truncate">{name}</Bidi>
        {said !== undefined && <span className="shrink-0 text-ink-tertiary">&nbsp;· {said}</span>}
      </button>
    )
  }

  const target = where.kind === 'address' ? where.address : (path ?? value)
  if (present === false) {
    return (
      <span className="flex min-w-0" data-file={value} data-file-missing="" title={`No file is at ${target} now`}>
        <Bidi className="min-w-0 truncate text-ink-secondary">{name}</Bidi>
        <span className="shrink-0 text-ink-tertiary">&nbsp;· missing</span>
      </span>
    )
  }
  // A program is shown in its folder, never run from a cell.
  const program = where.kind === 'path' && isProgramFile(target)
  return (
    <span className="flex min-w-0 items-baseline gap-1.5" data-file={value}>
      <button
        type="button"
        className={LINK}
        title={program ? `${target} is a program — this shows it in its folder` : `Open ${target}`}
        onClick={(event) => act(event, () => (program ? files.show(target) : files.open(target)))}
      >
        <Bidi className="min-w-0 truncate">{name}</Bidi>
      </button>
      {where.kind === 'path' && !program && (
        <button
          type="button"
          data-file-show=""
          className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-caption text-ink-tertiary hover:text-ink hover:underline"
          title={`Show ${name} in its folder`}
          onClick={(event) => act(event, () => files.show(target))}
        >
          show in folder
        </button>
      )}
      {said !== undefined && <span className="truncate text-caption text-negative">{said}</span>}
    </span>
  )
}

/**
 * The entry's `file` field: the file as a cell shows it, a path typed or
 * pasted, *Choose…* in the desktop app, and a file dropped anywhere on it.
 * Typed text writes when the field is left, as every typed field does; a pick
 * and a drop write at once.
 */
export function FileField({
  label,
  value,
  className,
  onChange,
  onPick,
}: {
  label: string
  value: string
  className: string
  onChange: (text: string) => void
  onPick: (text: string) => void
}) {
  const holder = useHolder()
  const files = shellFiles()
  const [why, setWhy] = useState<string | undefined>(undefined)
  const placed = (text: string): string => (text.trim() === '' ? '' : fileValueFor(text, holder))
  const pick = (text: string): void => {
    setWhy(undefined)
    onPick(placed(text))
  }

  return (
    <span
      className="flex w-full min-w-0 flex-col gap-0.5"
      data-file-field={label}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes('Files')) return
        event.preventDefault()
        event.stopPropagation()
      }}
      onDrop={(event) => {
        const [file] = event.dataTransfer.files
        if (file === undefined) return
        event.preventDefault()
        event.stopPropagation()
        const path = files?.pathOf(file) ?? ''
        if (path === '') setWhy('A page is not told where a dropped file is. Type or paste its path, or use the desktop app.')
        else pick(path)
      }}
    >
      {value !== '' && <FileLink value={value} />}
      <span className="flex min-w-0 items-baseline gap-2">
        <input
          className={className}
          aria-label={label}
          spellCheck={false}
          placeholder="Type, paste or drop a path"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          // Kept beside the document when it is under its folder, before the
          // leave that follows writes it.
          onBlur={() => {
            const next = placed(value)
            if (next !== value) onChange(next)
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            pick(value)
          }}
        />
        {files !== undefined && (
          <button
            type="button"
            className="shrink-0 cursor-pointer border-0 bg-transparent p-0 text-caption text-accent hover:underline"
            onClick={() => {
              files.choose().then(
                (path) => {
                  if (path !== undefined) pick(path)
                },
                (error: unknown) => setWhy(String(error)),
              )
            }}
          >
            Choose…
          </button>
        )}
      </span>
      {why !== undefined && <span className="text-caption text-negative">{why}</span>}
    </span>
  )
}
