'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Script from 'next/script'
import { zodResolver } from '@hookform/resolvers/zod'
import { useFieldArray, useForm } from 'react-hook-form'
import { Camera, Clock3, ImagePlus, Plus, ShoppingBag, Shirt, Trash2, Truck } from 'lucide-react'
import { Button } from '@/shared/ui/button'
import { itemPrice, orderTotals, type PickupSlotView, type ProductConfig } from '../domain/order'
import { orderFormSchema, type OrderFormInput } from '../schemas'

type PostcodeConstructor = new (options: { oncomplete: (data: { zonecode: string; address: string }) => void }) => { open: () => void }

declare global {
  interface Window {
    kakao?: { Postcode: PostcodeConstructor }
    daum?: { Postcode: PostcodeConstructor }
  }
}

type Props = {
  hardExpiresAt: string
  serverNow: string
  products: ProductConfig[]
  pickupSlots: PickupSlotView[]
  shippingFee: number
  freeShippingThreshold: number
}
type ImageDraft = { localId: string; file: File; preview: string; width: number; height: number }

class ImageUploadError extends Error {
  constructor(public readonly clientId: string, message: string) {
    super(message)
    this.name = 'ImageUploadError'
  }
}

function remainingLabel(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function itemDefaults(product: ProductConfig): OrderFormInput['items'][number] {
  return {
    clientId: crypto.randomUUID(), productId: product.id, itemType: product.type,
    size: product.type === 'shirt' ? (product.sizes.find((size) => size.value === 'M')?.value ?? product.sizes[0]?.value ?? '') : '',
    gender: product.type === 'shirt' ? (product.genders[0] ?? '') : '', initialText: '', stickerSelected: false, stickerCategories: '',
    favoriteColors: '', favoriteThings: '', desiredMood: '', instagramReference: '', extraRequest: '', images: [],
  }
}

async function decodeImage(file: File) {
  if ('createImageBitmap' in window) {
    try {
      const bitmap = await createImageBitmap(file)
      return { source: bitmap as CanvasImageSource, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() }
    } catch { /* Safari fallback below */ }
  }
  const url = URL.createObjectURL(file)
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new Error('이 이미지 형식은 변환할 수 없어요.'))
    element.src = url
  })
  return { source: image as CanvasImageSource, width: image.naturalWidth, height: image.naturalHeight, cleanup: () => URL.revokeObjectURL(url) }
}

async function prepareImage(original: File): Promise<ImageDraft> {
  if (original.size > 10 * 1024 * 1024) throw new Error(`${original.name}: 원본은 10MB 이하만 선택할 수 있어요.`)
  const decoded = await decodeImage(original)
  try {
    const scale = Math.min(1, 1600 / Math.max(decoded.width, decoded.height))
    const width = Math.max(1, Math.round(decoded.width * scale))
    const height = Math.max(1, Math.round(decoded.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width; canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('이미지를 처리하지 못했어요.')
    context.fillStyle = '#fff'; context.fillRect(0, 0, width, height)
    context.drawImage(decoded.source, 0, 0, width, height)
    let quality = 0.86
    let blob: Blob | null = null
    while (quality >= 0.5) {
      blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
      if (blob && blob.size <= 2 * 1024 * 1024) break
      quality -= 0.1
    }
    if (!blob || blob.size > 2 * 1024 * 1024) throw new Error(`${original.name}: 2MB 이하로 압축하지 못했어요.`)
    const name = `${original.name.replace(/\.[^.]+$/, '') || 'reference'}.jpg`
    const file = new File([blob], name, { type: 'image/jpeg' })
    return { localId: crypto.randomUUID(), file, preview: URL.createObjectURL(file), width, height }
  } finally { decoded.cleanup() }
}

function pickupLabel(slot: PickupSlotView) {
  const date = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(`${slot.date}T00:00:00+09:00`))
  return `${date} · ${slot.startsAt.slice(0, 5)}–${slot.endsAt.slice(0, 5)}`
}

export function OrderForm({ hardExpiresAt, serverNow, products, pickupSlots, shippingFee, freeShippingThreshold }: Props) {
  const shirt = products.find((product) => product.type === 'shirt') ?? products[0]
  const bag = products.find((product) => product.type === 'bag')
  const [now, setNow] = useState(() => Date.parse(serverNow))
  const [idleWarning, setIdleWarning] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [uploadLabel, setUploadLabel] = useState('')
  const [images, setImages] = useState<Record<string, ImageDraft[]>>({})
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({})
  const [postcodeError, setPostcodeError] = useState('')
  const imagesRef = useRef(images)
  const clockOffset = useRef(Date.parse(serverNow) - Date.now())
  const activityAt = useRef(Date.now())
  const warnedAt = useRef<number | null>(null)
  const idempotencyKey = useRef(crypto.randomUUID())
  const uploadedByLocalId = useRef<Record<string, string>>({})
  const form = useForm<OrderFormInput>({
    resolver: zodResolver(orderFormSchema),
    defaultValues: {
      customerName: '', phone: '', email: '', depositorName: '', fulfillmentType: 'shipping', postalCode: '', address: '', addressDetail: '', pickupSlotId: '',
      cashReceiptType: 'none', cashReceiptIdentifier: '', items: [itemDefaults(shirt)], privacyConsent: false, customOrderConsent: false, website: '',
    },
  })
  const items = useFieldArray({ control: form.control, name: 'items', keyName: 'fieldKey' })
  const watchedItems = form.watch('items')
  const fulfillmentType = form.watch('fulfillmentType')
  const cashReceiptType = form.watch('cashReceiptType')
  const totals = useMemo(
    () => orderTotals(products, watchedItems, fulfillmentType, { shippingFee, freeShippingThreshold }),
    [freeShippingThreshold, fulfillmentType, products, shippingFee, watchedItems],
  )
  const remaining = useMemo(() => Date.parse(hardExpiresAt) - now, [hardExpiresAt, now])
  const totalImages = Object.values(images).reduce((sum, entries) => sum + entries.length, 0)

  useEffect(() => { imagesRef.current = images }, [images])
  useEffect(() => () => Object.values(imagesRef.current).flat().forEach((image) => URL.revokeObjectURL(image.preview)), [])

  const releaseAndLeave = useCallback(async (message: string) => {
    await fetch('/api/reservations/release', { method: 'POST', keepalive: true }).catch(() => undefined)
    window.alert(message); window.location.assign('/')
  }, [])

  useEffect(() => {
    const markActivity = () => { activityAt.current = Date.now(); warnedAt.current = null; setIdleWarning(false) }
    const events: (keyof WindowEventMap)[] = ['pointerdown', 'keydown', 'input']
    events.forEach((event) => window.addEventListener(event, markActivity, { passive: true }))
    const timer = window.setInterval(() => {
      const clientNow = Date.now(); const serverCurrent = clientNow + clockOffset.current
      setNow(serverCurrent)
      const idle = clientNow - activityAt.current
      if (idle >= 5 * 60_000 && !warnedAt.current) { warnedAt.current = clientNow; setIdleWarning(true) }
      if (idle >= 6 * 60_000) void releaseAndLeave('오랫동안 활동이 없어 주문서가 종료되었어요.')
      if (serverCurrent >= Date.parse(hardExpiresAt)) void releaseAndLeave('20분의 주문서 작성 시간이 끝났어요.')
    }, 1_000)
    const heartbeat = window.setInterval(async () => {
      if (Date.now() - activityAt.current >= 5 * 60_000) return
      const response = await fetch('/api/reservations/heartbeat', { method: 'POST' })
      if (!response.ok) void releaseAndLeave('주문 자리가 만료되었어요. 다시 입장해주세요.')
    }, 30_000)
    const releaseOnClose = () => { if (!submitting) void fetch('/api/reservations/release', { method: 'POST', keepalive: true }) }
    window.addEventListener('pagehide', releaseOnClose)
    return () => { events.forEach((event) => window.removeEventListener(event, markActivity)); window.clearInterval(timer); window.clearInterval(heartbeat); window.removeEventListener('pagehide', releaseOnClose) }
  }, [hardExpiresAt, releaseAndLeave, submitting])

  function openPostcode() {
    const Postcode = window.kakao?.Postcode ?? window.daum?.Postcode
    if (!Postcode) { setPostcodeError('주소 검색을 불러오지 못했어요. 인터넷 연결을 확인한 후 다시 시도해주세요.'); return }
    setPostcodeError('')
    new Postcode({ oncomplete: (data) => { form.setValue('postalCode', data.zonecode, { shouldValidate: true }); form.setValue('address', data.address, { shouldValidate: true }) } }).open()
  }

  async function addImages(clientId: string, selected: FileList | null) {
    if (!selected?.length) return
    setImageErrors((state) => {
      const next = { ...state }
      delete next[clientId]
      return next
    })
    const current = images[clientId] ?? []
    const files = Array.from(selected).slice(0, Math.max(0, Math.min(3 - current.length, 20 - totalImages)))
    try {
      const prepared: ImageDraft[] = []
      for (const file of files) prepared.push(await prepareImage(file))
      setImages((state) => ({ ...state, [clientId]: [...(state[clientId] ?? []), ...prepared] }))
    } catch (error) {
      setImageErrors((state) => ({ ...state, [clientId]: error instanceof Error ? error.message : '이미지를 처리하지 못했어요.' }))
    }
  }

  function removeImage(clientId: string, localId: string) {
    setImageErrors((state) => {
      const next = { ...state }
      delete next[clientId]
      return next
    })
    const uploadedId = uploadedByLocalId.current[localId]
    if (uploadedId) {
      delete uploadedByLocalId.current[localId]
      void fetch('/api/order-images', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: uploadedId }) })
    }
    setImages((state) => {
      const target = state[clientId]?.find((image) => image.localId === localId)
      if (target) URL.revokeObjectURL(target.preview)
      return { ...state, [clientId]: (state[clientId] ?? []).filter((image) => image.localId !== localId) }
    })
  }

  function removeItem(index: number, clientId: string) {
    for (const image of images[clientId] ?? []) {
      URL.revokeObjectURL(image.preview)
      const uploadedId = uploadedByLocalId.current[image.localId]
      if (uploadedId) {
        delete uploadedByLocalId.current[image.localId]
        void fetch('/api/order-images', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: uploadedId }) })
      }
    }
    setImages((state) => { const next = { ...state }; delete next[clientId]; return next })
    setImageErrors((state) => { const next = { ...state }; delete next[clientId]; return next })
    items.remove(index)
  }

  async function uploadImages(value: OrderFormInput) {
    let completed = 0
    const total = Object.values(images).reduce((sum, entries) => sum + entries.length, 0)
    const uploaded: Record<string, string[]> = {}
    for (const item of value.items) {
      uploaded[item.clientId] = []
      for (const image of images[item.clientId] ?? []) {
        const previousId = uploadedByLocalId.current[image.localId]
        if (previousId) { uploaded[item.clientId].push(previousId); completed += 1; continue }
        try {
          setUploadLabel(`참고 이미지 업로드 중 ${completed + 1}/${total}`)
          const body = new FormData(); body.set('clientItemId', item.clientId); body.set('width', String(image.width)); body.set('height', String(image.height)); body.set('file', image.file)
          const response = await fetch('/api/order-images', { method: 'POST', body })
          const payload = await response.json() as { id?: string; error?: { message: string } }
          if (!response.ok || !payload.id) throw new Error(payload.error?.message ?? '이미지를 업로드하지 못했어요.')
          uploadedByLocalId.current[image.localId] = payload.id
          uploaded[item.clientId].push(payload.id); completed += 1
        } catch (error) {
          throw new ImageUploadError(item.clientId, error instanceof Error ? error.message : '이미지를 업로드하지 못했어요.')
        }
      }
    }
    return uploaded
  }

  async function submit(value: OrderFormInput) {
    setSubmitting(true); setSubmitError(''); setImageErrors({})
    try {
      const uploaded = await uploadImages(value)
      setUploadLabel('주문을 접수하고 있어요')
      const body = { ...value, items: value.items.map((item) => ({ ...item, images: uploaded[item.clientId] ?? [] })) }
      const response = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey.current }, body: JSON.stringify(body) })
      const payload = await response.json() as { redirectTo?: string; error?: { message: string } }
      if (!response.ok || !payload.redirectTo) throw new Error(payload.error?.message ?? '주문을 접수하지 못했어요.')
      window.location.assign(payload.redirectTo)
    } catch (error) {
      if (error instanceof ImageUploadError) setImageErrors((state) => ({ ...state, [error.clientId]: error.message }))
      else setSubmitError(error instanceof Error ? error.message : '잠시 후 다시 시도해주세요.')
      setSubmitting(false); setUploadLabel('')
    }
  }

  return (
    <>
      <Script src="https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js" strategy="afterInteractive" onReady={() => setPostcodeError('')} onError={() => setPostcodeError('주소 검색을 불러오지 못했어요. 인터넷 연결을 확인한 후 다시 시도해주세요.')} />
      <div className="timer-bar" aria-live="polite"><div><strong><Clock3 size={15} /> 주문 자리 확보 중</strong><span>입장 후 20분 안에 제출해주세요.</span></div><b>{remainingLabel(remaining)}</b></div>
      {idleWarning && <div className="idle-warning" role="alertdialog" aria-modal="true"><div><Clock3 size={24} /><h2>계속 작성하고 계신가요?</h2><p>1분 안에 화면을 클릭하거나 입력하지 않으면 주문 자리가 자동으로 반환됩니다.</p><Button onClick={() => { activityAt.current = Date.now(); setIdleWarning(false) }}>계속 작성하기</Button></div></div>}

      <form className="surface-card order-custom-form" onSubmit={form.handleSubmit(submit)}>
        <div className="bot-field" aria-hidden="true"><label>웹사이트<input tabIndex={-1} autoComplete="off" {...form.register('website')} /></label></div>
        <FormHeading number="01" title="주문자 정보" description="주문 확인과 제작 안내에 사용됩니다." />
        <p className="required-guide"><RequiredMark /> 표시된 항목은 필수 입력입니다.</p>
        <div className="form-grid">
          <Field label="이름" error={form.formState.errors.customerName?.message} required><input aria-required="true" autoComplete="name" placeholder="홍길동" {...form.register('customerName')} /></Field>
          <Field label="휴대전화" error={form.formState.errors.phone?.message} required><input aria-required="true" inputMode="tel" autoComplete="tel" placeholder="010-1234-5678" {...form.register('phone')} /></Field>
          <Field label="이메일" error={form.formState.errors.email?.message} full required><input aria-required="true" type="email" autoComplete="email" placeholder="hello@example.com" {...form.register('email')} /></Field>
          <Field label="입금자명" error={form.formState.errors.depositorName?.message} full required><input aria-required="true" placeholder="실제 입금할 이름" {...form.register('depositorName')} /></Field>
        </div>

        <div className="form-section">
          <FormHeading number="02" title="상품별 주문 정보" description="제작할 상품마다 이니셜과 취향을 따로 입력해주세요." />
          <div className="product-add-buttons">
            <Button type="button" variant="secondary" onClick={() => items.append(itemDefaults(shirt))}><Shirt size={16} /> 티셔츠 추가</Button>
            {bag && <Button type="button" variant="secondary" onClick={() => items.append(itemDefaults(bag))}><ShoppingBag size={16} /> 가방 추가</Button>}
          </div>
          <div className="custom-item-list">
            {items.fields.map((field, index) => {
              const current = watchedItems[index] ?? field
              const product = products.find((entry) => entry.id === current.productId) ?? shirt
              const itemImages = images[current.clientId] ?? []
              return (
                <article className="custom-item-card" key={field.fieldKey}>
                  <div className="custom-item-card__header"><div><span>{String(index + 1).padStart(2, '0')}</span>{product.type === 'shirt' ? <Shirt size={18} /> : <ShoppingBag size={18} />}<strong>{product.name}</strong></div><button type="button" aria-label={`${product.name} 삭제`} disabled={items.fields.length === 1} onClick={() => removeItem(index, current.clientId)}><Trash2 size={17} /></button></div>
                  <input type="hidden" {...form.register(`items.${index}.clientId`)} /><input type="hidden" {...form.register(`items.${index}.productId`)} /><input type="hidden" {...form.register(`items.${index}.itemType`)} />
                  <div className="form-grid compact-grid">
                    {product.type === 'shirt' && <><Field label="사이즈" error={form.formState.errors.items?.[index]?.size?.message} required><select aria-required="true" {...form.register(`items.${index}.size`)}>{product.sizes.map((size) => <option key={size.value} value={size.value}>{size.value}{size.priceDelta ? ` (+${size.priceDelta.toLocaleString('ko-KR')}원)` : ''}</option>)}</select></Field><Field label="성별" error={form.formState.errors.items?.[index]?.gender?.message} required><select aria-required="true" {...form.register(`items.${index}.gender`)}>{product.genders.map((gender) => <option key={gender}>{gender}</option>)}</select></Field></>}
                    <Field label="이니셜" error={form.formState.errors.items?.[index]?.initialText?.message} full required><input aria-required="true" maxLength={20} autoCapitalize="off" placeholder="영문 대·소문자, 공백 제외 최대 10자" {...form.register(`items.${index}.initialText`)} /></Field>
                  </div>
                  <label className="sticker-toggle"><input type="checkbox" {...form.register(`items.${index}.stickerSelected`)} /><span><strong>랜덤 이니셜 스티커 선택</strong><small>선택하지 않아도 괜찮아요.</small></span></label>
                  {current.stickerSelected && <Field label="원하는 스티커 카테고리" error={form.formState.errors.items?.[index]?.stickerCategories?.message}><input placeholder="자동차, 공룡, 무지개처럼 3~5개 권장" {...form.register(`items.${index}.stickerCategories`)} /></Field>}
                  <details className="preference-details"><summary>디자인 참고사항 입력 <span>선택</span></summary><div className="form-grid compact-grid"><Field label="좋아하는 색상"><input placeholder="예: 초록, 파랑" {...form.register(`items.${index}.favoriteColors`)} /></Field><Field label="좋아하는 동물·물건"><input placeholder="예: 공룡, 자동차" {...form.register(`items.${index}.favoriteThings`)} /></Field><Field label="원하는 분위기" full><input placeholder="예: 밝고 귀여운 느낌" {...form.register(`items.${index}.desiredMood`)} /></Field><Field label="참고할 인스타그램 디자인" full><input placeholder="게시물 링크 또는 설명" {...form.register(`items.${index}.instagramReference`)} /></Field><Field label="기타 요청사항" full><textarea placeholder="추가로 참고할 내용을 입력해주세요." {...form.register(`items.${index}.extraRequest`)} /></Field></div></details>
                  <div className={`image-picker ${imageErrors[current.clientId] ? 'image-picker--error' : ''}`}><div><strong><Camera size={15} /> 참고 이미지</strong><span>상품당 최대 3장 · 아이폰 사진 지원</span></div><div className="image-grid">{itemImages.map((image) => <figure key={image.localId}><img src={image.preview} alt="업로드할 참고 이미지 미리보기" /><button type="button" aria-label="참고 이미지 삭제" onClick={() => removeImage(current.clientId, image.localId)}><Trash2 size={14} /></button></figure>)}{itemImages.length < 3 && totalImages < 20 && <label className="image-add"><ImagePlus size={20} /><span>사진 추가</span><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" multiple onChange={(event) => { void addImages(current.clientId, event.target.files); event.target.value = '' }} /></label>}</div>{imageErrors[current.clientId] && <p className="image-picker__error" role="alert">{imageErrors[current.clientId]}</p>}</div>
                  <div className="item-price"><span>상품 금액</span><strong>{itemPrice(product, current.size).toLocaleString('ko-KR')}원</strong></div>
                </article>
              )
            })}
          </div>
          {form.formState.errors.items?.message && <p className="field__error">{form.formState.errors.items.message}</p>}
          <p className="field__hint">주문 수량 제한은 없습니다. 참고 이미지는 주문 전체에서 최대 20장까지 첨부할 수 있어요. ({totalImages}/20)</p>
        </div>

        <div className="form-section">
          <FormHeading number="03" title="수령 방법" description="택배 배송 또는 직접 픽업을 선택해주세요." />
          <div className="choice-cards"><label><input type="radio" value="shipping" {...form.register('fulfillmentType')} /><span><Truck size={19} /><strong>택배 배송</strong><small>{freeShippingThreshold.toLocaleString('ko-KR')}원 미만 배송비 {shippingFee.toLocaleString('ko-KR')}원</small></span></label><label><input type="radio" value="pickup" {...form.register('fulfillmentType')} /><span><ShoppingBag size={19} /><strong>직접 픽업</strong><small>배송비 무료</small></span></label></div>
          {fulfillmentType === 'shipping' ? <div className="form-grid delivery-fields"><Field label="우편번호" error={form.formState.errors.postalCode?.message} required><input aria-required="true" readOnly placeholder="우편번호" {...form.register('postalCode')} /></Field><div className="field field--address-button"><span className="field__label">주소 검색</span><Button type="button" variant="secondary" onClick={openPostcode}>카카오 주소 검색</Button>{postcodeError && <span className="field__error" role="alert">{postcodeError}</span>}</div><Field label="기본 주소" error={form.formState.errors.address?.message} full required><input aria-required="true" readOnly placeholder="주소 검색을 이용해주세요" {...form.register('address')} /></Field><Field label="상세 주소" error={form.formState.errors.addressDetail?.message} full required><input aria-required="true" placeholder="동·호수 등 상세 주소" {...form.register('addressDetail')} /></Field></div> : <Field label="픽업 날짜·시간" error={form.formState.errors.pickupSlotId?.message} required><select aria-required="true" {...form.register('pickupSlotId')}><option value="">픽업 일정을 선택해주세요</option>{pickupSlots.map((slot) => <option key={slot.id} value={slot.id}>{pickupLabel(slot)}</option>)}</select>{!pickupSlots.length && <span className="field__error">현재 선택 가능한 픽업 일정이 없습니다.</span>}</Field>}
        </div>

        <div className="form-section">
          <FormHeading number="04" title="현금영수증" description="필요한 경우 발급 정보를 남겨주세요." />
          <div className="form-grid"><Field label="신청 유형" full><select {...form.register('cashReceiptType')}><option value="none">신청 안 함</option><option value="personal">개인 소득공제용</option><option value="business">사업자 지출증빙용</option></select></Field>{cashReceiptType !== 'none' && <Field label={cashReceiptType === 'personal' ? '휴대전화 번호' : '사업자등록번호'} error={form.formState.errors.cashReceiptIdentifier?.message} full required><input aria-required="true" inputMode="numeric" placeholder={cashReceiptType === 'personal' ? '01012345678' : '1234567890'} {...form.register('cashReceiptIdentifier')} /></Field>}</div>
        </div>

        <div className="summary-box order-total-box"><div className="summary-line"><span>상품 {watchedItems.length}개</span><strong>{totals.subtotal.toLocaleString('ko-KR')}원</strong></div><div className="summary-line"><span>배송비</span><strong>{totals.shippingFee ? `${totals.shippingFee.toLocaleString('ko-KR')}원` : '무료'}</strong></div><div className="summary-line summary-line--total"><span>총 입금 금액</span><strong>{totals.total.toLocaleString('ko-KR')}원</strong></div></div>

        <label className="checkbox privacy-box"><input type="checkbox" aria-required="true" {...form.register('privacyConsent')} /><span><strong>개인정보 수집 및 이용에 동의합니다. <RequiredMark /></strong><br />주문, 제작, 배송·픽업과 고객 문의를 위해 연락처, 주소, 현금영수증 정보와 참고 이미지를 수집합니다. 참고 이미지에는 아동 사진이 포함될 수 있으며 관리자만 열람합니다.</span></label>
        {form.formState.errors.privacyConsent?.message && <p className="field__error">{form.formState.errors.privacyConsent.message}</p>}
        <label className="checkbox privacy-box custom-consent"><input type="checkbox" aria-required="true" {...form.register('customOrderConsent')} /><span><strong>커스텀 제작 및 교환·환불 안내에 동의합니다. <RequiredMark /></strong><br />디자인 시안은 별도로 제공되지 않으며 입금 확인 후 제작이 시작됩니다. 제작 시작 후 단순 변심 교환·환불은 어렵지만, 제작 불량 또는 주문 내용과 다른 상품은 확인 후 무료 재제작 또는 교환해드립니다.</span></label>
        {form.formState.errors.customOrderConsent?.message && <p className="field__error">{form.formState.errors.customOrderConsent.message}</p>}
        {submitError && <p className="form-error">{submitError}</p>}
        <div className="form-actions sticky-submit"><Button type="button" variant="ghost" onClick={() => void releaseAndLeave('주문서 작성을 종료했어요.')}>나가기</Button><Button type="submit" disabled={submitting}>{submitting ? (uploadLabel || '주문 접수 중…') : `${totals.total.toLocaleString('ko-KR')}원 주문하기`}</Button></div>
      </form>
    </>
  )
}

function FormHeading({ number, title, description }: { number: string; title: string; description: string }) {
  return <div className="form-section__heading"><span>{number}</span><div><h2>{title}</h2><p>{description}</p></div></div>
}

function RequiredMark() {
  return <><span className="required-mark" aria-hidden="true">*</span><span className="sr-only">필수</span></>
}

function Field({ label, error, full = false, required = false, children }: { label: string; error?: string; full?: boolean; required?: boolean; children: React.ReactNode }) {
  return <div className={`field ${full ? 'field--full' : ''}`}><span className="field__label">{label}{required && <> <RequiredMark /></>}</span>{children}{error && <span className="field__error">{error}</span>}</div>
}
