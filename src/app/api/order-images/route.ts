import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { apiError, ApiProblem, assertSameOrigin, enforceRateLimit } from '@/server/http/api'
import { hmac } from '@/server/security/crypto'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'

const metadataSchema = z.object({ clientItemId: z.uuid(), width: z.coerce.number().int().min(1).max(1600), height: z.coerce.number().int().min(1).max(1600) })
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const bucket = 'order-reference-images'

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request)
    await enforceRateLimit(request, 'order-image-upload', 40, 3600)
    const token = (await cookies()).get('bb_reservation')?.value
    if (!token) throw new ApiProblem('RESERVATION_EXPIRED', '주문서 이용 시간이 끝났어요.', 410)
    const formData = await request.formData()
    const parsed = metadataSchema.safeParse({ clientItemId: formData.get('clientItemId'), width: formData.get('width'), height: formData.get('height') })
    if (!parsed.success) throw new ApiProblem('INVALID_INPUT', '이미지 정보를 확인해주세요.', 422)
    const file = formData.get('file')
    if (!(file instanceof File) || file.size < 1 || file.size > 2 * 1024 * 1024 || !allowedTypes.has(file.type)) {
      throw new ApiProblem('INVALID_IMAGE', '이미지는 JPEG, PNG, WebP 형식으로 2MB 이하만 업로드할 수 있어요.', 422)
    }
    const client = createPrivilegedClient()
    const { data: reservation, error: reservationError } = await client.from('reservations').select('id,sale_id,state,hard_expires_at,lease_expires_at').eq('token_hash', hmac(token)).maybeSingle()
    if (reservationError || !reservation || reservation.state !== 'active' || Date.parse(reservation.hard_expires_at) <= Date.now() || Date.parse(reservation.lease_expires_at) <= Date.now()) {
      throw new ApiProblem('RESERVATION_EXPIRED', '주문서 이용 시간이 끝났어요.', 410)
    }
    const [{ count: itemCount }, { count: totalCount }] = await Promise.all([
      client.from('order_image_uploads').select('id', { count: 'exact', head: true }).eq('reservation_id', reservation.id).eq('client_item_id', parsed.data.clientItemId).is('consumed_at', null),
      client.from('order_image_uploads').select('id', { count: 'exact', head: true }).eq('reservation_id', reservation.id).is('consumed_at', null),
    ])
    if ((itemCount ?? 0) >= 3) throw new ApiProblem('TOO_MANY_IMAGES', '상품 하나에 이미지는 최대 3장까지 첨부할 수 있어요.', 409)
    if ((totalCount ?? 0) >= 20) throw new ApiProblem('TOO_MANY_IMAGES', '한 주문에는 이미지를 최대 20장까지 첨부할 수 있어요.', 409)
    const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    const imageId = crypto.randomUUID()
    const storagePath = `${reservation.sale_id}/${reservation.id}/${imageId}.${extension}`
    const { error: uploadError } = await client.storage.from(bucket).upload(storagePath, await file.arrayBuffer(), { contentType: file.type, upsert: false })
    if (uploadError) throw new ApiProblem('IMAGE_UPLOAD_ERROR', '이미지를 업로드하지 못했어요.', 500)
    const { error: metadataError } = await client.from('order_image_uploads').insert({
      id: imageId,
      reservation_id: reservation.id,
      client_item_id: parsed.data.clientItemId,
      storage_path: storagePath,
      mime_type: file.type,
      byte_size: file.size,
      width: parsed.data.width,
      height: parsed.data.height,
    })
    if (metadataError) {
      await client.storage.from(bucket).remove([storagePath])
      throw new ApiProblem('IMAGE_UPLOAD_ERROR', '이미지 정보를 저장하지 못했어요.', 500)
    }
    return NextResponse.json({ id: imageId })
  } catch (error) { return apiError(error) }
}

export async function DELETE(request: NextRequest) {
  try {
    assertSameOrigin(request)
    const token = (await cookies()).get('bb_reservation')?.value
    const parsed = z.object({ id: z.uuid() }).safeParse(await request.json())
    if (!token || !parsed.success) throw new ApiProblem('INVALID_INPUT', '삭제할 이미지를 확인해주세요.', 422)
    const client = createPrivilegedClient()
    const { data: reservation } = await client.from('reservations').select('id').eq('token_hash', hmac(token)).maybeSingle()
    if (!reservation) throw new ApiProblem('RESERVATION_EXPIRED', '주문서 이용 시간이 끝났어요.', 410)
    const { data: upload } = await client.from('order_image_uploads').select('id,storage_path').eq('id', parsed.data.id).eq('reservation_id', reservation.id).is('consumed_at', null).maybeSingle()
    if (!upload) return NextResponse.json({ deleted: true })
    await client.storage.from(bucket).remove([upload.storage_path])
    await client.from('order_image_uploads').delete().eq('id', upload.id)
    return NextResponse.json({ deleted: true })
  } catch (error) { return apiError(error) }
}
