<!-- moved from the README by M43 U7 (text by M43 U4).
     Its address is meant to stay put: registry and directory listings link it.
     If Emerald's page (M33 U8) ever takes a form post or a count, this file says so first:
     who processes it, how long it is kept, how to have it deleted, and that it sets no cookies. -->
# Privacy Policy

The desktop app, the MCP server and the Claude plugin collect nothing, because there is nowhere for
it to go: no server, no account, no analytics, no telemetry, no crash reports, and no update check
unless you turn one on. **The Google Drive connector** is the one part of Emerald that runs on a
server, and [its own section](#the-google-drive-connector) below says everything it touches and the
little it keeps.

- **The desktop app** opens the document you choose and writes that file, and the copies it keeps
  beside it before a change. On this machine it also keeps a list of the documents you opened
  recently, a copy of the open document to recover from a crash, and display preferences. None of
  it is sent anywhere.
- **It cannot make a request.** The desktop shell blocks every request that is not to the app's own
  files, `localhost` included ([`electron/network.ts`](./electron/network.ts)). The exceptions
  are a model runtime on your own machine, reached on loopback from the main process, and only when
  you use one — and the update check below, only when you ask for it.
- **Updates, if you turn them on.** Off by default. With the setting on (in About), the desktop app
  asks GitHub (`api.github.com`) for Emerald's newest release when it starts and once a day after;
  Help → Check for Updates Now asks once, with the setting off too. GitHub sees your IP address,
  that the request comes from Emerald and which version, and when — under GitHub's privacy
  statement. Nothing else is sent. On a Mac nothing is downloaded: a newer version is a note in the
  window, and Download opens the release page in your browser. **On Windows, with the setting on**,
  a newer version is also downloaded from that release (`github.com/kfireliyahu/emerald-emd/releases/download/…`
  and the GitHub file store it redirects to, `release-assets.githubusercontent.com` or
  `objects.githubusercontent.com`), which see the same three things; it is installed only when you
  press Install and restart. With the setting off, nothing is ever downloaded. Your documents are
  never sent and never touched by an update.
- **The MCP server** opens the `.emd` file a tool call names, keeps a backup copy beside it before
  it writes, and makes no network call; a test proves it. **What leaves your machine is what you,
  or the model, put into the conversation** — and that conversation is with the host and the model
  provider you chose, under their privacy policy, not this one.
- **The Claude plugin** runs that same server, published on npm as `emerald-mcp`, through `npx`.
  The first time, and for each new version, npm downloads the package from the npm registry —
  npm's request, under npm's privacy statement — and keeps it in its own cache; after that it runs
  from the cache and makes no network call. Its hooks read the project's `.emd` and
  print to the session, and what they print stays on this machine until the conversation sends it.
- **Emerald's page and the demo** on this repository's Pages site — getemerald.dev, once it points
  there — load only their own files, set no cookies, and send nothing: the page carries no visit
  count and no form today, and offers an email address instead. If a form or a count is ever
  added, this policy says first who processes it, how long it is kept, how to have it deleted, and
  that it sets no cookies. GitHub hosts the site, and GitHub's own privacy statement covers what
  its servers log.

## The Google Drive connector

The Google Drive connector is Emerald's MCP server at `mcp.getemerald.dev`, for a chat that adds a
server only by its address — Claude on the web or on a phone, say. It is open to invited testers
first, and to anyone once Google has reviewed it. **It keeps no document: yours is a file in your
own Google Drive.**

- **Your document is in your Drive.** The first time you use it, the connector makes a folder
  `Emerald` in your Drive with one document in it, `Emerald.emd`, stored as text. It asks Google for
  the `drive.file` permission, which lets it see only the files it made or that you open with it —
  never the rest of your Drive.
- **It passes through on each call, and nothing of it is kept.** A call reads the document from
  your Drive, runs the tool, writes the document back if the tool changed it, and forgets it. If the
  document changed in your Drive since it was read, the write is refused and says so. The connector
  writes down no copy of the document, of what was asked, or of what a tool answered.
- **It offers Emerald's own tools, and no pack.** It works on formats and their rows; the ledger and
  the development pack are not offered there, and stay in the desktop app and the plugin on your
  machine.
- **Earlier copies are Drive's version history.** The connector makes no backups of its own; Drive
  keeps the earlier versions of the file, as it does for any file.
- **Signing in is Google's.** You sign in with Google. The token Google gives is handed to your
  chat app encrypted with a key only the connector holds, and the connector stores no token.
- **What it keeps is five fields per Google account, and nothing else**, in Google Cloud Firestore,
  to hold the cap of 200 calls a day and to count whether people come back:
  1. a one-way hash of your Google email address — not the address itself, and not your name;
  2. today's date, which is the last day you used it;
  3. how many calls you made today;
  4. the first day you used it;
  5. whether you used it again on a later day.

  Never a call, its arguments, a tool's name, a file's name, or anything from your document.
- **Deleting it.** A record nobody has used for 90 days deletes itself. To have yours deleted
  sooner, write to me@kfireliyahu.com from the Google address you use it with. To stop the connector reaching your Drive at all, remove
  Emerald from your Google account's third-party access; your document stays in your Drive, yours to
  keep, open in the desktop app, or delete.
- **Who else sees what.** Google runs the connector (Google Cloud) and holds your Drive, under
  Google's privacy policy. Google Cloud's request log records each request's time, the address it
  came from and whether it succeeded, kept for its default 30 days; it holds nothing of what was
  asked or of your document. Your chat app and its model see what goes into the conversation, under
  their privacy policy, as they do with the server on your machine.
- **If it closes.** The connector is switched off if fewer than five people use it on two different
  days within 30 days of it opening to everyone. Your document stays in your Drive, and the desktop
  app opens it.

If any of this changes, this policy changes first.
