/**
 * The glyphs a button carries in its leading tile (M28 U4), hand-drawn for the
 * reason `NavGlyph` gives: an icon set is a package and a licence for a dozen
 * paths. One weight, `currentColor`, square caps to match the square controls.
 */
export type ActionGlyphName =
  | 'add'
  | 'read'
  | 'write'
  | 'stop'
  | 'edit'
  | 'trash'
  | 'check'
  | 'arrow'
  | 'left'
  | 'right'
  | 'open'
  | 'eyeoff'
  | 'eye'
  | 'card'
  | 'note'
  | 'rule'
  | 'filter'
  | 'copy'
  | 'skip'
  | 'bill'
  | 'debt'
  | 'search'
  | 'palette'
  | 'merge'
  | 'move'
  | 'archive'
  | 'cat'
  | 'undo'
  | 'more'
  | 'plus'
  | 'guide'
  | 'close'
  | 'equals'

const PATHS: Readonly<Record<ActionGlyphName, React.ReactNode>> = {
  add: <path d="M8 3v10M3 8h10" />,
  read: (
    <>
      <path d="M4 2.5h5.5L12 5v8.5H4z" />
      <path d="M8 6.5v4.5M6 9l2 2 2-2" />
    </>
  ),
  write: <path d="M3 8.5l3 3 7-7" />,
  stop: <rect x="4" y="4" width="8" height="8" />,
  edit: <path d="M3 13l1-3.5 6.5-6.5 2.5 2.5L6.5 12z" />,
  trash: <path d="M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.7 9h5.6l.7-9" />,
  check: <path d="M3.5 8.5l3 3 6-7" />,
  arrow: <path d="M3 8h9M9 5l3 3-3 3" />,
  left: <path d="M10 3.5L5.5 8l4.5 4.5" />,
  right: <path d="M6 3.5l4.5 4.5L6 12.5" />,
  open: (
    <>
      <path d="M4 2.5h6l2.5 2.5v8.5H4z" />
      <path d="M6.5 8h4M6.5 10.5h4" />
    </>
  ),
  eyeoff: (
    <><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" /><path d="M3 13L13 3" /></>
  ),
  eye: (
    <><path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" /><circle cx="8" cy="8" r="1.6" /></>
  ),
  card: (
    <><rect x="2" y="4" width="12" height="8.5" /><path d="M2 7h12" /></>
  ),
  note: (
    <><path d="M3 3h10v7l-3 3H3z" /><path d="M10 13v-3h3" /></>
  ),
  rule: (
    <><path d="M3 4h10M3 8h6M3 12h4" /><path d="M11 10l1.5 1.5L15 9" /></>
  ),
  filter: <path d="M2.5 3.5h11L9.5 8.5v4l-3 1v-5z" />,
  copy: (
    <><rect x="5" y="5" width="8" height="8" /><path d="M3 11V3h8" /></>
  ),
  skip: (
    <><path d="M4 3.5l6 4.5-6 4.5z" /><path d="M12 3.5v9" /></>
  ),
  bill: (
    <><rect x="3" y="2.5" width="10" height="11" /><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" /></>
  ),
  debt: <path d="M3 12.5h10M4.5 12.5V7M8 12.5V7M11.5 12.5V7M2.5 6L8 3l5.5 3z" />,
  search: (
    <><circle cx="7" cy="7" r="4" /><path d="M10 10l3.5 3.5" /></>
  ),
  palette: (
    <><circle cx="8" cy="8" r="5.5" /><circle cx="6" cy="6" r=".8" /><circle cx="10" cy="6" r=".8" /><circle cx="6" cy="10" r=".8" /></>
  ),
  merge: <path d="M4 3v3c0 2 4 2 4 4v3M12 3v3c0 2-4 2-4 4" />,
  move: <path d="M3 8h10M10 5l3 3-3 3" />,
  archive: (
    <><rect x="2.5" y="3" width="11" height="3" /><path d="M3.5 6v7h9V6M6.5 8.5h3" /></>
  ),
  cat: (
    <><circle cx="5" cy="5" r="2" /><path d="M9 4h4.5M9 6.5h3M2.5 9.5h11M2.5 12.5h8" /></>
  ),
  undo: (
    <><path d="M5 3L2.5 5.5 5 8" /><path d="M2.5 5.5h7a3.5 3.5 0 010 7H6" /></>
  ),
  more: (
    <><circle cx="4" cy="8" r=".9" /><circle cx="8" cy="8" r=".9" /><circle cx="12" cy="8" r=".9" /></>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  // Guide me (M28 U9): a compass, and the cross that puts it away.
  guide: (
    <><circle cx="8" cy="8" r="5.5" /><path d="M10.5 5.5L9 9 5.5 10.5 7 7z" /></>
  ),
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  // What has to add up (M29 U1): the sign an identity is written around.
  equals: <path d="M3 6h10M3 10h10" />,
}

export function ActionGlyph({ name, size = 16 }: { readonly name: ActionGlyphName; readonly size?: number }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="square"
      className="shrink-0"
    >
      {PATHS[name]}
    </svg>
  )
}
