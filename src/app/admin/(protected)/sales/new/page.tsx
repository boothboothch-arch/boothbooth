import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createSaleAction } from '@/features/admin/actions'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { Button } from '@/shared/ui/button'

function kstInput(date: Date) {
  return new Date(date.getTime() + 9 * 60 * 60_000).toISOString().slice(0, 16)
}

export default async function NewSalePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams
  const client = createPrivilegedClient()
  const { data: sales } = await client.from('sales').select('id,round_number,title').order('round_number', { ascending: false })
  const latest = sales?.[0]
  const nextRound = (latest?.round_number ?? 0) + 1
  const start = new Date(Date.now() + 7 * 24 * 60 * 60_000)
  start.setUTCHours(1, 0, 0, 0)
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60_000)
  end.setUTCHours(14, 59, 0, 0)
  return (
    <>
      <div className="admin-heading"><div><span className="eyebrow">NEW ROUND</span><h1>새 차수 만들기</h1><p>이전 차수의 상품·가격·배송·계좌 설정을 복사해 초안으로 시작합니다.</p></div><Link className="button button--secondary" href="/admin/sales"><ArrowLeft size={15} /> 차수 목록</Link></div>
      {query.error && <div className="notice notice--error">차수를 만들지 못했습니다: {query.error}</div>}
      {!latest ? <section className="admin-panel"><p>복사할 기존 차수가 없습니다. 먼저 초기 데이터베이스 마이그레이션을 적용해주세요.</p></section> :
        <form className="admin-panel settings-form" action={createSaleAction}>
          <section><h2>복사 기준</h2><div className="form-grid"><div className="field field--full"><label>복사할 차수 <span className="required-mark">*</span></label><select name="sourceSaleId" defaultValue={latest.id} required>{(sales ?? []).map((sale) => <option key={sale.id} value={sale.id}>{sale.round_number}차 · {sale.title}</option>)}</select><span className="field__hint">주문과 고객 이미지, 지난 픽업 일정은 복사하지 않습니다.</span></div></div></section>
          <section><h2>새 판매 기본 정보</h2><div className="form-grid"><fieldset className="field field--full sale-kind-picker"><legend>차수 용도 <span className="required-mark">*</span></legend><label><input name="saleKind" type="radio" value="live" defaultChecked /><span><strong>운영 차수</strong><small>검수 후 고객 메인에 공개하는 실제 판매입니다.</small></span></label><label><input name="saleKind" type="radio" value="test" /><span><strong>테스트 차수</strong><small>메인에는 노출되지 않고 전용 링크에서만 주문을 테스트합니다.</small></span></label></fieldset><div className="field"><label>차수 번호 <span className="required-mark">*</span></label><input name="roundNumber" type="number" min="1" defaultValue={nextRound} required /></div><div className="field"><label>판매 제목 <span className="required-mark">*</span></label><input name="title" defaultValue={`${nextRound}차 부스부스 이니셜 주문`} required /></div><div className="field"><label>판매 시작 (KST) <span className="required-mark">*</span></label><input name="startsAt" type="datetime-local" defaultValue={kstInput(start)} required /></div><div className="field"><label>판매 종료 (KST) <span className="required-mark">*</span></label><input name="endsAt" type="datetime-local" defaultValue={kstInput(end)} required /></div><div className="field field--full"><label>운영 메모</label><textarea name="internalNote" placeholder="예: 어린이날 7차 판매, 인스타그램 공지 예정" /><span className="field__hint">관리자에게만 보이며 고객 화면에는 노출되지 않습니다.</span></div></div></section>
          <div className="notice">새 차수는 고객에게 보이지 않는 <strong>초안</strong>으로 만들어집니다. 생성 후 픽업 일정을 반드시 등록하고 공개해주세요.</div>
          <div className="form-actions"><Button type="submit">초안 만들고 설정하기</Button></div>
        </form>}
    </>
  )
}
