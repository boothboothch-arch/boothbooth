'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/shared/ui/button'

export function OrderLookupForm() {
  const [orderNumber, setOrderNumber] = useState('')
  const [phoneLast4, setPhoneLast4] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/orders/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderNumber, phoneLast4 }) })
      const payload = await response.json() as { redirectTo?: string; error?: { message: string } }
      if (!response.ok || !payload.redirectTo) throw new Error(payload.error?.message ?? '주문을 찾지 못했어요.')
      window.location.assign(payload.redirectTo)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '잠시 후 다시 시도해주세요.')
      setLoading(false)
    }
  }

  return (
    <form className="surface-card lookup-form" onSubmit={submit}>
      <div className="field"><label htmlFor="orderNumber">주문번호</label><input id="orderNumber" value={orderNumber} onChange={(event) => setOrderNumber(event.target.value.toUpperCase())} placeholder="BB-XXXXXXXXXX" autoCapitalize="characters" /></div>
      <div className="field"><label htmlFor="phoneLast4">휴대전화 번호 뒷자리</label><input id="phoneLast4" value={phoneLast4} onChange={(event) => setPhoneLast4(event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="1234" inputMode="numeric" /></div>
      {error && <p className="form-error">{error}</p>}
      <Button disabled={loading} type="submit"><Search size={16} /> {loading ? '확인 중…' : '주문 확인하기'}</Button>
      <p className="lookup-form__hint">인증 후 30분 동안 주문을 확인할 수 있어요.</p>
    </form>
  )
}
