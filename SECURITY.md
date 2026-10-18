# Security

Emerald has no server, no accounts and no hosted service, so there is nothing of ours to breach
and no data of yours that we hold. What can go wrong is on your machine: the desktop app, the MCP
server, and the documents they open. Those are what this policy covers.

## What counts

- The desktop app or the MCP server making a network request it should not — the app is built to
  make none, and the shell blocks every request that is not to its own files
  ([`electron/network.ts`](./electron/network.ts)).
- A `.emd` document, a `.format.md` declaration or a file read onto a format that makes Emerald run
  code, read or write a file it was not given, or escape the page's sandbox.
- A write that bypasses its dry run, its backup or a check the engine claims to enforce.
- Anything in this repository that should not be in it.

- **Text a model read out of a document is untrusted input.** A statement, a receipt or a note can
  carry words written to steer the model reading it (prompt injection). Where that text can make an
  Emerald tool do more than the tool says — write past its dry run, reach a file the call did not
  name, or make a request — that is in scope.

A model in a conversation doing something you did not want is the host's and the model's matter,
not this project's — unless an Emerald tool let it do more than the tool says.

## How to report

Write to **me@kfireliyahu.com** with what you did, what happened and the version
or commit. Please do not open a public issue for it first.
<!-- M43 U7: the next sentence is true once the maintainer turns on private vulnerability reporting
     in the public repository's settings (Security → Private vulnerability reporting). -->
GitHub's private vulnerability reporting works too: the repository's **Security** tab, then
**Report a vulnerability**. This is a project run by one person:
there is no promised response time and no bounty.

## Supported versions

Only the latest release and `main`. There are no backports.
