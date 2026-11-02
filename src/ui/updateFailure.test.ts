import { describe, expect, it } from 'vitest'

import { plainCheckFailure, plainDownloadFailure } from './Notices.tsx'

// *An error names the fix* (M54 F6): the update notice never prints Chromium's
// or electron-updater's own words.
describe('why an update could not be had, in a person’s words', () => {
  it('says offline is the connection, without the code', () => {
    const said = plainCheckFailure('net::ERR_INTERNET_DISCONNECTED')
    expect(said).toMatch(/could not reach GitHub/)
    expect(said).not.toMatch(/ERR_|net::/)
  })

  it('says anything else is GitHub’s, without the raw reason', () => {
    const said = plainCheckFailure('HttpError: 503 Service Unavailable "method: GET url: https://api.github.com"')
    expect(said).toMatch(/GitHub did not answer/)
    expect(said).not.toMatch(/HttpError|503/)
  })

  it('keeps the checksum’s own sentence, and says the rest opens the page', () => {
    const checksum = 'The download did not match the checksum published with it, so it was not kept.'
    expect(plainDownloadFailure(checksum)).toBe(checksum)
    expect(plainDownloadFailure('HttpError: 404')).toBe('It could not be downloaded here, so Download opens its page instead.')
  })
})
