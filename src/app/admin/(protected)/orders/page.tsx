import { Download, Search } from 'lucide-react'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { orderStateOptions, type OrderView } from '@/features/order/domain/order'
import { AdminOrdersTable, type AdminOrderRow } from '@/features/admin/ui/admin-orders-table'
import { hmac, normalizeEmail, normalizePhone } from '@/server/security/crypto'

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
  let query = client.from('orders').select('id,sale_id,order_number,customer_name,depositor_name,total_quantity,total_amount,order_state,payment_state,payment_due_at,fulfillment_type,cash_receipt_type,created_at,shipments(tracking_number)').order('created_at', { ascending: false })
  if (saleId !== 'all') query = query.eq('sale_id', saleId)
  const textQuery = q.replace(/[^\p{L}\p{N}\s-]/gu, '')
  if (q.includes('@')) query = query.eq('email_normalized_hash', hmac(normalizeEmail(q)))
  else if (/^[\d\s-]+$/.test(q) && normalizePhone(q).length >= 10) query = query.eq('phone_normalized_hash', hmac(normalizePhone(q)))
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
  const tableOrders: AdminOrderRow[] = (orders ?? []).map((order) => {
    const sale = saleMap.get(order.sale_id)
    const shipment = Array.isArray(order.shipments) ? order.shipments[0] : order.shipments
    return {
      id: order.id,
      saleLabel: sale ? `${sale.round_number}차` : '-',
      saleKind: sale?.sale_kind === 'test' ? 'test' : 'live',
      orderNumber: order.order_number,
      customerName: order.customer_name,
      depositorName: order.depositor_name,
      totalQuantity: order.total_quantity,
      totalAmount: order.total_amount,
      orderState: order.order_state as OrderView['orderState'],
      fulfillmentType: order.fulfillment_type as OrderView['fulfillmentType'],
      hasTrackingNumber: order.fulfillment_type !== 'shipping' || Boolean(shipment?.tracking_number?.trim()),
      needsCashReceiptSelfIssue: sale?.sale_kind !== 'test' && order.total_amount >= 100000 && order.payment_state === 'paid' && order.cash_receipt_type === 'none',
      overdue: order.order_state === 'payment_pending' && order.payment_state === 'pending' && Date.parse(order.payment_due_at) <= Date.now(),
      createdAtLabel: new Date(order.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }),
    }
  })
  return (
    <>
      <div className="admin-heading"><div><span className="eyebrow">ORDERS</span><h1>주문 관리</h1><p>입금 대기부터 출고 완료까지 주문 상태를 처리합니다.</p></div><a className="button button--secondary" href={csvHref}><Download size={15} /> CSV 다운로드</a></div>
      <form className="admin-filters admin-filters--extended"><select name="saleId" defaultValue={saleId} aria-label="판매 차수"><option value="all">전체 차수</option>{(sales ?? []).map((sale) => <option key={sale.id} value={sale.id}>{sale.sale_kind === 'test' ? '[테스트] ' : ''}{sale.round_number}차 · {sale.title}</option>)}</select><label><Search size={15} /><input name="q" defaultValue={q} placeholder="주문번호, 이름, 전화, 이메일, 입금자명" /></label><select name="state" defaultValue={state} aria-label="주문 상태"><option value="">모든 주문 상태</option>{orderStateOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><select name="itemType" defaultValue={itemType} aria-label="상품"><option value="">모든 상품</option><option value="shirt">티셔츠</option><option value="bag">가방</option></select><select name="fulfillment" defaultValue={fulfillment} aria-label="수령 방법"><option value="">모든 수령 방법</option><option value="shipping">택배</option><option value="pickup">픽업</option></select><select name="overdue" defaultValue={overdue} aria-label="입금 기한"><option value="">모든 입금 시간</option><option value="1">1시간 경과</option></select><input name="from" type="date" defaultValue={from} aria-label="주문 시작일" /><input name="to" type="date" defaultValue={to} aria-label="주문 종료일" /><button className="button button--primary" type="submit">검색</button></form>
      <AdminOrdersTable orders={tableOrders} />
    </>
  )
}
