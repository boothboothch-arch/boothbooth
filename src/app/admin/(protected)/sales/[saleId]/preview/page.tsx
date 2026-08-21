import Link from 'next/link'
import { ArrowLeft, CalendarDays, ExternalLink, PackageCheck, Truck } from 'lucide-react'
import { notFound } from 'next/navigation'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { Badge } from '@/shared/ui/badge'

type OptionRow = { option_type: string; value: string; price_delta: number; sort_order: number; active: boolean }

export default async function SalePreviewPage({ params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = await params
  const client = createPrivilegedClient()
  const [{ data: sale }, { data: products }, { data: slots }, { count: orders }] = await Promise.all([
    client.from('sales').select('*').eq('id', saleId).maybeSingle(),
    client.from('products').select('*,product_options(option_type,value,price_delta,sort_order,active)').eq('sale_id', saleId).order('created_at'),
    client.from('pickup_slots').select('*').eq('sale_id', saleId).eq('active', true).eq('manually_closed', false).order('pickup_date').order('starts_at'),
    client.from('orders').select('id', { count: 'exact', head: true }).eq('sale_id', saleId).neq('order_state', 'cancelled'),
  ])
  if (!sale) notFound()
  const shirt = (products ?? []).find((product) => product.item_type === 'shirt')
  const bag = (products ?? []).find((product) => product.item_type === 'bag')
  const options = (Array.isArray(shirt?.product_options) ? shirt.product_options : []) as OptionRow[]
  const sizes = options.filter((option) => option.option_type === 'size' && option.active).sort((a, b) => a.sort_order - b.sort_order)
  const genders = options.filter((option) => option.option_type === 'gender' && option.active).sort((a, b) => a.sort_order - b.sort_order)
  const statusLabel: Record<string, string> = { draft: '초안 미리보기', published: '고객 공개 중', archived: '보관된 판매' }
  return (
    <>
      <div className="admin-heading"><div><span className="eyebrow">CUSTOMER PREVIEW · {sale.round_number}TH</span><h1>{sale.title}</h1><p>고객에게 노출될 핵심 판매 정보를 공개 전에 확인합니다. 이 화면에서는 주문서를 제출할 수 없습니다.</p></div><div className="admin-heading__actions">{sale.sale_kind === 'test' && <Link className="button button--primary" href={`/test/${sale.id}`} target="_blank"><ExternalLink size={15} /> 테스트 주문 열기</Link>}<Link className="button button--secondary" href={`/admin/settings?saleId=${sale.id}`}>설정 수정</Link><Link className="button button--secondary" href="/admin/sales"><ArrowLeft size={15} /> 차수 목록</Link></div></div>
      <section className="preview-hero">
        <div><Badge tone={sale.publication_status === 'published' ? 'green' : 'neutral'}>{statusLabel[sale.publication_status] ?? sale.publication_status}</Badge><span className="preview-round">{String(sale.round_number).padStart(2, '0')}</span><h2>{sale.title}</h2><p>{new Date(sale.starts_at).toLocaleString('ko-KR')}부터<br />{new Date(sale.ends_at).toLocaleString('ko-KR')}까지</p></div>
        <div className="preview-capacity"><span>남은 주문 가능 건수</span><strong>{Math.max(0, sale.order_limit - (orders ?? 0))}</strong><small>총 {sale.order_limit}건 · 현재 작성 중 슬롯 제외</small></div>
      </section>
      <section className="preview-grid">
        <article className="admin-panel"><PackageCheck size={20} /><h2>상품과 옵션</h2>{shirt && <div className="preview-product"><strong>{shirt.name}</strong><span>{shirt.unit_price.toLocaleString('ko-KR')}원</span><small>사이즈 {sizes.map((item) => `${item.value}${item.price_delta ? ` (+${item.price_delta.toLocaleString('ko-KR')}원)` : ''}`).join(' · ')}</small><small>성별 {genders.map((item) => item.value).join(' · ')}</small></div>}{bag && <div className="preview-product"><strong>{bag.name}</strong><span>{bag.unit_price.toLocaleString('ko-KR')}원</span><small>이니셜·스티커·참고 이미지 입력</small></div>}</article>
        <article className="admin-panel"><Truck size={20} /><h2>배송</h2><p>{sale.free_shipping_threshold.toLocaleString('ko-KR')}원 이상 무료배송</p><p>미만 배송비 {sale.shipping_fee.toLocaleString('ko-KR')}원</p><small>{sale.shipping_notice || '추가 배송 안내 없음'}</small></article>
        <article className="admin-panel"><CalendarDays size={20} /><h2>직접 픽업</h2><p>{sale.pickup_name}</p><small>{sale.pickup_address || '픽업 주소 미입력'}</small><ul>{(slots ?? []).map((slot) => <li key={slot.id}>{slot.pickup_date} · {String(slot.starts_at).slice(0, 5)}–{String(slot.ends_at).slice(0, 5)}</li>)}</ul>{!slots?.length && <p className="text-danger">픽업 일정이 없습니다.</p>}</article>
      </section>
      <div className="notice">계좌번호는 주문 완료·조회 화면에서만 표시되므로 이 미리보기에는 노출하지 않습니다.</div>
    </>
  )
}
