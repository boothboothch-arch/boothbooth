import Link from 'next/link'
import { AlertCircle, ArrowRight, Banknote, CheckCircle2, Clock3, Package, PackageCheck, Shirt } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { orderStateLabel, orderStateTone, type OrderView } from '@/features/order/domain/order'

type Params = Promise<{ saleId?: string }>

export default async function AdminDashboard({ searchParams }: { searchParams: Params }) {
  const params = await searchParams
  const client = createPrivilegedClient()
  const [{ data: publicStatus }, { data: sales }] = await Promise.all([
    client.rpc('get_sale_status'),
    client.from('sales').select('*').order('round_number', { ascending: false }),
  ])
  const publicSaleId = (publicStatus as { saleId?: string } | null)?.saleId
  const selectedSale = (sales ?? []).find((sale) => sale.id === params.saleId) ?? (sales ?? []).find((sale) => sale.id === publicSaleId) ?? sales?.[0] ?? null
  let ordersQuery = client.from('orders').select('id,order_number,customer_name,total_amount,order_state,payment_state,payment_due_at,created_at').order('created_at', { ascending: false })
  if (selectedSale) ordersQuery = ordersQuery.eq('sale_id', selectedSale.id)
  const nowIso = new Date().toISOString()
  const [{ data: orders }, { count: activeReservations }] = await Promise.all([
    ordersQuery,
    selectedSale
      ? client.from('reservations').select('id', { count: 'exact', head: true }).eq('sale_id', selectedSale.id).eq('state', 'active').gt('hard_expires_at', nowIso).gt('lease_expires_at', nowIso)
      : Promise.resolve({ count: 0 }),
  ])
  const rows = orders ?? []
  const submittedCount = rows.filter((order) => order.order_state !== 'cancelled').length
  const remainingCount = Math.max(0, (selectedSale?.order_limit ?? 0) - submittedCount - (activeReservations ?? 0))
  const paidAmount = rows.filter((order) => order.payment_state === 'paid').reduce((sum, order) => sum + order.total_amount, 0)
  const cards = [
    { label: '접수 주문', value: `${submittedCount}건`, icon: Shirt },
    { label: '남은 주문', value: `${remainingCount}건`, icon: PackageCheck },
    { label: '작성 중', value: `${activeReservations ?? 0}명`, icon: Clock3 },
    { label: '입금 대기', value: `${rows.filter((order) => order.order_state === 'payment_pending').length}건`, icon: Banknote },
    { label: '입금 1시간 경과', value: `${rows.filter((order) => order.payment_state === 'pending' && order.order_state === 'payment_pending' && Date.parse(order.payment_due_at) <= Date.now()).length}건`, icon: AlertCircle },
    { label: '입금 완료', value: `${rows.filter((order) => order.order_state === 'payment_confirmed').length}건`, icon: CheckCircle2 },
    { label: '제작 중', value: `${rows.filter((order) => order.order_state === 'preparing').length}건`, icon: Package },
    { label: '출고 완료', value: `${rows.filter((order) => order.order_state === 'completed').length}건`, icon: PackageCheck },
    { label: '입금 확인액', value: `${paidAmount.toLocaleString('ko-KR')}원`, icon: Banknote },
  ]
  const now = Date.now()
  const phase = !selectedSale ? '설정 필요'
    : selectedSale.sale_kind === 'test' ? selectedSale.manually_closed ? '테스트 중지' : '테스트 가능'
    : selectedSale.publication_status === 'draft' ? '초안'
    : selectedSale.publication_status === 'archived' ? '보관됨'
    : now < Date.parse(selectedSale.starts_at) ? '판매 예정'
    : now >= Date.parse(selectedSale.ends_at) ? '판매 종료'
    : selectedSale.manually_closed ? '신규 입장 중지'
    : remainingCount === 0 ? '접수 마감'
    : '판매 중'
  return (
    <>
      <div className="admin-heading"><div><span className="eyebrow">OVERVIEW</span><h1>대시보드</h1><p>선택한 차수의 판매와 주문 현황을 확인하세요.</p></div><Link className="button button--secondary" href={{ pathname: '/admin/orders', query: selectedSale ? { saleId: selectedSale.id } : undefined }}>주문 보기 <ArrowRight size={15} /></Link></div>
      {selectedSale && <form className="admin-round-select" method="get"><label>현황 차수</label><select name="saleId" defaultValue={selectedSale.id}>{(sales ?? []).map((sale) => <option key={sale.id} value={sale.id}>{sale.sale_kind === 'test' ? '[테스트] ' : ''}{sale.round_number}차 · {sale.title}</option>)}</select><button className="button button--secondary" type="submit">불러오기</button></form>}
      <section className="admin-sale-strip"><Badge tone={phase === '판매 중' ? 'green' : selectedSale?.sale_kind === 'test' ? 'yellow' : 'neutral'}>{phase}</Badge><span>차수 <strong>{selectedSale?.round_number ?? '-'}차</strong></span><span>접수 한도 <strong>{selectedSale?.order_limit ?? 0}건</strong></span><span>시작 <strong>{selectedSale ? new Date(selectedSale.starts_at).toLocaleString('ko-KR') : '-'}</strong></span><span>종료 <strong>{selectedSale ? new Date(selectedSale.ends_at).toLocaleString('ko-KR') : '-'}</strong></span></section>
      <section className="admin-stat-grid">{cards.map(({ label, value, icon: Icon }) => <article key={label}><Icon size={19} /><span>{label}</span><strong>{value}</strong></article>)}</section>
      <section className="admin-panel"><div className="admin-panel__header"><h2>최근 주문</h2><Link href={{ pathname: '/admin/orders', query: selectedSale ? { saleId: selectedSale.id } : undefined }}>전체 보기</Link></div><div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>주문번호</th><th>주문자</th><th>금액</th><th>주문 상태</th><th>접수일</th></tr></thead><tbody>{rows.slice(0, 8).map((order) => { const orderState = order.order_state as OrderView['orderState']; return <tr key={order.id}><td><Link href={`/admin/orders/${order.order_number}`}>{order.order_number}</Link></td><td>{order.customer_name}</td><td>{order.total_amount.toLocaleString('ko-KR')}원</td><td><Badge className="admin-order-status-badge" tone={orderStateTone(orderState)}>{orderStateLabel[orderState]}</Badge></td><td>{new Date(order.created_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}</td></tr> })}</tbody></table>{!rows.length && <div className="admin-empty">이 차수에 접수된 주문이 없습니다.</div>}</div></section>
    </>
  )
}
