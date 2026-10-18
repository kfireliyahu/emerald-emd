import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

import { ActionGlyph, type ActionGlyphName } from '@/ui/components/ActionGlyph.tsx'

/**
 * The app's context menu (D-173), as the Transactions and Categories screens
 * use it since M28 U6 (D-315).
 *
 * **The first one decided the pattern**, which docs/08 B9 flagged before there
 * was one to decide, so the rules are here rather than in the screen that
 * happens to be first: it opens where you asked for it, Escape and a click
 * outside close it, the arrows walk it, and **there is a keyboard way to open
 * it** — `Shift+F10` and the Menu key, which is what the platform binds and
 * therefore what a person already knows. [conventions](../../docs/conventions.md)
 * makes that last part done rather than nice.
 *
 * **It holds actions, never state.** U6 allowed one more shape and no more: an
 * item can open a **submenu of actions** (Category ▸ the usual six), because
 * "file this under…" is a verb with a choice in it. Nothing is ticked and nothing
 * is a field; everything here does one thing and closes.
 *
 * `fixed`, positioned against the viewport, because the point it opens at came
 * from a pointer event and those are viewport coordinates — and because a menu
 * inside a scrolling table would scroll away from the row it is about. It
 * closes on a scroll instead, which is the same answer every native menu gives.
 */
export interface MenuItem {
  readonly label: ReactNode
  readonly onChoose?: () => void
  /** A glyph in the leading column, when the item is a verb worth a picture. */
  readonly icon?: ActionGlyphName
  /** A line under the label that says what the action will do, in one sentence. */
  readonly detail?: ReactNode
  /** The key that does the same thing on the screen, shown at the right. */
  readonly shortcut?: string
  readonly disabled?: boolean
  /** Actions that open beside this item. The item itself then chooses nothing. */
  readonly submenu?: readonly MenuItem[]
  /** A hairline above this item, to group a long menu. */
  readonly separated?: boolean
}

export function ContextMenu({
  at,
  items,
  onClose,
  header,
  hint,
}: {
  /** Viewport coordinates — a pointer event's, or a focused element's corner. */
  readonly at: { readonly x: number; readonly y: number }
  readonly items: readonly MenuItem[]
  readonly onClose: () => void
  /** What the menu is about, in two lines: who, and the facts that tell it apart. */
  readonly header?: { readonly title: ReactNode; readonly sub?: ReactNode }
  /** One line at the foot, for something worth saying once (S5's highlight hint). */
  readonly hint?: ReactNode
}) {
  const holder = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState<number | undefined>()
  // Where the menu really goes: measured once it is in the page, because what
  // an item weighs depends on whether it carries a second line.
  const [top, setTop] = useState(at.y)
  useLayoutEffect(() => {
    const height = holder.current?.getBoundingClientRect().height ?? 0
    setTop(Math.max(8, Math.min(at.y, window.innerHeight - height - 8)))
  }, [at.y])

  // Focus the first item, so the arrows have somewhere to start and so a
  // keyboard-opened menu is usable without a further keystroke.
  useEffect(() => {
    holder.current?.querySelector<HTMLElement>('[data-top]:not(:disabled)')?.focus()
  }, [])

  useEffect(() => {
    const close = (): void => onClose()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }
    // `pointerdown` rather than `click`: a menu that survives until mouseup is
    // a menu that can be closed by the very click that opened something else.
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKeyDown)
    // Capture, because the scroller is an inner element and scroll does not
    // bubble to the window.
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [onClose])

  if (items.length === 0) return null

  const tops = (): HTMLElement[] => [
    ...(holder.current?.querySelectorAll<HTMLElement>('[data-top]:not(:disabled)') ?? []),
  ]

  const walk = (event: React.KeyboardEvent, button: HTMLElement, index: number, item: MenuItem): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setOpen(undefined)
      const buttons = tops()
      const at = buttons.indexOf(button)
      const next = event.key === 'ArrowDown' ? at + 1 : at - 1
      // Wraps, which is what a menu of four items should do: reaching the bottom
      // and stopping is a dead end you have to look at to escape.
      buttons[(next + buttons.length) % buttons.length]?.focus()
      return
    }
    if (item.submenu !== undefined && (event.key === 'ArrowRight' || event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault()
      event.stopPropagation()
      setOpen(index)
      // After the flyout has rendered.
      window.setTimeout(() => button.parentElement?.querySelector<HTMLElement>('[data-sub]:not(:disabled)')?.focus(), 0)
    }
  }

  const left = Math.min(at.x, Math.max(0, window.innerWidth - 300))
  // A flyout opens to the left when there is no room on the right.
  const flip = left + 300 + 260 > window.innerWidth

  return (
    <div
      ref={holder}
      role="menu"
      // Its own pointerdown must not reach the window listener above.
      onPointerDown={(event) => event.stopPropagation()}
      className="fc-pop-enter fixed z-50 w-72 border border-hairline-strong bg-elevated py-1 shadow-lg"
      style={{
        // Kept inside the window: a menu opened near the right edge would
        // otherwise be a menu you cannot read.
        left,
        top,
        maxHeight: 'calc(100vh - 16px)',
      }}
    >
      {header !== undefined && (
        <div className="flex flex-col gap-0.5 border-b border-hairline px-3 pt-1.5 pb-2">
          <b className="truncate font-medium text-ink">{header.title}</b>
          {header.sub !== undefined && <span className="truncate text-caption text-ink-secondary">{header.sub}</span>}
        </div>
      )}
      {items.map((item, index) => (
        <div key={index} className="relative" onMouseEnter={() => setOpen(item.submenu === undefined ? undefined : index)}>
          {item.separated === true && <div className="my-1 border-t border-hairline" />}
          <button
            type="button"
            role="menuitem"
            data-top=""
            disabled={item.disabled === true}
            aria-haspopup={item.submenu === undefined ? undefined : 'menu'}
            aria-expanded={item.submenu === undefined ? undefined : open === index}
            onKeyDown={(event) => walk(event, event.currentTarget, index, item)}
            onClick={() => {
              if (item.submenu !== undefined) {
                setOpen(index)
                return
              }
              onClose()
              item.onChoose?.()
            }}
            className="grid w-full grid-cols-[1.25rem_1fr_auto] items-start gap-x-2 px-3 py-1.5 text-left text-ink transition-colors duration-[var(--duration-micro)] hover:bg-accent-soft focus-visible:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:text-ink-tertiary disabled:hover:bg-transparent"
          >
            <span aria-hidden className="mt-0.5 text-ink-secondary">
              {item.icon !== undefined && <ActionGlyph name={item.icon} size={14} />}
            </span>
            <span className="flex min-w-0 flex-col">
              <span>{item.label}</span>
              {item.detail !== undefined && (
                <small className="text-caption text-ink-secondary">{item.detail}</small>
              )}
            </span>
            <span className="mt-0.5 font-mono text-caption text-ink-tertiary">
              {item.submenu !== undefined ? '▸' : (item.shortcut ?? '')}
            </span>
          </button>
          {item.submenu !== undefined && open === index && (
            <div
              role="menu"
              className={`fc-pop-enter absolute top-0 z-10 max-h-80 w-64 overflow-auto border border-hairline-strong bg-elevated py-1 shadow-lg ${
                flip ? 'right-full' : 'left-full'
              }`}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft') {
                  event.preventDefault()
                  event.stopPropagation()
                  setOpen(undefined)
                  holder.current?.querySelectorAll<HTMLElement>('[data-top]')[index]?.focus()
                }
              }}
            >
              {item.submenu.map((sub, subIndex) => (
                <div key={subIndex}>
                  {sub.separated === true && <div className="my-1 border-t border-hairline" />}
                  <button
                    type="button"
                    role="menuitem"
                    data-sub=""
                    disabled={sub.disabled === true}
                    onKeyDown={(event) => {
                      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
                      event.preventDefault()
                      event.stopPropagation()
                      const all = [
                        ...(event.currentTarget.closest('[role="menu"]')?.querySelectorAll<HTMLElement>('[data-sub]:not(:disabled)') ?? []),
                      ]
                      const next = all.indexOf(event.currentTarget) + (event.key === 'ArrowDown' ? 1 : -1)
                      all[(next + all.length) % all.length]?.focus()
                    }}
                    onClick={() => {
                      onClose()
                      sub.onChoose?.()
                    }}
                    className="grid w-full grid-cols-[1fr_auto] items-center gap-x-2 px-3 py-1.5 text-left text-ink transition-colors duration-[var(--duration-micro)] hover:bg-accent-soft focus-visible:bg-accent-soft focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent disabled:cursor-default disabled:text-ink-tertiary"
                  >
                    <span className="min-w-0 truncate">{sub.label}</span>
                    <span className="font-mono text-caption text-ink-tertiary">{sub.shortcut ?? ''}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
      {hint !== undefined && (
        <p className="m-0 border-t border-hairline px-3 pt-2 pb-1 text-caption text-ink-secondary">{hint}</p>
      )}
    </div>
  )
}

/**
 * Whether a key event is asking for the context menu.
 *
 * `Shift+F10` and the Menu key, which is what every desktop platform binds and
 * therefore the only pair a person could be expected to guess. Exported so the
 * screen that opens the menu and any test of it agree about what "asking for
 * it" means.
 */
export function isMenuKey(event: React.KeyboardEvent | KeyboardEvent): boolean {
  return event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')
}
