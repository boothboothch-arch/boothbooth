import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fallbackSaleStatus, type SalePhase } from '../domain/sale'
import { SalePanel } from './sale-panel'

const initialNow = '2026-10-11T00:00:00.000Z'
function show(phase: SalePhase, endsAt = '2026-10-12T00:00:00.000Z') {
  render(<SalePanel initialNow={initialNow} initialStatus={{ ...fallbackSaleStatus, configured: true, phase, startsAt: '2026-10-11T01:00:00.000Z', endsAt, serverNow: initialNow }} />)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(initialNow))
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('sale countdown', () => {
  it('shows the start countdown before opening', () => {
    show('scheduled')
    expect(screen.getByText('주문 시작까지')).toBeInTheDocument()
    expect(screen.queryByText('주문 마감까지')).not.toBeInTheDocument()
  })
  it.each(['open', 'temporarily_full'] as const)('hides the closing countdown and refresh button while %s', (phase) => {
    show(phase)
    expect(screen.queryByText('주문 마감까지')).not.toBeInTheDocument()
    expect(document.querySelector('.sale-panel__date')).not.toBeInTheDocument()
    expect(document.querySelector('.countdown')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '판매 상태 새로고침' })).not.toBeInTheDocument()
    expect(screen.getByText('준비된 수량 소진 시 일찍 마감될 수 있어요.')).toBeInTheDocument()
  })
  it.each(['sold_out', 'manually_closed', 'ended'] as const)('shows closure instead of countdown while %s', (phase) => {
    show(phase)
    expect(screen.getByText(phase === 'sold_out' ? '준비된 수량이 모두 소진되었어요.' : '주문이 마감되었습니다.')).toBeInTheDocument()
    if (phase === 'sold_out') expect(screen.getByRole('button', { name: '주문 마감' })).toBeDisabled()
    expect(screen.queryByText('주문 마감까지')).not.toBeInTheDocument()
  })
  it('closes and disables entry at the deadline before the next status poll', () => {
    show('open', '2026-10-11T00:00:02.000Z')
    expect(screen.getByRole('button', { name: '주문하기' })).toBeEnabled()
    act(() => { vi.advanceTimersByTime(2000) })
    expect(screen.getByText('주문이 마감되었습니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '판매 종료' })).toBeDisabled()
  })
})
