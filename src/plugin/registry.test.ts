import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { tempDir } from '../testing/tempDir'
import { PLUGIN_VERSION } from './document.ts'
import { SERVER_NAME } from './server.ts'

/**
 * **The MCP Registry lists the server from `server.json`** (M42 U3, D-500), and
 * accepts it only when the npm package it names, as published, carries the
 * same name as `mcpName`. So the listing, the package and the server must agree
 * on two things — the name and the version — and the version is the
 * repository's own `package.json`'s, cut once. That the file meets the
 * registry's live schema is checked where the schema is: by `mcp-publisher
 * validate` in `.github/workflows/registry.yml`, before every publish.
 */
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'))
const listing = json(join(ROOT, 'server.json'))
const app = json(join(ROOT, 'package.json'))

describe('the registry listing', () => {
  it("is named in the maintainer's GitHub namespace, after the server", () => {
    expect(listing.$schema).toMatch(/^https:\/\/static\.modelcontextprotocol\.io\/schemas\/\d{4}-\d{2}-\d{2}\/server\.schema\.json$/)
    expect(listing.name).toBe(`io.github.kfireliyahu/${SERVER_NAME}`)
    expect(listing.description.length).toBeLessThanOrEqual(100)
  })

  it('lists the npm package at the version the repository cuts, which the server reports', () => {
    expect(listing.version).toBe(app.version)
    expect(PLUGIN_VERSION).toBe(app.version)
    expect(listing.packages).toEqual([
      {
        registryType: 'npm',
        registryBaseUrl: 'https://registry.npmjs.org',
        identifier: 'emerald-mcp',
        version: app.version,
        runtimeHint: 'npx',
        transport: { type: 'stdio' },
      },
    ])
  })

  it("stamps the listing's name on the package as mcpName", async () => {
    const out = await tempDir('emerald-npm-')
    execFileSync(process.execPath, [join(ROOT, 'scripts', 'npm-package.mjs'), out])
    const manifest = json(join(out, 'package.json'))
    expect(manifest).toMatchObject({ name: 'emerald-mcp', version: app.version, mcpName: listing.name })
  })
})
