<!--
The development tour's project (M33 U6): a made-up project with nothing to
learn first — a service with a versioned API — kept in the development pack's formats. Each `## <format>` below
holds that format's rows as a text document writes them; scripts/make-demo-document.mjs
puts them under the pack's own declarations (src/data/packs/development/) to make
project.emd, so the pack is the one a real project keeps. Links are written by the
row's ref, as in docs/memory.emd. `## views` is the widths the decision and milestone
sheets' columns were dragged to, so each sheet fits the screen the tour lays the app out on.
-->

## decision

### D-1
date: 2026-09-02
milestone: M1
scope: app
title: Settings are read from the environment, never from a file in the repository
question: Where does the service read its settings from?
answer: From environment variables. A settings file in the repository ends up holding a password sooner or later.
state: live

### D-2
date: 2026-09-05
milestone: M1
scope: app
title: Every response is JSON, errors included
question: What does the API answer with?
answer: JSON, and an error in one shape every time (a code and a message), so a client reads one format.
state: live

### D-3
date: 2026-09-18
milestone: M2
scope: app
title: The version is in the path, /v1 and then /v2
question: How does a client say which version of the API it calls?
answer: In the path. A header is easy to forget, and a path shows in every log line.
state: live

### D-4
date: 2026-09-30
milestone: M2
scope: app
title: A published version never changes: fields are added, never renamed or removed
question: What may change in /v1 once clients call it?
answer: New fields, and nothing else. Renaming or removing a field breaks every client that reads it, and they upgrade when they choose to.
state: live

## milestone

### M1
title: First release
goal: The service runs, configured and answering.
state: closed
position: 1

### M2
title: Public API
goal: Other teams call /v1 and can rely on it.
state: open
position: 2

### M3
title: Monitoring
goal: We hear about an error before a user reports it.
state: planned
position: 3

## open_question

### How long is /v1 kept?
question: How long is /v1 kept once /v2 is out?
opened_by: D-3
state: open

## unit

### M1 U1
milestone: M1
scope: app
title: the service starts and reads its settings
landed: 2026-09-03
decision: D-1
state: built
taken_by: session 1
started: 2026-09-02

### M1 U2
milestone: M1
scope: app
title: every error answers in one JSON shape
landed: 2026-09-06
decision: D-2
state: built
taken_by: session 2
started: 2026-09-05

### M2 U1
milestone: M2
scope: app
title: the API answers under /v1
landed: 2026-09-19
decision: D-3
state: built
taken_by: session 4
started: 2026-09-18

### M2 U2
milestone: M2
scope: app
title: a test fails when a /v1 response loses or renames a field
landed: 2026-10-01
decision: D-4
state: built
blocks: ["M2 U1"]
taken_by: session 6
started: 2026-09-30

### M2 U3
milestone: M2
scope: app
title: requests are limited per client, and each response says how many are left
state: planned
brief: A client that sends too many requests in a minute is answered 429, with the time to wait. Every response says how many requests are left this minute.
blocks: ["M2 U2"]

### M2 U4
milestone: M2
scope: app
title: the API's reference page is generated from the code
state: planned
blocks: ["M2 U1"]

### M3 U1
milestone: M3
scope: app
title: an error is reported to the team as it happens
state: planned
blocks: ["M2 U3"]

## views

### decision
answer: 90
date: 92
milestone: 72
question: 90
ref: 56
scope: 56
state: 54
supersedes: 50
title: 190

### milestone
goal: 280
ref: 80
title: 140
