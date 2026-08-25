import Link from 'next/link'
import { Download, Search } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { orderStateLabel, orderStateOptions, orderStateTone, type OrderView } from '@/features/order/domain/order'
import { hmac, normalizePhone } from '@/server/security/crypto'

type Params = Promise<{ saleId?: string; q?: string; state?: string; from?: string; to?: string; itemType?: string; fulfillment?: string; overdue?: string }>

function kstBoundary(value: string, end = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00'}+09:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export default async function AdminOrdersPage({ searchParams }: { searchParams: Params }) {
  const params = await searchParams
  const { q = '', state = '', from = '', to = '', itemType = '', fulfillment = '', overdue = '' } = params
  const client = createPrivilegedClient()
  const [{ data: sales }, { data: publicStatus }] = await Promise.all([
    client.from('sales').select('id,round_number,title,sale_kind').order('round_number', { ascending: false }),
    client.rpc('get_sale_status'),
  ])
  const publicSaleId = (publicStatus as { saleId?: string } | null)?.saleId
  const saleId = params.saleId === 'all' ? 'all' : params.saleId || publicSaleId || sales?.[0]?.id || 'all'
  const saleMap = new Map((sales ?? []).map((sale) => [sale.id, sale]))
  let matchingOrderIds: string[] | null = null
  if (itemType) {
    let itemQuery = client.from('order_items').select('order_id')
    if (itemType) itemQuery = itemQuery.eq('item_type', itemType)
    const { data: matchedItems } = await itemQuery
    matchingOrderIds = [...new Set((matchedItems ?? []).map((item) => item.order_id))]
  }
  let query = client.from('orders').select('id,sale_id,order_number,customer_name,depositor_name,total_quantity,total_amount,order_state,payment_state,payment_due_at,created_at').order('created_at', { ascending: false })
  if (saleId !== 'all') query = query.eq('sale_id', saleId)
  const textQuery = q.replace(/[^\p{L}\p{N}\s-]/gu, '')
  if (/^[\d\s-]+$/.test(q) && normalizePhone(q).length >= 10) query = query.eq('phone_normalized_hash', hmac(normalizePhone(q)))
  else if (textQuery) query = query.or(`order_number.ilike.%${textQuery}%,customer_name.ilike.%${textQuery}%,depositor_name.ilike.%${textQuery}%`)
  if (state) query = query.eq('order_state', state)
  if (fulfillment) query = query.eq('fulfillment_type', fulfillment)
  if (overdue === '1') query = query.eq('order_state', 'payment_pending').eq('payment_state', 'pending').lte('payment_due_at', new Date().toISOString())
  const fromIso = kstBoundary(from)
  const toIso = kstBoundary(to, true)
  if (fromIso) query = query.gte('created_at', fromIso)
  if (toIso) query = query.lte('created_at', toIso)
  if (matchingOrderIds) query = query.in('id', matchingOrderIds.length ? matchingOrderIds : ['00000000-0000-0000-0000-000000000000'])
  const { data: orders } = await query
  const csvParams = new URLSearchParams()
  csvParams.set('saleId', saleId)
  if (q) csvParams.set('q', q)
  if (state) csvParams.set('state', state)
  if (from) csvParams.set('from', from)
  if (to) csvParams.set('to', to)
  if (itemType) csvParams.set('itemType', itemType)
  if (fulfillment) csvParams.set('fulfillment', fulfillment)
  if (overdue) csvParams.set('overdue', overdue)
  const csvHref = `/api/admin/orders.csv${csvParams.size ? `?${csvParams.toString()}` : ''}`
  return (
    <>
      <div className="admin-heading"><div><span className="eyebrow">ORDERS</span><h1>주문 관리</h1><p>입금 대기부터 출고 완료까지 주문 상태를 처리합니다.</p></div><a className="button button--secondary" href={csvHref}><Download size={15} /> CSV 다운로드</a></div>
      <form className="admin-filters admin-filters--extended"><select name="saleId" defaultValue={saleId} aria-label="판매 차수"><option value="all">전체 차수</option>{(sales ?? []).map((sale) => <option key={sale.id} value={sale.id}>{sale.sale_kind === 'test' ? '[테스트] ' : ''}{sale.round_number}차 · {sale.title}</option>)}</select><label><Search size={15} /><input name="q" defaultValue={q} placeholder="주문번호, 이름, 전화, 입금자명" /></label><select name="state" defaultValue={state} aria-label="주문 상태"><option value="">모든 주문 상태</option>{orderStateOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><select name="itemType" defaultValue={itemType} aria-label="상품"><option value="">모든 상품</option><option value="shirt">티셔츠</option><option value="bag">가방</option></select><select name="fulfillment" defaultValue={fulfillment} aria-label="수령 방법"><option value="">모든 수령 방법</option><option value="shipping">택배</option><option value="pickup">픽업</option></select><select name="overdue" defaultValue={overdue} aria-label="입금 기한"><option value="">모든 입금 시간</option><option value="1">1시간 경과</option></select><input name="from" type="date" defaultValue={from} aria-label="주문 시작일" /><input name="to" type="date" defaultValue={to} aria-label="주문 종료일" /><button className="button button--primary" type="submit">검색</button></form>
      <section className="admin-panel"><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>차수</th><th>주문번호</th><th>주문자 / 입금자</th><th>상품</th><th>금액</th><th>주문 상태</th><th>접수일</th></tr></thead><tbody>{(orders ?? []).map((order) => { const isOverdue = order.order_state === 'payment_pending' && order.payment_state === 'pending' && Date.parse(order.payment_due_at) <= Date.now(); const sale = saleMap.get(order.sale_id); const orderState = order.order_state as OrderView['orderState']; return <tr key={order.id}><td>{sale ? `${sale.round_number}차` : '-'}{sale?.sale_kind === 'test' && <small className="text-danger">테스트</small>}</td><td><Link href={`/admin/orders/${order.order_number}`}>{order.order_number}</Link>{isOverdue && <small className="text-danger">입금 1시간 경과</small>}</td><td>{order.customer_name}<small>{order.depositor_name}</small></td><td>{order.total_quantity}개</td><td>{order.total_amount.toLocaleString('ko-KR')}원</td><td><Badge className="admin-order-status-badge" tone={orderStateTone(orderState)}>{orderStateLabel[orderState]}</Badge></td><td>{new Date(order.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</td></tr>})}</tbody></table>{!orders?.length && <div className="admin-empty">조건에 맞는 주문이 없습니다.</div>}</div></section>
    </>
  )
}
