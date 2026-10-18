// `defineConfig` comes from vitest/config, not vite, so the `test` block below
// is type-checked rather than silently accepted as an unknown property.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { readFile, rename } from 'node:fs/promises'
import type { Plugin } from 'vite'

const BYTES_SUFFIX = '?bytes'

/**
 * `import wasm from 'pkg/file.wasm?bytes'` → a `Uint8Array` compiled into the
 * bundle.
 *
 * sql.js otherwise fetches its wasm as a separate file at runtime. Handing
 * emscripten `wasmBinary` directly removes the fetch altogether, and that is
 * what makes one piece of plumbing serve three places at once: the database
 * layer is testable in **Node** under Vitest with no setup, `dist-plugin/`
 * needs no second file beside `server.mjs`, and the renderer asks the shell's
 * `app://` scheme for one asset fewer at startup.
 *
 * The trick came from `dist-single/` and outlived it (D-133).
 */
function wasmAsBytes(emptyWasm = false): Plugin {
  return {
    name: 'fc:wasm-as-bytes',
    enforce: 'pre',

    async resolveId(source, importer) {
      if (!source.endsWith(BYTES_SUFFIX)) return null
      const resolved = await this.resolve(source.slice(0, -BYTES_SUFFIX.length), importer, {
        skipSelf: true,
      })
      return resolved === null ? null : resolved.id + BYTES_SUFFIX
    },

    async load(id) {
      if (!id.endsWith(BYTES_SUFFIX)) return null
      // The frame runs sql.js's asm.js build, which takes no wasm: it is
      // handed nothing rather than 900 KB it would ignore (M41 U1).
      if (emptyWasm && id.includes('sql-wasm.wasm')) return 'export default new Uint8Array(0)'
      const base64 = (await readFile(id.slice(0, -BYTES_SUFFIX.length))).toString('base64')
      return [
        `const binary = atob(${JSON.stringify(base64)})`,
        'const bytes = new Uint8Array(binary.length)',
        'for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)',
        'export default bytes',
      ].join('\n')
    },
  }
}

/**
 * The demo is three pages: Emerald's page, `demo-page.html`, which is
 * `index.html` in `dist-demo/` so a static host — and the domain that points at
 * it — serves it at the folder's own address (M33 U8, D-459); the frame,
 * `demo-frame.html`, which is `tour.html` beside it, the page an embed points at
 * (M33 U2, U4); and the app the frame plays, `demo.html`, which is `app.html`.
 */
function demoPagesRenamed(): Plugin {
  return {
    name: 'fc:demo-pages-renamed',
    apply: 'build',
    // After the write rather than in the bundle: Vite emits the pages late in its
    // own pass, and a rename on disk does not depend on which pass runs first.
    async writeBundle(options) {
      const dir = options.dir ?? 'dist-demo'
      await rename(`${dir}/demo.html`, `${dir}/app.html`)
      await rename(`${dir}/demo-frame.html`, `${dir}/tour.html`)
      await rename(`${dir}/demo-page.html`, `${dir}/index.html`)
    },
  }
}

/**
 * `vite --mode demo` serves the three pages at the names they are built to —
 * Emerald's page at `/`, the frame at `/tour.html`, the app at `/app.html` — so
 * the launcher opens the page in one step and every iframe finds what it embeds
 * in both (M33 U2, U8).
 */
function demoPagesServed(): Plugin {
  const served: Record<string, string> = {
    '/': '/demo-page.html',
    '/index.html': '/demo-page.html',
    '/tour.html': '/demo-frame.html',
    '/app.html': '/demo.html',
  }
  return {
    name: 'fc:demo-pages-served',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [pathname = '/', query] = (req.url ?? '/').split('?')
        const page = served[pathname]
        if (page !== undefined) req.url = page + (query === undefined ? '' : `?${query}`)
        next()
      })
    },
  }
}

const FRAME_PAGE = '.frame/frame.html'
const FRAME_MODULE = 'virtual:emerald-frame'

/**
 * **The frame is one page with nothing beside it** (M41 U1): an MCP App's
 * resource is a single HTML document a host draws in a sandboxed frame, whose
 * default CSP lets an inline script and style run and nothing load. So the
 * entry chunk and the stylesheet are written into the page, and every asset
 * was already inlined as a `data:` URI — except the fonts, whose `@font-face`
 * rules are dropped: the default CSP has no `font-src`, so a font the frame
 * named would be refused anyway, and the frame falls back to the system's.
 */
function frameInlined(): Plugin {
  return {
    name: 'fc:frame-inlined',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const page = Object.values(bundle).find((each) => each.type === 'asset' && each.fileName.endsWith('.html'))
      if (page === undefined || page.type !== 'asset') return
      let html = String(page.source)
      for (const [fileName, each] of Object.entries(bundle)) {
        if (each.type === 'chunk') {
          // `</script` inside the code would end the element early, and `<!--`
          // followed by a `<script` (React has one, in a string) would make the
          // real end tag not end it. In a module both can only sit in a string,
          // a regex or a template, where `\x3C` and `\/` mean what they replace.
          const code = each.code.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '\\x3C!--')
          html = html.replace(
            new RegExp(`<script[^>]*src="[^"]*${escaped(fileName)}"[^>]*></script>`),
            () => `<script type="module">${code}</script>`,
          )
          delete bundle[fileName]
        } else if (fileName.endsWith('.css')) {
          const css = String(each.source).replace(/@font-face\{[^}]*\}/g, '')
          html = html.replace(new RegExp(`<link[^>]*href="[^"]*${escaped(fileName)}"[^>]*>`), () => `<style>${css}</style>`)
          delete bundle[fileName]
        } else if (each !== page) {
          delete bundle[fileName]
        }
      }
      page.source = html
    },
  }
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * `import FRAME from 'virtual:emerald-frame'` → the frame's page, as a string
 * compiled into the server (M41 U1), so `build:plugin` still writes one
 * `server.mjs` and the page is served from memory. `build:plugin` builds the
 * frame first; a test run before any build gets a page that says so.
 */
function frameEmbedded(): Plugin {
  return {
    name: 'fc:frame-embedded',
    resolveId: (source) => (source === FRAME_MODULE ? `\0${FRAME_MODULE}` : null),
    async load(id) {
      if (id !== `\0${FRAME_MODULE}`) return null
      const page = await readFile(FRAME_PAGE, 'utf8').catch(
        () => '<!doctype html><p>The frame is not built. <code>npm run build:plugin</code> builds it.</p>',
      )
      return `export default ${JSON.stringify(page)}`
    },
  }
}

// Five build outputs, from eight modes:
//   vite build                          -> dist/          the app: a static site, and what the
//                                                         shell serves over app://
//   vite build --mode plugin            -> dist-plugin/   the stdio MCP server, every client's…
//   vite build --mode claude-hooks      -> dist-plugin/   …Claude Code's hooks (M42 U6)…
//   vite build --mode claude-status-line -> dist-plugin/  …and its status line (M51 U6)
//   vite build --mode electron          -> dist-electron/ the desktop shell's main…
//   vite build --mode electron-preload  -> dist-electron/ …and its preload
//   vite build --mode demo              -> dist-demo/     the demo (M33 U1, D-413): Emerald's page
//                                                         (M33 U8), the tour frame, and the app's
//                                                         screens over one document per tour
//   vite build --mode frame             -> .frame/        the MCP App's page (M41 U1): the app's
//                                                         format page in one file, which the
//                                                         plugin build then embeds
//
// **`dist-single/` was a fourth output and is gone** (D-133). With it went the inlining, the
// under-5MB budget, and the no-CDN rule as things this file enforced. Offline did not go with
// them: the shell blocks every request that is not `app://`, `blob:` or `data:` (D-124,
// `electron/network.ts`), so a CDN reference is a runtime failure now rather than a build one.
// That is why fonts stay self-hosted in `src/ui/theme/tokens.css` and nothing here links out.
//
// The plugin build is a *separate output and never a dependency of the app's* (D-092): Rollup
// bundles only what the entry reaches, and `src/main.tsx` does not reach `src/plugin/`, so
// neither the MCP SDK nor a byte of this mode's code can arrive in the app. It targets Node
// rather than a browser and skips React and Tailwind because it renders nothing.
//
// The electron modes are separate in the same way, and in both directions: they bundle
// `electron/` alone, and `src/` imports exactly one file from it (`bridge.ts`). CommonJS
// because a sandboxed preload must be, and because `__dirname` is how main finds `dist/`
// beside itself.
//
// **Two passes into one directory, and that is not an accident.** The shell is two processes
// that share a module — `bridge.ts`, the contract between them — and a single Rollup build with
// two entries hoists a shared module into a third chunk the two then require. A sandboxed
// preload cannot require a sibling file: its `require` reaches a handful of Electron built-ins
// and nothing on disk. So each entry is built alone, which is what makes each one whole:
// `--mode electron` writes `main.cjs`, `--mode electron-preload` writes `preload.cjs`, and
// `npm run build:electron` is both.
export default defineConfig(({ mode }) => {
  const plugin = mode === 'plugin'
  // **The status line is a second pass into dist-plugin/** (M51 U6), as the
  // shell's preload is: a status line has 200 ms, the server's bundle takes a
  // third of a second to load, and one build with two entries would hoist what
  // they share into a third file. So it is bundled alone — Node's modules and
  // three small files of ours — after the server's pass, which empties the folder.
  const statusLine = mode === 'claude-status-line'
  // **Claude Code's hooks are a pass of their own too** (M42 U6): what a hook
  // runs is Claude's alone, so it lives in `hosts/claude/` and the server's
  // entry does not reach it. It bundles the tools it answers with, as the
  // server does.
  const hooks = mode === 'claude-hooks'
  const electronMain = mode === 'electron'
  const electronPreload = mode === 'electron-preload'
  const electron = electronMain || electronPreload
  // **The three are the npm package, `emerald-mcp`** (M42 U2, D-497): dist-plugin/
  // is published as it is built, so each pass bundles every package it reaches
  // and the package has no dependency to install. Node's own modules stay imports.
  const published = plugin || hooks || statusLine
  const node = published || electron
  const demo = mode === 'demo'
  const frame = mode === 'frame'

  return {
    plugins: [
      wasmAsBytes(frame),
      frameEmbedded(),
      ...(node ? [] : [react(), tailwindcss()]),
      ...(demo ? [demoPagesRenamed(), demoPagesServed()] : []),
      ...(frame ? [frameInlined()] : []),
    ],

    // **The demo's document is beside its page and never in the repository**:
    // `scripts/make-demo-document.mjs` writes `.demo/demo.emd` with this build's
    // own plugin, and the build copies `.demo/` into `dist-demo/` (M33 U1). The
    // other outputs have no public folder.
    publicDir: demo ? '.demo' : frame || published ? false : 'public',

    resolve: {
      alias: [
        { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
        // **The frame's sql.js is the asm.js build of the same package** (M41 U1):
        // an MCP App's default CSP has no 'wasm-unsafe-eval', and a page cannot
        // ask for one, so wasm cannot compile there and plain JavaScript can.
        ...(frame ? [{ find: /^sql\.js$/, replacement: 'sql.js/dist/sql-asm.js' }] : []),
        // **The package's sql.js is its browser build** (M42 U2), the same wasm byte
        // for byte. Its Node build sets `module = undefined` and then exports on a
        // `typeof module` check, which the bundler's CommonJS transform reads as
        // always true; the browser build has no Node branch and needs none, because
        // the wasm is handed to it as bytes (`wasmAsBytes`) and never fetched or read.
        ...(published ? [{ find: /^sql\.js$/, replacement: 'sql.js/dist/sql-wasm-browser.js' }] : []),
      ],
    },

    // The shell's main process too, since M42 U9 gave it a dependency (electron-updater): the
    // packaged app ships no node_modules (electron-builder.yml), so what it imports is inside main.cjs.
    ...(published || electronMain ? { ssr: { noExternal: true, target: 'node' as const } } : {}),

    // Relative base, so the built HTML works both from the root of the shell's `app://`
    // origin and from a subpath on a static host.
    base: './',

    // `PORT` wins when something sets it. Several git worktrees of this repo can
    // be checked out at once, and whichever dev server starts first takes 5173 —
    // leaving the next one silently serving a different worktree's code, which
    // looks exactly like a change that did not take effect. Reading the port the
    // launcher assigned is what makes "start the dev server" mean this copy.
    server: { port: Number(process.env['PORT']) || 5173 },

    build: plugin
      ? {
          outDir: 'dist-plugin',
          emptyOutDir: true,
          target: 'node20',
          // An SSR build, which is how Vitest already runs this same code in
          // Node. Until M42 U2 `sql.js`, `xlsx` and the MCP SDK stayed external
          // and were resolved from node_modules at runtime; now `ssr.noExternal`
          // above bundles them, because the file is published and runs where
          // there is no node_modules (D-497).
          ssr: 'src/plugin/main.ts',
          // Not minified. This output is read by whoever is debugging a server
          // that speaks over a pipe.
          minify: false,
          rollupOptions: {
            output: {
              format: 'esm',
              entryFileNames: 'server.mjs',
              banner: '#!/usr/bin/env node',
            },
          },
        }
      : hooks
      ? {
          outDir: 'dist-plugin',
          emptyOutDir: false,
          target: 'node20',
          ssr: 'hosts/claude/hooks/main.ts',
          minify: false,
          rollupOptions: {
            // The banner because each of the three is a bin of the package, and npm's
            // shim reads it to know what runs the file.
            output: { format: 'esm', entryFileNames: 'hooks.mjs', inlineDynamicImports: true, banner: '#!/usr/bin/env node' },
          },
        }
      : statusLine
      ? {
          outDir: 'dist-plugin',
          emptyOutDir: false,
          target: 'node20',
          ssr: 'hosts/claude/hooks/statusLineMain.ts',
          minify: false,
          rollupOptions: {
            output: { format: 'esm', entryFileNames: 'status-line.mjs', inlineDynamicImports: true, banner: '#!/usr/bin/env node' },
          },
        }
      : electron
      ? {
          outDir: 'dist-electron',
          // Neither pass clears the directory: they write two fixed names into
          // it, and a pass that emptied would delete the other one's work —
          // leaving a shell whose window opens with no preload behind it,
          // which is a confusing way to find out you ran only half a build.
          emptyOutDir: false,
          target: 'node20',
          // An SSR build again, so Node builtins stay external; `electron`
          // itself is added by hand because it is resolved from the runtime
          // rather than from node_modules.
          ssr: electronMain ? 'electron/main.ts' : 'electron/preload.ts',
          // Read by whoever is debugging a window that will not open.
          minify: false,
          rollupOptions: {
            external: ['electron'],
            output: {
              format: 'cjs',
              entryFileNames: electronMain ? 'main.cjs' : 'preload.cjs',
              inlineDynamicImports: true,
            },
          },
        }
      : frame
      ? {
          outDir: '.frame',
          emptyOutDir: true,
          target: 'es2022',
          // Everything a page names goes into the page, so it asks for nothing.
          assetsInlineLimit: () => true,
          cssCodeSplit: false,
          modulePreload: false,
          chunkSizeWarningLimit: 6000,
          rollupOptions: {
            input: fileURLToPath(new URL('./frame.html', import.meta.url)),
            output: { inlineDynamicImports: true },
          },
        }
      : demo
      ? {
          outDir: 'dist-demo',
          emptyOutDir: true,
          target: 'es2022',
          chunkSizeWarningLimit: 3000,
          rollupOptions: {
            input: {
              app: fileURLToPath(new URL('./demo.html', import.meta.url)),
              frame: fileURLToPath(new URL('./demo-frame.html', import.meta.url)),
              page: fileURLToPath(new URL('./demo-page.html', import.meta.url)),
            },
          },
        }
      : {
          outDir: 'dist',
          emptyOutDir: true,
          target: 'es2022',
          // The sql.js wasm arrives as base64 inside a chunk rather than as an asset (see
          // `wasmAsBytes` above), which is most of this number. It is a tripwire for
          // "something large got added and nobody noticed", not a budget — the budget
          // retired with `dist-single/` and is kept by hand from here (D-133). It was
          // 6000 while the single file was inlining fonts and an icon into the same
          // chunk; without them the chunk is ~2.2MB and 6000 would never fire.
          chunkSizeWarningLimit: 3000,
        },

    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'electron/**/*.test.ts', 'hosts/**/*.test.ts'],
      // A test makes folders on disk only through src/testing/tempDir.ts; the
      // setup file removes them after each file, and the global setup gives
      // the run a temp folder of its own and fails it if anything is left in
      // it (M28 F19 — the suite once filled C: with 56 GB of leftovers).
      setupFiles: ['src/testing/setup.ts'],
      globalSetup: ['src/testing/globalSetup.ts'],
      // **A test's budget holds under load** (M29 F6). The default five
      // seconds was a timing assertion nobody chose: a plugin tool's test opens
      // and writes a real document and takes 2-3s alone, so a busy machine put
      // it within one stall of failing. Fifteen is five times the slowest
      // such test; a test that needs more says so itself, as categorize does.
      testTimeout: 15_000,
      // **The wasm is run through `wasmAsBytes` in tests too** (M42 F3).
      // Vitest 4's module runner hands anything under node_modules to Node
      // itself, and Node now imports a `.wasm` as a WebAssembly module — so
      // `sql-wasm.wasm?bytes` reached Node rather than the plugin, and failed
      // on emscripten's import namespace. Inlining it keeps it Vite's.
      server: { deps: { inline: [/\.wasm\?bytes$/] } },
    },
  }
})
