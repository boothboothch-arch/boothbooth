export type OrderReceivedEmailData = {
  customerName: string
  orderNumber: string
  totalAmount: number
  paymentDueAt: string
  appUrl: string
  kakaoChannelUrl?: string
  saleKind?: 'live' | 'test'
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function money(value: number) {
  return `${value.toLocaleString('ko-KR')}원`
}

function kstDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function buildOrderReceivedEmail(data: OrderReceivedEmailData) {
  const isTest = data.saleKind === 'test'
  const lookupUrl = new URL('/order/lookup', data.appUrl).toString()
  const customerName = escapeHtml(data.customerName)
  const orderNumber = escapeHtml(data.orderNumber)
  const totalAmount = money(data.totalAmount)
  const paymentDueAt = kstDateTime(data.paymentDueAt)
  const kakaoLink = data.kakaoChannelUrl
    ? `<p style="margin:24px 0 0;text-align:center"><a href="${escapeHtml(data.kakaoChannelUrl)}" style="color:#5c462c;text-decoration:underline">카카오톡 채널로 문의하기</a></p>`
    : ''
  const testBanner = isTest
    ? '<div style="padding:14px 20px;background:#fee500;color:#2d2900;text-align:center;font-size:14px;font-weight:700;line-height:1.5">테스트 주문 안내 · 실제 주문으로 처리되지 않습니다.</div>'
    : ''

  return {
    subject: `${isTest ? '[테스트 주문] ' : ''}[부스부스] 주문이 접수됐어요 · ${data.orderNumber}`,
    text: [
      isTest ? '※ 테스트 주문입니다. 실제 주문으로 처리되지 않습니다.' : '',
      `${data.customerName}님, 주문이 정상적으로 접수되었습니다.`,
      '',
      `주문번호: ${data.orderNumber}`,
      `최종 입금액: ${totalAmount}`,
      `입금 기한: ${paymentDueAt}`,
      '',
      '주문 조회 시 주문번호와 휴대전화 번호 뒷자리 4개가 필요합니다.',
      `주문 조회: ${lookupUrl}`,
      data.kakaoChannelUrl ? `문의: ${data.kakaoChannelUrl}` : '',
    ].filter(Boolean).join('\n'),
    html: `<!doctype html>
<html lang="ko">
  <body style="margin:0;background:#f5f0e8;font-family:Arial,'Apple SD Gothic Neo',sans-serif;color:#2d251c">
    <div style="max-width:600px;margin:0 auto;padding:32px 16px">
      <div style="background:#fff;border:1px solid #e2d6c6;border-radius:18px;overflow:hidden">
        ${testBanner}
        <div style="padding:26px 28px;background:#5c462c;color:#fff">
          <p style="margin:0 0 8px;font-size:13px;letter-spacing:1.5px">BOOTH BOOTH</p>
          <h1 style="margin:0;font-size:24px">주문이 접수됐어요</h1>
        </div>
        <div style="padding:30px 28px">
          <p style="margin:0 0 22px;line-height:1.7">${customerName}님, 주문해주셔서 감사합니다.<br>아래 주문번호를 꼭 보관해주세요.</p>
          <div style="padding:20px;border-radius:12px;background:#f8f4ee;text-align:center">
            <span style="display:block;margin-bottom:8px;font-size:13px;color:#756653">주문번호</span>
            <strong style="font-size:26px;letter-spacing:1px;color:#4b3824">${orderNumber}</strong>
          </div>
          <table role="presentation" style="width:100%;margin:24px 0;border-collapse:collapse;font-size:15px">
            <tr><td style="padding:10px 0;color:#756653">최종 입금액</td><td style="padding:10px 0;text-align:right;font-weight:700">${escapeHtml(totalAmount)}</td></tr>
            <tr><td style="padding:10px 0;color:#756653">입금 기한</td><td style="padding:10px 0;text-align:right">${escapeHtml(paymentDueAt)}</td></tr>
          </table>
          <p style="margin:0 0 24px;font-size:13px;line-height:1.7;color:#756653">주문 조회 시 주문번호와 주문할 때 입력한 휴대전화 번호의 뒷자리 4개가 필요합니다.</p>
          <p style="margin:0;text-align:center"><a href="${escapeHtml(lookupUrl)}" style="display:inline-block;padding:13px 24px;border-radius:9px;background:#5c462c;color:#fff;text-decoration:none;font-weight:700">주문 조회하기</a></p>
          ${kakaoLink}
        </div>
      </div>
      <p style="margin:18px 0 0;text-align:center;font-size:12px;color:#8a7b68">이 메일은 부스부스 주문 접수 결과를 안내하기 위해 발송되었습니다.</p>
    </div>
  </body>
</html>`,
  }
}
