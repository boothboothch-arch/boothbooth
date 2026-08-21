import { NextRequest } from 'next/server'
import { getAdmin } from '@/server/auth/admin'
import { decryptText, hmac, normalizeEmail, normalizePhone } from '@/server/security/crypto'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'

export const dynamic = 'force-dynamic'

function csvCell(value: unknown) {
  const raw = String(value ?? '')
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  return `"${safe.replaceAll('"', '""')}"`
}

function safeDecrypt(value: string) {
  try { return decryptText(value) } catch { return value }
}

function safeAddress(value: string) {
  try { return JSON.parse(safeDecrypt(value)) as { postalCode?: string; address?: string; addressDetail?: string } } catch { return {} }
}

function kstBoundary(value: string, end = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00'}+09:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export async function GET(request: NextRequest) {
  if (!await getAdmin()) return new Response('Unauthorized', { status: 401 })
  const client = createPrivilegedClient()
  const saleId = request.nextUrl.searchParams.get('saleId') ?? 'all'
  const q = request.nextUrl.searchParams.get('q')?.replaceAll(',', '') ?? ''
  const state = request.nextUrl.searchParams.get('state') ?? ''
  const payment = request.nextUrl.searchParams.get('payment') ?? ''
  const from = request.nextUrl.searchParams.get('from') ?? ''
  const to = request.nextUrl.searchParams.get('to') ?? ''
  const itemType = request.nextUrl.searchParams.get('itemType') ?? ''
  const fulfillment = request.nextUrl.searchParams.get('fulfillment') ?? ''
  const overdue = request.nextUrl.searchParams.get('overdue') ?? ''
  const size = request.nextUrl.searchParams.get('size') ?? ''
  let matchingOrderIds: string[] | null = null
  if (itemType || size) {
    let itemQuery = client.from('order_items').select('order_id')
    if (itemType) itemQuery = itemQuery.eq('item_type', itemType)
    if (size) itemQuery = itemQuery.eq('size', size)
    const { data: matchedItems } = await itemQuery
    matchingOrderIds = [...new Set((matchedItems ?? []).map((item) => item.order_id))]
  }
  let query = client.from('orders').select('*').order('created_at', { ascending: false })
  if (saleId !== 'all') query = query.eq('sale_id', saleId)
  const textQuery = q.replace(/[^\p{L}\p{N}\s-]/gu, '')
  if (q.includes('@')) query = query.eq('email_normalized_hash', hmac(normalizeEmail(q)))
  else if (/^[\d\s-]+$/.test(q) && normalizePhone(q).length >= 10) query = query.eq('phone_normalized_hash', hmac(normalizePhone(q)))
  else if (textQuery) query = query.or(`order_number.ilike.%${textQuery}%,customer_name.ilike.%${textQuery}%,depositor_name.ilike.%${textQuery}%`)
  if (state) query = query.eq('order_state', state)
  if (payment) query = query.eq('payment_state', payment)
  if (fulfillment) query = query.eq('fulfillment_type', fulfillment)
  if (overdue === '1') query = query.eq('order_state', 'payment_pending').eq('payment_state', 'pending').lte('payment_due_at', new Date().toISOString())
  const fromIso = kstBoundary(from)
  const toIso = kstBoundary(to, true)
  if (fromIso) query = query.gte('created_at', fromIso)
  if (toIso) query = query.lte('created_at', toIso)
  if (matchingOrderIds) query = query.in('id', matchingOrderIds.length ? matchingOrderIds : ['00000000-0000-0000-0000-000000000000'])
  const { data: orders, error } = await query
  if (error) return new Response('CSV 생성 실패', { status: 500 })
  const orderIds = (orders ?? []).map((order) => order.id)
  const [{ data: items }, { data: shipments }, { data: sales }] = await Promise.all([
    orderIds.length ? client.from('order_items').select('*').in('order_id', orderIds).order('id') : Promise.resolve({ data: [] }),
    orderIds.length ? client.from('shipments').select('*').in('order_id', orderIds) : Promise.resolve({ data: [] }),
    client.from('sales').select('id,round_number,title,sale_kind'),
  ])
  const saleMap = new Map((sales ?? []).map((sale) => [sale.id, sale]))
  const header = ['판매 차수','판매 제목','차수 용도','주문번호','주문 생성일','주문자 이름','휴대전화','이메일','수령 방법','우편번호','기본 주소','상세 주소','픽업 정보','상품별 제작 정보','총 상품 수','상품 합계','배송비','최종 입금액','입금자명','현금영수증 유형','현금영수증 번호','주문 상태','입금 상태','확인 필요 사유','입금 안내 시간','택배사','송장번호','취소 시각','취소 사유']
  const rows = (orders ?? []).map((order) => {
    const address = safeAddress(order.address_ciphertext)
    const orderItems = (items ?? []).filter((item) => item.order_id === order.id)
    const shipment = (shipments ?? []).find((item) => item.order_id === order.id)
    const sale = saleMap.get(order.sale_id)
    const itemSummary = orderItems.map((item) => `${item.product_name} / ${item.initial_text} / ${[item.size,item.gender].filter(Boolean).join('·') || '옵션없음'} / 스티커:${item.sticker_selected ? (item.sticker_categories ?? []).join('·') || '선택' : '미선택'} / 색상:${item.favorite_colors || '-'} / 대상:${item.favorite_things || '-'} / 분위기:${item.desired_mood || '-'} / 인스타:${item.instagram_reference || '-'} / 요청:${item.extra_request || '-'}`).join(' | ')
    const pickup = order.pickup_snapshot as { name?: string; address?: string; date?: string; startsAt?: string; endsAt?: string } | null
    return [sale ? `${sale.round_number}차` : '', sale?.title, sale?.sale_kind === 'test' ? '테스트' : '운영', order.order_number, order.created_at, order.customer_name, safeDecrypt(order.phone_ciphertext), safeDecrypt(order.email_ciphertext), order.fulfillment_type === 'pickup' ? '픽업' : '택배', address.postalCode, address.address, address.addressDetail, pickup ? `${pickup.name} ${pickup.address} ${pickup.date} ${pickup.startsAt}-${pickup.endsAt}` : '', itemSummary, order.total_quantity, order.subtotal_amount, order.shipping_fee, order.total_amount, order.depositor_name, order.cash_receipt_type, safeDecrypt(order.cash_receipt_identifier_ciphertext), order.order_state, order.payment_state, order.payment_review_reason, order.payment_due_at, shipment?.carrier_name, shipment?.tracking_number, order.cancelled_at, order.cancellation_reason]
  })
  const csv = `\uFEFF${[header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`
  const selectedRound = sales?.find((sale) => sale.id === saleId)?.round_number
  const scope = selectedRound ? `round-${selectedRound}` : 'all-rounds'
  return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="booth-booth-${scope}-${new Date().toISOString().slice(0,10)}.csv"`, 'Cache-Control': 'no-store' } })
}
