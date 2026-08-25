import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import { customerOrderUpdateSchema } from '@/features/order/schemas'
import { apiError, ApiProblem, assertSameOrigin } from '@/server/http/api'
import { getOrderByNumber } from '@/server/orders/get-order'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'
import { verifyOrderAccessToken } from '@/server/security/access-token'
import { encryptText } from '@/server/security/crypto'

type Context = { params: Promise<{ orderNumber: string }> }

async function authorize(orderNumber: string) {
  const token = (await cookies()).get('bb_order_access')?.value
  if (!verifyOrderAccessToken(token, orderNumber)) throw new ApiProblem('UNAUTHORIZED', '주문 조회 인증이 필요해요.', 401)
}

export async function GET(_: NextRequest, { params }: Context) {
  try {
    const { orderNumber } = await params
    await authorize(orderNumber)
    const order = await getOrderByNumber(orderNumber)
    if (!order) throw new ApiProblem('ORDER_NOT_FOUND', '주문을 찾지 못했어요.', 404)
    return NextResponse.json(order, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return apiError(error) }
}

export async function PATCH(request: NextRequest, { params }: Context) {
  try {
    assertSameOrigin(request)
    const { orderNumber } = await params
    await authorize(orderNumber)
    const parsed = customerOrderUpdateSchema.safeParse(await request.json())
    if (!parsed.success) throw new ApiProblem('INVALID_INPUT', parsed.error.issues[0]?.message ?? '입력 내용을 확인해주세요.', 422)
    const order = await getOrderByNumber(orderNumber)
    if (!order) throw new ApiProblem('ORDER_NOT_FOUND', '주문을 찾지 못했어요.', 404)
    const value = parsed.data
    const { data, error } = await createPrivilegedClient().rpc('update_customer_order_v2', {
      p_order_id: order.id,
      p_payload: {
        fulfillmentType: value.fulfillmentType,
        postalCode: value.fulfillmentType === 'shipping' ? value.postalCode : '',
        addressCiphertext: value.fulfillmentType === 'shipping' ? encryptText(JSON.stringify({ postalCode: value.postalCode, address: value.address, addressDetail: value.addressDetail })) : '',
        cashReceiptType: value.cashReceiptType,
        cashReceiptIdentifierCiphertext: value.cashReceiptType === 'none' ? '' : encryptText(value.cashReceiptIdentifier.replaceAll('-', '')),
        items: value.items,
      },
    })
    if (error) {
      if (error.message.includes('ORDER_NOT_EDITABLE')) throw new ApiProblem('ORDER_NOT_EDITABLE', '제작이 시작되어 주문서를 수정할 수 없어요.', 409)
      if (error.message.includes('INVALID_POSTAL_CODE')) throw new ApiProblem('INVALID_POSTAL_CODE', '배송지 우편번호를 확인해주세요.', 422)
      throw new ApiProblem('ORDER_UPDATE_ERROR', '주문을 수정하지 못했어요.', 500)
    }
    return NextResponse.json(data)
  } catch (error) { return apiError(error) }
}
