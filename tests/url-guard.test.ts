import { describe, expect, it, beforeAll } from 'vitest'
import { assertPublicUrl, isPrivateAddress } from '../src/main/core/url-guard'

beforeAll(() => {
  delete process.env.WEBFORGE_ALLOW_PRIVATE
})

describe('private address detection', () => {
  it('flags loopback, private, link-local and IPv6 local ranges', () => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.5.4', '192.168.1.1', '169.254.1.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1']) {
      expect(isPrivateAddress(address), address).toBe(true)
    }
  })

  it('accepts public addresses', () => {
    expect(isPrivateAddress('8.8.8.8')).toBe(false)
    expect(isPrivateAddress('1.1.1.1')).toBe(false)
    expect(isPrivateAddress('2606:4700:4700::1111')).toBe(false)
  })
})

describe('assertPublicUrl', () => {
  it('rejects non-http protocols', async () => {
    await expect(assertPublicUrl('ftp://example.com')).rejects.toMatchObject({ code: 'INVALID_URL' })
  })

  it('rejects malformed urls', async () => {
    await expect(assertPublicUrl('example')).rejects.toMatchObject({ code: 'INVALID_URL' })
  })

  it('rejects credentials in urls', async () => {
    await expect(assertPublicUrl('https://user:pass@example.com')).rejects.toMatchObject({
      code: 'URL_HAS_CREDENTIALS'
    })
  })

  it('rejects localhost and private IPs', async () => {
    await expect(assertPublicUrl('http://localhost:3000')).rejects.toMatchObject({
      code: 'PRIVATE_URL_NOT_ALLOWED'
    })
    await expect(assertPublicUrl('http://127.0.0.1/')).rejects.toMatchObject({
      code: 'PRIVATE_URL_NOT_ALLOWED'
    })
    await expect(assertPublicUrl('http://[::1]/')).rejects.toMatchObject({
      code: 'PRIVATE_URL_NOT_ALLOWED'
    })
  })

  it('accepts a public hostname and returns resolved addresses', async () => {
    const result = await assertPublicUrl('https://example.com')
    expect(result.url.hostname).toBe('example.com')
    expect(result.addresses.length).toBeGreaterThan(0)
  })
})
