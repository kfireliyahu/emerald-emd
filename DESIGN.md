# Design

*A pointer for design tools that read `DESIGN.md` from the repository root (D-529). The design
system is not written here, because a copy drifts ([D-437](./docs/09-decision-log.md)):*

- **The values** — every colour in both themes, the type ramp, spacing, radii, the one shadow,
  durations and easings — are tokens in [`src/ui/theme/tokens.css`](./src/ui/theme/tokens.css),
  each with its reason beside it.
- **The rules** — about seventy, each with its why and the test that fails when it breaks — are
  `rule` rows in [`docs/memory.emd`](./docs/memory.emd), read through the `emerald` MCP server:

  ```
  format_rows rule match:{scope:ui, state:live} columns:[name, statement]
  format_rows rule search:"chart"        # or "motion", "accent", "form", "table"…
  ```

- **Where things are** is [`docs/11-ui-design-language.md`](./docs/11-ui-design-language.md).

**Where this summary and a row disagree, the row is right.** Read the rows before any UI edit;
what follows is only enough to recognise a violation at a glance.

## The absolutes

- Near-monochrome. `accent` marks what you can act on and never colours a figure; `positive` and
  `negative` are genuine signal only. Colour is never the only carrier.
- No gradients, no shadows — elevation is space and hairlines; `--shadow-pop` is for menus, panels
  and dialogs alone.
- IBM Plex Sans and Plex Sans Hebrew, self-hosted, weights 400/500/600; tabular figures wherever a
  number appears; numbers right-aligned.
- The 8px scale and nothing between its steps; rows are 40px (data), 32px (chrome), 24px (nested).
- Cards and controls are square. A chip is text with a dot, never a filled pill.
- One primary action per screen. Actions are verbs. An empty state is one sentence and one text
  action.
- A choice is `ChoiceField`, never `<select>`; a form makes what it needs in place (*+ New…*).
- Motion says what changed — four kinds only, all through `src/ui/motion/` — and none of it runs
  under reduced motion.
- Every colour, size and duration is a token; never a hex or a pixel literal in a component.

## The components to reach for

`Bidi` (any string from a document) · `ChoiceField` · `IconAction` · `Working` (every loading
state) · `Flip`, `Reveal`, `useMark` (motion) · `CountingAmount` · the views under `src/ui/formats/`.
