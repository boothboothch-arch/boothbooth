'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, Clock3, RefreshCw } from 'lucide-react'
import { Badge } from '@/shared/ui/badge'
import { Button } from '@/shared/ui/button'
import type { SaleStatus } from '../domain/sale'
import { fallbackSaleStatus, getSaleLabel } from '../domain/sale'

function formatCountdown(milliseconds: number) {
  const value = Math.max(0, Math.floor(milliseconds / 1000))
  const days = Math.floor(value / 86400)
  const hours = Math.floor((value % 86400) / 3600)
  const minutes = Math.floor((value % 3600) / 60)
  const seconds = value % 60
  return { days, hours, minutes, seconds }
}

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return <div className="countdown__unit"><strong>{String(value).padStart(2, '0')}</strong><span>{label}</span></div>
}

function saleDate(value: string) {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export function SalePanel({
  initialNow,
  initialStatus = fallbackSaleStatus,
  statusEndpoint = '/api/public/sale-status',
  reservationSaleId,
}: {
  initialNow: string
  initialStatus?: SaleStatus
  statusEndpoint?: string
  reservationSaleId?: string
}) {
  const [status, setStatus] = useState<SaleStatus>(initialStatus)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [now, setNow] = useState(() => Date.parse(initialNow))
  const clockOffset = useRef(Date.parse(initialNow) - Date.now())

  async function refresh() {
    try {
      const response = await fetch(statusEndpoint, { cache: 'no-store' })
      if (!response.ok) throw new Error('sale status failed')
      const next = await response.json() as SaleStatus
      clockOffset.current = Date.parse(next.serverNow) - Date.now()
      setStatus(next)
      setError(false)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
    const poller = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 10_000)
    const ticker = window.setInterval(() => setNow(Date.now() + clockOffset.current), 1_000)
    return () => { window.clearInterval(poller); window.clearInterval(ticker) }
  }, [])

  const countdown = useMemo(() => {
    const target = status.phase === 'scheduled' ? Date.parse(status.startsAt) : Date.parse(status.endsAt)
    return formatCountdown(target - now)
  }, [now, status.endsAt, status.phase, status.startsAt])

  const phase = status.configured && now >= Date.parse(status.endsAt) ? 'ended' : status.phase
  const isScheduled = phase === 'scheduled'
  const showCountdown = isScheduled || phase === 'open' || phase === 'temporarily_full'
  const canEnter = status.configured && phase === 'open' && status.remainingCount > 0
  const tone = phase === 'open' ? 'green' : isScheduled ? 'blue' : 'neutral'

  async function enterOrder() {
    if (!canEnter) return
    const button = document.activeElement as HTMLButtonElement | null
    if (button) button.disabled = true
    try {
      const response = await fetch('/api/reservations', {
        method: 'POST',
        headers: reservationSaleId ? { 'Content-Type': 'application/json' } : undefined,
        body: reservationSaleId ? JSON.stringify({ saleId: reservationSaleId }) : undefined,
      })
      const payload = await response.json() as { redirectTo?: string; error?: { message: string } }
      if (!response.ok || !payload.redirectTo) throw new Error(payload.error?.message ?? '주문서에 입장하지 못했어요.')
      window.location.assign(payload.redirectTo)
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : '잠시 후 다시 시도해주세요.')
      if (button) button.disabled = false
      void refresh()
    }
  }

  return (
    <aside className="sale-panel" aria-live="polite">
      <div className="sale-panel__header">
        <Badge tone={tone}>{getSaleLabel(phase)}</Badge>
        <button className="icon-button" onClick={() => void refresh()} aria-label="판매 상태 새로고침"><RefreshCw size={15} /></button>
      </div>

      <h1 className="sale-panel__title">{status.title}</h1>

      {showCountdown ? (
        <>
          <span className="sale-panel__eyebrow"><Clock3 size={14} /> {isScheduled ? '주문 시작까지' : '주문 마감까지'}</span>
          <time className="sale-panel__date" dateTime={isScheduled ? status.startsAt : status.endsAt}>{saleDate(isScheduled ? status.startsAt : status.endsAt)} {isScheduled ? '오픈' : '마감'}</time>
          <div className="countdown">
            <CountdownUnit value={countdown.days} label="일" />
            <CountdownUnit value={countdown.hours} label="시간" />
            <CountdownUnit value={countdown.minutes} label="분" />
            <CountdownUnit value={countdown.seconds} label="초" />
          </div>
          {!isScheduled && <p className="sale-panel__countdown-note">준비된 수량 소진 시 일찍 마감될 수 있어요.</p>}
        </>
      ) : (
        <p className="sale-panel__closed-message">{phase === 'sold_out' ? '준비된 수량이 모두 소진되었어요.' : '주문이 마감되었습니다.'}</p>
      )}

      {!status.configured && <p className="notice notice--setup">Supabase 연결 후 판매를 시작할 수 있어요.</p>}
      {error && <p className="notice notice--error">판매 상태를 불러오지 못했어요. 다시 시도해주세요.</p>}

      <Button className="sale-panel__button" disabled={!canEnter || loading} onClick={() => void enterOrder()}>
        {loading ? '상태 확인 중…' : canEnter ? <>주문하기 <ArrowRight size={16} /></> : phase === 'sold_out' ? '주문 마감' : getSaleLabel(phase)}
      </Button>
      <span className="sale-panel__hint">입장 후 30분 동안 주문 자리가 확보됩니다.</span>
    </aside>
  )
}
