import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminOrdersTable, type AdminOrderRow } from './admin-orders-table'

const { bulkUpdateMock, refreshMock } = vi.hoisted(() => ({
  bulkUpdateMock: vi.fn(),
  refreshMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}))

vi.mock('@/features/admin/actions', () => ({
  bulkUpdateOrderStateAction: bulkUpdateMock,
}))

const orders: AdminOrderRow[] = [
  {
    id: '11111111-1111-4111-8111-111111111111',
    saleLabel: '1차',
    saleKind: 'live',
    orderNumber: 'BB-ORDER0001',
    customerName: '김고객',
    depositorName: '김입금',
    totalQuantity: 1,
    totalAmount: 66000,
    orderState: 'payment_pending',
    fulfillmentType: 'shipping',
    hasTrackingNumber: false,
    overdue: false,
    createdAtLabel: '2026. 9. 1.',
  },
  {
    id: '22222222-2222-4222-8222-222222222222',
    saleLabel: '1차',
    saleKind: 'live',
    orderNumber: 'BB-ORDER0002',
    customerName: '이고객',
    depositorName: '이입금',
    totalQuantity: 2,
    totalAmount: 132000,
    orderState: 'preparing',
    fulfillmentType: 'pickup',
    hasTrackingNumber: true,
    overdue: false,
    createdAtLabel: '2026. 9. 1.',
  },
]

describe('AdminOrdersTable', () => {
  afterEach(cleanup)

  beforeEach(() => {
    bulkUpdateMock.mockReset()
    refreshMock.mockReset()
  })

  it('조회 결과 전체를 선택하고 부분 선택 상태를 표시한다', () => {
    render(<AdminOrdersTable orders={orders} />)
    const selectAll = screen.getByLabelText('조회된 주문 전체 선택') as HTMLInputElement

    fireEvent.click(selectAll)
    expect(screen.getByText('2건 선택')).toBeInTheDocument()
    expect(selectAll.checked).toBe(true)

    fireEvent.click(screen.getByLabelText('BB-ORDER0001 선택'))
    expect(screen.getByText('1건 선택')).toBeInTheDocument()
    expect(selectAll.checked).toBe(false)
    expect(selectAll.indeterminate).toBe(true)
  })

  it('송장번호가 없는 택배 주문의 출고 완료 일괄 변경을 막는다', () => {
    render(<AdminOrdersTable orders={orders} />)

    fireEvent.click(screen.getByLabelText('BB-ORDER0001 선택'))
    fireEvent.change(screen.getByLabelText('변경할 주문 상태'), { target: { value: 'completed' } })

    expect(screen.getByText(/운송장 번호가 없는 택배 주문 1건/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '적용' })).toBeDisabled()
  })

  it('확인 후 선택 주문을 한 번의 일괄 작업으로 요청한다', async () => {
    bulkUpdateMock.mockResolvedValue({ ok: true, changedCount: 2, unchangedCount: 0 })
    render(<AdminOrdersTable orders={orders} />)

    fireEvent.click(screen.getByLabelText('조회된 주문 전체 선택'))
    fireEvent.change(screen.getByLabelText('변경할 주문 상태'), { target: { value: 'payment_confirmed' } })
    fireEvent.click(screen.getByRole('button', { name: '적용' }))

    expect(screen.getByRole('dialog')).toHaveTextContent('2건을 입금 완료 상태로 변경할까요?')
    fireEvent.click(screen.getByRole('button', { name: '입금 완료로 변경' }))

    await waitFor(() => expect(bulkUpdateMock).toHaveBeenCalledWith({
      orderIds: orders.map((order) => order.id),
      orderState: 'payment_confirmed',
    }))
    await waitFor(() => expect(screen.getByText('2건을 입금 완료 상태로 변경했습니다.')).toBeInTheDocument())
    expect(refreshMock).toHaveBeenCalledOnce()
  })
})
