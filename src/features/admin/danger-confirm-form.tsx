'use client'

import { useState } from 'react'
import { deleteSaleAction, resetTestSaleAction } from '@/features/admin/actions'
import { Button } from '@/shared/ui/button'

export function DangerConfirmForm({
  saleId,
  phrase,
  mode,
  disabled = false,
}: {
  saleId: string
  phrase: string
  mode: 'delete' | 'reset'
  disabled?: boolean
}) {
  const [confirmation, setConfirmation] = useState('')
  const action = mode === 'delete' ? deleteSaleAction : resetTestSaleAction
  const label = mode === 'delete' ? '차수 영구 삭제' : '테스트 데이터 초기화'
  return (
    <form className="danger-confirm-form" action={action}>
      <input type="hidden" name="saleId" value={saleId} />
      <div className="field">
        <label htmlFor={`${mode}-confirmation`}>확인 문구</label>
        <input
          id={`${mode}-confirmation`}
          name="confirmation"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          placeholder={phrase}
          autoComplete="off"
          disabled={disabled}
        />
        <span className="field__hint"><strong>{phrase}</strong>를 정확히 입력해주세요.</span>
      </div>
      <Button type="submit" variant="danger" disabled={disabled || confirmation !== phrase}>{label}</Button>
    </form>
  )
}
