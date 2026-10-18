// A document with dated change marks, for the plugin's tests of them (M47 U5,
// D-462) — here rather than beside them, since nothing under `src/plugin/` may
// hold SQL (`noSql.test.ts`, D-095).
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createDatabase, exportDatabase, query } from '@/data/db/database.ts'
import { adoptFormat } from '@/data/repositories/formatRepository.ts'
import { insertRows } from '@/data/repositories/formatRowRepository.ts'
import { parse } from '@/domain/format/artefact.ts'

import { tempDir } from './tempDir'

const NOW = Date.UTC(2026, 8, 15)
const OCT_6 = new Date(2026, 9, 6, 12).getTime()
const OCT_9 = new Date(2026, 9, 9, 12).getTime()

function declared(name: string) {
  const parsed = parse(`---
format: ${name}
title: ${name}
language: 23
---

| column | type | points at | unit | per | required | unique | values | min | max | note |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| key | text |  |  |  | yes | yes |  |  |  |  |
`)
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.value
}

/**
 * A site's document: `copy_slot` (two rows) last changed on 6 October,
 * `dns_record` (one) on the 9th — and, when `old` is set, saved by a build from
 * before there were marks, with no trigger in the file. Returns its path.
 */
export async function markedSite(old: boolean): Promise<string> {
  const db = await createDatabase()
  const copy = declared('copy_slot')
  const dns = declared('dns_record')
  adoptFormat(db, copy, NOW)
  adoptFormat(db, dns, NOW)
  insertRows(db, copy, [{ key: 'hero.title' }, { key: 'about.intro' }])
  insertRows(db, dns, [{ key: 'www' }])
  db.run("UPDATE format SET updated_at = ? WHERE name = 'copy_slot'", [OCT_6])
  db.run("UPDATE format SET updated_at = ? WHERE name = 'dns_record'", [OCT_9])
  if (old) {
    for (const row of query(db, "SELECT name FROM sqlite_master WHERE type = 'trigger'")) {
      db.run(`DROP TRIGGER "${String(row['name'])}"`)
    }
  }
  const bytes = exportDatabase(db)
  db.close()
  const path = join(await tempDir('emerald-changed-'), 'site.emd')
  await writeFile(path, bytes)
  return path
}
