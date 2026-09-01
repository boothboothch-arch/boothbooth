import { NextResponse } from 'next/server'
import { getAdmin } from '@/server/auth/admin'
import { createPrivilegedClient } from '@/server/supabase/privileged-client'

const imageBucket = 'order-reference-images'
const databaseId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Context = { params: Promise<{ imageId: string }> }

function noStoreRedirect(location: string) {
  return new NextResponse(null, {
    status: 307,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      Location: location,
    },
  })
}

export async function GET(request: Request, { params }: Context) {
  const admin = await getAdmin()
  if (!admin) return noStoreRedirect(new URL('/admin/login', request.url).toString())

  const { imageId } = await params
  if (!databaseId.test(imageId)) {
    return NextResponse.json({ error: { message: '이미지 주소를 확인해주세요.' } }, { status: 400 })
  }

  const client = createPrivilegedClient()
  const { data: image, error } = await client
    .from('order_item_images')
    .select('storage_path')
    .eq('id', imageId)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: { message: '이미지를 불러오지 못했습니다.' } }, { status: 500 })
  }
  if (!image) {
    return NextResponse.json({ error: { message: '이미지를 찾지 못했습니다.' } }, { status: 404 })
  }

  const { data: signed, error: signedError } = await client.storage
    .from(imageBucket)
    .createSignedUrl(image.storage_path, 5 * 60)

  if (signedError || !signed?.signedUrl) {
    return NextResponse.json({ error: { message: '이미지 링크를 만들지 못했습니다.' } }, { status: 502 })
  }

  return noStoreRedirect(signed.signedUrl)
}
