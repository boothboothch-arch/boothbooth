import Link from 'next/link'
import { ArrowLeft, ExternalLink, MapPin, PackageCheck, Truck } from 'lucide-react'
import { notFound } from 'next/navigation'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { Badge } from '@/shared/ui/badge'

type OptionGroup = { id: string; name: string; active: boolean; values: { id: string; label: string; priceDelta: number; active: boolean }[] }

export default async function SalePreviewPage({ params }: { params: Promise<{ saleId: string }> }) {
  const { saleId } = await params
  const client = createPrivilegedClient()
  const [{ data: sale }, { data: products }, { count: orders }] = await Promise.all([
    client.from('sales').select('*').eq('id', saleId).maybeSingle(),
    client.from('products').select('*').eq('sale_id', saleId).order('sort_order').order('created_at'),
    client.from('orders').select('id', { count: 'exact', head: true }).eq('sale_id', saleId).neq('order_state', 'cancelled'),
  ])
  if (!sale) notFound()
  const statusLabel: Record<string, string> = { draft: '초안 미리보기', published: '고객 공개 중', archived: '보관된 판매' }
  return (
    <>
      <div className="admin-heading"><div><span className="eyebrow">CUSTOMER PREVIEW · {sale.round_number}TH</span><h1>{sale.title}</h1><p>고객에게 노출될 핵심 판매 정보를 공개 전에 확인합니다. 이 화면에서는 주문서를 제출할 수 없습니다.</p></div><div className="admin-heading__actions">{sale.sale_kind === 'test' && <Link className="button button--primary" href={`/test/${sale.id}`} target="_blank"><ExternalLink size={15} /> 테스트 주문 열기</Link>}<Link className="button button--secondary" href={`/admin/settings?saleId=${sale.id}`}>설정 수정</Link><Link className="button button--secondary" href="/admin/sales"><ArrowLeft size={15} /> 차수 목록</Link></div></div>
      <section className="preview-hero">
        <div><Badge tone={sale.publication_status === 'published' ? 'green' : 'neutral'}>{statusLabel[sale.publication_status] ?? sale.publication_status}</Badge><span className="preview-round">{String(sale.round_number).padStart(2, '0')}</span><h2>{sale.title}</h2><p>{new Date(sale.starts_at).toLocaleString('ko-KR')}부터<br />{new Date(sale.ends_at).toLocaleString('ko-KR')}까지</p></div>
        <div className="preview-capacity"><span>남은 주문 가능 건수</span><strong>{Math.max(0, sale.order_limit - (orders ?? 0))}</strong><small>총 {sale.order_limit}건 · 현재 작성 중 슬롯 제외</small></div>
      </section>
      <section className="preview-grid">
        <article className="admin-panel"><PackageCheck size={20} /><h2>상품과 옵션</h2>{(products ?? []).map((product) => { const groups = (Array.isArray(product.option_groups) ? product.option_groups : []) as OptionGroup[]; return <div className="preview-product" key={product.id}><strong>{product.name}{!product.active && ' (숨김)'}</strong><span>{product.unit_price.toLocaleString('ko-KR')}원{product.stock_limit !== null ? ` · 한정 ${product.stock_limit}개` : ''}</span>{product.description && <small>{product.description}</small>}{groups.filter((group) => group.active).map((group) => <small key={group.id}>{group.name} {(group.values ?? []).filter((value) => value.active).map((value) => `${value.label}${value.priceDelta ? ` (${value.priceDelta > 0 ? '+' : ''}${value.priceDelta.toLocaleString('ko-KR')}원)` : ''}`).join(' · ')}</small>)}</div>})}{!products?.length && <p className="text-danger">등록된 상품이 없습니다.</p>}</article>
        <article className="admin-panel"><Truck size={20} /><h2>배송</h2><p>{sale.free_shipping_threshold.toLocaleString('ko-KR')}원 이상 무료배송</p><p>미만 배송비 {sale.shipping_fee.toLocaleString('ko-KR')}원</p><p>제주·도서산간 추가 {sale.remote_area_surcharge.toLocaleString('ko-KR')}원</p><small>{sale.shipping_notice || '추가 배송 안내 없음'}</small></article>
        <article className="admin-panel"><MapPin size={20} /><h2>직접 픽업</h2><p>{sale.pickup_name}</p><small>{sale.pickup_address || '픽업 주소 미입력'}</small>{sale.pickup_notice && <p>{sale.pickup_notice}</p>}</article>
      </section>
      <div className="notice">계좌번호는 주문 완료·조회 화면에서만 표시되므로 이 미리보기에는 노출하지 않습니다.</div>
    </>
  )
}
