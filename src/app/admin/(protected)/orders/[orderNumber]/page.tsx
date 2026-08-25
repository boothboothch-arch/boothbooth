import Link from 'next/link'
import { ArrowLeft, ExternalLink, ShoppingBag, Shirt } from 'lucide-react'
import { notFound } from 'next/navigation'
import { updateOrderAction, updateOrderInfoAction } from '@/features/admin/actions'
import { orderStateOptions } from '@/features/order/domain/order'
import { getOrderByNumber } from '@/server/orders/get-order'
import { Button } from '@/shared/ui/button'

type Props = { params: Promise<{ orderNumber: string }>; searchParams: Promise<{ saved?: string; error?: string }> }

export default async function AdminOrderPage({ params, searchParams }: Props) {
  const [{ orderNumber }, query] = await Promise.all([params, searchParams])
  const order = await getOrderByNumber(orderNumber)
  if (!order) notFound()
  const overdue = order.orderState === 'payment_pending' && order.paymentState === 'pending' && Date.parse(order.paymentDueAt) < Date.now()
  return (
    <>
      <div className="admin-heading"><div><Link className="admin-back" href={{ pathname: '/admin/orders', query: { saleId: order.saleId } }}><ArrowLeft size={14} /> {order.roundNumber}차 주문 목록</Link><h1>{order.orderNumber}</h1><p>{order.saleKind === 'test' ? '테스트 주문 · ' : ''}{order.roundNumber}차 · {new Date(order.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} 접수 · {order.customerName}</p></div></div>
      {query.saved && <div className="notice notice--success">변경 내용을 저장했습니다.</div>}
      {query.error && <div className="notice notice--error">저장하지 못했습니다: {query.error}</div>}
      {overdue && <div className="notice notice--warning">입금 안내 1시간이 지났습니다. 실제 입금 내역을 확인한 뒤 주문 상태를 변경해주세요.</div>}
      <div className="admin-detail-grid">
        <div className="admin-panel admin-detail-summary">
          <form className="admin-order-info-form" action={updateOrderInfoAction}><input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="orderNumber" value={order.orderNumber} /><input type="hidden" name="fulfillmentType" value={order.fulfillmentType} /><h2>주문자와 수령 정보</h2><div className="form-grid"><div className="field"><label>주문자</label><input name="customerName" defaultValue={order.customerName} required /></div><div className="field"><label>입금자명</label><input name="depositorName" defaultValue={order.depositorName} required /></div><div className="field"><label>휴대전화</label><input name="phone" defaultValue={order.phone} required /></div>{order.address && <><div className="field"><label>우편번호</label><input name="postalCode" defaultValue={order.address.postalCode} required /></div><div className="field"><label>기본 주소</label><input name="address" defaultValue={order.address.address} required /></div><div className="field field--full"><label>상세 주소</label><input name="addressDetail" defaultValue={order.address.addressDetail} required /></div></>}</div>{order.deliveryZone === 'remote' && <div className="notice notice--warning">제주·도서산간 추가 배송비가 적용된 주문입니다.</div>}{order.pickup && <p className="field__hint">픽업: {order.pickup.name}{order.pickup.address ? ` · ${order.pickup.address}` : ''}{order.pickup.notice ? ` · ${order.pickup.notice}` : ''}</p>}<p className="field__hint">현금영수증: {order.cashReceiptType === 'none' ? '미신청' : `${order.cashReceiptType === 'personal' ? '소득공제' : '지출증빙'} · ${order.cashReceiptIdentifier}`}</p><Button type="submit" variant="secondary">주문자 정보 저장</Button></form>
          <h2>상품별 제작 정보</h2>{order.items.map((item, index) => <article className="admin-custom-item" key={item.id}><div className="admin-custom-item__title"><span>{item.itemType === 'shirt' ? <Shirt size={17} /> : <ShoppingBag size={17} />}</span><strong>{index + 1}. {item.productName}{item.initialText ? ` · ${item.initialText}` : ''}</strong><b>{item.lineAmount.toLocaleString('ko-KR')}원</b></div><dl className="info-list"><div><dt>옵션</dt><dd>{item.selectedOptions.map((option) => `${option.groupName}: ${option.valueLabel}${option.priceDelta ? ` (+${option.priceDelta.toLocaleString('ko-KR')}원)` : ''}`).join(' · ') || '없음'}</dd></div><div><dt>스티커</dt><dd>{item.stickerSelected ? item.stickerCategories.join(', ') || '선택' : '미선택'}</dd></div><div><dt>기타 요청</dt><dd>{item.extraRequest || '-'}</dd></div></dl>{item.images.length > 0 && <div className="admin-image-grid">{item.images.map((image) => <a href={image.url} target="_blank" rel="noreferrer" key={image.id}><img src={image.url} alt="주문 디자인 참고" /><span>원본 보기 <ExternalLink size={12} /></span></a>)}</div>}</article>)}
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
