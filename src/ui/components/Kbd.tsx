/**
 * A key on the keyboard, rendered as one.
 *
 * Small, but it earns a file: the review screen is keyboard-first by
 * specification (docs/f01) and the shortcut hints appear on four screens now.
 * It used to live inside the commit bar, which is why the document bar imported
 * its keyboard hint from the importer.
 */
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-hairline px-1 font-mono text-[11px]">{children}</kbd>
}
