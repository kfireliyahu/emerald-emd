import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/ui/theme/tokens.css'
import { initTheme } from '@/ui/theme/useTheme.ts'
import { Frame } from './Frame.tsx'
import type { TourCheck } from './player.ts'
import { loadTours } from './rows.ts'

/**
 * **The frame's entry** (M33 U2): `demo-frame.html`, which the demo build
 * writes as `dist-demo/tour.html` — the page an embed points at (`index.html`
 * beside it is Emerald's page, M33 U8, which embeds this one). The app it
 * plays is `app.html` beside it, U1's entry, unchanged but for the handle it
 * offers this page (`src/demo/contract.ts`).
 *
 * **The tours are rows** (M33 U3): this page reads `tours.emd` beside it
 * through the engine before anything else, so the title and the first caption
 * are up while the app page is still opening its document. `?tour=` names one
 * (the first otherwise), and `?autoplay=1` plays it while it is seen (D-496); without it the
 * frame holds the first frame until the visitor asks (M33 U4, D-418 — the page
 * an embed points at, and the contract in README.md). **Each tour opens its own
 * document** (2026-10-07), passed to the app page as `?document=`.
 *
 * `?check` is `scripts/check-tours.mjs`'s: the same frame plays the tour once
 * at fast-forward and publishes what it found as `window.emeraldTourCheck`.
 */

declare global {
  interface Window {
    emeraldTourCheck?: { readonly tour: string; readonly tours: readonly string[]; readonly result: TourCheck }
  }
}

initTheme()
requestAnimationFrame(() => document.documentElement.classList.add('theme-ready'))

const element = document.getElementById('frame')
if (!element) throw new Error('#frame not found')
const root = createRoot(element)
const asked = new URLSearchParams(window.location.search)
/** `?autoplay=1`, or `?autoplay` alone; `0` and `false` are the same as leaving it out. */
const autoplay = ['', '1', 'true'].includes(asked.get('autoplay') ?? 'no')

try {
  const tours = await loadTours('./')
  const tour = tours.find((each) => each.name === asked.get('tour')) ?? tours[0]
  if (tour === undefined) throw new Error('tours.emd holds no tour.')
  const names = tours.map((each) => each.name)
  const check = asked.has('check')
    ? (result: TourCheck) => {
        window.emeraldTourCheck = { tour: tour.name, tours: names, result }
      }
    : undefined
  root.render(
    <StrictMode>
      <Frame
        tour={tour}
        appUrl={`./app.html?document=${tour.document}`}
        autoplay={autoplay}
        {...(check === undefined ? {} : { check })}
      />
    </StrictMode>,
  )
} catch (error) {
  const said = `The tour could not be read. ${error instanceof Error ? error.message : String(error)}`
  console.error(said, error)
  if (asked.has('check')) {
    window.emeraldTourCheck = { tour: '', tours: [], result: { ok: false, step: undefined, said, ms: 0 } }
  }
  root.render(<p className="tour-unread">{said}</p>)
}
