/**
 * **The few calls the Google Drive connector makes to Drive** (M57 U3, D-560):
 * Drive's REST API, version 3, with an access token handed in for the
 * `drive.file` scope — so Drive shows it only the files this app made or the
 * person opened with it, and nothing else in their Drive.
 *
 * Six calls and no more: find files by a query, make a folder, make a file with
 * its content, read a file's metadata, download one revision's bytes, and upload
 * new content over a file. No SDK: the requests are plain `fetch`, which is
 * handed in, so a test runs them against a fake Drive and makes no request at
 * all (`fakeDrive.ts`).
 *
 * A request Drive answers with anything but success throws a `DriveError`
 * carrying the status; the store turns it into a sentence (`store.ts`).
 */

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'

/** What Drive calls a folder. */
export const FOLDER_MIME = 'application/vnd.google-apps.folder'

/** The fields every answer about a file carries. */
const FILE_FIELDS = 'id,name,mimeType,headRevisionId,size'

/** The `fetch` the client sends with: the global one, or a fake in a test. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>

/** A file as Drive describes it, in the fields this connector asks for. */
export interface DriveFile {
  readonly id: string
  readonly name?: string
  readonly mimeType?: string
  /** The revision its content is at — absent for a folder. */
  readonly headRevisionId?: string
  /** Bytes, as a decimal string, which is how Drive sends it. */
  readonly size?: string
}

/** Drive answered with something other than success. */
export class DriveError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'DriveError'
  }
}

export interface Drive {
  /** The files a Drive query matches, oldest first. */
  find(query: string): Promise<readonly DriveFile[]>
  /** A new folder in the root of the person's Drive. */
  createFolder(name: string): Promise<DriveFile>
  /** A new file in `parent`, with its content. */
  createFile(name: string, parent: string, mimeType: string, bytes: Uint8Array): Promise<DriveFile>
  /** A file's metadata — its revision above all. */
  metadata(id: string): Promise<DriveFile>
  /** The bytes of one revision of a file, so what is read is exactly the revision named. */
  download(id: string, revision: string): Promise<Uint8Array>
  /** New content over a file; Drive keeps the content it replaces as an earlier version. */
  upload(id: string, mimeType: string, bytes: Uint8Array): Promise<DriveFile>
}

/** A value inside a Drive query's single quotes. */
export function quoted(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** Bytes as a request body, copied onto an `ArrayBuffer` of their own. */
function body(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return concat([bytes])
}

/** A Drive client sending as the person whose token this is. */
export function driveClient(accessToken: string, send: Fetch = (url, init) => fetch(url, init)): Drive {
  const request = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${accessToken}`)
    const response = await send(url, { ...init, headers })
    if (response.ok) return response
    const text = await response.text().catch(() => '')
    let message = text
    try {
      const parsed = JSON.parse(text) as { error?: { message?: unknown } }
      if (typeof parsed.error?.message === 'string') message = parsed.error.message
    } catch {
      // Not JSON: the text as it came.
    }
    throw new DriveError(response.status, message === '' ? response.statusText : message)
  }
  const json = async <T>(url: string, init?: RequestInit): Promise<T> => (await request(url, init)).json() as Promise<T>

  return {
    async find(query) {
      const params = new URLSearchParams({
        q: query,
        fields: `files(${FILE_FIELDS})`,
        orderBy: 'createdTime',
        spaces: 'drive',
        pageSize: '10',
      })
      const found = await json<{ files?: DriveFile[] }>(`${API}/files?${params.toString()}`)
      return found.files ?? []
    },

    createFolder(name) {
      return json<DriveFile>(`${API}/files?fields=${FILE_FIELDS}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
      })
    },

    createFile(name, parent, mimeType, bytes) {
      // One multipart request, metadata and content together, so there is never
      // a file in the folder without its content.
      const boundary = `emerald-${crypto.randomUUID()}`
      const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
      const payload = concat([
        encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`),
        encode(JSON.stringify({ name, parents: [parent], mimeType })),
        encode(`\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
        bytes,
        encode(`\r\n--${boundary}--`),
      ])
      return json<DriveFile>(`${UPLOAD}/files?uploadType=multipart&fields=${FILE_FIELDS}`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: payload,
      })
    },

    metadata(id) {
      return json<DriveFile>(`${API}/files/${encodeURIComponent(id)}?fields=${FILE_FIELDS}`)
    },

    async download(id, revision) {
      const response = await request(
        `${API}/files/${encodeURIComponent(id)}/revisions/${encodeURIComponent(revision)}?alt=media`,
      )
      return new Uint8Array(await response.arrayBuffer())
    },

    upload(id, mimeType, bytes) {
      return json<DriveFile>(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=${FILE_FIELDS}`, {
        method: 'PATCH',
        headers: { 'Content-Type': mimeType },
        body: body(bytes),
      })
    },
  }
}
