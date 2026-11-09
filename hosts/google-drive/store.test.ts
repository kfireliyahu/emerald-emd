import { describe, expect, it } from 'vitest'

import {
  declareFormatTool,
  formatRowsTool,
  formatsTool,
  NO_CLIENT,
  recordFormatRowsTool,
  withDocumentStore,
} from '@/plugin/host.ts'

import { FOLDER_MIME } from './drive.ts'
import { FakeDrive } from './fakeDrive.ts'
import {
  CHANGED_SINCE_READ,
  DRIVE_DOCUMENT_LIMIT,
  DRIVE_DOCUMENT_MIME,
  DRIVE_DOCUMENT_PATH,
  DRIVE_FILE,
  DRIVE_FOLDER,
  openDriveDocument,
  type DriveDocument,
} from './store.ts'

/**
 * **The Drive store** (M57 U3, D-560, D-562), against a Drive in memory: the
 * document found or made on the first call, read as one revision, written only
 * over the revision it read, refused over 5 MB, and no copies of ours. No
 * request leaves the process.
 */

const BOOK = {
  path: DRIVE_DOCUMENT_PATH,
  format: 'book',
  title: 'Book',
  columns: [{ name: 'title', type: 'text', required: true }],
  nothing_must_hold: true,
}

async function opened(drive: FakeDrive): Promise<DriveDocument> {
  const document = await openDriveDocument({ accessToken: drive.token, fetch: drive.fetch })
  if (!document.ok) throw new Error(document.error)
  return document.value
}

/** A document holding the book format, as text. */
async function bookBytes(): Promise<Uint8Array> {
  const drive = new FakeDrive()
  const document = await opened(drive)
  await withDocumentStore(document.store, () => declareFormatTool.run({ ...BOOK, commit: true }, NO_CLIENT))
  const bytes = drive.content(document.fileId)
  if (bytes === undefined) throw new Error('nothing written')
  return bytes
}

describe('the Drive store (M57 U3)', () => {
  it('makes Emerald/Emerald.emd on the first call, stored as text and empty', async () => {
    const drive = new FakeDrive()
    const document = await opened(drive)

    expect(document.created).toBe(true)
    expect(document.path).toBe('Emerald/Emerald.emd')
    const [folder] = drive.named(DRIVE_FOLDER)
    const [file] = drive.named(DRIVE_FILE)
    expect(folder?.mimeType).toBe(FOLDER_MIME)
    expect(file?.parents).toEqual([folder?.id])
    expect(file?.mimeType).toBe(DRIVE_DOCUMENT_MIME)

    // The bytes are an Emerald document, as text, with nothing declared in it.
    const content = drive.content(document.fileId)
    if (content === undefined) throw new Error('no content')
    expect(new TextDecoder().decode(content)).toMatch(/^<!-- emerald document, schema \d+ -->\n$/)
    const formats = await withDocumentStore(document.store, () => formatsTool.run({ path: document.path }, NO_CLIENT))
    expect(formats).toContain(`${DRIVE_DOCUMENT_PATH} declares no formats.`)
  })

  it('finds the folder and the document the app made, and makes neither again', async () => {
    const drive = new FakeDrive()
    const first = await opened(drive)
    const again = await opened(drive)

    expect(again.created).toBe(false)
    expect(again.fileId).toBe(first.fileId)
    expect(drive.named(DRIVE_FOLDER)).toHaveLength(1)
    expect(drive.named(DRIVE_FILE)).toHaveLength(1)
  })

  it('makes the document in a folder the app made earlier, and passes over one in the bin', async () => {
    const drive = new FakeDrive()
    const binned = drive.add(DRIVE_FOLDER, FOLDER_MIME, ['root'])
    binned.trashed = true
    const kept = drive.add(DRIVE_FOLDER, FOLDER_MIME, ['root'])

    const document = await opened(drive)
    expect(document.created).toBe(true)
    expect(drive.files.get(document.fileId)?.parents).toEqual([kept.id])
    expect(drive.named(DRIVE_FOLDER)).toHaveLength(2)
  })

  it('reads the head revision’s bytes, and the revision is the version', async () => {
    const drive = new FakeDrive()
    const document = await opened(drive)
    const head = drive.files.get(document.fileId)?.revisions.at(-1)

    const read = await document.store.read(document.path)
    if (!read.ok) throw new Error(read.error)
    expect(read.value.version).toBe(head?.id)
    expect(read.value.bytes).toEqual(head?.bytes)
    // The bytes are downloaded by the revision's id, never "whatever is there now".
    expect(drive.requests.some((one) => one.url.includes(`/revisions/${String(head?.id)}?alt=media`))).toBe(true)
  })

  it('writes over the revision it read, and Drive keeps the one it replaced', async () => {
    const drive = new FakeDrive()
    const document = await opened(drive)

    const declared = await withDocumentStore(document.store, () => declareFormatTool.run({ ...BOOK, commit: true }, NO_CLIENT))
    expect(declared).not.toContain('REFUSED')
    expect(declared).not.toContain('copied to')
    const recorded = await withDocumentStore(document.store, () =>
      recordFormatRowsTool.run({ path: DRIVE_DOCUMENT_PATH, format: 'book', rows: [{ title: 'Dune' }], commit: true }, NO_CLIENT),
    )
    expect(recorded).not.toContain('REFUSED')

    // The made revision and one per write: the earlier copies are Drive's.
    expect(drive.files.get(document.fileId)?.revisions).toHaveLength(3)
    const rows = await withDocumentStore(document.store, () =>
      formatRowsTool.run({ path: DRIVE_DOCUMENT_PATH, format: 'book' }, NO_CLIENT),
    )
    expect(rows).toContain('Dune')
    // Still text, so Drive still previews it.
    expect(new TextDecoder().decode(drive.content(document.fileId))).toContain('Dune')
  })

  it('refuses a write over a document that changed since it was read, and writes nothing', async () => {
    const drive = new FakeDrive()
    const document = await opened(drive)
    const read = await document.store.read(document.path)
    if (!read.ok) throw new Error(read.error)

    // The person's other device writes between this call's read and its write.
    const theirs = await bookBytes()
    drive.change(document.fileId, theirs)

    const written = await document.store.write(document.path, read.value.bytes, read.value.version)
    expect(written).toEqual({ ok: false, error: CHANGED_SINCE_READ })
    expect(CHANGED_SINCE_READ).toContain('changed in your Google Drive since this call read it')
    expect(CHANGED_SINCE_READ).toContain('Ask again')
    expect(drive.content(document.fileId)).toBe(theirs)
    expect(drive.requests.some((one) => one.method === 'PATCH')).toBe(false)
  })

  it('brings the refusal to the tool as a refusal, with nothing written', async () => {
    const drive = new FakeDrive()
    const document = await opened(drive)
    const store = document.store
    const realRead = store.read.bind(store)
    const before = drive.content(document.fileId)
    const changed = await bookBytes()
    const racing = {
      ...store,
      read: async (path: string) => {
        const read = await realRead(path)
        drive.change(document.fileId, changed)
        return read
      },
    }

    const answer = await withDocumentStore(racing, () => declareFormatTool.run({ ...BOOK, commit: true }, NO_CLIENT))
    expect(answer).toContain(`REFUSED — nothing was written to ${DRIVE_DOCUMENT_PATH}.`)
    expect(answer).toContain(CHANGED_SINCE_READ)
    expect(drive.content(document.fileId)).toBe(changed)
    expect(drive.content(document.fileId)).not.toBe(before)
  })

  it('refuses a document over 5 MB at write, before anything is sent', async () => {
    const drive = new FakeDrive()
    const document = await opened(drive)
    const read = await document.store.read(document.path)
    if (!read.ok) throw new Error(read.error)
    const sent = drive.requests.length

    const written = await document.store.write(document.path, new Uint8Array(DRIVE_DOCUMENT_LIMIT + 1), read.value.version)
    expect(written.ok).toBe(false)
    if (written.ok) return
    expect(written.error).toContain('over the 5.0 MB a document on the Google Drive connector may be')
    expect(written.error).toContain('nothing was written')
    expect(drive.requests).toHaveLength(sent)

    // Exactly 5 MB is taken.
    const atLimit = await document.store.write(document.path, new Uint8Array(DRIVE_DOCUMENT_LIMIT), read.value.version)
    expect(atLimit.ok).toBe(true)
  })

  it('keeps no copies of its own: Drive’s version history is the earlier copies', async () => {
    const drive = new FakeDrive()
    const document = await opened(drive)
    expect(document.store.copies).toBeUndefined()
  })

  it('says a token Google will not take as a sign-in to make again, and sends nothing but to Drive', async () => {
    const drive = new FakeDrive()
    const refused = await openDriveDocument({ accessToken: 'expired', fetch: drive.fetch })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error).toContain('Sign in to the connector again')
    expect(drive.files.size).toBe(0)

    await opened(drive)
    for (const request of drive.requests) expect(new URL(request.url).host).toBe('www.googleapis.com')
  })

  it('queues one process’s writers to one file, so neither refuses the other', async () => {
    const drive = new FakeDrive()
    const document = await opened(drive)

    const [one, two] = await Promise.all([
      withDocumentStore(document.store, () => declareFormatTool.run({ ...BOOK, commit: true }, NO_CLIENT)),
      withDocumentStore(document.store, () =>
        declareFormatTool.run({ ...BOOK, format: 'film', title: 'Film', commit: true }, NO_CLIENT),
      ),
    ])
    expect(one).not.toContain('REFUSED')
    expect(two).not.toContain('REFUSED')
    const text = new TextDecoder().decode(drive.content(document.fileId))
    expect(text).toContain('book')
    expect(text).toContain('film')
  })
})

describe('the fake Drive the store is tested against', () => {
  it('takes back what a multipart create sent, byte for byte', async () => {
    // Every byte value, CR and LF among them, as a SQLite document's bytes would hold.
    const bytes = Uint8Array.from({ length: 512 }, (_, at) => at % 256)
    const drive = new FakeDrive()
    const folder = drive.add(DRIVE_FOLDER, FOLDER_MIME, ['root'])
    const { driveClient } = await import('./drive.ts')
    const made = await driveClient(drive.token, drive.fetch).createFile('x.emd', folder.id, 'application/octet-stream', bytes)
    expect(drive.content(made.id)).toEqual(bytes)
  })
})
