---
name: set-up-a-project
description: Set a repository up to keep its planning in an Emerald document — run `npx emerald-mcp init` with the person and walk them through the choices it leaves to them — where the document lives (stored as text and committed, or one file outside every repository), the hooks that bring it into each session, and the status line. Use when they say "set up Emerald in this repo", "start a project document", "use Emerald for this project's planning", "init Emerald here", "add the Emerald hooks", "show the inbox in my status line", or when a repository they want to plan in has no .emd yet. If this session has no Emerald tools at all, the emerald-setup skill comes first.
---

# Setting a project up

**One command sets a repository up, and three choices are the person's.** `init` makes or finds
the document, tells every later session about it, and wires the hooks; where the document lives,
whether the hooks are needed, and whether a status line shows it are decisions, so ask them before
running it rather than letting the defaults decide.

## What `init` does

Run in the repository's folder:

```
npx -y emerald-mcp@0.3.1 init [path/to/document.emd]
```

1. **The document**: the one named; else the one `.claude/emerald.json` names; else the one `.emd`
   in the folder; else a new one in the repository's `docs` folder. A document that is not there is **created keeping the
   development pack**. One that is there is only read, and the answer says how it is stored and
   whether it lacks the pack (`keep_packs` adds it). `.claude/emerald.json` is written to name it,
   which is how the hooks find it.
2. **A marked section of `CLAUDE.md`**, between `<!-- emerald-init: … -->` and
   `<!-- /emerald-init -->`: the questions the document's `start_here` answers, and one line per
   format with its columns — so a session knows the columns without asking. Nothing outside the
   markers is touched.
3. **The two hooks**, merged into `.claude/settings.json` — only when the Emerald plugin is not
   enabled, since the plugin brings the same two. **And, plugin or not, an allow rule** in its
   `permissions.allow` for the plugin's own reads — `start_here`, `show_format` and `format_rows`.
   Claude Code asks the person before a plugin's code calls a tool, so until the rule exists the
   project pane beside the chat shows a Read button and asks once before it fills; with it the pane
   fills by itself at session start, and the inbox reaches the session without starting `npx`. It
   allows reads only: nothing that writes.
4. **What a session there now sees first**: `start_here` on the document.

**A second run changes nothing** that would come out the same. After a format changes, running it
again rewrites only the `CLAUDE.md` section. It writes files in their repository, so say what it
will write and run it when they agree.

## Choice 1: where the document lives

**Inside the repository, stored as text and committed** — `init` with a path inside the repository
(or none) does this.

- It diffs and merges in git like any file, so a plan change can be reviewed beside the code that
  made it.
- It is in every clone, worktree and cloud session, and reads as Markdown without Emerald.
- In a git worktree, the hooks read and write the main checkout's copy, so parallel sessions claim
  from the same rows; the worktree's own copy is not the one to commit.
- The cost: two branches that both wrote rows merge as text, and a conflict is resolved by hand.

**One file outside every repository, reached by its absolute path** — `init` with a path outside
the repository (`~/plans/work.emd`) does this, stored as SQLite bytes.

- **One document holds the work of several repositories**: each repository runs `init` with the
  same path. Never a document per repository when the work is one.
- Every session on the machine writes the same rows; a write takes a lock beside the file.
- The cost: it is in no git history, so back it up; a cloud session cannot reach it; and the path
  is this machine's.

The storage can change later: `store_document_as` turns a document to text or to bytes. Ask which
fits; a single repository a team reviews in pull requests is usually the first, one person's work
across several repositories usually the second.

**What to commit.** The `CLAUDE.md` section, yes — it is how a session learns the document. A
`.claude/emerald.json` with a relative path, yes. One holding an absolute path is this machine's:
each person runs `init` with their own path instead of sharing it.

## Choice 2: the hooks

At session start, `start_here` on the document; before each prompt, the inbox's new rows, each
printed in full once per session and then a one-line count. Both are silent in a folder with no
document.

- **With the Emerald plugin enabled**, the plugin runs them, and `init` writes none.
- **Without it**, `init` merges them into `.claude/settings.json`, pinned to the package's version.
  Committed, they run for everyone who opens the repository; a person who would rather not can keep
  them in their own `.claude/settings.local.json` instead.

If a hook printing the same thing is already there, `init` leaves it alone and says so.

## Choice 3: the status line

A strip under the prompt with the inbox's new rows and the units in progress. It costs the model
nothing — a hook's text is context, a status line's is not — and it is **the person's setting, not
the project's**: their own `~/.claude/settings.json`.

```json
"statusLine": { "type": "command", "command": "npx -y --prefer-offline -p emerald-mcp@0.3.1 emerald-status-line" }
```

A person has one status line. If they already have one, ask before replacing it. Through `npx` it
takes about two seconds to refresh.

## Then

Show what `init` printed, then call `start_here` on the document. A new document has no rows yet:
offer to bring in a plan they already have (the `bring-in-a-plan` skill), or to start from the
first milestone.

## What not to do

- **Do not run `init` before the person has chosen** where the document lives — the default is a
  file inside the repository.
- **Do not create a second document** when the work already has one elsewhere: point `init` at it.
- **Do not edit inside the `CLAUDE.md` markers** by hand; the next run writes over it. What they
  want said goes outside them.
- **Do not set the status line in the project's settings.** It is a person's, and a person has one.
