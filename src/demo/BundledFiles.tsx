import { useEffect, useState } from 'react'

/**
 * **The demo's file picker** (M33 U5, D-413): the one control the demo has
 * that the app has not. Where the app opens the system's file picker, the demo
 * lists the synthetic files bundled beside its page (`bundled.json`, written by
 * `scripts/make-demo-document.mjs`) and hands the one picked to the same
 * `onFiles` a picked file goes to — so what reads it is the app's own reading,
 * unchanged. A visitor has no file of theirs here, and the demo asks for none.
 *
 * Reached only through `useFilePicker` behind `isDemo()`; nothing in the app's
 * own build renders it.
 */
export function BundledFiles({
  onFiles,
  onClose,
}: {
  readonly onFiles: (files: readonly File[]) => void
  readonly onClose: () => void
}) {
  const [names, setNames] = useState<readonly string[] | undefined>(undefined)
  const [problem, setProblem] = useState<string | undefined>(undefined)

  useEffect(() => {
    let live = true
    fetch('./bundled.json')
      .then((response) => (response.ok ? (response.json() as Promise<unknown>) : Promise.reject(new Error(String(response.status)))))
      .then((list) => {
        if (live) setNames(Array.isArray(list) ? list.filter((each): each is string => typeof each === 'string') : [])
      })
      .catch(() => {
        if (live) setProblem('The demo’s files could not be listed.')
      })
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const pick = async (name: string): Promise<void> => {
    try {
      const response = await fetch(`./${encodeURIComponent(name)}`)
      if (!response.ok) throw new Error(String(response.status))
      const file = new File([await response.blob()], name)
      onClose()
      onFiles([file])
    } catch {
      setProblem(`${name} could not be opened.`)
    }
  }

  return (
    <div
      data-motion-close
      className="fixed inset-0 z-50 flex items-start justify-center bg-background/70 px-6 pt-[14vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Choose a file"
        className="fc-pop-enter flex w-full max-w-md flex-col overflow-hidden rounded-lg border border-hairline-strong bg-elevated shadow-pop"
      >
        <p className="border-b border-hairline px-4 py-3 text-ink">
          Choose a file
          <span className="block text-caption text-ink-tertiary">Made-up files that come with the demo.</span>
        </p>
        <ul role="listbox" aria-label="Files" className="py-1">
          {names?.map((name) => (
            <li
              key={name}
              role="option"
              aria-selected={false}
              tabIndex={0}
              className="cursor-pointer px-4 py-2 text-ink hover:bg-surface focus:bg-surface focus:outline-none"
              onClick={() => void pick(name)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void pick(name)
              }}
            >
              {name}
            </li>
          ))}
        </ul>
        {problem !== undefined && <p className="px-4 pb-3 text-caption text-negative">{problem}</p>}
      </div>
    </div>
  )
}
