import { useEffect, type ReactNode } from 'react'

import { Button } from '@/ui/components/Button.tsx'
import { useClaimWindow } from '@/ui/useFullWindow.ts'

/**
 * A flow that takes the whole window, and the one way out of it.
 *
 * **What this fixes is a shape, not a screen.** Adding a reading to a fund was
 * a form, inside a 30rem pane, inside a list — a dozen figures copied off paper
 * into 372px of content, with the eleven other funds still on screen competing
 * for the eye. That is D-050's argument for the
 * paycheck form, arriving a second time; it was right the first time. So the
 * four flows that transcribe a document — *Add a reading*, *Read a report*, the
 * payslip reader and the paycheck form — get the shape onboarding and the
 * import flow already had (docs/06, "outside the tabs"): the whole content
 * area, the sidebar not navigable, the tab strip gone, and the list gone.
 *
 * **One way out, and it is here.** Every one of the four had its own: a header
 * "Back to the fund", a header "Back to the list", a footer Cancel beside Save,
 * a line of copy saying Escape closes this — and one of them had no visible
 * exit at all. A flow that fills the window has no *outside* to click, so the
 * exit has to be in a fixed place, and having it in two places is how one of
 * them ends up meaning something slightly different from the other. It is the
 * frame's, it is top-right, it is the same weight every time, and the forms
 * inside keep only their primary action.
 *
 * **Escape leaves, and never from inside a field.** `PaycheckEditor` bound
 * Escape on the form, so Escape anywhere in it closed it — including in a text
 * field, where Escape means "undo what I just typed here" everywhere else in
 * this app (the categories screen's target, the appearance picker's icon, the
 * rename). A dozen typed fields vanishing because someone tried to revert one
 * of them is not a way out, it is a trapdoor.
 *
 * It listens on the window rather than on the frame, which is the difference
 * between a shortcut that works and one that works when the focus happens to be
 * somewhere. Clicking any plain area of a form leaves `document.body` focused,
 * and a handler in the React tree never hears the keystroke at all. The two
 * guards are what make a window listener safe here: a popover inside the flow
 * that answers Escape itself has already called `preventDefault`, and anything
 * with a cursor in it is a field.
 */
export function FlowFrame({
  title,
  leaveLabel,
  onLeave,
  onSubmit,
  actions,
  footer,
  children,
}: {
  /** What is happening, in the header. Quiet: the content is the point. */
  title: ReactNode
  /** Where leaving goes — "Back to the fund", "Back to the list". */
  leaveLabel: string
  onLeave: () => void
  /**
   * Makes the frame a `<form>`.
   *
   * Two of the four flows are forms with a **pinned** primary — the paycheck
   * editor's Save sits under the reconciliation strip, which is the figure
   * being watched while the lines are typed (D-050). A footer outside the form
   * cannot hold a submit button, and threading `form="…"` ids through three
   * call sites to fake one is worse than the frame simply being the form.
   */
  onSubmit?: () => void
  /** Anything that belongs beside the exit — a Stop, a format picker. */
  actions?: ReactNode
  /**
   * Pinned under the body. Supplies its own padding, because what goes here
   * ranges from a row of buttons to a reconciliation strip on its own plane.
   *
   * **Never a second way out.** The primary lives here; Cancel does not.
   */
  footer?: ReactNode
  children: ReactNode
}) {
  useClaimWindow()

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (isFieldEvent(event.target)) return
      event.preventDefault()
      onLeave()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onLeave])

  const Root = onSubmit === undefined ? 'div' : 'form'

  return (
    <Root
      className="fc-view-enter flex h-full flex-col"
      {...(onSubmit === undefined
        ? {}
        : {
            onSubmit: (event: React.FormEvent) => {
              event.preventDefault()
              onSubmit()
            },
          })}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline px-6 py-2">
        <span className="text-ink-secondary">{title}</span>

        <span className="ml-auto flex items-center gap-2">
          {actions}
          <Button variant="ghost" size="sm" onClick={onLeave}>
            {leaveLabel}
          </Button>
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">{children}</div>

      {footer !== undefined && (
        <div className="shrink-0 border-t border-hairline">{footer}</div>
      )}
    </Root>
  )
}

/**
 * Whether the keystroke came from somewhere Escape already means something.
 *
 * A native `<select>` closes its own popup on Escape and a text field reverts;
 * both are the browser's or the app's, and neither is this frame's to take.
 */
function isFieldEvent(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
