import Link from 'next/link'
import { ExternalLink, Eye, ListChecks } from 'lucide-react'
import { updateSalePublicationAction, updateSettingsAction } from '@/features/admin/actions'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { Button } from '@/shared/ui/button'

function toKstInput(value: string) {
  const date = new Date(value); const kst = new Date(date.getTime() + 9 * 60 * 60_000)
  return kst.toISOString().slice(0, 16)
}

type OptionRow = { option_type: string; value: string; sort_order: number; price_delta: number }

export default async function AdminSettingsPage({ searchParams }: { searchParams: Promise<{ saleId?: string; saved?: string; created?: string; error?: string; publicationSaved?: string }> }) {
  const query = await searchParams
  const client = createPrivilegedClient()
  const { data: sales } = await client.from('sales').select('*').order('round_number', { ascending: false })
  const sale = (sales ?? []).find((row) => row.id === query.saleId) ?? sales?.[0] ?? null
  const [{ data: products }, { data: slots }] = sale ? await Promise.all([
    client.from('products').select('*,product_options(option_type,value,sort_order,price_delta)').eq('sale_id', sale.id).order('created_at'),
    client.from('pickup_slots').select('*').eq('sale_id', sale.id).order('pickup_date').order('starts_at'),
  ]) : [{ data: [] }, { data: [] }]
  const shirt = (products ?? []).find((product) => product.item_type === 'shirt')
  const bag = (products ?? []).find((product) => product.item_type === 'bag')
  if (!sale || !shirt || !bag) return <div className="admin-panel"><h1>판매 설정을 불러오지 못했습니다.</h1><p>최신 Supabase 마이그레이션 적용 여부와 해당 차수의 티셔츠·가방 상품 데이터를 확인해주세요.</p></div>
  const options = (Array.isArray(shirt.product_options) ? shirt.product_options : []) as OptionRow[]
  const sizes = options.filter((item) => item.option_type === 'size').sort((a, b) => a.sort_order - b.sort_order)
  const genders = options.filter((item) => item.option_type === 'gender').sort((a, b) => a.sort_order - b.sort_order)
  const twoXlSurcharge = sizes.find((item) => item.value === '2XL')?.price_delta ?? 2000
  const pickupSlotText = (slots ?? []).map((slot) => `${slot.pickup_date},${String(slot.starts_at).slice(0,5)},${String(slot.ends_at).slice(0,5)}`).join('\n')
  const checklist = [
    { label: '판매 제목과 시작·종료 시간', ready: Boolean(sale.title && Date.parse(sale.starts_at) < Date.parse(sale.ends_at)) },
    { label: '티셔츠·가방 상품과 가격', ready: Boolean(shirt && bag) },
    { label: '티셔츠 사이즈·성별 옵션', ready: Boolean(sizes.length && genders.length) },
    { label: '픽업 장소·날짜·시간', ready: Boolean(sale.pickup_name && (slots ?? []).length) },
    { label: '입금 계좌와 카카오톡 채널 주소', ready: Boolean(sale.bank_name && sale.bank_account_ciphertext && sale.bank_holder && sale.kakao_channel_url) },
  ]
  const canPublish = checklist.every((item) => item.ready)
  const statusLabel: Record<string, string> = { draft: '초안', published: '공개 중', archived: '보관됨' }
  return (
    <>
      <div className="admin-heading"><div><span className="eyebrow">SETTINGS · {sale.round_number}TH · {sale.sale_kind === 'test' ? 'TEST' : 'LIVE'}</span><h1>{sale.round_number}차 판매 설정</h1><p>판매 시간, 주문 건수, 상품 가격과 픽업 일정을 변경합니다. 모든 시간은 한국 시간 기준입니다.</p></div><div className="admin-heading__actions">{sale.sale_kind === 'test' && <Link className="button button--primary" href={`/test/${sale.id}`} target="_blank"><ExternalLink size={15} /> 테스트 주문 열기</Link>}<Link className="button button--secondary" href={`/admin/sales/${sale.id}/preview`}><Eye size={15} /> 미리보기</Link><Link className="button button--secondary" href="/admin/sales"><ListChecks size={15} /> 차수 목록</Link></div></div>
      <form className="admin-round-select" method="get"><label>편집할 차수</label><select name="saleId" defaultValue={sale.id}>{(sales ?? []).map((row) => <option key={row.id} value={row.id}>{row.sale_kind === 'test' ? '[테스트] ' : ''}{row.round_number}차 · {row.title} · {statusLabel[row.publication_status] ?? row.publication_status}</option>)}</select><button className="button button--secondary" type="submit">불러오기</button></form>
      {query.created && <div className="notice notice--success">새 차수 초안을 만들었습니다. 복사되지 않은 픽업 일정을 입력하고 전체 설정을 확인해주세요.</div>}
      {query.saved && <div className="notice notice--success">판매 설정을 저장했습니다.</div>}
      {query.publicationSaved && <div className="notice notice--success">공개 상태를 변경했습니다.</div>}
      {query.error && <div className="notice notice--error">저장하지 못했습니다: {query.error}</div>}
      <section className="admin-panel admin-publication-panel">
        <div><span className={`publication-dot publication-dot--${sale.publication_status}`} /> <strong>{sale.sale_kind === 'test' ? '테스트 전용' : statusLabel[sale.publication_status] ?? sale.publication_status}</strong><p>{sale.sale_kind === 'test' ? '고객 메인에는 노출되지 않으며 테스트 전용 링크에서만 주문할 수 있습니다.' : '설정을 먼저 저장한 뒤 공개하세요. 공개된 운영 차수만 고객 메인과 주문서에 표시됩니다.'}</p></div>
        <ul>{checklist.map((item) => <li key={item.label} data-ready={item.ready}>{item.ready ? '완료' : '필요'} · {item.label}</li>)}</ul>
        <div className="admin-publication-actions">
          {sale.sale_kind === 'live' && sale.publication_status !== 'published' && <form action={updateSalePublicationAction}><input type="hidden" name="saleId" value={sale.id} /><input type="hidden" name="publicationStatus" value="published" /><input type="hidden" name="returnTo" value={`/admin/settings?saleId=${sale.id}`} /><Button type="submit" disabled={!canPublish}>고객에게 공개</Button></form>}
          {sale.publication_status === 'published' && <form action={updateSalePublicationAction}><input type="hidden" name="saleId" value={sale.id} /><input type="hidden" name="publicationStatus" value="archived" /><input type="hidden" name="returnTo" value={`/admin/settings?saleId=${sale.id}`} /><Button type="submit" variant="secondary">판매 보관</Button></form>}
        </div>
      </section>
      <form className="admin-panel settings-form" action={updateSettingsAction}>
        <input type="hidden" name="saleId" value={sale.id} /><input type="hidden" name="shirtId" value={shirt.id} /><input type="hidden" name="bagId" value={bag.id} />
        <section><h2>판매 운영</h2><div className="form-grid"><div className="field field--full"><label>판매 제목</label><input name="title" defaultValue={sale.title} required /></div><div className="field"><label>시작 시각 (KST)</label><input name="startsAt" type="datetime-local" defaultValue={toKstInput(sale.starts_at)} required /></div><div className="field"><label>종료 시각 (KST)</label><input name="endsAt" type="datetime-local" defaultValue={toKstInput(sale.ends_at)} required /></div><div className="field"><label>주문서 접수 한도</label><input name="orderLimit" type="number" min="1" defaultValue={sale.order_limit} required /><span className="field__hint">상품 수가 아닌 주문 건수 기준입니다.</span></div><div className="field field--full"><label>운영 메모</label><textarea name="internalNote" defaultValue={sale.internal_note} placeholder="관리자에게만 표시되는 메모" /></div><label className="checkbox admin-switch"><input name="manuallyClosed" type="checkbox" defaultChecked={sale.manually_closed} /><span><strong>신규 주문서 입장 일시 중지</strong><br />기존 작성자는 남은 시간 동안 제출할 수 있습니다.</span></label></div></section>
        <section><h2>상품과 옵션</h2><div className="form-grid"><div className="field"><label>티셔츠 상품명</label><input name="shirtName" defaultValue={shirt.name} required /></div><div className="field"><label>티셔츠 가격</label><input name="shirtPrice" type="number" min="0" step="100" defaultValue={shirt.unit_price} required /></div><div className="field"><label>가방 상품명</label><input name="bagName" defaultValue={bag.name} required /></div><div className="field"><label>가방 가격</label><input name="bagPrice" type="number" min="0" step="100" defaultValue={bag.unit_price} required /></div><div className="field"><label>티셔츠 사이즈 (쉼표 구분)</label><input name="sizes" defaultValue={sizes.map((item) => item.value).join(', ')} required /></div><div className="field"><label>티셔츠 성별 (쉼표 구분)</label><input name="genders" defaultValue={genders.map((item) => item.value).join(', ')} required /></div><div className="field"><label>2XL 추가금</label><input name="twoXlSurcharge" type="number" min="0" step="100" defaultValue={twoXlSurcharge} required /></div></div></section>
        <section><h2>배송과 픽업</h2><div className="form-grid"><div className="field"><label>기본 배송비</label><input name="shippingFee" type="number" min="0" step="100" defaultValue={sale.shipping_fee} required /></div><div className="field"><label>무료배송 기준</label><input name="freeShippingThreshold" type="number" min="0" step="1000" defaultValue={sale.free_shipping_threshold} required /></div><div className="field"><label>픽업 장소명</label><input name="pickupName" defaultValue={sale.pickup_name} required /></div><div className="field"><label>픽업 주소</label><input name="pickupAddress" defaultValue={sale.pickup_address} /></div><div className="field field--full"><label>픽업 안내</label><textarea name="pickupNotice" defaultValue={sale.pickup_notice} /></div><div className="field field--full"><label>픽업 날짜와 시간</label><textarea name="pickupSlots" className="code-textarea" defaultValue={pickupSlotText} placeholder={'2026-09-05,11:00,13:00\n2026-09-05,13:00,15:00'} /><span className="field__hint">한 줄에 날짜,시작,종료 순서로 입력합니다. 인원 제한은 없으며 행을 삭제하면 해당 시간이 마감됩니다.</span></div></div></section>
        <section><h2>입금 및 안내</h2><div className="form-grid"><div className="field"><label>은행</label><input name="bankName" defaultValue={sale.bank_name} required /></div><div className="field"><label>예금주</label><input name="bankHolder" defaultValue={sale.bank_holder} required /></div><div className="field field--full"><label>계좌번호</label><input name="bankAccount" placeholder="변경할 때만 새 계좌번호 입력" /><span className="field__hint">저장된 계좌번호는 암호화되어 다시 표시하지 않습니다.</span></div><div className="field field--full"><label>카카오톡 비즈니스 채널 URL</label><input name="kakaoChannelUrl" type="url" defaultValue={sale.kakao_channel_url} required /></div><div className="field field--full"><label>배송·제작 안내</label><textarea name="shippingNotice" defaultValue={sale.shipping_notice} /></div></div></section>
        <div className="form-actions"><Button type="submit">판매 설정 저장</Button></div>
      </form>
    </>
  )
}
