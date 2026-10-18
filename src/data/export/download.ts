/**
 * Handing a CSV to the browser, through the same `downloadBlob` that hands over
 * a document.
 *
 * Separate from the storage adapter on purpose. That one is the *document* —
 * the thing the app opens, watches and can clobber. This is a derived file that
 * leaves and is never read back, so it has no handle, no mark and no
 * save-silently path to care about.
 */

import { instantDay } from '@/core/instant.ts'
import { downloadBlob } from '@/data/storage/download.ts'

/**
 * The three bytes without which Excel opens Hebrew as `×©×•×¤×¨×¡×œ`.
 *
 * Excel guesses the encoding of a `.csv` from the system code page unless the
 * file opens with a UTF-8 byte-order mark, and on a Hebrew Windows install that
 * guess is CP1255. Every merchant name in this app is Hebrew on most rows, so
 * the BOM is not a nicety here — without it the export is unreadable for its
 * one intended reader. Numbers survive either way, which is what makes this
 * easy to omit and easy to miss.
 */
const UTF8_BOM = '﻿'

export function downloadCsv(fileName: string, csv: string): void {
  downloadBlob(new Blob([UTF8_BOM + csv], { type: 'text/csv;charset=utf-8' }), fileName)
}

/**
 * `transactions-2026-08-25.csv`. Dated rather than numbered, because two
 * exports of a moving ledger are two different files and the date is the only
 * honest thing distinguishing them.
 */
export function exportFileName(what: string, now: Date = new Date()): string {
  return `${what}-${instantDay(now.getTime())}.csv`
}
