# Product

*A pointer for design tools that read `PRODUCT.md` from the repository root (D-529). It holds no
argument of its own: what Emerald is and who it is for is [`docs/product.md`](./docs/product.md),
and where this file and that one disagree, that one is right.*

## What it is

**Excel that reads your documents and won't let you be wrong quietly.** A local-first desktop app
(and the same build as a static site) where a person keeps the things they track as *formats* —
declared tables with real types, checks and links — in one `.emd` file on their own machine. No
account, no backend, no network call. A model can drive the same file through an MCP server.

## Who it is for

- **The ledger crowd** wants their money correct and private, and never thinks about formats.
- **The engine crowd** uses a model daily and wants its memory typed — rows a session asks for
  instead of notes it greps.

## Surfaces and their mode

| Surface | Where | Mode |
|---|---|---|
| The app — formats, rows, views, dashboards, intake | `src/ui/` | Operate |
| Emerald's page, getemerald.dev | `demo-page.html`, words in `src/demo/page/copy/en.ts` | Persuade |
| The tour the page embeds | `demo-frame.html` → `tour.html` | Experience |
| The specification | `docs/` | Read |

## What it must feel like

Black on white, the numbers are the interface, one emerald accent for what you can act on, motion
only where something changed. Calm, exact, private. Never a dashboard template, never decoration,
never a marketing voice inside the app.

## Constraints a design must keep

- Offline is not optional: no font link, no CDN, no request the page did not serve itself.
- Hebrew is a first-class language: bidi isolation everywhere (`Bidi`), right-to-left content
  inside left-to-right chrome.
- Anything a person can do on a screen, a conversation can do too — a new control is half a feature
  until its tool exists.
- Another product is described by its category, never named.
