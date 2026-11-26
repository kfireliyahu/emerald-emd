import type { ReactNode } from 'react'

/**
 * **A Settings page, as the report** (M64 U12, D-624): every page under
 * Settings — and Assistants beside them — answers its one question first, in
 * words, before anything is set (*The answer comes first, in words*). The
 * name is the `h1`, the answer one sentence at the lede step under it, and
 * then the page's rows: a few choices, one column, each a label, what it
 * means and its control (`SettingRow`). No eyebrow over the name (D-614
 * dropped them), and the one primary, where a page has one, at the top right.
 *
 * `aside` is the page's `SidePanel` when one is open: beside the page and
 * never over its own scroll, as on the ledger's screens.
 */
export function SettingsPage({
  title,
  answer,
  action,
  aside,
  children,
}: {
  readonly title: string
  /** The page's question, answered: `Weeks start on Monday: this week is …`. */
  readonly answer: ReactNode
  /** The page's one primary, beside its name. */
  readonly action?: ReactNode
  readonly aside?: ReactNode
  readonly children?: ReactNode
}) {
  return (
    <div className="flex h-full">
      <div className="h-full min-w-0 flex-1 overflow-auto">
        <div className="fc-view-enter flex flex-col gap-6 px-8 pt-6 pb-12">
          {/* As tall as a button whether or not one is there: the title stays put from page to page. */}
          <header className="flex min-h-9 flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <h1 className="m-0 text-title leading-tight font-medium">{title}</h1>
            {action}
          </header>
          <p className="m-0 max-w-[40ch] text-lede [text-wrap:balance]">{answer}</p>
          {children !== undefined && <div className="flex flex-col">{children}</div>}
        </div>
      </div>
      {aside}
    </div>
  )
}

/**
 * One setting: what it is, what it means in a line, and its control at the
 * row's end — a form of one column, hairline between rows. `htmlFor` names the
 * control the label is for, where it is a field.
 */
export function SettingRow({
  label,
  htmlFor,
  hint,
  children,
}: {
  readonly label: ReactNode
  readonly htmlFor?: string | undefined
  readonly hint?: ReactNode
  readonly children?: ReactNode
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-hairline py-4 first:border-t">
      <div className="min-w-0">
        {htmlFor === undefined ? (
          <span className="font-medium">{label}</span>
        ) : (
          <label htmlFor={htmlFor} className="font-medium">
            {label}
          </label>
        )}
        {hint !== undefined && <p className="m-0 mt-0.5 max-w-[60ch] text-ink-secondary">{hint}</p>}
      </div>
      {children}
    </div>
  )
}
