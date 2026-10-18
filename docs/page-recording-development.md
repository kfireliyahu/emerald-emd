# The recording: the development pack in a conversation

The development pack's half of Emerald's page (M33 F11), beside the inbox diagram that plays
itself. **A proposal: the maintainer records it, and every word below can change.** 60 to 90
seconds, no voice-over needed; the captions carry it. The point is the one thing the diagram
cannot show: a coding agent working *from* the project's rows, and the view of them drawn in the
conversation.

## The rule before anything else

**Record on the demo's made-up project, never on `docs/memory.emd`.** Rows written before M47
still hold real document names, and a video on a public page would publish them. Copy
`dist-demo/project.emd` (built by `npm run build:demo`: a service with a versioned API, four
decisions, three milestones, one open question) to a folder outside the repository and record
on the copy. Anything else that shows on screen — the editor's file tree, a terminal, the window
title, another tab — must show nothing of a real project either: open the copy's folder alone.

## What is on screen

VS Code, one window: the chat with an agent on the right, nothing else open on the left, or the
copy of `project.emd` as text, which is what a text document is. The engine-only server is the
one configured (`node dist-plugin/server.mjs --engine-only` in the editor's MCP settings), so the
tool list the agent sees is the engine's alone.

## The shots

| Time | In the chat | What the frame draws | Caption |
| --- | --- | --- | --- |
| 0:00 | *What can I start on next?* The agent calls `start_here` on the copy. | The answer, and the milestone roadmap drawn in the conversation: M1 closed, M2 open with two units built and two planned, M3 ahead. | **The project says what is next. Not the chat's memory: the rows.** |
| 0:15 | *Rename the `/v1` field `user` to `owner`.* Before writing code, the agent searches the decisions. | — | **It asks the project before it builds.** |
| 0:25 | The agent answers that D-4 forbids it — a published version never changes: fields are added, never renamed — and offers to add `owner` beside `user` instead. | The decision row, D-4, as the tool returns it. | **A decision from weeks ago, still holding.** |
| 0:45 | *Do that, and write down why.* The agent records a decision row: the dry run first, then `commit: true`. | The new decision on the decision sheet. | **Every write is shown before it is made.** |
| 1:00 | *Show me the roadmap again.* | The roadmap, redrawn from the file. | **The next session starts from these rows, not from this chat.** |

An optional last shot, if the inbox belongs in the recording too: a second made-up document
(`create_document` with the development pack, *Shop website*), whose session writes a note into
`project.emd`'s inbox, and the first session's next prompt starting with it. The diagram above
the recording already says this, so it can be left out.

## Open

- Whether the recording is shown in light or dark; the page follows the visitor's theme, and one
  recording will match only one of them.
- **Recorded 2026-10-13** on a copy of the demo's project outside the repository, the
  first shot only: the question, the agent calling the server, and the roadmap drawn in the chat.
  Cut to 22 seconds (the folder-trust dialog and the model's routing taken out), no sound:
  `fixtures/synthetic/demo/development.mp4`, named in `DEVELOPMENT_RECORDING` in
  `src/demo/page/page.ts` and copied beside the page by the demo build. The rename shots are still
  to record if wanted.
- Whether the captions are burned into the video or written under it.
