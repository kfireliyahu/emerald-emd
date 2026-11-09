/**
 * **Google in memory, for the endpoint** (M57 U4): the sign-in's token
 * endpoint, Cloud Run's metadata server, Firestore's REST API and Drive
 * (`fakeDrive.ts`) behind one `fetch`, answered the way Google answers what the
 * endpoint sends — so `endpoint.test.ts` runs a whole sign-in and a call, and
 * `main.ts --local` runs the endpoint on this machine, with no request leaving
 * the process.
 *
 * Every request is kept in `sent`, and every write Firestore takes in
 * `firestore.writes`, so a test can say what was sent and what was kept.
 * Anything it has not been taught is a 400, so it fails a test rather than
 * passing it.
 */

import type { Fetch } from './drive.ts'
import { FakeDrive } from './fakeDrive.ts'
import { GOOGLE_TOKEN } from './signIn.ts'

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** An unsigned JWT carrying `claims` — enough for what the endpoint reads of an ID token. */
export function idToken(claims: Record<string, unknown>): string {
  const part = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'none' })}.${part(claims)}.`
}

interface StoredDocument {
  fields: Record<string, unknown>
  updateTime: string
}

/** Firestore's REST API, the five calls `usage.ts` makes. */
export class FakeFirestore {
  readonly documents = new Map<string, StoredDocument>()
  /** The `fields` of every write it took, in order. */
  readonly writes: Record<string, unknown>[] = []
  private clock = 0

  private stamp(): string {
    this.clock += 1
    return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, this.clock)).toISOString()
  }

  handle(url: URL, init: RequestInit): Response {
    const path = decodeURIComponent(url.pathname).replace(/^\/v1\//, '')
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}

    if (path.endsWith('/documents:runQuery') && method === 'POST') {
      const query = body['structuredQuery'] as { where: { fieldFilter: { value: { stringValue: string } } } }
      const before = query.where.fieldFilter.value.stringValue
      const found = [...this.documents].filter(([, document]) => {
        const day = (document.fields['day'] as { stringValue?: string } | undefined)?.stringValue
        return day !== undefined && day < before
      })
      return answer(200, found.length === 0 ? [{ readTime: this.stamp() }] : found.map(([name]) => ({ document: { name } })))
    }
    if (path.endsWith('/documents:commit') && method === 'POST') {
      for (const write of body['writes'] as { delete: string }[]) this.documents.delete(write.delete)
      return answer(200, { commitTime: this.stamp() })
    }
    if (method === 'GET') {
      const found = this.documents.get(path)
      return found === undefined
        ? answer(404, { error: { code: 404, status: 'NOT_FOUND' } })
        : answer(200, { name: path, fields: found.fields, updateTime: found.updateTime })
    }
    if (method === 'PATCH') {
      const existing = this.documents.get(path)
      const mustNotExist = url.searchParams.get('currentDocument.exists') === 'false'
      const updateTime = url.searchParams.get('currentDocument.updateTime')
      if (mustNotExist && existing !== undefined) return answer(409, { error: { code: 409, status: 'ALREADY_EXISTS' } })
      if (updateTime !== null && existing?.updateTime !== updateTime) {
        return answer(400, { error: { code: 400, status: 'FAILED_PRECONDITION' } })
      }
      const fields = body['fields'] as Record<string, unknown>
      this.writes.push(fields)
      const stored = { fields, updateTime: this.stamp() }
      this.documents.set(path, stored)
      return answer(200, { name: path, ...stored })
    }
    return answer(400, { error: { message: `The fake Firestore was not taught ${method} ${path}.` } })
  }
}

/** One person Google will sign in. */
export interface FakeAccount {
  readonly email: string
  /** Whether they let the connector see its files in Drive. */
  readonly drive?: boolean
}

export class FakeGoogle {
  readonly drive: FakeDrive
  readonly firestore = new FakeFirestore()
  /** Every request sent, by URL. */
  readonly sent: string[] = []
  private readonly codes = new Map<string, FakeAccount>()
  private readonly refreshes = new Map<string, FakeAccount>()
  private issued = 0

  constructor(drive = new FakeDrive()) {
    this.drive = drive
  }

  /** The code Google would hand back after `account` signs in. */
  signIn(account: FakeAccount): string {
    this.issued += 1
    const code = `google-code-${String(this.issued)}`
    this.codes.set(code, account)
    return code
  }

  /** Every refresh token stops working, as when a person removes the app's access. */
  revoke(): void {
    this.refreshes.clear()
  }

  readonly fetch: Fetch = async (url, init) => {
    this.sent.push(url)
    const parsed = new URL(url)
    if (url === GOOGLE_TOKEN) return this.token(new URLSearchParams(String(init.body)))
    if (parsed.host === 'metadata.google.internal') return answer(200, { access_token: 'metadata-token', expires_in: 3600 })
    if (parsed.host === 'firestore.googleapis.com') return this.firestore.handle(parsed, init)
    if (parsed.host === 'www.googleapis.com') return this.drive.fetch(url, init)
    return answer(400, { error: `The fake Google was not taught ${parsed.host}.` })
  }

  private token(form: URLSearchParams): Response {
    if (form.get('client_id') !== 'google-client' || form.get('client_secret') !== 'google-secret') {
      return answer(401, { error: 'invalid_client' })
    }
    if (form.get('grant_type') === 'authorization_code') {
      const account = this.codes.get(form.get('code') ?? '')
      if (account === undefined) return answer(400, { error: 'invalid_grant' })
      this.codes.delete(form.get('code') ?? '')
      const refresh = `google-refresh-${String(this.refreshes.size + 1)}`
      this.refreshes.set(refresh, account)
      return answer(200, {
        access_token: this.drive.token,
        expires_in: 3599,
        refresh_token: refresh,
        id_token: idToken({ iss: 'https://accounts.google.com', email: account.email, email_verified: true }),
        scope: `openid https://www.googleapis.com/auth/userinfo.email${account.drive === false ? '' : ' https://www.googleapis.com/auth/drive.file'}`,
        token_type: 'Bearer',
      })
    }
    if (form.get('grant_type') === 'refresh_token') {
      if (!this.refreshes.has(form.get('refresh_token') ?? '')) return answer(400, { error: 'invalid_grant' })
      return answer(200, { access_token: this.drive.token, expires_in: 3599, token_type: 'Bearer' })
    }
    return answer(400, { error: 'unsupported_grant_type' })
  }
}
