#!/usr/bin/env node
/**
 * **A stand-in for an MCP Apps host, on this machine** (M41 U1): see what
 * `show_format`'s frame draws without a client that draws MCP Apps.
 *
 * It plays both of a host's halves. Over stdio it is the MCP client a host is:
 * it starts the built server over stdio, as make-demo-document.mjs does, says in
 * `initialize` that it draws MCP Apps (the `io.modelcontextprotocol/ui`
 * extension), finds `show_format` and the `ui://` page its `_meta.ui` names in
 * `tools/list`, calls it, and reads the page. Then it writes one page,
 * `.frame-try/host.html`, that plays the host's other half in a browser: the
 * frame drawn in a sandboxed `srcdoc` iframe under the spec's default CSP,
 * `ui/initialize` answered with a host context, the tool's input and result
 * handed over as the spec's notifications, `size-changed` honoured, and every
 * message both ways logged under the frame, so a mismatch with a real host is
 * something to read rather than guess.
 *
 * **It replays one call**: the page holds the result it was written with and
 * reaches no server. The one call it answers is the frame's first `frame_copy`
 * (M41 F2), recorded when the page was written, since no result carries the
 * document any more; any other call the frame asks for is refused.
 * Nothing leaves the machine — the page is self-contained and its own CSP is
 * the frame's, so it could not fetch anything if it tried.
 *
 * **`--live` keeps the server** (M44 U4): this process stays up, serves the
 * page itself on 127.0.0.1, and passes the frame's `tools/call` and
 * `resources/subscribe` to the server and the server's
 * `notifications/resources/updated` back to the frame — what a host that
 * forwards them would do. `--no-push` plays a host that forwards the frame's
 * tool calls but refuses its subscription, which is the case the frame's
 * change check (`frame_copy`) is for. Either way it proves only our side: what
 * a real host forwards is unmeasured until one draws on this machine. The
 * page's own CSP then allows `connect-src 'self'` — the host is allowed its
 * server; the frame inside keeps the default `connect-src 'none'`. It prints
 * what the frame says in the host's log, and every notification it forwards.
 *
 * Usage:
 *   npm run build:plugin            (the frame is compiled into the server)
 *   npm run frame:try -- <absolute .emd path> <format> [--view=board] [--full] [--no-open]
 *   npm run frame:try -- <absolute .emd path> --start [--full] [--no-open]
 *
 *   --view=V    show_format's view: table (the default), board, roadmap, ready or agenda
 *   --start     call start_here instead, whose page is its picture (M41 U2)
 *   --full      start the server with the ledger's tools too (default: --engine-only)
 *   --no-open   write the page and print its path; do not open a browser
 *   --server=P  start the server at P instead of this checkout's dist-plugin/server.mjs —
 *               a copy installed elsewhere, to prove it draws from there (M41 U4)
 *   --live      stay up and be a host that forwards: tools/call, resources/subscribe, and
 *               notifications/resources/updated back to the frame (M44 U4)
 *   --no-push   with --live: forward tools/call but refuse resources/subscribe, so the
 *               frame falls back to its change check
 *   --port=N    with --live: serve the page on 127.0.0.1:N (default 4184)
 *   --no-ui     play a host that draws MCP Apps without advertising the extension in its
 *               initialize — VS Code's chat, once (M41 F2). The frame must draw all the same.
 *   --strip-meta  play a host that hands the frame every tools/call result without its
 *               _meta — the tool's result, and the answers to the frame's own calls — as
 *               VS Code's chat handed show_format's (M41 F3). The input still comes.
 *   --host-theme=H  play a host that sends its look in hostContext.styles (M41 F1): `vscode`,
 *               `vscode-light` or `vscode-dark` (the suffix sets the theme). The palettes are
 *               src/frame/hostThemes.json; the page's own colours take them too, so the frame
 *               sits on that surface. Without it the host sends a theme and no styles, which
 *               is the unthemed case. The page's "Host styles" menu switches between them.
 *               A `vscode` host leaves the frame's iframe with no colour scheme of its own, as
 *               VS Code's webview does, so a frame whose root scheme differs gets the
 *               browser's opaque backdrop there too (M41 F4).
 *   --no-hand-off  play a host that offers a view neither `ui/message` nor
 *               `ui/update-model-context` in its `ui/initialize` answer (M51 U7). By default
 *               this host offers both, and shows under the frame what each one carried: the
 *               lines the person sent and what the model is told — the conversation this page
 *               does not have.
 *   --display-modes=M  play a host that offers these display modes, comma-separated, of
 *               inline, fullscreen and pip (M42 T1). By default it offers inline only, as
 *               before. Asked for one it offers, it floats the frame in a corner (pip) or
 *               fills the window with it (fullscreen) and says so in host-context-changed.
 *   --no-styles with --host-theme: the host's page wears that palette, but its hostContext
 *               carries the theme alone and no styles — a host that names no surface
 *               (M41 F4). The frame must still draw no panel of its own.
 *
 * The page opens as a file, or `.claude/launch.json`'s `frame-try` serves the
 * folder on 127.0.0.1:4183 for the Browser pane.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer as createHttpServer } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  CallToolResultSchema,
  EmptyResultSchema,
  ListResourcesResultSchema,
  ReadResourceResultSchema,
  ResourceUpdatedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverArg = process.argv.slice(2).find((arg) => arg.startsWith("--server="))?.slice("--server=".length);
const SERVER = serverArg !== undefined ? path.resolve(serverArg) : path.join(REPO, "dist-plugin", "server.mjs");
const OUT = path.join(REPO, ".frame-try");

// The spec's names, as `src/frame/contract.ts` has them (this runs in plain
// Node and cannot import TypeScript).
const APP_MIME = "text/html;profile=mcp-app";
const UI_EXTENSION = "io.modelcontextprotocol/ui";

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const view = args.find((arg) => arg.startsWith("--view="))?.slice("--view=".length);
const start = flags.has("--start");
const live = flags.has("--live");
const push = live && !flags.has("--no-push");
const advertises = !flags.has("--no-ui");
const stripMeta = flags.has("--strip-meta");
const handOff = !flags.has("--no-hand-off");
const displayModes = (args.find((arg) => arg.startsWith("--display-modes="))?.slice("--display-modes=".length) ?? "inline")
  .split(",")
  .filter((mode) => ["inline", "fullscreen", "pip"].includes(mode));
if (!displayModes.includes("inline")) displayModes.unshift("inline");
/** A result as a host that drops `_meta` hands it on (M41 F3). */
const handedOn = (result) => {
  if (!stripMeta || result === undefined || result === null) return result;
  const { _meta, ...rest } = result;
  return rest;
};
const port = Number(args.find((arg) => arg.startsWith("--port="))?.slice("--port=".length) ?? 4184);
const TOOL = start ? "start_here" : "show_format";
// The looks a host can send (M41 F1), shared with src/frame/hostStyle.test.ts.
const HOST_THEMES = JSON.parse(readFileSync(path.join(REPO, "src", "frame", "hostThemes.json"), "utf8"));
const hostThemeArg = args.find((arg) => arg.startsWith("--host-theme="))?.slice("--host-theme=".length);
const [hostStyles, hostScheme] = hostThemeArg === undefined ? [] : hostThemeArg.split(/-(?=light$|dark$)/);
const bare = flags.has("--no-styles");
if (hostStyles !== undefined && HOST_THEMES[hostStyles] === undefined) {
  console.error(`No host theme ${hostStyles}. Known: ${Object.keys(HOST_THEMES).join(", ")} (with -light or -dark).`);
  process.exit(2);
}
const [documentArg, format] = args.filter((arg) => !arg.startsWith("--"));
if (documentArg === undefined || (format === undefined && !start)) {
  console.error(
    "Usage: npm run frame:try -- <absolute .emd path> <format> [--view=board] [--full] [--no-open]\n" +
      "       npm run frame:try -- <absolute .emd path> --start [--full] [--no-open]",
  );
  process.exit(2);
}
const document = path.resolve(documentArg);
if (!existsSync(document)) {
  console.error(`No file at ${document}.`);
  process.exit(2);
}
if (!existsSync(SERVER)) {
  console.error(
    `No built server at ${SERVER}. Run \`npm run build:plugin\` first: the frame is compiled into it.`,
  );
  process.exit(2);
}
const frameSource = path.join(REPO, ".frame", "frame.html");
if (
  existsSync(frameSource) &&
  statSync(frameSource).mtimeMs > statSync(SERVER).mtimeMs
) {
  console.warn(
    "Note: .frame/frame.html is newer than dist-plugin/server.mjs — the server may carry an older frame.",
  );
}

// Called at the foot of the file, once the host page below is defined.
async function main() {
  const full = flags.has("--full");
  const client = new Client(
    { name: "emerald-frame-try", version: "1" },
    // What a host that draws MCP Apps says it can do (SEP-1865) — or, with
    // --no-ui, nothing: a host that draws without saying so (M41 F2).
    {
      capabilities: advertises ? { extensions: { [UI_EXTENSION]: { mimeTypes: [APP_MIME] } } } : {},
    },
  );
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: full ? [SERVER] : [SERVER, "--engine-only"],
      stderr: "inherit",
    }),
  );

  try {
    const server = client.getServerVersion();
    const { tools } = await client.listTools();
    const tool = tools.find((one) => one.name === TOOL);
    if (tool === undefined)
      throw new Error(
        `The server offers no ${TOOL}. Is dist-plugin/ older than M41 U1?`,
      );
    // `_meta.ui.resourceUri`, or the flat key an earlier draft of the spec used.
    const uri = tool._meta?.ui?.resourceUri ?? tool._meta?.["ui/resourceUri"];
    if (typeof uri !== "string" || !uri.startsWith("ui://"))
      throw new Error(`${TOOL} names no ui:// resource in its _meta.ui.`);

    const toolArguments = start
      ? { path: document }
      : { path: document, format, ...(view === undefined ? {} : { view }) };
    const result = await client.callTool({
      name: TOOL,
      arguments: toolArguments,
    });
    const read = await client.readResource({ uri });
    const page =
      read.contents.find((one) => one.uri === uri) ?? read.contents[0];
    if (page === undefined || typeof page.text !== "string")
      throw new Error(`${uri} came back with no HTML text.`);

    const carried = result._meta?.["emerald/sheet"];
    // The key the server wrote into the page (M41 F3): what the frame presents
    // to frame_copy, read here as the frame reads it.
    const key = /<meta name="emerald-frame-key" content="([^"]+)"/.exec(page.text)?.[1];
    // The frame's first frame_copy, recorded for the replay (M41 F2): no result
    // carries the document, so a replayed page needs this one answer to draw.
    // Asked as the frame asks it: the path from the call's input, the key from the page.
    const firstCopy =
      !live && key !== undefined && !result.isError
        ? handedOn(await client.callTool({ name: "frame_copy", arguments: { path: document, key } }))
        : undefined;
    console.log(
      `${server?.name ?? "server"} ${server?.version ?? ""}${full ? "" : " (--engine-only)"}; ` +
        (advertises ? `this host advertises ${UI_EXTENSION}` : `this host does not advertise ${UI_EXTENSION} (--no-ui)`) +
        (stripMeta ? "; it hands the frame results without their _meta (--strip-meta)" : "") +
        (handOff ? "; it offers ui/message and ui/update-model-context" : "; it offers neither ui/message nor ui/update-model-context (--no-hand-off)"),
    );
    console.log(
      `${TOOL} → ${uri} (${page.mimeType ?? "no mime type"}, ${Math.round(page.text.length / 1024)} KB)`,
    );
    // What a model reads (the text) beside what only the frame is handed.
    const said = (result.content ?? []).map((part) => part.text ?? "").join("");
    const metaSize = JSON.stringify(result._meta ?? {}).length;
    console.log(
      `result: ${result.isError ? "an error" : "ok"}; text ${said.length} B; _meta ${metaSize} B; ` +
        (carried ? `names ${carried.name} (view ${carried.view ?? "sheet"}) — no copy, no key` : "no document named in _meta") +
        `; the page ${key === undefined ? "carries no key" : "carries the server's key"}`,
    );
    if (carried?.bytes !== undefined) console.warn("Note: the result carries the document's bytes — a server older than M41 F2.");
    if (page.mimeType !== APP_MIME)
      console.warn(
        `Note: served as ${page.mimeType}, not ${APP_MIME} — a host may refuse to draw it.`,
      );
    if (!carried && !full && !result.isError)
      console.warn(
        "Note: no document came with the answer. A ledger format may need --full.",
      );

    const data = {
      written: new Date().toISOString(),
      server: {
        ...server,
        engineOnly: !full,
        protocolVersion: client.transport?.protocolVersion,
      },
      serverCapabilities: client.getServerCapabilities(),
      tool,
      toolArguments,
      label: start ? "start_here" : `${TOOL}(${JSON.stringify(format)}${view ? `, ${view}` : ""})`,
      // Every tool the server listed to this host, the frame's own among them,
      // so the page can refuse a frame's call to one not visible to an app.
      tools,
      live: live ? { push } : undefined,
      firstCopy,
      advertises,
      stripMeta,
      handOff,
      displayModes,
      hostThemes: HOST_THEMES,
      host: { styles: hostStyles === undefined ? "none" : bare ? `${hostStyles}:bare` : hostStyles, scheme: hostScheme ?? "system" },
      // What the frame is handed: without its _meta under --strip-meta.
      result: handedOn(result),
      resource: {
        uri,
        mimeType: page.mimeType,
        meta: page._meta ?? {},
        html: page.text,
      },
    };
    mkdirSync(OUT, { recursive: true });
    const target = path.join(OUT, "host.html");
    // `<` escaped so nothing in the frame's own HTML can close the data block.
    const html = HOST_PAGE.replace("__CSP__", live ? "'self'" : "'none'").replace("__DATA__", () =>
      JSON.stringify(data).replace(/</g, "\\u003c"),
    );
    writeFileSync(target, html);
    if (live) {
      await serveLive(client, html);
      return;
    }
    console.log(`\nWrote ${target}`);
    console.log(
      `Open ${pathToFileURL(target).href}, or serve it: launch.json's frame-try (http://127.0.0.1:4183/host.html).`,
    );
    if (!flags.has("--no-open")) openInBrowser(target);
  } finally {
    if (!live) await client.close();
  }
}

/**
 * The host's other half, kept up (M44 U4): the page on 127.0.0.1, `POST /mcp`
 * for what the frame asks the server through the host, and `GET /events` for
 * what the server says back. Stays up until Ctrl+C.
 */
async function serveLive(client, html) {
  const listeners = new Set();
  const say = (line) => console.log(`${new Date().toISOString().slice(11, 23)}  ${line}`);
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
    say(`server → host: notifications/resources/updated ${notification.params.uri}${push ? " (forwarded to the frame)" : ""}`);
    const event = `data: ${JSON.stringify({ method: notification.method, params: notification.params })}\n\n`;
    for (const listener of listeners) listener.write(event);
  });
  // What this host passes on, and the schema each answer is read with.
  const FORWARDS = {
    "tools/call": CallToolResultSchema,
    "resources/read": ReadResourceResultSchema,
    "resources/list": ListResourcesResultSchema,
    ...(push ? { "resources/subscribe": EmptyResultSchema, "resources/unsubscribe": EmptyResultSchema } : {}),
  };
  const body = (request) =>
    new Promise((resolve, reject) => {
      let text = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => (text += chunk));
      request.on("end", () => resolve(text));
      request.on("error", reject);
    });
  const server = createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/host.html")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(html);
      return;
    }
    if (request.method === "GET" && url.pathname === "/events") {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      response.write(": open\n\n");
      listeners.add(response);
      request.on("close", () => listeners.delete(response));
      return;
    }
    if (request.method === "POST" && url.pathname === "/note") {
      say(`frame says: ${await body(request)}`);
      response.writeHead(204).end();
      return;
    }
    if (request.method === "POST" && url.pathname === "/mcp") {
      const { method, params } = JSON.parse(await body(request));
      const schema = FORWARDS[method];
      response.writeHead(200, { "content-type": "application/json" });
      if (schema === undefined) {
        say(`frame → host: ${method}, refused`);
        response.end(JSON.stringify({ error: { code: -32601, message: `This host does not forward ${method}.` } }));
        return;
      }
      const asked = performance.now();
      try {
        const result = await client.request({ method, params }, schema);
        const size = JSON.stringify(result).length;
        say(
          `frame → host → server: ${method}${method === "tools/call" ? ` ${params?.name}` : ` ${params?.uri ?? ""}`}, ` +
            `answered in ${Math.round(performance.now() - asked)} ms, ${size < 2048 ? `${size} B` : `${Math.round(size / 1024)} KB`}`,
        );
        response.end(JSON.stringify({ result }));
      } catch (error) {
        say(`frame → host → server: ${method}, failed: ${error.message}`);
        response.end(JSON.stringify({ error: { code: error.code ?? -32603, message: error.message } }));
      }
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = `http://127.0.0.1:${port}/host.html`;
  console.log(
    `\nLive: ${push ? "a host that forwards resources/subscribe and notifications/resources/updated" : "a host that forwards tools/call and refuses resources/subscribe (--no-push)"}.`,
  );
  console.log(`Open ${address} — Ctrl+C stops it.`);
  if (!flags.has("--no-open")) openInBrowser(address);
  const stop = async () => {
    for (const listener of listeners) listener.end();
    server.close();
    await client.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

function openInBrowser(file) {
  const [command, rest] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", '""', `"${file}"`]]
      : process.platform === "darwin"
        ? ["open", [file]]
        : ["xdg-open", [file]];
  spawn(command, rest, {
    detached: true,
    stdio: "ignore",
    windowsVerbatimArguments: process.platform === "win32",
  }).unref();
}

/* ------------------------------------------------------------------------- *
 * The host page. Plain JavaScript, inline, no request of its own.
 * ------------------------------------------------------------------------- */
const HOST_PAGE = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<!-- The host page's own CSP is the frame's default, so the srcdoc frame (which
     inherits it) runs under exactly the policy a host would give it, and the
     page itself can reach nothing. -->
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; connect-src __CSP__">
<title>Frame try</title>
<style>
  :root { --bg: #f6f6f4; --panel: #ffffff; --ink: #1d1d1b; --muted: #6b6b66; --line: #dcdcd6; --in: #0d6e4f; --out: #3a55a4; --bad: #b3261e; color-scheme: light; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #161615; --panel: #1f1f1d; --ink: #ececea; --muted: #9a9a94; --line: #34342f; --in: #5fc39b; --out: #8ea6ef; --bad: #f28b82; color-scheme: dark; } }
  :root[data-theme="dark"] { --bg: #161615; --panel: #1f1f1d; --ink: #ececea; --muted: #9a9a94; --line: #34342f; --in: #5fc39b; --out: #8ea6ef; --bad: #f28b82; color-scheme: dark; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 13px/1.45 system-ui, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; padding: 16px; }
  header { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: baseline; margin-bottom: 12px; }
  header h1 { font-size: 15px; margin: 0; }
  header .meta { color: var(--muted); }
  .bar { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 12px; align-items: center; }
  button, select { font: inherit; color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 3px 10px; }
  .turn { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 12px; }
  .turn > p { margin: 0 0 8px; color: var(--muted); }
  iframe { display: block; width: 100%; height: 120px; border: 0; background: transparent; }
  iframe.border { border: 1px solid var(--line); border-radius: 8px; }
  /* The two display modes a host may offer besides inline (M42 T1): a corner that stays put while
     the page scrolls, and the whole window. The height the frame asks for does not apply. */
  iframe.pip { position: fixed; right: 16px; bottom: 16px; width: 420px !important; height: 320px !important; z-index: 10;
    border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 8px 28px rgba(0,0,0,.25); background: var(--panel); }
  iframe.fullscreen { position: fixed; inset: 0; width: 100vw !important; height: 100vh !important; z-index: 10; background: var(--panel); }
  h2 { font-size: 13px; margin: 16px 0 6px; }
  #log { font: 12px/1.4 ui-monospace, Consolas, monospace; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; max-height: 360px; overflow: auto; }
  #log details { border-bottom: 1px solid var(--line); padding: 3px 8px; }
  #log summary { cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #log pre { margin: 4px 0; white-space: pre-wrap; word-break: break-all; color: var(--muted); }
  .in { color: var(--in); } .out { color: var(--out); } .bad { color: var(--bad); font-weight: 600; } .t { color: var(--muted); }
  #conversation { border: 1px solid var(--line); border-radius: 6px; padding: 8px 12px; background: var(--panel); }
  #conversation h3 { font-size: 12px; margin: 10px 0 4px; }
  #sent li, #context { white-space: pre-wrap; font: 12px/1.4 ui-monospace, Consolas, monospace; margin: 0 0 6px; }
  #text { white-space: pre-wrap; font: 12px/1.4 ui-monospace, Consolas, monospace; color: var(--muted); max-height: 200px; overflow: auto; }
</style>
</head>
<body>
<main>
  <header>
    <h1>MCP Apps host stand-in</h1>
    <span class="meta" id="meta"></span>
  </header>
  <div class="bar">
    <label>Theme <select id="theme"><option value="system">follow the system</option><option value="light">light</option><option value="dark">dark</option></select></label>
    <label>Host styles <select id="styles"><option value="none">none (unthemed)</option></select></label>
    <button id="replay">Draw again</button>
    <button id="teardown">Send ui/resource-teardown</button>
    <button id="cancel">Draw, then cancel the call</button>
    <span class="t" id="size"></span>
  </div>
  <div class="turn">
    <p id="said"></p>
    <iframe id="frame" title="The MCP App" sandbox="allow-scripts"></iframe>
  </div>
  <h2>The conversation <span class="t">— what the frame handed it (M51 U7): ui/message and ui/update-model-context</span></h2>
  <div id="conversation">
    <p class="t" id="offered"></p>
    <h3>Sent as the person <span class="t">(ui/message)</span></h3>
    <ol id="sent"><li class="t">nothing yet</li></ol>
    <h3>What the model is told <span class="t">(ui/update-model-context, each replacing the last)</span></h3>
    <pre id="context" class="t">nothing yet</pre>
  </div>
  <h2>Messages <span class="t">— host → frame in blue, frame → host in green, anything a real host would trip on in red</span></h2>
  <div id="log"></div>
  <h2>The text the model reads</h2>
  <details><summary class="t">content[0].text</summary><div id="text"></div></details>
</main>
<script type="application/json" id="data">__DATA__</script>
<script>
(() => {
  'use strict'
  const data = JSON.parse(document.getElementById('data').textContent)
  const PROTOCOL_VERSION = '2026-01-26'
  const frame = document.getElementById('frame')
  const log = document.getElementById('log')
  const uiMeta = (data.resource.meta && data.resource.meta.ui) || {}

  document.getElementById('meta').textContent =
    (data.server.name || 'server') + ' ' + (data.server.version || '') + (data.server.engineOnly ? ' --engine-only' : '') +
    (data.live ? (data.live.push ? ' · live: forwards subscriptions' : ' · live: refuses subscriptions') : ' · replay') +
    (data.advertises === false ? ' · does not advertise MCP Apps' : ' · advertises MCP Apps') +
    ' · ' + data.label + ' · ' + data.resource.uri + ' · written ' + data.written
  document.getElementById('said').textContent = 'The assistant called ' + data.tool.name + ' on ' + data.toolArguments.path + '.'
  document.getElementById('text').textContent = ((data.result.content || [])[0] || {}).text || '(no text)'
  if (uiMeta.prefersBorder === true) frame.classList.add('border')
  document.getElementById('offered').textContent = data.handOff
    ? 'This host offers both in its ui/initialize answer (hostCapabilities.message, .updateModelContext).'
    : 'This host offers neither (--no-hand-off): the frame must look as it did before M51 U7.'

  // ---- the log ------------------------------------------------------------
  const started = performance.now()
  const elide = (value) => JSON.stringify(value, (key, v) => (typeof v === 'string' && v.length > 240 ? v.slice(0, 120) + '… (' + v.length + ' chars)' : v), 2)
  function entry(direction, message, problem) {
    const row = document.createElement('details')
    const summary = document.createElement('summary')
    const time = document.createElement('span')
    time.className = 't'
    time.textContent = ((performance.now() - started) / 1000).toFixed(2).padStart(6) + 's '
    const arrow = document.createElement('span')
    arrow.className = direction === 'out' ? 'out' : direction === 'in' ? 'in' : 't'
    arrow.textContent = direction === 'out' ? 'host → frame ' : direction === 'in' ? 'frame → host ' : 'host        '
    const what = document.createElement('span')
    const m = message || {}
    what.textContent =
      m.method !== undefined ? m.method + (m.id !== undefined ? ' #' + m.id : '') : m.id !== undefined ? (m.error ? 'error' : 'result') + ' #' + m.id : String(m.note || '')
    summary.append(time, arrow, what)
    if (problem) {
      const bad = document.createElement('span')
      bad.className = 'bad'
      bad.textContent = '  ' + problem
      summary.append(bad)
      row.open = true
    }
    const body = document.createElement('pre')
    body.textContent = m.note !== undefined && Object.keys(m).length === 1 ? '' : elide(m)
    row.append(summary, body)
    log.append(row)
    log.scrollTop = log.scrollHeight
  }
  const note = (text, problem) => entry('host', { note: text }, problem)

  // ---- the host's side of the protocol --------------------------------------
  let initialized = false
  let initializeSeen = false
  let displayMode = 'inline'
  let cancelling = false
  let next = 1
  let sizes = []
  const post = (message) => {
    entry('out', message)
    frame.contentWindow.postMessage(message, '*')
  }
  const respond = (id, result) => post({ jsonrpc: '2.0', id, result })
  const fail = (id, code, message) => post({ jsonrpc: '2.0', id, error: { code, message } })
  const notify = (method, params) => post({ jsonrpc: '2.0', method, params })

  const themeChoice = document.getElementById('theme')
  const stylesChoice = document.getElementById('styles')
  for (const name of Object.keys(data.hostThemes || {})) {
    stylesChoice.add(new Option(name, name))
    stylesChoice.add(new Option(name + ' (theme only)', name + ':bare'))
  }
  stylesChoice.value = data.host ? data.host.styles : 'none'
  themeChoice.value = data.host ? data.host.scheme : 'system'
  const dark = matchMedia('(prefers-color-scheme: dark)')
  const theme = () => (themeChoice.value === 'system' ? (dark.matches ? 'dark' : 'light') : themeChoice.value)
  // The host's look (M41 F1): the standard variables a themed host sends, or none.
  // The host's own page wears its palette; ':bare' (--no-styles, M41 F4) sends the frame the theme alone.
  const palette = () => (stylesChoice.value === 'none' ? undefined : data.hostThemes[stylesChoice.value.split(':')[0]][theme()])
  const variables = () => (stylesChoice.value.endsWith(':bare') ? undefined : palette())
  const applyTheme = () => {
    if (themeChoice.value === 'system') delete document.documentElement.dataset.theme
    else document.documentElement.dataset.theme = themeChoice.value
    // A themed host's page is its surface: the frame's turn is drawn on it.
    const own = document.documentElement.style
    const vars = palette()
    // VS Code's webview declares no colour scheme, so its frame's element has none (M41 F4).
    frame.style.colorScheme = stylesChoice.value.startsWith('vscode') ? 'normal' : ''
    const map = { '--panel': '--color-background-primary', '--bg': '--color-background-secondary', '--ink': '--color-text-primary', '--muted': '--color-text-secondary', '--line': '--color-border-secondary' }
    for (const [mine, theirs] of Object.entries(map)) {
      if (vars && vars[theirs]) own.setProperty(mine, vars[theirs])
      else own.removeProperty(mine)
    }
    own.colorScheme = vars ? theme() : ''
    if (vars && vars['--font-sans']) document.body.style.fontFamily = vars['--font-sans']
    else document.body.style.fontFamily = ''
  }

  function hostContext() {
    return {
      toolInfo: { tool: data.tool },
      theme: theme(),
      ...(variables() ? { styles: { variables: variables() } } : {}),
      displayMode: displayMode,
      availableDisplayModes: data.displayModes,
      containerDimensions: { maxWidth: Math.round(frame.parentElement.clientWidth), maxHeight: 6000 },
      locale: navigator.language,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      userAgent: 'emerald-frame-try/1',
      platform: 'desktop',
      deviceCapabilities: { touch: false, hover: true },
    }
  }

  function onRequest(message) {
    const { id, method, params } = message
    switch (method) {
      case 'ui/initialize':
        initializeSeen = true
        if (!params || typeof params.protocolVersion !== 'string') note('ui/initialize carries no protocolVersion', 'spec: params.protocolVersion is required')
        if (!params || typeof params.appInfo !== 'object') note('ui/initialize carries no appInfo', 'spec: params.appInfo is required')
        if (!params || typeof params.appCapabilities !== 'object') note('ui/initialize carries no appCapabilities', 'spec: params.appCapabilities is required')
        respond(id, {
          protocolVersion: PROTOCOL_VERSION,
          hostInfo: { name: 'emerald-frame-try', version: '1' },
          hostCapabilities: Object.assign(
            { openLinks: {}, logging: {}, sandbox: { csp: uiMeta.csp || {} } },
            // The spec's two for a host that passes calls and reads on (M44 U4).
            // It names no capability for a subscription: a frame learns that
            // by asking.
            data.live ? { serverTools: {}, serverResources: {} } : {},
            // The spec's two for a view that talks to the conversation (M51 U7).
            data.handOff ? { message: { text: {} }, updateModelContext: { text: {} } } : {},
          ),
          hostContext: hostContext(),
        })
        return
      case 'ping':
        respond(id, {})
        return
      case 'ui/request-display-mode': {
        // The host decides (spec): a mode it offers is set, any other leaves the current one.
        const asked = params && params.mode
        if (data.displayModes.includes(asked) && asked !== displayMode) {
          displayMode = asked
          frame.classList.toggle('pip', asked === 'pip')
          frame.classList.toggle('fullscreen', asked === 'fullscreen')
          respond(id, { mode: displayMode })
          notify('ui/notifications/host-context-changed', { displayMode })
        } else {
          if (!data.displayModes.includes(asked)) note('the frame asked for display mode ' + asked, 'this host does not offer it')
          respond(id, { mode: displayMode })
        }
        return
      }
      case 'ui/open-link':
        // Logged, not acted on: this page opens nothing.
        respond(id, {})
        return
      case 'ui/message':
      case 'ui/update-model-context': {
        // Shown, as the conversation would take them (M51 U7) — or refused,
        // as a host that does not offer them would (--no-hand-off).
        if (!data.handOff) {
          fail(id, -32601, 'This host does not take ' + method + ' (--no-hand-off).')
          note('the frame sent ' + method, 'this host did not offer it')
          return
        }
        const texts = ((params && params.content) || []).map((part) => part.text || '').join('\n')
        if (method === 'ui/message') {
          if (!params || params.role !== 'user') note('ui/message without role user', 'spec: params.role is "user"')
          const sent = document.getElementById('sent')
          if (sent.querySelector('.t')) sent.textContent = ''
          const item = document.createElement('li')
          item.textContent = texts
          sent.append(item)
        } else {
          document.getElementById('context').textContent = texts === '' ? '(cleared)' : texts
        }
        respond(id, {})
        return
      }
      case 'tools/call':
      case 'resources/read':
      case 'resources/list':
      case 'resources/subscribe':
      case 'resources/unsubscribe':
        if (method === 'tools/call') {
          // The spec's MUST: an app calls only a tool whose visibility has "app".
          const tool = (data.tools || []).find((one) => one.name === (params && params.name))
          const visibility = (tool && tool._meta && tool._meta.ui && tool._meta.ui.visibility) || ['model', 'app']
          if (tool === undefined || !visibility.includes('app')) {
            fail(id, -32602, 'The frame may not call ' + (params && params.name) + '.')
            note('the frame called ' + (params && params.name), 'spec: a host rejects a call to a tool not visible to the app')
            return
          }
        }
        if (!data.live) {
          // The one recorded call (M41 F2): the frame's first fetch of its document.
          const args = (params && params.arguments) || {}
          if (method === 'tools/call' && params.name === 'frame_copy' && data.firstCopy && args.since === undefined) {
            respond(id, data.firstCopy)
            return
          }
          fail(id, -32601, 'This stand-in replays one recorded call and reaches no server.')
          return
        }
        if ((method === 'resources/subscribe' || method === 'resources/unsubscribe') && !data.live.push) {
          fail(id, -32601, 'This host does not forward ' + method + ' (--no-push).')
          return
        }
        forward(id, method, params)
        return
      default:
        fail(id, -32601, 'Method not found: ' + method)
        note('the frame asked for ' + method, 'not a View → Host request in the spec')
    }
  }

  function onNotification(message) {
    switch (message.method) {
      case 'ui/notifications/initialized':
        if (initialized) note('initialized said twice', 'spec: once per frame')
        initialized = true
        // The spec's order: input, then the result, both after initialized —
        // or, when the person cancelled, tool-cancelled and no result at all.
        notify('ui/notifications/tool-input', { arguments: data.toolArguments })
        if (cancelling) notify('ui/notifications/tool-cancelled', { reason: 'the person stopped the call' })
        else notify('ui/notifications/tool-result', data.result)
        return
      case 'ui/notifications/size-changed': {
        const { width, height } = message.params || {}
        if (!initialized) note('size-changed before initialized')
        const now = performance.now()
        sizes = sizes.filter((t) => now - t < 2000).concat(now)
        if (sizes.length > 30) note(sizes.length + ' size changes in 2s', 'a resize loop: the frame keeps asking as the host obeys')
        // The way the spec's reference host honours it: the height as asked,
        // the width as a floor no wider than the container.
        if (typeof height === 'number') frame.style.height = Math.ceil(height) + (frame.classList.contains('border') ? 2 : 0) + 'px'
        if (typeof width === 'number') frame.style.minWidth = 'min(' + Math.ceil(width) + 'px, 100%)'
        document.getElementById('size').textContent = 'frame asked for ' + width + ' × ' + height
        return
      }
      case 'notifications/message': {
        // What the frame says in the host's log — which way it chose to stay
        // live (M44 U4) — shown on the line, and said to the terminal.
        const said = message.params && message.params.data
        if (typeof said === 'string') {
          note('frame: ' + said)
          if (data.live) fetch('/note', { method: 'POST', body: said }).catch(() => undefined)
        }
        return
      }
      default:
        note('the frame said ' + message.method, 'not a View → Host notification in the spec')
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== frame.contentWindow) return
    const message = event.data
    const shaped = typeof message === 'object' && message !== null && message.jsonrpc === '2.0'
    entry('in', message, shaped ? undefined : 'not JSON-RPC 2.0')
    if (!shaped) return
    if (message.method === undefined) return // an answer, to the teardown
    if (message.id !== undefined) onRequest(message)
    else onNotification(message)
  })

  // ---- the server, when this host forwards (M44 U4) ----------------------------
  const subscribed = new Set()
  function forward(id, method, params) {
    fetch('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, params }) })
      .then((response) => response.json())
      .then((answer) => {
        if (answer.error) return fail(id, answer.error.code || -32603, answer.error.message)
        // --strip-meta (M41 F3): a host that drops _meta on the way to a view.
        if (data.stripMeta && method === 'tools/call' && answer.result) delete answer.result._meta
        if (method === 'resources/subscribe') subscribed.add(params.uri)
        if (method === 'resources/unsubscribe') subscribed.delete(params.uri)
        respond(id, answer.result)
      })
      .catch((error) => fail(id, -32603, 'The stand-in lost its server: ' + error.message))
  }
  if (data.live) {
    const events = new EventSource('/events')
    events.onmessage = (event) => {
      const said = JSON.parse(event.data)
      const uri = said.params && said.params.uri
      // Passed on only to a frame that subscribed to it, as a host would.
      if (said.method === 'notifications/resources/updated' && subscribed.has(uri)) post({ jsonrpc: '2.0', method: said.method, params: said.params })
      else note('server said ' + said.method + ' ' + (uri || '') + ', for nobody here')
    }
    events.onerror = () => note('the stand-in’s server went away', 'nothing more will be forwarded')
  }
  // A frame drawn again is a new frame: the old one's subscriptions go with it.
  function forget() {
    for (const uri of subscribed) {
      fetch('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: 'resources/unsubscribe', params: { uri } }) }).catch(() => undefined)
    }
    subscribed.clear()
  }

  // ---- drawing the frame -------------------------------------------------------
  // The spec's default policy when the resource declares no _meta.ui.csp; its
  // domains when it does.
  function policy() {
    const csp = uiMeta.csp
    if (!csp) {
      return "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' data:; connect-src 'none'"
    }
    const list = (key) => (Array.isArray(csp[key]) ? csp[key].join(' ') : '')
    const resources = list('resourceDomains')
    return [
      "default-src 'none'",
      "script-src 'self' 'unsafe-inline' " + resources,
      "style-src 'self' 'unsafe-inline' " + resources,
      "img-src 'self' data: " + resources,
      "font-src 'self' " + resources,
      "media-src 'self' data: " + resources,
      "connect-src 'self' " + list('connectDomains'),
      'frame-src ' + (list('frameDomains') || "'none'"),
      'base-uri ' + (list('baseUriDomains') || "'self'"),
    ].join('; ')
  }

  function draw() {
    forget()
    initialized = false
    initializeSeen = false
    sizes = []
    frame.style.height = '120px'
    frame.style.minWidth = ''
    const meta = '<meta http-equiv="Content-Security-Policy" content="' + policy().replace(/"/g, '&quot;') + '">'
    const html = data.resource.html
    // First in <head>, so the policy covers every script after it.
    const head = /<head[^>]*>/i.exec(html)
    let page = head ? html.slice(0, head.index + head[0].length) + meta + html.slice(head.index + head[0].length) : meta + html
    // VS Code's webview writes the page itself, and marks it before any script
    // runs: its theme kind on <body>, its --vscode-* colours on <html> (M41 F4).
    if (stylesChoice.value.startsWith('vscode')) {
      const colours = palette() || {}
      const end = page.lastIndexOf('<body')
      page = page.slice(0, end).replace(/<html([^>]*)>/i, '<html$1 style="--vscode-editor-background: ' + (colours['--color-background-primary'] || '') + '; --vscode-foreground: ' + (colours['--color-text-primary'] || '') + '">') +
        page.slice(end).replace(/<body([^>]*)>/i, '<body$1 data-vscode-theme-kind="vscode-' + theme() + '">')
    }
    frame.srcdoc = page
    note('drawing ' + data.resource.uri + ' (' + data.resource.mimeType + ', ' + Math.round(html.length / 1024) + ' KB) under: ' + policy())
    if (data.resource.mimeType !== 'text/html;profile=mcp-app') note('served as ' + data.resource.mimeType, 'spec: text/html;profile=mcp-app')
    const drawn = performance.now()
    setTimeout(() => {
      if (!initializeSeen) note('no ui/initialize after 10s', 'the frame never started the handshake')
      else if (!initialized) note('no ui/notifications/initialized after 10s', 'spec: the host sends nothing until the frame says initialized')
    }, 10000)
    frame.addEventListener('load', () => note('frame loaded in ' + Math.round(performance.now() - drawn) + ' ms'), { once: true })
  }

  const contextChanged = () => {
    applyTheme()
    // A theme switch carries the host's variables for the new theme (M41 F1).
    if (initialized) notify('ui/notifications/host-context-changed', Object.assign({ theme: theme() }, variables() ? { styles: { variables: variables() } } : {}))
  }
  // Another host altogether: draw again, as a new host would.
  stylesChoice.addEventListener('change', () => {
    applyTheme()
    log.textContent = ''
    cancelling = false
    draw()
  })
  themeChoice.addEventListener('change', contextChanged)
  dark.addEventListener('change', () => themeChoice.value === 'system' && contextChanged())
  document.getElementById('replay').addEventListener('click', () => {
    log.textContent = ''
    cancelling = false
    draw()
  })
  document.getElementById('cancel').addEventListener('click', () => {
    log.textContent = ''
    cancelling = true
    draw()
  })
  document.getElementById('teardown').addEventListener('click', () => post({ jsonrpc: '2.0', id: 'teardown-' + next++, method: 'ui/resource-teardown', params: { reason: 'the person asked' } }))

  applyTheme()
  draw()
})()
</script>
</body>
</html>
`;

await main();
