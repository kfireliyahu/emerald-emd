/**
 * **The Drive store: Emerald/Emerald.emd in the person's Google Drive** (M57 U3,
 * D-560, D-562).
 *
 * The store U1 put between the tools and the bytes (`src/plugin/store.ts`), with
 * the bytes in one file in the person's Drive instead of on this machine. The
 * endpoint keeps no document: every call opens this store with the person's
 * token, the tool reads the document, works, and writes it back, and nothing of
 * it stays behind.
 *
 * **The first call finds the document or makes it**: a folder `Emerald` and in
 * it `Emerald.emd`, stored as text so Drive previews it, and empty — packs are
 * added when the person asks (D-562). Under the `drive.file` scope Drive shows
 * this app only what it made, so the search cannot land on a file of the
 * person's that happens to share the name. Where two first calls race and each
 * makes a folder, every later call takes the oldest, so they converge on one.
 *
 * **A read is one revision, exactly**: the file's head revision is asked first,
 * then that revision's bytes downloaded by its id, so the bytes and the version
 * a write hands back can never disagree.
 *
 * **A write refuses a document that changed since it was read** — the person's
 * other chat, another device, Drive's own sync client — and says so, and to ask
 * again. Drive's v3 API offers no precondition on an upload (no `If-Match`, no
 * revision to name; D-563), so the write checks the head revision and then
 * uploads. Between the two is a window, a round trip wide, in which another
 * writer's upload would be replaced — and still be in Drive's version history,
 * which is where the earlier copies are (D-562). One process's own writers to
 * one file are queued (`exclusive`), so the window is only ever another
 * process's.
 *
 * **Over 5 MB is refused at write** (D-562), before anything is sent.
 *
 * **No copies**: Drive keeps each version it replaces, so the store has no
 * `copies`, and a write takes none and says nothing of one (D-562).
 */

import { err, newDocumentBytes, ok, type DocumentStore, type Result } from '@/plugin/host.ts'

import { DriveError, driveClient, FOLDER_MIME, quoted, type Drive, type DriveFile, type Fetch } from './drive.ts'

export const DRIVE_FOLDER = 'Emerald'
export const DRIVE_FILE = 'Emerald.emd'
/** How the document is named to the person, and the `path` its tools are given. */
export const DRIVE_DOCUMENT_PATH = `${DRIVE_FOLDER}/${DRIVE_FILE}`
/** The largest document the connector writes (D-562). */
export const DRIVE_DOCUMENT_LIMIT = 5 * 1024 * 1024
/** A text document as Drive should take it — so it previews it (D-562). */
export const DRIVE_DOCUMENT_MIME = 'text/plain'

/** The refusal of a write over a document that moved on. */
export const CHANGED_SINCE_READ =
  `${DRIVE_DOCUMENT_PATH} changed in your Google Drive since this call read it, so nothing was ` +
  'written over it. Ask again: the next call reads it as it is now.'

export interface DriveDocument {
  /** The store this call's tools reach the document through. */
  readonly store: DocumentStore
  /** The path to hand the tools: the document as the person would find it. */
  readonly path: string
  /** Drive's id for the file. */
  readonly fileId: string
  /** Whether this call made the folder or the file. */
  readonly created: boolean
}

export interface DriveOptions {
  /** The person's Google access token, for the `drive.file` scope. */
  readonly accessToken: string
  /** How requests are sent: the global `fetch`, or a fake Drive's in a test. */
  readonly fetch?: Fetch
}

/** The bytes of a new, empty document, stored as text (D-562). */
export function emptyDocument(): Promise<Result<Uint8Array, string>> {
  return newDocumentBytes([], 'text')
}

/** A failed request to Drive, as the sentence the person reads. */
function said(error: unknown, doing: string): string {
  if (error instanceof DriveError) {
    if (error.status === 401) {
      return `Google did not accept this call's sign-in while ${doing}, so nothing was read or written. Sign in to the connector again.`
    }
    if (error.status === 404) {
      return `${DRIVE_DOCUMENT_PATH} is no longer where it was in your Google Drive (${doing}). Ask again: the next call finds it, or makes it again.`
    }
    return `Google Drive refused ${doing}: ${error.message} (${String(error.status)}). Nothing was written.`
  }
  return `Google Drive could not be reached while ${doing}: ${error instanceof Error ? error.message : String(error)}. Nothing was written.`
}

/** The oldest of what a query found, or undefined. */
async function oldest(drive: Drive, query: string): Promise<DriveFile | undefined> {
  return (await drive.find(query))[0]
}

/**
 * Find the person's document in their Drive, or make it — **the first call of
 * every call** — and the store that reads and writes it.
 */
export async function openDriveDocument(options: DriveOptions): Promise<Result<DriveDocument, string>> {
  const drive = driveClient(options.accessToken, options.fetch)
  let created = false

  let file: DriveFile
  try {
    let folder = await oldest(
      drive,
      `name = ${quoted(DRIVE_FOLDER)} and mimeType = ${quoted(FOLDER_MIME)} and trashed = false`,
    )
    if (folder === undefined) {
      folder = await drive.createFolder(DRIVE_FOLDER)
      created = true
    }
    const found = await oldest(
      drive,
      `name = ${quoted(DRIVE_FILE)} and ${quoted(folder.id)} in parents and trashed = false`,
    )
    if (found === undefined) {
      const bytes = await emptyDocument()
      if (!bytes.ok) return err(`Could not make ${DRIVE_DOCUMENT_PATH}: ${bytes.error}`)
      file = await drive.createFile(DRIVE_FILE, folder.id, DRIVE_DOCUMENT_MIME, bytes.value)
      created = true
    } else {
      file = found
    }
  } catch (error) {
    return err(said(error, `finding ${DRIVE_DOCUMENT_PATH}`))
  }

  return ok({ store: driveStore(drive, file), path: DRIVE_DOCUMENT_PATH, fileId: file.id, created })
}

/** Writers in this process to one Drive file, one after another. */
const queues = new Map<string, Promise<unknown>>()

function queued<T>(key: string, work: () => Promise<T>): Promise<T> {
  const before = queues.get(key) ?? Promise.resolve()
  const run = before.then(work, work)
  const settled = run.catch(() => undefined)
  queues.set(key, settled)
  void settled.then(() => {
    if (queues.get(key) === settled) queues.delete(key)
  })
  return run
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}

/** The store over one Drive file. The `path` a tool passes names it, and is not looked up. */
function driveStore(drive: Drive, file: DriveFile): DocumentStore {
  const mimeType = file.mimeType ?? DRIVE_DOCUMENT_MIME
  return {
    async read() {
      try {
        const head = await drive.metadata(file.id)
        if (head.headRevisionId === undefined) {
          return err(`${DRIVE_DOCUMENT_PATH} in your Google Drive has no content to read.`)
        }
        const bytes = await drive.download(file.id, head.headRevisionId)
        return ok({ bytes, version: head.headRevisionId })
      } catch (error) {
        return err(said(error, `reading ${DRIVE_DOCUMENT_PATH}`))
      }
    },

    async write(_path, bytes, version) {
      if (bytes.length > DRIVE_DOCUMENT_LIMIT) {
        return err(
          `${DRIVE_DOCUMENT_PATH} would be ${megabytes(bytes.length)} MB, over the ` +
            `${megabytes(DRIVE_DOCUMENT_LIMIT)} MB a document on the Google Drive connector may be, ` +
            'so nothing was written and the document in your Drive is as it was.',
        )
      }
      try {
        // Check, then write: Drive's v3 upload takes no precondition (D-563).
        const head = await drive.metadata(file.id)
        if (head.headRevisionId !== version) return err(CHANGED_SINCE_READ)
        await drive.upload(file.id, mimeType, bytes)
        return ok(undefined)
      } catch (error) {
        return err(said(error, `writing ${DRIVE_DOCUMENT_PATH}`))
      }
    },

    exclusive: (_path, work) => queued(file.id, work),
  }
}
