import { describe, expect, it } from 'vitest'
import { buildOrderReceivedEmail } from './order-email-template'

describe('order received email', () => {
  it('주문번호와 안전한 주문 조회 링크를 안내한다', () => {
    const email = buildOrderReceivedEmail({
      customerName: '홍길동',
      orderNumber: 'BB-0123456789',
      totalAmount: 36000,
      paymentDueAt: '2026-08-30T09:30:00.000Z',
      appUrl: 'https://booth-booth.example',
      kakaoChannelUrl: 'https://pf.kakao.com/_example',
    })
    expect(email.subject).toContain('BB-0123456789')
    expect(email.text).toContain('36,000원')
    expect(email.text).toContain('https://booth-booth.example/order/lookup')
    expect(email.html).toContain('카카오톡 채널로 문의하기')
  })

  it('고객 입력값을 HTML 이스케이프한다', () => {
    const email = buildOrderReceivedEmail({
      customerName: '<script>alert(1)</script>',
      orderNumber: 'BB-0123456789',
      totalAmount: 1000,
      paymentDueAt: '2026-08-30T09:30:00.000Z',
      appUrl: 'https://booth-booth.example',
    })
    expect(email.html).not.toContain('<script>')
    expect(email.html).toContain('&lt;script&gt;')
  })

  it('테스트 차수 메일을 실제 주문과 명확히 구분한다', () => {
    const email = buildOrderReceivedEmail({
      customerName: '테스트',
      orderNumber: 'BB-TEST000001',
      totalAmount: 1000,
      paymentDueAt: '2026-09-01T09:30:00.000Z',
      appUrl: 'https://boothbooth.kr',
      saleKind: 'test',
    })
    expect(email.subject).toMatch(/^\[테스트 주문\]/)
    expect(email.text).toContain('실제 주문으로 처리되지 않습니다')
    expect(email.html).toContain('테스트 주문 안내')
  })
})
