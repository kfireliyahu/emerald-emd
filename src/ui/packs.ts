import { useMemo } from 'react'
import type { Database } from 'sql.js'

import { PACKS, packsKeptBy } from '@/data/packs/packs.ts'
import { useDocumentStore } from '@/state/documentStore.ts'
import { groupByPack, type FormatsByPack, type PackRail } from '@/ui/nav.ts'

/**
 * Which packs are showing — the open document's (M25 U8).
 *
 * **The ledger is at the front door again, and it is the document that says
 * so.** M20 U0 staged it behind one boolean in `localStorage` (D-227, D-228),
 * per machine, so the engine could be driven without the finance app in the
 * way. D-266 then made the ledger per document — a document keeps it by
 * declaring its formats — and from that day the switch was a second answer to
 * a question the file already answered. U8 takes the switch away: a document
 * that keeps a ledger shows its screens in the rail and opens on its month; one
 * that does not, like `docs/memory.emd` or a recipe book, shows the engine's.
 *
 * Still not a preference written into the file (D-115): nothing is stored to
 * say the rail should show the ledger. Keeping the ledger's rows is what a
 * ledger document *is*, and the rail reads that.
 */

/**
 * **Which packs a document keeps** (M27 U7) — every pack asked, each by its own
 * test (`data/packs/packs.ts`). `keepsLedger` is this question asked of one.
 */
export function keptPacks(db: Database | undefined): ReadonlySet<string> {
  return packsKeptBy(db)
}

/** Whether a document keeps a ledger — the pack has seeded it (D-266). */
export function keepsLedger(db: Database | undefined): boolean {
  return keptPacks(db).has('ledger')
}

/** Which packs the open document keeps, outside React. */
export function openDocumentKeptPacks(): ReadonlySet<string> {
  return keptPacks(useDocumentStore.getState().db)
}

/** Which packs the open document keeps, recomputed whenever it changes. */
export function useKeptPacks(): ReadonlySet<string> {
  const db = useDocumentStore((state) => state.db)
  const revision = useDocumentStore((state) => state.revision)
  // `revision` moves on every mutation, which is when the answer can change.
  return useMemo(() => keptPacks(db), [db, revision])
}

/**
 * **Whether the open document keeps a ledger** (M25 U2, D-266). A document that
 * does not has no `fmt_account` for a ledger screen to read, so the rail, the
 * screens, the notices and onboarding ask this first.
 */
export function useKeepsLedger(): boolean {
  return useKeptPacks().has('ledger')
}

/** The rail's showing map: every pack, kept or not. */
export function showingOf(kept: ReadonlySet<string>): Readonly<Record<string, boolean>> {
  return Object.fromEntries(PACKS.map((pack) => [pack.id, kept.has(pack.id)]))
}

/**
 * The kept packs, as the rail draws them: one that declares views is a section
 * of its own, built from the views and not from a branch naming the pack; one
 * that declares none has its formats under its name in `Formats` (M33 F3).
 */
export function packRails(kept: ReadonlySet<string>): readonly PackRail[] {
  return PACKS.filter((pack) => kept.has(pack.id)).map((pack) => ({
    id: pack.id,
    title: pack.title,
    views: pack.places(),
    formats: [...pack.formats()],
  }))
}

/**
 * **A person's own formats first, then each pack's under its name** — M33 F3.
 *
 * 2026-10-07: *"i also want the formats indented inside if they
 * come from packs so user would be able to find his own easily"*. Every list of
 * formats — the rail, `#/formats`, a link's *Points at*, a file's *onto* — asks
 * this, so they agree on whose a format is.
 *
 * **Whose is read off the document, not asked of anybody.** A format is a
 * pack's when the document keeps that pack (each pack's own test, D-266) and
 * the pack declares a format of that name; a person's own column on it does
 * not make it theirs (D-269: what they add, the pack still owns). A person's
 * `account` in a recipe book is theirs, because a recipe book keeps no ledger.
 */
export function formatsByPack<T>(
  formats: readonly T[],
  kept: ReadonlySet<string>,
  nameOf: (format: T) => string,
): FormatsByPack<T> {
  return groupByPack(formats, packRails(kept), nameOf)
}
