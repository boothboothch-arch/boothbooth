'use client'

import { useState } from 'react'
import Script from 'next/script'
import { Check, Copy, PackageCheck, Pencil, ShoppingBag, Shirt, Truck } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import { isCustomerEditable, itemPrice, orderStateLabel, paymentStateLabel, type OrderView } from '../domain/order'
import type { CustomerOrderUpdateInput } from '../schemas'

declare global {
  interface Window { daum?: { Postcode: new (options: { oncomplete: (data: { zonecode: string; address: string }) => void }) => { open: () => void } } }
}

function receiptLabel(type: OrderView['cashReceiptType']) {
  return type === 'personal' ? '개인 소득공제용' : type === 'business' ? '사업자 지출증빙용' : '신청 안 함'
}

function pickupTime(pickup: NonNullable<OrderView['pickup']>) {
  return `${pickup.date} · ${pickup.startsAt.slice(0, 5)}–${pickup.endsAt.slice(0, 5)}`
}

export function OrderDetail({ initialOrder, complete = false }: { initialOrder: OrderView; complete?: boolean }) {
  const [order, setOrder] = useState(initialOrder)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState<CustomerOrderUpdateInput>({
    fulfillmentType: order.fulfillmentType,
    postalCode: order.address?.postalCode ?? '', address: order.address?.address ?? '', addressDetail: order.address?.addressDetail ?? '',
    pickupSlotId: '', cashReceiptType: order.cashReceiptType, cashReceiptIdentifier: order.cashReceiptIdentifier ?? '',
    items: order.items.map((item) => ({
      id: item.id, productId: item.productId, itemType: item.itemType, size: item.size ?? '', gender: item.gender ?? '', initialText: item.initialText,
      stickerSelected: item.stickerSelected, stickerCategories: item.stickerCategories.join(', '), favoriteColors: item.favoriteColors,
      favoriteThings: item.favoriteThings, desiredMood: item.desiredMood, instagramReference: item.instagramReference, extraRequest: item.extraRequest,
    })),
  })
  const statusTone = order.orderState === 'cancelled' ? 'red' : order.orderState === 'completed' ? 'green' : 'blue'
  const duePassed = Date.parse(order.paymentDueAt) < Date.now() && order.paymentState === 'pending' && order.orderState !== 'cancelled'

  function copyAccount() { void navigator.clipboard.writeText(order.bank.account) }
  function openPostcode() {
    if (!window.daum?.Postcode) return
    new window.daum.Postcode({ oncomplete: (data) => setDraft((current) => ({ ...current, postalCode: data.zonecode, address: data.address })) }).open()
  }
  function updateItem(index: number, patch: Partial<CustomerOrderUpdateInput['items'][number]>) {
    setDraft((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) }))
  }
  async function save() {
    setSaving(true); setError('')
    try {
      const response = await fetch(`/api/orders/${order.orderNumber}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) })
      const payload = await response.json() as { totalAmount?: number; subtotalAmount?: number; shippingFee?: number; error?: { message: string } }
      if (!response.ok) throw new Error(payload.error?.message ?? '수정하지 못했어요.')
      const refreshed = await fetch(`/api/orders/${order.orderNumber}`, { cache: 'no-store' })
      if (refreshed.ok) setOrder(await refreshed.json() as OrderView)
      else setOrder((current) => ({ ...current, totalAmount: payload.totalAmount ?? current.totalAmount, subtotalAmount: payload.subtotalAmount ?? current.subtotalAmount, shippingFee: payload.shippingFee ?? current.shippingFee }))
      setEditing(false)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '수정하지 못했어요.') } finally { setSaving(false) }
  }

  return (
    <>
      <Script src="//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js" strategy="afterInteractive" />
      {complete && <div className="complete-mark"><span><Check size={25} /></span><h1>주문이 접수됐어요</h1><p>주문번호와 최종 입금 금액을 꼭 확인해주세요.</p></div>}
      <div className="order-detail-grid">
        <section className="surface-card order-info-card">
          <div className="order-info-card__header"><div><span>{order.saleKind === 'test' ? '테스트 · ' : ''}{order.roundNumber ? `${order.roundNumber}차 · ` : ''}주문번호</span><strong>{order.orderNumber}</strong></div><Badge tone={order.saleKind === 'test' ? 'yellow' : statusTone}>{order.saleKind === 'test' ? '테스트 주문' : orderStateLabel[order.orderState]}</Badge></div>
          <div className="status-track">{[['입금 대기', PackageCheck], ['입금 확인', Check], ['배송·수령 준비', Truck], ['완료', Check]].map(([label, Icon], index) => <div className={index <= ['payment_pending','payment_confirmed','preparing','completed'].indexOf(order.orderState) ? 'active' : ''} key={String(label)}><span><Icon size={15} /></span><small>{String(label)}</small></div>)}</div>
          <dl className="info-list"><div><dt>판매 차수</dt><dd>{order.roundNumber ? `${order.roundNumber}차 · ` : ''}{order.saleTitle}</dd></div><div><dt>입금 상태</dt><dd>{paymentStateLabel[order.paymentState]}{order.paymentReviewReason ? ` · ${order.paymentReviewReason}` : ''}</dd></div>{duePassed && <div><dt>입금 안내</dt><dd className="text-danger">1시간 입금 안내 시간이 지났습니다. 주문은 자동 취소되지 않습니다.</dd></div>}{order.cancellationReason && <div><dt>취소 사유</dt><dd>{order.cancellationReason}</dd></div>}<div><dt>주문자</dt><dd>{order.customerName} · {order.phone}</dd></div><div><dt>이메일</dt><dd>{order.email}</dd></div><div><dt>입금자명</dt><dd>{order.depositorName}</dd></div><div><dt>현금영수증</dt><dd>{receiptLabel(order.cashReceiptType)}{order.cashReceiptIdentifier ? ` · ${order.cashReceiptIdentifier}` : ''}</dd></div></dl>
        </section>

        {order.orderState !== 'cancelled' && order.paymentState !== 'paid' && <aside className="bank-card"><span>입금 계좌</span><h2>{order.bank.bankName}<br />{order.bank.account}</h2><p>예금주 {order.bank.holder}<br />주문자명과 같은 이름으로 입금해주세요.</p><Button variant="secondary" onClick={copyAccount}><Copy size={15} /> 계좌번호 복사</Button><div>입금 안내 시간 <strong>{new Date(order.paymentDueAt).toLocaleString('ko-KR')}</strong><small>시간이 지나도 자동 취소되지 않아요.</small></div></aside>}

        <section className="surface-card order-products">
          <div className="card-title"><h2>주문 상품</h2><span>총 {order.totalQuantity}개</span></div>
          {order.items.map((item) => <article className="ordered-custom-item" key={item.id}><div className="ordered-custom-item__title"><span>{item.itemType === 'shirt' ? <Shirt size={18} /> : <ShoppingBag size={18} />}</span><div><strong>{item.productName} · {item.initialText}</strong><small>{[item.size, item.gender].filter(Boolean).join(' · ') || '가방'}{item.optionSurcharge ? ` · 추가금 ${item.optionSurcharge.toLocaleString('ko-KR')}원` : ''}</small></div><b>{item.lineAmount.toLocaleString('ko-KR')}원</b></div>{item.stickerSelected && <p><strong>스티커</strong> {item.stickerCategories.join(', ') || '랜덤 구성'}</p>}<div className="order-preferences">{item.favoriteColors && <span>좋아하는 색상 · {item.favoriteColors}</span>}{item.favoriteThings && <span>동물·물건 · {item.favoriteThings}</span>}{item.desiredMood && <span>분위기 · {item.desiredMood}</span>}{item.instagramReference && <span>인스타그램 참고 · {item.instagramReference}</span>}{item.extraRequest && <span>기타 · {item.extraRequest}</span>}</div>{item.images.length > 0 && <div className="order-image-strip">{item.images.map((image) => image.url && <a href={image.url} target="_blank" rel="noreferrer" key={image.id}><img src={image.url} alt={`${item.productName} 디자인 참고 이미지`} /></a>)}</div>}</article>)}
          <div className="summary-box"><div className="summary-line"><span>상품 합계</span><strong>{order.subtotalAmount.toLocaleString('ko-KR')}원</strong></div><div className="summary-line"><span>배송비</span><strong>{order.shippingFee ? `${order.shippingFee.toLocaleString('ko-KR')}원` : '무료'}</strong></div><div className="summary-line summary-line--total"><span>총 입금 금액</span><strong>{order.totalAmount.toLocaleString('ko-KR')}원</strong></div></div>
        </section>

        <section className="surface-card order-address">
          <div className="card-title"><h2>{order.fulfillmentType === 'shipping' ? '배송지' : '픽업 정보'}</h2>{isCustomerEditable(order.orderState) && !editing && <Button variant="ghost" onClick={() => setEditing(true)}><Pencil size={14} /> 주문 수정</Button>}</div>
          {!editing && (order.fulfillmentType === 'shipping' && order.address ? <address>({order.address.postalCode}) {order.address.address}<br />{order.address.addressDetail}</address> : order.pickup ? <address><strong>{order.pickup.name}</strong><br />{order.pickup.address}<br />{pickupTime(order.pickup)}<br />{order.pickup.notice}</address> : <p>픽업 정보를 확인해주세요.</p>)}
          {editing && <div className="customer-order-editor"><div className="choice-cards"><label><input type="radio" checked={draft.fulfillmentType === 'shipping'} onChange={() => setDraft((current) => ({ ...current, fulfillmentType: 'shipping' }))} /><span><Truck size={18} /><strong>택배 배송</strong></span></label><label><input type="radio" checked={draft.fulfillmentType === 'pickup'} onChange={() => setDraft((current) => ({ ...current, fulfillmentType: 'pickup' }))} /><span><ShoppingBag size={18} /><strong>직접 픽업</strong></span></label></div>{draft.fulfillmentType === 'shipping' ? <div className="form-grid"><Field label="우편번호"><input value={draft.postalCode} readOnly /></Field><div className="field field--address-button"><label>주소 검색</label><Button variant="secondary" onClick={openPostcode}>카카오 주소 검색</Button></div><Field label="기본 주소" full><input value={draft.address} readOnly /></Field><Field label="상세 주소" full><input value={draft.addressDetail} onChange={(event) => setDraft((current) => ({ ...current, addressDetail: event.target.value }))} /></Field></div> : <Field label="픽업 일정"><select value={draft.pickupSlotId} onChange={(event) => setDraft((current) => ({ ...current, pickupSlotId: event.target.value }))}><option value="">일정을 선택해주세요</option>{order.availablePickupSlots.map((slot) => <option key={slot.id} value={slot.id}>{slot.date} · {slot.startsAt.slice(0,5)}–{slot.endsAt.slice(0,5)}</option>)}</select></Field>}
            <h3>상품 정보</h3>{draft.items.map((item, index) => { const product = order.availableProducts.find((entry) => entry.id === item.productId); if (!product) return null; return <div className="editor-item" key={item.id}><strong>{index + 1}. {product.name}</strong><div className="form-grid">{item.itemType === 'shirt' && <><Field label="사이즈"><select value={item.size} onChange={(event) => updateItem(index, { size: event.target.value })}>{product.sizes.map((size) => <option key={size.value}>{size.value}</option>)}</select></Field><Field label="성별"><select value={item.gender} onChange={(event) => updateItem(index, { gender: event.target.value })}>{product.genders.map((gender) => <option key={gender}>{gender}</option>)}</select></Field></>}<Field label="이니셜" full><input value={item.initialText} onChange={(event) => updateItem(index, { initialText: event.target.value })} /></Field><Field label="스티커 카테고리" full><input value={item.stickerCategories} onChange={(event) => updateItem(index, { stickerSelected: Boolean(event.target.value), stickerCategories: event.target.value })} placeholder="선택하지 않으면 비워두세요" /></Field><Field label="좋아하는 색상"><input value={item.favoriteColors} onChange={(event) => updateItem(index, { favoriteColors: event.target.value })} /></Field><Field label="좋아하는 동물·물건"><input value={item.favoriteThings} onChange={(event) => updateItem(index, { favoriteThings: event.target.value })} /></Field><Field label="원하는 분위기" full><input value={item.desiredMood} onChange={(event) => updateItem(index, { desiredMood: event.target.value })} /></Field><Field label="인스타그램 참고" full><input value={item.instagramReference} onChange={(event) => updateItem(index, { instagramReference: event.target.value })} /></Field><Field label="기타 요청" full><textarea value={item.extraRequest} onChange={(event) => updateItem(index, { extraRequest: event.target.value })} /></Field></div></div> })}
            <h3>현금영수증</h3><div className="form-grid"><Field label="신청 유형" full><select value={draft.cashReceiptType} onChange={(event) => setDraft((current) => ({ ...current, cashReceiptType: event.target.value as CustomerOrderUpdateInput['cashReceiptType'] }))}><option value="none">신청 안 함</option><option value="personal">개인 소득공제용</option><option value="business">사업자 지출증빙용</option></select></Field>{draft.cashReceiptType !== 'none' && <Field label="발급 번호" full><input value={draft.cashReceiptIdentifier} onChange={(event) => setDraft((current) => ({ ...current, cashReceiptIdentifier: event.target.value }))} /></Field>}</div>
            <p className="field__hint">참고 이미지 또는 상품 개수 변경은 카카오톡 채널로 문의해주세요.</p>{error && <p className="form-error">{error}</p>}<div className="form-actions"><Button variant="ghost" onClick={() => setEditing(false)}>취소</Button><Button disabled={saving} onClick={() => void save()}>{saving ? '저장 중…' : '변경 저장'}</Button></div></div>}
        </section>
        {order.fulfillmentType === 'shipping' && order.shipment?.trackingNumber && <section className="surface-card order-shipment"><div className="card-title"><h2>배송 정보</h2><Truck size={18} /></div><dl className="info-list"><div><dt>택배사</dt><dd>{order.shipment.carrierName ?? '-'}</dd></div><div><dt>송장번호</dt><dd>{order.shipment.trackingNumber}</dd></div><div><dt>배송 시작</dt><dd>{order.shipment.shippedAt ? new Date(order.shipment.shippedAt).toLocaleString('ko-KR') : '-'}</dd></div></dl></section>}
      </div>
      <p className="support-note">취소·환불 또는 주문 변경이 필요하신가요? <a href={order.kakaoChannelUrl} target="_blank" rel="noreferrer">카카오톡 채널로 문의하기</a></p>
    </>
  )
}

function Field({ label, full = false, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return <div className={`field ${full ? 'field--full' : ''}`}><label>{label}</label>{children}</div>
}
