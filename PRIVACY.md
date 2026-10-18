<!-- moved from the README by M43 U7 (text by M43 U4).
     Its address is meant to stay put: registry and directory listings link it.
     If Emerald's page (M33 U8) ever takes a form post or a count, this file says so first:
     who processes it, how long it is kept, how to have it deleted, and that it sets no cookies. -->
# Privacy Policy

Emerald collects nothing, because there is nowhere for it to go: no server, no account, no
analytics, no telemetry, no crash reports, no update check.

- **The desktop app** opens the document you choose and writes that file, and the copies it keeps
  beside it before a change. On this machine it also keeps a list of the documents you opened
  recently, a copy of the open document to recover from a crash, and display preferences. None of
  it is sent anywhere.
- **It cannot make a request.** The desktop shell blocks every request that is not to the app's own
  files, `localhost` included ([`electron/network.ts`](./electron/network.ts)). The one exception
  is a model runtime on your own machine, reached on loopback from the main process, and only when
  you use one.
- **The MCP server** opens the `.emd` file a tool call names, keeps a backup copy beside it before
  it writes, and makes no network call; a test proves it. **What leaves your machine is what you,
  or the model, put into the conversation** — and that conversation is with the host and the model
  provider you chose, under their privacy policy, not this one.
- **The Claude plugin** runs that same server, published on npm as `emerald-mcp`. To install it
  and each new version, npm downloads the package from the npm registry — npm's request, under
  npm's privacy statement — and the plugin keeps a copy in the folder Claude Code gives it; after
  that it runs from the copy and makes no network call. Its hooks read the project's `.emd` and
  print to the session, and what they print stays on this machine until the conversation sends it.
- **Emerald's page and the demo** on this repository's Pages site — getemerald.dev, once it points
  there — load only their own files, set no cookies, and send nothing: the page carries no visit
  count and no form today, and offers an email address instead. If a form or a count is ever
  added, this policy says first who processes it, how long it is kept, how to have it deleted, and
  that it sets no cookies. GitHub hosts the site, and GitHub's own privacy statement covers what
  its servers log.

If any of this changes, this policy changes first.
