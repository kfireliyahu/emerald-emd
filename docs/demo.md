# The demo: Emerald's page, the tours, and embedding one

`npm run build:demo` writes `dist-demo/`: Emerald's page at its root, the page
[getemerald.dev](https://getemerald.dev) serves, with the four tours embedded; the tour frame beside
it as `tour.html`; and the app it plays as `app.html` — guided tours over the real app, on documents
of made-up figures, as a static folder with relative paths. `npm run check:tours` replays every
tour in a real browser, opens the page and waits for each of its frames to play, and fails if one
stalls or if anything is requested from outside the folder. It opens Electron windows, so it needs
a display and is not run in CI.

The page's words live in one file per language, `src/demo/page/copy/<lang>.ts` (M33 F9); the
markup holds no words. The tours are in `src/demo/tour/`, and the contract below is tested in
`src/demo/contained.test.ts` and `src/demo/contract.ts` (D-418).

## Embedding a tour

Any page can embed a tour:

```html
<iframe src="https://getemerald.dev/tour.html?tour=custom&autoplay=1" title="Emerald, a guided tour"
        referrerpolicy="no-referrer" allow="" style="width:100%; aspect-ratio:16/10"></iframe>
```

- **`?tour=<name>`** picks the tour (`custom`, `ledger`, `development` or `timesheet`; the first if
  it is left out or unknown).
- **`?autoplay=1`** plays it **while it is seen** (D-496): the first step is held until a third of
  the frame is in the visitor's view and its tab is showing, the tour stops where it is when it
  leaves, and goes on from there when it comes back. The frame works this out itself, so a frame
  below the fold of any page starts at its beginning when it is scrolled to. A tour the visitor took
  over stays as they left it. Without `autoplay` the frame holds the tour's first frame with a
  *Watch the tour* control over it.
- **Size.** It lays out at any width from **375 px**, and needs at least **440 px** of height. From
  690 px up the app is drawn whole, scaled to fit, and a visitor can take it over (*Try it*); below
  690 px it is a moving crop of the app that is watched only.
- **What it tells the page**, with `postMessage`, and nothing else:
  `{ source: 'emerald-demo', event: 'step' | 'took-over' | 'reset', step, of }` — a step coming
  up while it plays, the visitor taking it over, or Reset; `step` counts from 1, as the frame shows
  it, and `of` is how many there are. Tell two frames apart by `event.source`.
- **Nothing leaves the page**: no request but to the folder it is served from, and what a visitor
  does is thrown away on Reset or reload. It needs no permission (`allow=""`) and no referrer. Its
  one remembered setting, the speed, is kept in the browser's storage for that site, and it plays
  at the default speed where there is none.
