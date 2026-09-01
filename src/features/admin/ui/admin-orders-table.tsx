'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { AlertTriangle, CheckCircle2, LoaderCircle, X } from 'lucide-react'
import { bulkUpdateOrderStateAction } from '@/features/admin/actions'
import { orderStateLabel, orderStateOptions, orderStateTone, type OrderView } from '@/features/order/domain/order'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'

export type AdminOrderRow = {
  id: string
  saleLabel: string
  saleKind: 'live' | 'test'
  orderNumber: string
  customerName: string
  depositorName: string
  totalQuantity: number
  totalAmount: number
  orderState: OrderView['orderState']
  fulfillmentType: OrderView['fulfillmentType']
  hasTrackingNumber: boolean
  overdue: boolean
  createdAtLabel: string
}

type Feedback = { tone: 'success' | 'error'; message: string }

function countBy<T extends string>(values: T[]) {
  return values.reduce<Partial<Record<T, number>>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1
    return counts
  }, {})
}

export function AdminOrdersTable({ orders }: { orders: AdminOrderRow[] }) {
  const router = useRouter()
  const selectAllRef = useRef<HTMLInputElement>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [targetState, setTargetState] = useState<OrderView['orderState'] | ''>('')
  const [confirming, setConfirming] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [pending, startTransition] = useTransition()
  const orderKey = orders.map((order) => order.id).join(':')
  const selectedOrders = useMemo(
    () => orders.filter((order) => selectedIds.has(order.id)),
    [orders, selectedIds],
  )
  const allSelected = orders.length > 0 && selectedIds.size === orders.length
  const partiallySelected = selectedIds.size > 0 && !allSelected
  const unchangedCount = targetState
    ? selectedOrders.filter((order) => order.orderState === targetState).length
    : 0
  const missingTrackingCount = targetState === 'completed'
    ? selectedOrders.filter((order) => order.fulfillmentType === 'shipping' && !order.hasTrackingNumber && order.orderState !== 'completed').length
    : 0
  const canApply = selectedIds.size > 0 && Boolean(targetState) && unchangedCount < selectedIds.size && missingTrackingCount === 0 && !pending

  useEffect(() => {
    setSelectedIds(new Set())
    setTargetState('')
    setConfirming(false)
    setFeedback(null)
  }, [orderKey])

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = partiallySelected
  }, [partiallySelected])

  useEffect(() => {
    if (!confirming) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) setConfirming(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [confirming, pending])

  function toggleAll() {
    setFeedback(null)
    setSelectedIds(allSelected ? new Set() : new Set(orders.map((order) => order.id)))
  }

  function toggleOne(orderId: string) {
    setFeedback(null)
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  function clearSelection() {
    setSelectedIds(new Set())
    setTargetState('')
    setConfirming(false)
  }

  function applyBulkUpdate() {
    if (!targetState || !canApply) return
    const orderIds = selectedOrders.map((order) => order.id)
    const nextState = targetState
    startTransition(async () => {
      const result = await bulkUpdateOrderStateAction({ orderIds, orderState: nextState })
      setConfirming(false)
      if (!result.ok) {
        setFeedback({ tone: 'error', message: result.message })
        return
      }
      clearSelection()
      setFeedback({
        tone: 'success',
        message: `${result.changedCount}건을 ${orderStateLabel[nextState]} 상태로 변경했습니다.${result.unchangedCount ? ` 이미 같은 상태였던 ${result.unchangedCount}건은 제외했습니다.` : ''}`,
      })
      router.refresh()
    })
  }

  const stateCounts = countBy(selectedOrders.map((order) => order.orderState))
  const saleCounts = countBy(selectedOrders.map((order) => order.saleLabel))

  return (
    <>
      {feedback && (
        <div className={`notice ${feedback.tone === 'success' ? 'notice--success' : 'notice--error'} admin-bulk-feedback`} role={feedback.tone === 'error' ? 'alert' : 'status'}>
          {feedback.tone === 'success' ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
          <span>{feedback.message}</span>
          <button type="button" aria-label="알림 닫기" onClick={() => setFeedback(null)}><X size={15} /></button>
        </div>
      )}
      <section className={`admin-panel admin-orders-selectable ${selectedIds.size ? 'admin-orders-selectable--active' : ''}`}>
        <div className="admin-table-wrap">
          <table className="admin-table admin-orders-table">
            <thead>
              <tr>
                <th className="admin-order-select-cell">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allSelected}
                    disabled={!orders.length || pending}
                    aria-label={allSelected ? '조회된 주문 전체 선택 해제' : '조회된 주문 전체 선택'}
                    onChange={toggleAll}
                  />
                </th>
                <th>차수</th><th>주문번호</th><th>주문자 / 입금자</th><th>상품</th><th>금액</th><th>주문 상태</th><th>접수일</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id} className={selectedIds.has(order.id) ? 'is-selected' : ''}>
                  <td className="admin-order-select-cell">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(order.id)}
                      disabled={pending}
                      aria-label={`${order.orderNumber} 선택`}
                      onChange={() => toggleOne(order.id)}
                    />
                  </td>
                  <td>{order.saleLabel}{order.saleKind === 'test' && <small className="text-danger">테스트</small>}</td>
                  <td><Link href={`/admin/orders/${order.orderNumber}`}>{order.orderNumber}</Link>{order.overdue && <small className="text-danger">입금 1시간 경과</small>}</td>
                  <td>{order.customerName}<small>{order.depositorName}</small></td>
                  <td>{order.totalQuantity}개</td>
                  <td>{order.totalAmount.toLocaleString('ko-KR')}원</td>
                  <td><Badge className="admin-order-status-badge" tone={orderStateTone(order.orderState)}>{orderStateLabel[order.orderState]}</Badge></td>
                  <td>{order.createdAtLabel}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!orders.length && <div className="admin-empty">조건에 맞는 주문이 없습니다.</div>}
        </div>
      </section>

      {selectedIds.size > 0 && (
        <div className="admin-bulk-bar" role="region" aria-label="선택 주문 일괄 작업">
          <div className="admin-bulk-bar__selection">
            <strong>{selectedIds.size}건 선택</strong>
            <button type="button" onClick={clearSelection} disabled={pending}>선택 해제</button>
          </div>
          <div className="admin-bulk-bar__action">
            <select
              value={targetState}
              aria-label="변경할 주문 상태"
              disabled={pending}
              onChange={(event) => setTargetState(event.target.value as OrderView['orderState'] | '')}
            >
              <option value="">변경할 상태 선택</option>
              {orderStateOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <Button type="button" variant={targetState === 'cancelled' ? 'danger' : 'primary'} disabled={!canApply} onClick={() => setConfirming(true)}>
              {pending && <LoaderCircle className="admin-bulk-spinner" size={15} />} 적용
            </Button>
          </div>
          {targetState && unchangedCount === selectedIds.size && <small>선택한 주문이 이미 모두 {orderStateLabel[targetState]} 상태입니다.</small>}
          {missingTrackingCount > 0 && <small className="text-danger">운송장 번호가 없는 택배 주문 {missingTrackingCount}건은 출고 완료로 변경할 수 없습니다.</small>}
        </div>
      )}

      {confirming && targetState && (
        <div className="admin-bulk-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) setConfirming(false) }}>
          <section className="admin-bulk-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-dialog-title">
            <span className={`admin-bulk-dialog__icon ${targetState === 'cancelled' ? 'is-danger' : ''}`}><AlertTriangle size={21} /></span>
            <h2 id="bulk-dialog-title">{selectedIds.size}건을 {orderStateLabel[targetState]} 상태로 변경할까요?</h2>
            <p>선택한 주문의 주문·입금 상태가 함께 변경됩니다. 처리 중 오류가 생기면 어떤 주문도 변경되지 않습니다.</p>
            <dl>
              <div><dt>현재 상태</dt><dd>{Object.entries(stateCounts).map(([state, count]) => `${orderStateLabel[state as OrderView['orderState']]} ${count}건`).join(' · ')}</dd></div>
              <div><dt>판매 차수</dt><dd>{Object.entries(saleCounts).map(([sale, count]) => `${sale} ${count}건`).join(' · ')}</dd></div>
              {unchangedCount > 0 && <div><dt>변경 제외</dt><dd>이미 같은 상태인 주문 {unchangedCount}건</dd></div>}
            </dl>
            {targetState === 'cancelled' && <div className="notice notice--warning">미입금 취소로 변경한 주문은 고객 주문 화면에도 즉시 취소 상태로 표시됩니다.</div>}
            <div className="admin-bulk-dialog__actions">
              <Button type="button" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>돌아가기</Button>
              <Button type="button" variant={targetState === 'cancelled' ? 'danger' : 'primary'} disabled={pending} autoFocus onClick={applyBulkUpdate}>
                {pending && <LoaderCircle className="admin-bulk-spinner" size={15} />}{orderStateLabel[targetState]}로 변경
              </Button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
