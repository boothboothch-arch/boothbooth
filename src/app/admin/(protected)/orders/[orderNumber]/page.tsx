import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { notFound } from 'next/navigation'
import { updateOrderAction, updateOrderInfoAction } from '@/features/admin/actions'
import { AdminOrderItemEditor } from '@/features/admin/ui/admin-order-item-editor'
import { orderStateOptions } from '@/features/order/domain/order'
import { getOrderByNumber } from '@/server/orders/get-order'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { Button } from '@/shared/ui/button'

type Props = { params: Promise<{ orderNumber: string }>; searchParams: Promise<{ saved?: string; itemSaved?: string; error?: string }> }

export default async function AdminOrderPage({ params, searchParams }: Props) {
  const [{ orderNumber }, query] = await Promise.all([params, searchParams])
  const order = await getOrderByNumber(orderNumber)
  if (!order) notFound()
  const client = createPrivilegedClient()
  const [{ data: changeLogs }, { data: emailJobs }] = await Promise.all([
    client.from('order_item_change_logs').select('id,order_item_id,before_data,after_data,order_total_before,order_total_after,created_at').eq('order_id', order.id).order('created_at', { ascending: false }),
    client.from('email_outbox').select('state,attempt_count,last_error,sent_at').eq('order_id', order.id).eq('event_type', 'order_received').order('created_at', { ascending: false }).limit(1),
  ])
  const latestEmail = emailJobs?.[0]
  const logsByItem = new Map<string, { id: number; beforeData: Record<string, unknown>; afterData: Record<string, unknown>; orderTotalBefore: number; orderTotalAfter: number; createdAt: string }[]>()
  for (const log of changeLogs ?? []) {
    const entries = logsByItem.get(log.order_item_id) ?? []
    entries.push({ id: log.id, beforeData: log.before_data as Record<string, unknown>, afterData: log.after_data as Record<string, unknown>, orderTotalBefore: log.order_total_before, orderTotalAfter: log.order_total_after, createdAt: log.created_at })
    logsByItem.set(log.order_item_id, entries)
  }
  const overdue = order.orderState === 'payment_pending' && order.paymentState === 'pending' && Date.parse(order.paymentDueAt) < Date.now()
  return (
    <>
      <div className="admin-heading"><div><Link className="admin-back" href={{ pathname: '/admin/orders', query: { saleId: order.saleId } }}><ArrowLeft size={14} /> {order.roundNumber}차 주문 목록</Link><h1>{order.orderNumber}</h1><p>{order.saleKind === 'test' ? '테스트 주문 · ' : ''}{order.roundNumber}차 · {new Date(order.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} 접수 · {order.customerName}</p></div></div>
      {query.saved && <div className="notice notice--success">변경 내용을 저장했습니다.</div>}
      {query.itemSaved && <div className="notice notice--success">상품별 제작 정보를 저장했습니다.</div>}
      {query.error && <div className="notice notice--error">저장하지 못했습니다: {query.error}</div>}
      {overdue && <div className="notice notice--warning">입금 안내 1시간이 지났습니다. 실제 입금 내역을 확인한 뒤 주문 상태를 변경해주세요.</div>}
      <div className="admin-detail-grid">
        <div className="admin-panel admin-detail-summary">
          <form className="admin-order-info-form" action={updateOrderInfoAction}><input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="orderNumber" value={order.orderNumber} /><input type="hidden" name="fulfillmentType" value={order.fulfillmentType} /><h2>주문자와 수령 정보</h2><div className="form-grid"><div className="field"><label>주문자</label><input name="customerName" defaultValue={order.customerName} required /></div><div className="field"><label>입금자명</label><input name="depositorName" defaultValue={order.depositorName} required /></div><div className="field"><label>휴대전화</label><input name="phone" defaultValue={order.phone} required /></div><div className="field"><label>이메일</label><input name="email" type="email" defaultValue={order.email} required /></div>{order.address && <><div className="field"><label>우편번호</label><input name="postalCode" defaultValue={order.address.postalCode} required /></div><div className="field"><label>기본 주소</label><input name="address" defaultValue={order.address.address} required /></div><div className="field field--full"><label>상세 주소</label><input name="addressDetail" defaultValue={order.address.addressDetail} required /></div></>}</div>{latestEmail && <div className={`notice ${latestEmail.state === 'sent' ? 'notice--success' : latestEmail.state === 'failed' ? 'notice--error' : 'notice--warning'}`}>주문 확인 이메일: {latestEmail.state === 'sent' ? '발송 완료' : latestEmail.state === 'failed' ? latestEmail.attempt_count >= 5 ? '발송 실패 · 자동 재시도 종료' : `발송 재시도 중 (${latestEmail.attempt_count}/5)` : '발송 대기 중'}{latestEmail.last_error && <small>{latestEmail.last_error}</small>}</div>}{order.deliveryZone === 'remote' && <div className="notice notice--warning">제주·도서산간 추가 배송비가 적용된 주문입니다.</div>}{order.pickup && <p className="field__hint">픽업: {order.pickup.name}{order.pickup.address ? ` · ${order.pickup.address}` : ''}{order.pickup.notice ? ` · ${order.pickup.notice}` : ''}</p>}<p className="field__hint">현금영수증: {order.cashReceiptType === 'none' ? '미신청' : `${order.cashReceiptType === 'personal' ? '소득공제' : '지출증빙'} · ${order.cashReceiptIdentifier}`}</p><Button type="submit" variant="secondary">주문자 정보 저장</Button></form>
          <h2>상품별 제작 정보</h2>{order.items.map((item, index) => <AdminOrderItemEditor key={item.id} orderId={order.id} orderNumber={order.orderNumber} orderState={order.orderState} item={item} index={index} product={order.availableProducts.find((product) => product.id === item.productId) ?? null} logs={logsByItem.get(item.id) ?? []} />)}
          <div className="summary-box"><div className="summary-line"><span>상품 합계</span><strong>{order.subtotalAmount.toLocaleString('ko-KR')}원</strong></div><div className="summary-line"><span>기본 배송비</span><strong>{order.baseShippingFee ? `${order.baseShippingFee.toLocaleString('ko-KR')}원` : '무료'}</strong></div>{order.remoteAreaSurcharge > 0 && <div className="summary-line"><span>제주·도서산간 추가 배송비</span><strong>+{order.remoteAreaSurcharge.toLocaleString('ko-KR')}원</strong></div>}<div className="summary-line summary-line--total"><span>최종 입금액</span><strong>{order.totalAmount.toLocaleString('ko-KR')}원</strong></div></div>
        </div>
        <div className="admin-side-stack"><form className="admin-panel admin-state-form" action={updateOrderAction}>
          <input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="orderNumber" value={order.orderNumber} /><input type="hidden" name="fulfillmentType" value={order.fulfillmentType} />
          <h2>상태 변경</h2><div className="field admin-state-form__status" data-state={order.orderState}><label>현재 주문 상태</label><select name="orderState" defaultValue={order.orderState}>{orderStateOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><span className="field__hint">입금 상태는 선택한 주문 상태에 맞춰 자동으로 반영됩니다.</span></div>
          {order.fulfillmentType === 'shipping' && <><h2>배송 정보</h2><div className="form-grid"><div className="field"><label>택배사 코드</label><input name="carrierCode" defaultValue={order.shipment?.carrierCode ?? ''} /></div><div className="field"><label>택배사</label><input name="carrierName" defaultValue={order.shipment?.carrierName ?? ''} placeholder="CJ대한통운" /></div><div className="field field--full"><label>운송장 번호</label><input name="trackingNumber" defaultValue={order.shipment?.trackingNumber ?? ''} /><span className="field__hint">출고 완료로 변경할 때 반드시 입력해주세요.</span></div></div></>}
          <Button type="submit">변경 내용 저장</Button>
        </form></div>
      </div>
    </>
  )
}
