import { describe, expect, it } from 'vitest'
import { getSaleLabel } from './sale'

describe('getSaleLabel', () => {
  it.each([
    ['scheduled', '판매 예정'],
    ['open', '주문 가능'],
    ['temporarily_full', '현재 작성 중'],
    ['sold_out', '품절'],
    ['manually_closed', '조기 마감'],
    ['ended', '판매 종료'],
  ] as const)('%s 상태를 고객용 문구로 바꾼다', (phase, label) => {
    expect(getSaleLabel(phase)).toBe(label)
  })
})

