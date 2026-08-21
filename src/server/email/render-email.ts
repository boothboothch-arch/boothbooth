import 'server-only'

type EmailContent = { subject: string; html: string }

function money(value: unknown) {
  return `${Number(value ?? 0).toLocaleString('ko-KR')}원`
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character] ?? character)
}

function frame(title: string, body: string, appUrl: string) {
  return `<!doctype html><html lang="ko"><body style="margin:0;background:#f5f5f3;font-family:Arial,'Apple SD Gothic Neo',sans-serif;color:#30302e"><table width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:40px 16px"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:auto;background:#fff;border:1px solid #e5e5e2;border-radius:12px"><tr><td style="padding:32px"><div style="font-size:18px;font-weight:800;letter-spacing:-1px;color:#111">booth<br>booth</div><h1 style="margin:36px 0 16px;font-size:26px;letter-spacing:-1px;color:#111">${escapeHtml(title)}</h1>${body}<a href="${escapeHtml(appUrl)}/order/lookup" style="display:inline-block;margin-top:26px;padding:13px 18px;color:#fff;background:#0878e4;border-radius:7px;text-decoration:none;font-size:13px;font-weight:700">주문 조회하기</a></td></tr></table></td></tr></table></body></html>`
}

export function renderOrderEmail(eventType: string, payload: Record<string, unknown>, appUrl: string): EmailContent {
  const orderNumber = escapeHtml(payload.orderNumber)
  const intro = `<p style="font-size:14px;line-height:1.8;color:#6d6c68">주문번호 <strong style="color:#111">${orderNumber}</strong></p>`
  if (eventType === 'order_received') return {
    subject: `[booth booth] ${orderNumber} 주문이 접수되었습니다`,
    html: frame('주문이 접수됐어요.', `${intro}<p style="font-size:14px;line-height:1.8;color:#6d6c68">입금 금액은 <strong style="color:#111">${money(payload.totalAmount)}</strong>이며, 입금 기한은 ${escapeHtml(new Date(String(payload.paymentDueAt)).toLocaleString('ko-KR'))}입니다. 계좌 정보는 주문 조회 화면에서 확인해주세요.</p>`, appUrl),
  }
  if (eventType === 'payment_confirmed') return {
    subject: `[booth booth] ${orderNumber} 입금이 확인되었습니다`,
    html: frame('입금이 확인됐어요.', `${intro}<p style="font-size:14px;line-height:1.8;color:#6d6c68">${money(payload.totalAmount)} 입금을 확인했습니다. 커스텀 상품 제작이 시작되며, 제작 이후 단순 변심에 의한 변경은 어렵습니다.</p>`, appUrl),
  }
  if (eventType === 'order_cancelled') return {
    subject: `[booth booth] ${orderNumber} 주문이 취소되었습니다`,
    html: frame('주문이 취소됐어요.', `${intro}<p style="font-size:14px;line-height:1.8;color:#6d6c68">취소 사유: ${escapeHtml(payload.reason ?? '관리자 취소')}</p>`, appUrl),
  }
  if (eventType === 'shipment_started') return {
    subject: `[booth booth] ${orderNumber} 배송이 시작되었습니다`,
    html: frame('배송이 시작됐어요.', `${intro}<p style="font-size:14px;line-height:1.8;color:#6d6c68">${escapeHtml(payload.carrierName)} · 송장번호 <strong style="color:#111">${escapeHtml(payload.trackingNumber)}</strong></p>`, appUrl),
  }
  if (eventType === 'pickup_ready') {
    const pickup = (payload.pickup ?? {}) as Record<string, unknown>
    return {
      subject: `[booth booth] ${orderNumber} 픽업 준비가 완료되었습니다`,
      html: frame('픽업 준비가 완료됐어요.', `${intro}<p style="font-size:14px;line-height:1.8;color:#6d6c68">${escapeHtml(pickup.name)} · ${escapeHtml(pickup.date)} ${escapeHtml(pickup.startsAt)}–${escapeHtml(pickup.endsAt)}<br>${escapeHtml(pickup.address)}<br>${escapeHtml(pickup.notice)}</p>`, appUrl),
    }
  }
  if (eventType === 'delivery_completed') return {
    subject: `[booth booth] ${orderNumber} 배송이 완료되었습니다`,
    html: frame(payload.fulfillmentType === 'pickup' ? '픽업이 완료됐어요.' : '배송이 완료됐어요.', `${intro}<p style="font-size:14px;line-height:1.8;color:#6d6c68">booth booth 커스텀 상품과 좋은 시간을 보내시길 바랍니다.</p>`, appUrl),
  }
  throw new Error(`Unsupported email event: ${eventType}`)
}
