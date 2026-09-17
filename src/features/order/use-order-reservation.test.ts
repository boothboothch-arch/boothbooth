import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOrderReservation } from './use-order-reservation'

const start = new Date('2026-09-17T02:00:00Z')
const end = new Date(start.getTime() + 30 * 60_000).toISOString()
const fetchMock = vi.fn()
const expiredResponse = () => Response.json({ error: { code: 'RESERVATION_EXPIRED' } }, { status: 410 })
const mount = () => renderHook(() => useOrderReservation(end, start.toISOString()))
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(start)
  fetchMock.mockReset().mockImplementation(async () => Response.json({}))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('order reservation lifecycle', () => {
  it('does not release the reservation on pagehide or unmount', async () => {
    const { unmount } = mount()
    act(() => window.dispatchEvent(new Event('pagehide')))
    unmount()
    await advance(60_000)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries server failures without expiring or releasing the reservation', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ error: { code: 'RESERVATION_CHECK_FAILED' } }, { status: 503 }))
    const { result } = mount()
    await advance(30_000)
    expect(result.current.expired).toBe(false)
    expect(result.current.reservationError).toContain('자동으로 다시 확인')
    await advance(30_000)
    expect(result.current.reservationError).toBe('')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(Array(2).fill('/api/reservations/heartbeat'))
  })

  it('handles a disconnected network and recovers on the next heartbeat', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const { result } = mount()
    await advance(30_000)
    expect(result.current.expired).toBe(false)
    expect(result.current.reservationError).not.toBe('')
    await advance(30_000)
    expect(result.current.reservationError).toBe('')
  })

  it('shows confirmed expiration in place and prevents another submit', async () => {
    fetchMock.mockResolvedValue(expiredResponse())
    const { result } = mount()
    await advance(30_000)
    expect(result.current.expired).toBe(true)
    expect(result.current.reservationError).toContain('입력 내용은 화면에 남아')
    expect(result.current.beginSubmission()).toBe(false)
    await advance(30_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not interpret an unrelated 410 as confirmed expiration', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { code: 'OTHER_ERROR' } }, { status: 410 }))
    const { result } = mount()
    await advance(30_000)
    expect(result.current.expired).toBe(false)
  })

  it('keeps renewing throughout a long upload and ignores expiration while submitting', async () => {
    fetchMock.mockImplementation(async () => expiredResponse())
    const { result } = mount()
    act(() => expect(result.current.beginSubmission()).toBe(true))
    await advance(31 * 60_000)
    expect(fetchMock).toHaveBeenCalledTimes(62)
    expect(result.current.expired).toBe(false)
    expect(result.current.idleWarning).toBe(false)
    expect(result.current.reservationError).toBe('')
    await act(() => result.current.releaseAndLeave('leave'))
    expect(fetchMock.mock.calls.every(([url]) => url === '/api/reservations/heartbeat')).toBe(true)
    expect(result.current.beginSubmission()).toBe(false)
  })

  it('ignores an old heartbeat resolving after submission starts and fails', async () => {
    let resolve!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r }))
    const { result } = mount()
    await advance(30_000)
    act(() => { result.current.beginSubmission(); result.current.submissionFailed() })
    await act(async () => resolve(expiredResponse()))
    expect(result.current.expired).toBe(false)
    await advance(30_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    act(() => expect(result.current.beginSubmission()).toBe(true))
  })

  it('ignores a heartbeat started during submission that resolves after failure', async () => {
    let resolve!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise<Response>(r => { resolve = r }))
    const { result } = mount()
    act(() => { result.current.beginSubmission() })
    await advance(30_000)
    act(() => result.current.submissionFailed())
    await act(async () => resolve(expiredResponse()))
    expect(result.current.expired).toBe(false)
    fetchMock.mockResolvedValueOnce(expiredResponse())
    await advance(30_000)
    expect(result.current.expired).toBe(true)
  })

  it('bounds a hung heartbeat and retries without releasing the reservation', async () => {
    fetchMock.mockImplementationOnce((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
    }))
    const { result } = mount()
    await advance(40_000)
    expect(result.current.reservationError).not.toBe('')
    expect(result.current.expired).toBe(false)
    await advance(20_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.reservationError).toBe('')
  })

  it('checks the reservation promptly when the browser comes online', async () => {
    mount()
    await act(async () => { window.dispatchEvent(new Event('online')) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('warns at five idle minutes and expires in place at six', async () => {
    const { result } = mount()
    await advance(5 * 60_000)
    expect(result.current.idleWarning).toBe(true)
    await advance(60_000)
    expect(result.current.expired).toBe(true)
    expect(result.current.idleWarning).toBe(false)
    expect(fetchMock.mock.calls.every(([url]) => url === '/api/reservations/heartbeat')).toBe(true)
  })

  it('enforces the hard deadline while editing even with recent activity', async () => {
    const { result } = mount()
    for (let minute = 0; minute < 30; minute++) {
      act(() => result.current.markActivity())
      await advance(60_000)
    }
    expect(result.current.expired).toBe(true)
    expect(result.current.reservationError).toContain('30분')
  })
})
