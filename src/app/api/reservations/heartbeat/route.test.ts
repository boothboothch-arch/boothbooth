// @vitest-environment node
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/server/supabase/privileged-client', () => ({ createPrivilegedClient: () => ({ rpc }) }))
vi.mock('@/server/security/crypto', () => ({ hmac: () => 'hashed-token' }))

beforeEach(() => rpc.mockReset())
afterEach(() => vi.restoreAllMocks())
const request = (cookie = 'bb_reservation=test-token') => new NextRequest('https://boothbooth.kr/api/reservations/heartbeat', {
  method: 'POST', headers: { cookie, origin: 'https://boothbooth.kr' },
})

describe('reservation heartbeat API', () => {
  it('returns confirmed expiration as 410', async () => {
    rpc.mockResolvedValue({ error: { message: 'RESERVATION_EXPIRED', code: 'P0001' } })
    const response = await POST(request())
    expect(response.status).toBe(410)
    expect((await response.json()).error.code).toBe('RESERVATION_EXPIRED')
  })
  it('returns database failures as retryable 503 rather than expiration', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    rpc.mockResolvedValue({ error: { message: 'connection unavailable', code: '08006' } })
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect((await response.json()).error.code).toBe('RESERVATION_CHECK_FAILED')
  })
  it('requires a reservation cookie', async () => {
    const response = await POST(request(''))
    expect(response.status).toBe(410)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('returns renewed reservation data', async () => {
    const data = { hardExpiresAt: '2026-09-17T02:30:00Z' }
    rpc.mockResolvedValue({ data, error: null })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(data)
  })
})
