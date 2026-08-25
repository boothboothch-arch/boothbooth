'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, ExternalLink, History, Pencil, Save, ShoppingBag, Shirt, X } from 'lucide-react'
import { updateOrderItemAction } from '@/features/admin/actions'
import { limitInitialTextInput, type OrderItemView, type OrderView, type ProductConfig } from '@/features/order/domain/order'
import { Button } from '@/shared/ui/button'

type ChangeLog = {
  id: number
  beforeData: Record<string, unknown>
  afterData: Record<string, unknown>
  orderTotalBefore: number
  orderTotalAfter: number
  createdAt: string
}

type Props = {
  orderId: string
  orderNumber: string
  orderState: OrderView['orderState']
  item: OrderItemView
  index: number
  product: ProductConfig | null
  logs: ChangeLog[]
}

function money(value: number) {
  return `${value.toLocaleString('ko-KR')}원`
}

export function AdminOrderItemEditor({ orderId, orderNumber, orderState, item, index, product, logs }: Props) {
  const [editing, setEditing] = useState(false)
  const [selectedOptionValueIds, setSelectedOptionValueIds] = useState(() => item.selectedOptions.map((option) => option.valueId))
  const [initialText, setInitialText] = useState(item.initialText)
  const [stickerSelected, setStickerSelected] = useState(item.stickerSelected)
  const [stickerCategories, setStickerCategories] = useState(item.stickerCategories.join(', '))
  const [extraRequest, setExtraRequest] = useState(item.extraRequest)
  const editable = Boolean(product) && ['payment_pending', 'payment_confirmed', 'preparing'].includes(orderState)
  const selected = useMemo(() => new Set(selectedOptionValueIds), [selectedOptionValueIds])
  const originalOptionValueIds = item.selectedOptions.map((option) => option.valueId)
  const optionsChanged = selectedOptionValueIds.length !== originalOptionValueIds.length || originalOptionValueIds.some((id) => !selected.has(id))
  const configuredSurcharge = product?.optionGroups
    .filter((group) => group.active)
    .flatMap((group) => group.values.filter((option) => option.active))
    .reduce((sum, option) => sum + (selected.has(option.id) ? option.priceDelta : 0), 0) ?? item.optionSurcharge
  const previewSurcharge = optionsChanged ? configuredSurcharge : item.optionSurcharge
  const previewLineAmount = item.unitPrice + previewSurcharge
  const amountDelta = previewLineAmount - item.lineAmount

  function reset() {
    setSelectedOptionValueIds(item.selectedOptions.map((option) => option.valueId))
    setInitialText(item.initialText)
    setStickerSelected(item.stickerSelected)
    setStickerCategories(item.stickerCategories.join(', '))
    setExtraRequest(item.extraRequest)
    setEditing(false)
  }

  function setSingleOption(group: ProductConfig['optionGroups'][number], valueId: string) {
    const groupIds = new Set(group.values.map((option) => option.id))
    setSelectedOptionValueIds((current) => [...current.filter((id) => !groupIds.has(id)), ...(valueId ? [valueId] : [])])
  }

  function setMultipleOption(group: ProductConfig['optionGroups'][number], valueId: string, checked: boolean) {
    const groupIds = new Set(group.values.map((option) => option.id))
    setSelectedOptionValueIds((current) => {
      const outside = current.filter((id) => !groupIds.has(id))
      const inside = current.filter((id) => groupIds.has(id))
      return checked ? [...outside, ...new Set([...inside, valueId])] : [...outside, ...inside.filter((id) => id !== valueId)]
    })
  }

  function confirmSave(event: React.FormEvent<HTMLFormElement>) {
    const warnings: string[] = []
    if (orderState === 'preparing') warnings.push('이미 제작에 반영됐을 수 있습니다. 제작 담당자에게 변경 내용을 반드시 전달해주세요.')
    if (amountDelta !== 0) warnings.push(`주문 금액이 ${money(item.lineAmount)}에서 ${money(previewLineAmount)}(으)로 변경됩니다.`)
    if (warnings.length && !window.confirm(`${warnings.join('\n\n')}\n\n저장할까요?`)) event.preventDefault()
  }

  return (
    <article className={`admin-custom-item ${editing ? 'admin-custom-item--editing' : ''}`}>
      <div className="admin-custom-item__title">
        <span>{item.itemType === 'shirt' ? <Shirt size={17} /> : <ShoppingBag size={17} />}</span>
        <strong>{index + 1}. {item.productName}{item.initialText ? ` · ${item.initialText}` : ''}</strong>
        <div className="admin-custom-item__title-actions">
          <b>{money(item.lineAmount)}</b>
          {editable && !editing && <Button type="button" variant="secondary" onClick={() => setEditing(true)}><Pencil size={12} /> 수정</Button>}
        </div>
      </div>

      {!editing ? <>
        <dl className="info-list">
          <div><dt>옵션</dt><dd>{item.selectedOptions.map((option) => `${option.groupName}: ${option.valueLabel}${option.priceDelta ? ` (+${money(option.priceDelta)})` : ''}`).join(' · ') || '없음'}</dd></div>
          <div><dt>스티커</dt><dd>{item.stickerSelected ? item.stickerCategories.join(', ') || '선택' : '미선택'}</dd></div>
          <div><dt>기타 요청</dt><dd>{item.extraRequest || '-'}</dd></div>
        </dl>
      </> : product && <form className="admin-order-item-editor" action={updateOrderItemAction} onSubmit={confirmSave}>
        <input type="hidden" name="orderId" value={orderId} />
        <input type="hidden" name="orderNumber" value={orderNumber} />
        <input type="hidden" name="orderItemId" value={item.id} />
        <input type="hidden" name="selectedOptionValueIds" value={JSON.stringify(selectedOptionValueIds)} />
        <input type="hidden" name="stickerSelected" value={String(stickerSelected)} />
        <div className="form-grid">
          {product.optionGroups.filter((group) => group.active).sort((a, b) => a.sortOrder - b.sortOrder).map((group) => {
            const activeValues = group.values.filter((option) => option.active).sort((a, b) => a.sortOrder - b.sortOrder)
            const selectedCount = activeValues.filter((option) => selected.has(option.id)).length
            const minimum = group.required ? Math.max(1, group.minSelections) : group.minSelections
            return <div className="field field--full" key={group.id}>
              <label>{group.name}{group.required ? ' *' : ''}</label>
              {group.selectionType === 'single' ? <select value={activeValues.find((option) => selected.has(option.id))?.id ?? ''} onChange={(event) => setSingleOption(group, event.target.value)}>
                {minimum === 0 ? <option value="">선택 안 함</option> : <option value="" disabled>선택해주세요</option>}
                {activeValues.map((option) => <option key={option.id} value={option.id}>{option.label}{option.priceDelta ? ` (+${money(option.priceDelta)})` : ''}</option>)}
              </select> : <div className="option-choice-list">
                {activeValues.map((option) => <label key={option.id}><input type="checkbox" checked={selected.has(option.id)} disabled={!selected.has(option.id) && selectedCount >= group.maxSelections} onChange={(event) => setMultipleOption(group, option.id, event.target.checked)} /><span><strong>{option.label}</strong>{option.priceDelta > 0 && <small>+{money(option.priceDelta)}</small>}</span></label>)}
              </div>}
            </div>
          })}
          {product.customization.initialEnabled && <div className="field field--full"><label>이니셜</label><input name="initialText" maxLength={40} value={initialText} onChange={(event) => setInitialText(limitInitialTextInput(event.target.value))} placeholder="영문, 공백 제외 최대 20자" /><span className="field__hint">공백 제외 {initialText.replaceAll(' ', '').length}/20자</span></div>}
          {!product.customization.initialEnabled && <input type="hidden" name="initialText" value={initialText} />}
          {product.customization.stickerEnabled && <div className="field field--full"><label>랜덤 이니셜 스티커</label><select value={stickerSelected ? 'selected' : 'unselected'} onChange={(event) => { const next = event.target.value === 'selected'; setStickerSelected(next); if (!next) setStickerCategories('') }}><option value="unselected">미선택</option><option value="selected">선택</option></select></div>}
          {product.customization.stickerEnabled && stickerSelected && <div className="field field--full"><label>원하는 스티커 카테고리</label><input name="stickerCategories" maxLength={200} value={stickerCategories} onChange={(event) => setStickerCategories(event.target.value)} /></div>}
          {(!product.customization.stickerEnabled || !stickerSelected) && <input type="hidden" name="stickerCategories" value={stickerCategories} />}
          {product.customization.extraRequestEnabled ? <div className="field field--full"><label>기타 요청</label><textarea name="extraRequest" maxLength={300} value={extraRequest} onChange={(event) => setExtraRequest(event.target.value)} /></div> : <input type="hidden" name="extraRequest" value={extraRequest} />}
        </div>
        {orderState === 'preparing' && <div className="notice notice--warning admin-item-edit-warning"><AlertTriangle size={15} /><span>제작 중인 주문입니다. 저장 후 제작 담당자에게 변경 내용을 전달해주세요.</span></div>}
        <div className={`admin-item-price-change ${amountDelta === 0 ? '' : 'admin-item-price-change--changed'}`}><span>상품 금액</span><strong>{money(item.lineAmount)} → {money(previewLineAmount)}</strong>{amountDelta !== 0 && <small>{amountDelta > 0 ? '+' : ''}{money(amountDelta)} 변경</small>}</div>
        <div className="form-actions"><Button type="button" variant="ghost" onClick={reset}><X size={13} /> 취소</Button><Button type="submit"><Save size={13} /> 변경 저장</Button></div>
      </form>}

      {item.images.length > 0 && <div className="admin-image-grid">{item.images.map((image) => <a href={image.url} target="_blank" rel="noreferrer" key={image.id}><img src={image.url} alt="주문 디자인 참고" /><span>원본 보기 <ExternalLink size={12} /></span></a>)}</div>}
      {logs.length > 0 && <details className="admin-item-change-history"><summary><History size={13} /> 변경 이력 {logs.length}건</summary><ul>{logs.map((log) => <li key={log.id}><span>{new Date(log.createdAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</span><strong>{money(log.orderTotalBefore)} → {money(log.orderTotalAfter)}</strong></li>)}</ul></details>}
    </article>
  )
}
