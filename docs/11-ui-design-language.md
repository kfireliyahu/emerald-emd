---
type: spec
project: Emerald
---

# 11 — UI Design Language

Minimal. Black on white. Motion that is smooth and simple but never decorative. **The numbers are
the interface**: everything else — chrome, colour, borders, shadows — is removed until only
typography, spacing and one accent remain.

This note used to be 568 lines. Since M40 U4 (D-437) it says where
things are and nothing else, because everything it held was one of two kinds:

## The values are the stylesheet's

Every colour (both themes), the type ramp, the spacing scale, the radii, the one shadow, the motion
durations and easings are tokens in [`src/ui/theme/tokens.css`](../src/ui/theme/tokens.css), with
the reason for each beside it. **They are not copied anywhere** — a copy drifts, and this note's did:
its colour table said `hairline` was `#E8E8E8` and its motion table said 200 and 250 ms while the
tokens said otherwise. The mark is [`src/ui/emerald.svg`](../src/ui/emerald.svg) (its facets are
the identity greens) and [`emerald-basic.svg`](../src/ui/emerald-basic.svg) its flat silhouette for
the sizes where the facets turn to mush.

## The rules are rows

Every rule a person or a model has to follow when drawing a screen — the accent and the two greens
(D-125), bidi isolation, the window and its chrome, density, layout, the four motions of M39, the
views' theme, charts, components, actions as verbs and icons, desktop affordances, dark mode,
what is ruled out, accessibility, *words name the rule* and *make it in place* —
is a `rule` row in [`docs/memory.emd`](./memory.emd) with `scope: ui`, its `why`, the decisions
behind it and, where one exists, the test that fails when it breaks:

```
format_rows rule match:{scope:ui, state:live} columns:[name, statement]   # all of them, ~70
format_rows rule search:"motion"                                            # or "accent", "chart", "tab"…
format_rows rule match:{name:"Accent is for acting"}                        # one, with its why
```

**A code comment that cites `docs/11` for a rule** — *charts draw once*, *colour carries meaning*, *a
stagger caps at three* — **means these rows**; some forty comments in `src/ui/` were left alone, as
conventions.md's were (D-435).

Two rules that read as UI are `shell` rows because the shell is where they bite: *A button in a
drag region* (`.app-drag`, `.app-no-drag`) and *Accelerators are shown, not registered*.

### The four motions (M39, D-421, D-423)

Are rows now — `format_rows rule search:"motion"` — from *Motion says what changed* to *Reduced
motion runs none of it*. The audit of what enters and what does not is still
[`mockups/m39-u1/motion.md`](./mockups/m39-u1/motion.md).

## Left in prose, on purpose

Nothing that is a rule. What did not become a row was a value (above), a ledger screen's own
detail (the category picker's `C` key — [`packs/ledger/`](./packs/ledger/README.md)), or history:
the pre-M39 motion table and D-154's button highlight, both superseded, are in the decision log.

## Related

[06 Navigation and Screens](./packs/ledger/06-navigation-and-screens.md) · [F10 Statistics and Reports](./packs/ledger/f10-statistics-and-reports.md) · [09 Decision Log](./09-decision-log.md)
