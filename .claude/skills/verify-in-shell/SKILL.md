---
name: verify-in-shell
description: Drive Emerald's Electron shell end to end from a session, over the Chrome DevTools Protocol, without a person clicking anything. Use when verifying anything in the desktop shell (electron/) — window chrome, the menu, document open/save, recents, the file picker, crash recovery, the app:// protocol — or when an Electron change needs proof it works. The Browser pane cannot drive the Electron window.
---

# Verifying the Electron shell

The Browser pane **cannot** drive the Electron window and refuses `file://` URLs. Attach over CDP
instead: it proves a shell unit actually works and costs a few lines of text instead of
screenshots.

## Kill the sessions' Electron first — every time, and never the person's

```bash
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"name='electron.exe'\" | Where-Object { \$_.CommandLine -like '*--remote-debugging-port*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue }"
```

**Only processes launched with `--remote-debugging-port`, which only a session does. Never
`Stop-Process -Name electron`:** a person's own Emerald window is an Electron process too, and
killing it loses whatever was not saved (it happened on 2026-10-09). That window does not get in
the way: the single-instance lock is per `--user-data-dir`, and every launch below uses a scratch one.

`child.kill()` on a `spawn(..., {shell: true})` kills the cmd wrapper, **not Electron**. A
leftover instance holds the single-instance lock ([`electron/main.ts:559`](../../../electron/main.ts)),
so the next launch quits immediately and your probe attaches to the **old build** — which looks
exactly like a change that did not take effect. This has burned whole sessions.

## Launch

Use PowerShell `Start-Process`, which returns immediately. Do **not** background the launch as a
Bash job — it holds the call open until the two-minute timeout.

```powershell
Start-Process -FilePath node_modules\electron\dist\electron.exe -ArgumentList ".","--remote-debugging-port=9222","--user-data-dir=<scratchpad>\ud" -WorkingDirectory F:\projects\financial-companion
```

**Launch in one call, probe in the next.** Never both in one Bash call.

`--user-data-dir` pointed at the scratchpad matters: each run then starts on a clean
`localStorage`, which is what keeps the crash-recovery `window.confirm` from firing (see below).

## Attach

Poll `http://127.0.0.1:9222/json/list` for the `page` target, open its `webSocketDebuggerUrl`
with Node's global `WebSocket`, and send `Runtime.evaluate` with `awaitPromise` and
`returnByValue`. Read state with `document.body.innerText`; drive with `querySelector(...).click()`.

**Write a small `cdp.mjs` in the scratchpad and do one round trip per Bash call** — something
taking `eval "<expr>"` or `files "<selector>" <paths...>`. The app stays running between calls, so
its state persists and the flow can be driven adaptively. That beats one long script, which
commits you to a plan before you know what the app will do.

Probe scripts live in the **scratchpad, never in the repo**.

## When it hangs — read this before suspecting your change

Three different causes present as "CDP opened and then answered nothing":

- **A blocking native dialog** (`showMessageBoxSync`) stalls all CDP traffic, because it blocks
  the main process. Usable as a signal: if an `invoke` stops answering right after you trigger a
  close, the modal is up.
- **A renderer `window.confirm` stalls it identically.** The crash-recovery prompt fires on the
  next launch after any probe that left a dirty document. Fix with a fresh `--user-data-dir`, or
  send `Page.enable` and answer `Page.javascriptDialogOpening` with `Page.handleJavaScriptDialog`.
- **Its other symptom is no window at all, and that one reads as a broken build.** `main.ts`
  creates the window with `show: false` ([`electron/main.ts:531`](../../../electron/main.ts)) and
  shows it on `ready-to-show` (:548); a confirm that blocks before first paint means
  `ready-to-show` never fires. If there is **no window and** CDP answers `Target.*` but not
  `Runtime.evaluate`, it is this — not your change. Most of a session on 2026-08-26 went to
  chasing a regression that wasn't one; `Get-Process electron | Select MainWindowHandle` was 0 on
  the *unmodified* build too.

## Gotchas that cost real time

- **A script that runs *under* Electron must be `.cjs`.** `app.whenReady()` never settles when the
  main entry is an ES module: no window, no error, no output, just a hang.
- **Electron's main-process `console.log` reaches nothing on Windows.** Write findings to a file.
- **A backgrounded probe's stdout does not stream** — `writeFileSync` results as you go.
- **`npx electron-builder` needs `System32` on PATH** from the Bash tool, or it dies with
  `spawn powershell.exe ENOENT` while collecting node modules.

## Driving a file picker with real files

`DOM.setFileInputFiles`. Get the input's `objectId` from `Runtime.evaluate` with
`returnByValue: false`, then send `DOM.setFileInputFiles` with `{objectId, files: [absolute
paths]}`. It fires `change`, so React sees it, and it accepts several paths for a `multiple`
input. This is how the fund-report stack was proven on real PDFs. Base64-ing a file into a
`DataTransfer` is unnecessary.

## Seeding state

- **Recents**: `<user-data-dir>/recents.json` ([`electron/main.ts:182`](../../../electron/main.ts)),
  and write the paths with **forward slashes**. A quoted heredoc with `C:\Users\…` reaches the file
  as single backslashes, which is invalid JSON — `decodeRecents` then correctly answers with an
  empty list, and the app looks broken when the fixture was.
- **The local model runtime** is switched on from `localStorage`, not the UI. The key is
  `fc-provider` ([`src/data/runtime/provider.ts:28`](../../../src/data/runtime/provider.ts)):

  ```js
  localStorage.setItem('fc-provider', JSON.stringify({ runtime: 'ollama', origin: 'http://127.0.0.1:11434', model: 'qwen3:30b-a3b' }))
  ```

  It is read once when a reader mounts, so set it **before** opening the flow rather than
  reloading — a reload on an unsaved document loses the document. Check what the machine actually
  has with `curl -s http://127.0.0.1:11434/api/tags` before assuming a model task can't be run
  here. It usually can.

## Never write to a real document

Real files are at `the real-documents folder` and are fine to read. Probes write to the scratchpad.
