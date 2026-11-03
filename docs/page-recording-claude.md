# The recordings: the project inside Claude

The third set of recordings on Emerald's page (M56 U6), beside the development pack's
([`page-recording-development.md`](./page-recording-development.md)) in the same section. **A
proposal: the maintainer records them, and every word below can change.** Three short clips, 15
to 30 seconds each, no sound; the captions under each carry it. They show the one thing neither
the inbox diagram nor the first recording can: the project *beside* the conversation, kept
current by the plugin's own pane (M56 U1) and inbox (M56 U2), without anyone asking for it.

## The rule before anything else

**Record on the demo's made-up project, never on `docs/memory.emd` or any working `.emd`.** A
video on a public page publishes everything in the frame. Run `npm run build:demo` and copy
`dist-demo/project.emd` (a service with a versioned API: four decisions, three milestones, one
open question) into a new folder outside every repository — `api-service/project.emd`, say — as
the folder's only `.emd`, which is what makes the pane open by itself there. The second project in
clip 2 is a second such folder. Anything else that shows — the session list, the window title,
another tab, a terminal's prompt and path — must show nothing of a real project either: record in
a fresh profile or with the sidebar collapsed, and name the folders as below.

## What is on screen

**The Claude desktop app first** (the maintainer's answer, 2026-11-02): one window, the chat on
the left and the project pane on the right, the plugin installed (`/plugin install
emerald@emerald-emd`) and nothing else added. Run `npx emerald-mcp init` in the copy's folder
once before recording, so the pane's two reads are allowed and no permission dialog interrupts a
take (D-541). **One terminal clip beside it**: clip 1 again, in Claude Code in a terminal, at the
window size a reader's terminal has.

Light or dark is the maintainer's; the page follows the visitor's theme and one recording matches
only one of them, as in the development recording.

## Clip 1 — the pane opens as a session starts

`claude-pane.mp4`, about 20 seconds.

| Time | In the chat | In the pane | Caption |
| --- | --- | --- | --- |
| 0:00 | A new session in `api-service/`. Nothing typed. | The pane opens by itself, titled with the document: *Ready to start* M2 U3 (requests limited per client) and M2 U4 (the reference page); *Open milestones* M2 and M3; *Open questions* how long /v1 is kept. | **A session starts, and the project is already beside it.** |
| 0:06 | *What should I pick up?* | — | — |
| 0:10 | The model answers from the same rows: M2 U3 is ready, and M3 U1 waits on it. | Unchanged. | **The chat and the pane read the same rows.** |
| 0:18 | Hold. | Hold. | — |

**The terminal take** (`claude-pane-terminal.mp4`, the same shots): `claude` started in
`api-service/`, the pane opening in the terminal beside the prompt. Caption: **The same pane in a
terminal session.**

## Clip 2 — a note from another project arrives

`claude-inbox.mp4`, about 25 seconds. Set up first: a second folder, `shop-website/`, with its
own document (`create_document` with the development pack, *Shop website*), and a second window
open on it, out of frame until 0:04.

| Time | In the chat | In the pane | Caption |
| --- | --- | --- | --- |
| 0:00 | The `api-service` session from clip 1, idle between prompts. | The project, as clip 1 left it. | **Two projects, two sessions.** |
| 0:04 | Cut to the `shop-website` window: *Tell the API project that /v1/orders returns the total as a string; we parse it.* Its session writes a row into `api-service/project.emd`'s inbox: the dry run, then `commit: true`. | — | **A session in one project leaves a note in another.** |
| 0:14 | Back on `api-service`: the toast *New in project.emd's inbox: …* rises while nobody is typing. | — | **It arrives while you work: no prompt asked for it.** |
| 0:18 | `/emerald` | The pane reads again: *New in the inbox*, the note, from `shop-website`. | **And it waits in the project until a session takes it up.** |
| 0:24 | Hold. | Hold. | — |

The pane redraws after a write in its own session or on `/emerald`, not when the toast rises
(M56 U1); that is why 0:18 asks for it. If the pane learns to redraw from the inbox's watch
before this is recorded, cut the `/emerald` and let the row appear with the toast.

## Clip 3 — a format declared in conversation, and its pane filling

`claude-format.mp4`, about 30 seconds.

| Time | In the chat | In the pane | Caption |
| --- | --- | --- | --- |
| 0:00 | *Keep a list of our endpoints: method, path, the version, and the unit that added it.* | The project. | **Something new to keep, said in a sentence.** |
| 0:06 | The model declares `endpoint` (method, path, version, added_by → unit): the dry run shows the plan, then `commit: true`. | Redraws after the write: the project, unchanged. | **It is declared: a real table, with real types.** |
| 0:14 | `/emerald show endpoint` | The `endpoint` format, empty. | — |
| 0:17 | *Add GET /v1/users and GET /v1/orders from M2 U1, and POST /v1/orders from M2 U3.* The model records the three rows. | The three rows arrive, the links to M2 U1 and M2 U3 shown by name. | **The pane fills as the rows are written.** |
| 0:27 | Hold. | Hold. | — |

Every value in the rows is one the prompt said (D-132, D-137): the model declares and maps, it
does not invent an endpoint.

## Putting them on the page

1. Cut each clip, no sound, H.264 MP4 at the window's size; under 4 MB each if it can be.
2. Take a poster frame from each: the clip's last held frame, saved as a PNG with the clip's name
   (`claude-pane.png` beside `claude-pane.mp4`). A visitor who asks for less motion sees the
   poster and nothing plays until they press play.
3. Put both files in `fixtures/synthetic/demo/`; the demo build copies them beside the page
   (`scripts/make-demo-document.mjs`), so the video is served by the page's own host and nothing
   leaves it (D-459).
4. Name the clip in `CLAUDE_RECORDINGS` in `src/demo/page/page.ts`. An empty name draws nothing:
   the page names no file it does not have, and `recordings.test.ts` fails when a named clip or
   its poster is missing from the fixtures.

The captions above are the page's too, under each clip, in `src/demo/page/copy/en.ts`
(`claude`); a caption burned into the video is the maintainer's choice and would repeat them.

## Rules the recordings keep

- **Nothing of a real project is in frame** — the rule above, and D-390.
- **The words follow the machinery-stays-invisible rule** (D-493): no caption says server, tool or
  drawing; the pane, the toast and the rows are what a person sees.
- **Nothing promises more than the plugin does**: the pane reads on its own only where `init`'s
  allow rules are (D-541), so the recordings are made after `init`, and the page says nothing
  about sessions without it.
- **A host Emerald runs inside may be named** (D-450): the window is Claude's.

## Open

- Whether clip 2's second project is shown at all, or the note is sent off screen and the clip
  starts at the toast (shorter, and the inbox diagram above already draws the sending).
- Which clip the terminal take is: clip 1 here, since the pane opening by itself is what looks
  most different in a terminal.
- Light or dark, as for the development recording.
