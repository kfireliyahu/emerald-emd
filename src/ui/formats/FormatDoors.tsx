import { useMemo } from 'react'

import { isProviderSupported, readChosenProvider } from '@/data/runtime/provider.ts'

/**
 * **The three ways a format begins** — M20 U2. All three open the one editor a
 * format is changed in since M29 U1 (D-331); the third opens it empty.
 *
 * ## Why they are doors and not three buttons on a toolbar
 *
 * They were three buttons on a toolbar, two ghost and one primary, sitting in
 * the header beside a row that said `0 formats`. All three worked. What they
 * did not do was make the choice look like a choice: *From an example* and
 * *Import a declaration* opened a panel above the list, *New format* went
 * somewhere else entirely, and the sentence explaining all three was a
 * paragraph in the empty state that a person reads once and never again.
 *
 * D-227's line is that **a format is the user's surface, not a declaration
 * made once**, and the first thing a surface owes the user is a legible way in. So
 * the three ways are the screen, in the middle of it, one card each, and the
 * word under each one says what it costs: something already at hand, a file
 * someone gave, or an empty form.
 *
 * ## Animated rather than disclosed
 *
 * A disclosure is a panel that appears beside the thing that opened it and
 * leaves you to work out what changed. These arrive as a set — the fade and
 * 4px rise every row in this app gets, staggered by `--fc-door-at`, which
 * docs/11 permits for exactly this: a cascade capped at three items. Choosing
 * one replaces the set rather than adding to it, so there is never a panel and
 * a chooser on screen at the same time arguing about which one you are in.
 *
 * ## The order is the order of the prior structure you have
 *
 * D-215's dial, left to right: a document in your hand, a declaration somebody
 * worked out, and nothing at all. It is the same axis the intake screen is
 * built on, and it is worth the cards being in that order even though nothing
 * enforces it.
 *
 * ## A door says what it costs before you go through it
 *
 * The example door needs the desktop shell and a model switched on, because the
 * only socket in this app is the main process's (D-124, D-134). As a ghost
 * button on a toolbar that could be found out afterwards; as a third of the
 * screen a person lands on it cannot. So the card reads what is missing in the
 * place where it would otherwise have promised something — which is the same
 * separation D-138 puts on a verifier, applied to an affordance.
 *
 * **The door stays, and is not hidden or disabled.** `ExamplePanel` makes the
 * same call for the same reason: somebody who has never opened
 * `#/settings/model` would otherwise never learn the app can do this, and
 * showing it costs nothing because no socket opens until a button is pressed.
 */
export function FormatDoors({
  onExample,
  onImport,
  onEmpty,
}: {
  onExample: () => void
  onImport: () => void
  onEmpty: () => void
}) {
  // Read once. Both are machine preferences, and changing either is a trip to
  // a settings screen that unmounts this one (D-134).
  const example = useMemo(() => {
    if (!isProviderSupported()) {
      return 'Needs the desktop app: a model runs beside it on your own machine, and a page in a browser has no way to reach one.'
    }
    if (readChosenProvider() === undefined) {
      return 'Needs a local model switched on, under Settings → Model. Everything it reads stays on this machine.'
    }
    return 'A model on this machine reads it and says what columns that kind of thing has.'
  }, [])

  const doors = [
    {
      key: 'example',
      glyph: DOCUMENT,
      title: 'From an example',
      lead: 'A label, a receipt, a note, a spreadsheet — one of the things you already have.',
      cost: example,
      onChoose: onExample,
    },
    {
      key: 'import',
      glyph: INBOX,
      title: 'From a declaration',
      lead: 'One you worked out with Claude, or one that came from another document.',
      cost: 'It opens in the editor with its columns filled in. Nothing is written until you create it.',
      onChoose: onImport,
    },
    {
      key: 'empty',
      glyph: GRID,
      title: 'Start empty',
      lead: 'Name it and add its columns, in the same editor you will change it in later.',
      cost: 'Nothing is written until you press Create.',
      onChoose: onEmpty,
    },
  ]

  return (
    // **`min-h-full`, not `h-full`.** A centred flex box that is shorter than
    // its contents pushes the first of them *above* the scroll origin, where no
    // amount of scrolling reaches it — which in a short window took the heading
    // off the top of the screen. Growing with the content instead means
    // `justify-center` centres only when there is room to.
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-8">
      {/* **It says nothing about what a format is.** The header above this
          already does, in both the places these are shown, and a screen that
          explains itself twice reads as a screen that is not sure. What is left
          is the only thing the three cards do not say on their own: what orders
          them. */}
      <div className="mb-6 max-w-prose text-center">
        <h2 className="font-medium">Start with what you have</h2>
        <p className="mt-1 text-caption text-ink-secondary">
          In order of how much of the shape you already hold — a document in your hand, a
          declaration somebody wrote, or nothing at all.
        </p>
      </div>

      <ul className="grid w-full max-w-[64rem] gap-3 sm:grid-cols-3">
        {doors.map((door, index) => (
          <li
            key={door.key}
            className="fc-door-enter"
            style={{ '--fc-door-at': index } as React.CSSProperties}
          >
            <button
              type="button"
              data-tour={`door-${door.key}`}
              onClick={door.onChoose}
              className="flex h-full w-full flex-col items-start gap-2 rounded-lg border border-hairline-strong bg-elevated p-5 text-left transition-colors duration-[var(--duration-micro)] hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              {/* `accent` marks what you can act on, and a door is nothing but
                  something to act on (D-125). No figure is coloured here. */}
              <span className="text-accent">{door.glyph}</span>
              <span className="font-medium">{door.title}</span>
              <span className="text-caption text-ink-secondary">{door.lead}</span>
              <span className="mt-auto pt-2 text-caption text-ink-tertiary">{door.cost}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Three glyphs, hand-drawn at the same weight as `NavGlyph`'s and drawn at
 * 24px because a door is not a rail item.
 *
 * They are local to this file rather than in a shared set: three paths used in
 * one place is a component, and the moment a fourth screen wants one of them is
 * the moment it becomes a family.
 */
function Glyph({ children }: { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      className="h-6 w-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  )
}

// A document with its corner turned: a thing you already have.
const DOCUMENT = (
  <Glyph>
    <path d="M3.5 1.5h5.4l3.6 3.6v9.4a.5.5 0 0 1-.5.5h-8.5a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5Z" />
    <path d="M9 1.6v3.5h3.4" />
    <path d="M5.5 8.5h5M5.5 11h5" />
  </Glyph>
)

// An arrow coming down into a tray: something written elsewhere, brought in.
const INBOX = (
  <Glyph>
    <path d="M8 1.5v7" />
    <path d="M5.3 6 8 8.7 10.7 6" />
    <path d="M2 10.5h3l1 2h4l1-2h3" />
    <path d="M2 10.5V14a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5v-3.5" />
  </Glyph>
)

// A grid: a sheet you type into.
const GRID = (
  <Glyph>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
    <path d="M1.5 6h13M1.5 9.5h13M6 2.5v11M10.5 2.5v11" />
  </Glyph>
)
