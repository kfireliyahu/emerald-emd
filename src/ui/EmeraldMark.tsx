import markUrl from './emerald.svg'

/**
 * The app's mark (D-123). The one place the emerald colour appears inside the
 * interface, and it is identity rather than signal — the palette is untouched,
 * because `positive` green means the pension deposit arrived (D-117, docs/11).
 *
 * An `<img>` rather than inline SVG on purpose: the mark's colours are fixed, so
 * nothing in it can ever inherit `currentColor` and start carrying meaning. It
 * is decorative here because the word "Emerald" sits beside it.
 */
export function EmeraldMark({ size = 18 }: { readonly size?: number }) {
  return (
    <img
      src={markUrl}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
      className="shrink-0 select-none"
    />
  )
}
