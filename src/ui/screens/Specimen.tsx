import type { ReactNode } from 'react'

/**
 * **The specimen page** (M64 U16, D-611): `#/specimen`, one place where every
 * component and every way of showing data is seen in every state, light and
 * dark side by side — so the redesign (M64) judges the look on one page rather
 * than on twenty screens, and the contact sheet (U2) has one picture of it.
 *
 * **U16 builds the frame; U4 fills it.** Until then `SPECIMENS` is empty and
 * the page says so. A specimen is a name, a line on what it is for, and its
 * states; each state is drawn twice, in a `.fc-theme-light` pane and a
 * `.fc-theme-dark` one (`tokens.css`), whichever theme the app is in.
 *
 * Opened by the dev server and the demo build only (`specimenOpens`), never by
 * the desktop release, so its words are a tool's and not the catalogue's.
 */

export interface SpecimenState {
  /** What the state is: Rest, Hover, Empty, Loading, Error, Long text… */
  readonly name: string
  readonly render: () => ReactNode
}

export interface Specimen {
  /** The component's name in the code, so a finding names what to open. */
  readonly name: string
  readonly about: string
  readonly states: readonly SpecimenState[]
}

/** Every specimen, in the order the page draws them. U4 fills this. */
const SPECIMENS: readonly Specimen[] = []

const PANES = [
  { theme: 'light', label: 'Light' },
  { theme: 'dark', label: 'Dark' },
] as const

/** One component: its name, what it is for, and each state in both themes. */
export function SpecimenFrame({ specimen }: { readonly specimen: Specimen }) {
  return (
    <section aria-labelledby={`specimen-${specimen.name}`} className="flex flex-col gap-3 border-b border-hairline pb-8">
      <header className="flex flex-col gap-1">
        <h2 id={`specimen-${specimen.name}`} className="m-0 text-heading">
          {specimen.name}
        </h2>
        <span className="text-ink-secondary">{specimen.about}</span>
      </header>
      {specimen.states.map((state) => (
        <div key={state.name} className="flex flex-col gap-2">
          <span className="fc-label text-ink-secondary uppercase">{state.name}</span>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {PANES.map((pane) => (
              <div
                key={pane.theme}
                role="group"
                aria-label={`${state.name}, ${pane.label}`}
                className={`fc-theme-${pane.theme} flex flex-col gap-2 border border-hairline bg-background p-4 text-ink`}
              >
                <span className="fc-label text-ink-secondary uppercase">{pane.label}</span>
                {state.render()}
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  )
}

export default function SpecimenPage() {
  return (
    <div className="h-full overflow-auto">
      <div className="fc-view-enter flex max-w-6xl flex-col gap-8 px-8 pt-6 pb-12">
        <header className="flex flex-col gap-1.5 border-b border-hairline pb-4">
          <span className="fc-label text-ink-secondary uppercase">Specimen</span>
          <h1 className="m-0 text-title">Every component, every state</h1>
          <span className="text-ink-secondary">
            Each component and each way of showing data, in every state it has, light and dark side by side.
          </span>
        </header>
        {SPECIMENS.length === 0 ? (
          <p className="m-0 text-ink-secondary">No specimens yet: M64 U4 draws the first.</p>
        ) : (
          SPECIMENS.map((specimen) => <SpecimenFrame key={specimen.name} specimen={specimen} />)
        )}
      </div>
    </div>
  )
}
