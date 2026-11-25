/**
 * **Which build this page is: the app, or the demo** (M33 U1, D-413).
 *
 * The demo (`demo.html`, `src/demo/main.tsx`) is the app's own screens over a
 * document it opened on start, inside somebody else's page. What it leaves out
 * is the document's way in and out — New, Open…, Save, Save as…, the
 * recents, their shortcuts, the crash snapshot and the close guard — because
 * a visitor has no file, and a frame that asked to keep their afternoon would
 * be asking about nobody's.
 *
 * A Vite mode rather than a prop or a store: `vite build --mode demo` is the
 * only thing that makes it true, so in the app's own build this is a constant
 * `false` and every branch behind it is dead. A function rather than a const so
 * a test can say "in the demo" with `vi.stubEnv('MODE', 'demo')`.
 */
export function isDemo(): boolean {
  return import.meta.env.MODE === 'demo'
}

/**
 * **Whether this build opens the specimen page** (M64 U16, D-611): `#/specimen`,
 * every component and every way of showing data in every state, light and dark
 * side by side. The dev server and the demo build open it; the desktop
 * release (`vite build`, mode `production`) never does, and since both halves
 * are constants there, the page's chunk is never emitted into `dist/`.
 */
export function specimenOpens(): boolean {
  return import.meta.env.DEV || import.meta.env.MODE === 'demo'
}
