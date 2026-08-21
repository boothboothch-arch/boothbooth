export type SalePhase = 'scheduled' | 'open' | 'temporarily_full' | 'sold_out' | 'manually_closed' | 'ended'

export type SaleStatus = {
  configured: boolean
  saleId: string | null
  roundNumber: number
  title: string
  phase: SalePhase
  startsAt: string
  endsAt: string
  orderLimit: number
  submittedCount: number
  activeReservations: number
  remainingCount: number
  serverNow: string
}

export const fallbackSaleStatus: SaleStatus = {
  configured: false,
  saleId: null,
  roundNumber: 0,
  title: '부스부스 이니셜 주문',
  phase: 'scheduled',
  startsAt: '2026-09-01T03:00:00.000Z',
  endsAt: '2026-09-07T14:59:59.000Z',
  orderLimit: 100,
  submittedCount: 0,
  activeReservations: 0,
  remainingCount: 100,
  serverNow: new Date().toISOString(),
}

export function getSaleLabel(phase: SalePhase) {
  switch (phase) {
    case 'open': return '주문 가능'
    case 'temporarily_full': return '현재 작성 중'
    case 'sold_out': return '품절'
    case 'manually_closed': return '조기 마감'
    case 'ended': return '판매 종료'
    default: return '판매 예정'
  }
}
