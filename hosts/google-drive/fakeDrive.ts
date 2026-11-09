/**
 * **A Google Drive in memory** (M57 U3): the calls `drive.ts` makes, answered
 * the way Drive's v3 API answers them, so the store is tested — and the
 * endpoint run locally (U4) — with no request leaving the process.
 *
 * It holds files with their parents and revisions, answers the queries the
 * store sends (a name, a mime type, a parent, not trashed), takes multipart
 * creates and media uploads, and refuses a request without the token it was
 * made with. Every request is kept in `requests`, so a test can say what was
 * and was not sent.
 *
 * Only what the connector sends is understood; anything else is a 400, so a
 * request this fake has not been taught fails the test rather than passing.
 */

import { FOLDER_MIME, type Fetch } from './drive.ts'

interface Revision {
  readonly id: string
  readonly bytes: Uint8Array
}

export interface FakeFile {
  readonly id: string
  name: string
  readonly mimeType: string
  readonly parents: readonly string[]
  readonly createdTime: number
  trashed: boolean
  readonly revisions: Revision[]
}

export interface SentRequest {
  readonly method: string
  readonly url: string
}

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function refuse(status: number, message: string): Response {
  return answer(status, { error: { code: status, message } })
}

function described(file: FakeFile): Record<string, string> {
  const head = file.revisions.at(-1)
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    ...(head === undefined ? {} : { headRevisionId: head.id, size: String(head.bytes.length) }),
  }
}

/** Split a `multipart/related` body into its metadata and its content. */
function parts(body: Uint8Array, contentType: string): { metadata: Record<string, unknown>; bytes: Uint8Array } | undefined {
  const boundary = /boundary=(.+)$/.exec(contentType)?.[1]
  if (boundary === undefined) return undefined
  // Latin-1 keeps one character per byte, so offsets in the text are offsets in the bytes.
  const text = new TextDecoder('latin1').decode(body)
  const delimiter = `\r\n--${boundary}`
  const metaStart = text.indexOf('\r\n\r\n') + 4
  const metaEnd = text.indexOf(delimiter, metaStart)
  const mediaStart = text.indexOf('\r\n\r\n', metaEnd) + 4
  const mediaEnd = text.lastIndexOf(`${delimiter}--`)
  if (metaStart < 4 || metaEnd < 0 || mediaStart < 4 || mediaEnd < mediaStart) return undefined
  const metadata = JSON.parse(new TextDecoder().decode(body.slice(metaStart, metaEnd))) as Record<string, unknown>
  return { metadata, bytes: body.slice(mediaStart, mediaEnd) }
}

/** What a query the store sends asks for, or undefined for one it does not send. */
function parseQuery(q: string): ((file: FakeFile) => boolean) | undefined {
  const tests: ((file: FakeFile) => boolean)[] = []
  for (const clause of q.split(' and ')) {
    const name = /^name = '((?:[^'\\]|\\.)*)'$/.exec(clause)
    const mime = /^mimeType = '((?:[^'\\]|\\.)*)'$/.exec(clause)
    const parent = /^'((?:[^'\\]|\\.)*)' in parents$/.exec(clause)
    const unescape = (value: string): string => value.replace(/\\(.)/g, '$1')
    if (name?.[1] !== undefined) {
      const wanted = unescape(name[1])
      tests.push((file) => file.name === wanted)
    } else if (mime?.[1] !== undefined) {
      const wanted = unescape(mime[1])
      tests.push((file) => file.mimeType === wanted)
    } else if (parent?.[1] !== undefined) {
      const wanted = unescape(parent[1])
      tests.push((file) => file.parents.includes(wanted))
    } else if (clause === 'trashed = false') {
      tests.push((file) => !file.trashed)
    } else {
      return undefined
    }
  }
  return (file) => tests.every((test) => test(file))
}

export class FakeDrive {
  readonly files = new Map<string, FakeFile>()
  readonly requests: SentRequest[] = []
  private counter = 0

  constructor(readonly token = 'fake-token') {}

  private next(prefix: string): string {
    this.counter += 1
    return `${prefix}${String(this.counter)}`
  }

  /** Put a file in the Drive as if the app had made it earlier, or another device had. */
  add(name: string, mimeType: string, parents: readonly string[], bytes?: Uint8Array): FakeFile {
    const file: FakeFile = {
      id: this.next('file-'),
      name,
      mimeType,
      parents,
      createdTime: this.counter,
      trashed: false,
      revisions: bytes === undefined ? [] : [{ id: this.next('rev-'), bytes }],
    }
    this.files.set(file.id, file)
    return file
  }

  /** New content in a file, from somewhere that is not this connector: a new head revision. */
  change(id: string, bytes: Uint8Array): void {
    this.files.get(id)?.revisions.push({ id: this.next('rev-'), bytes })
  }

  /** The files with a name, oldest first. */
  named(name: string): FakeFile[] {
    return [...this.files.values()].filter((file) => file.name === name)
  }

  /** The current content of a file. */
  content(id: string): Uint8Array | undefined {
    return this.files.get(id)?.revisions.at(-1)?.bytes
  }

  /** The `fetch` to hand the store. */
  readonly fetch: Fetch = async (url, init) => {
    const method = (init.method ?? 'GET').toUpperCase()
    this.requests.push({ method, url })
    const headers = new Headers(init.headers)
    if (headers.get('Authorization') !== `Bearer ${this.token}`) return refuse(401, 'Invalid Credentials')

    const parsed = new URL(url)
    if (parsed.host !== 'www.googleapis.com') return refuse(400, `Not Drive: ${parsed.host}`)
    const path = parsed.pathname
    const body =
      init.body === undefined || init.body === null
        ? new Uint8Array(0)
        : typeof init.body === 'string'
          ? new TextEncoder().encode(init.body)
          : new Uint8Array(init.body as ArrayBuffer)

    if (method === 'GET' && path === '/drive/v3/files') {
      const matches = parseQuery(parsed.searchParams.get('q') ?? '')
      if (matches === undefined) return refuse(400, `A query this fake was not taught: ${parsed.searchParams.get('q') ?? ''}`)
      const found = [...this.files.values()].filter(matches).sort((a, b) => a.createdTime - b.createdTime)
      return answer(200, { files: found.map(described) })
    }

    if (method === 'POST' && path === '/drive/v3/files') {
      const metadata = JSON.parse(new TextDecoder().decode(body)) as { name: string; mimeType: string; parents?: string[] }
      if (metadata.mimeType !== FOLDER_MIME) return refuse(400, 'Only folders are made without content here.')
      return answer(200, described(this.add(metadata.name, metadata.mimeType, metadata.parents ?? ['root'])))
    }

    if (method === 'POST' && path === '/upload/drive/v3/files' && parsed.searchParams.get('uploadType') === 'multipart') {
      const split = parts(body, headers.get('Content-Type') ?? '')
      if (split === undefined) return refuse(400, 'Malformed multipart body.')
      const { name, mimeType, parents: under } = split.metadata as { name: string; mimeType: string; parents: string[] }
      return answer(200, described(this.add(name, mimeType, under, split.bytes)))
    }

    const revision = /^\/drive\/v3\/files\/([^/]+)\/revisions\/([^/]+)$/.exec(path)
    if (method === 'GET' && revision !== null && parsed.searchParams.get('alt') === 'media') {
      const file = this.files.get(decodeURIComponent(revision[1] ?? ''))
      const found = file?.revisions.find((one) => one.id === decodeURIComponent(revision[2] ?? ''))
      if (found === undefined) return refuse(404, 'Revision not found.')
      return new Response(found.bytes.slice(), { status: 200 })
    }

    const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(path)
    if (method === 'GET' && one !== null) {
      const file = this.files.get(decodeURIComponent(one[1] ?? ''))
      if (file === undefined || file.trashed) return refuse(404, 'File not found.')
      return answer(200, described(file))
    }

    const upload = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(path)
    if (method === 'PATCH' && upload !== null && parsed.searchParams.get('uploadType') === 'media') {
      const file = this.files.get(decodeURIComponent(upload[1] ?? ''))
      if (file === undefined || file.trashed) return refuse(404, 'File not found.')
      file.revisions.push({ id: this.next('rev-'), bytes: body })
      return answer(200, described(file))
    }

    return refuse(400, `A request this fake was not taught: ${method} ${path}`)
  }
}
