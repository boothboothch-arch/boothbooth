import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  apiError,
  ApiProblem,
  assertSameOrigin,
  enforceRateLimit,
} from "@/server/http/api";
import { verifyOrderAccessToken } from "@/server/security/access-token";
import { createPrivilegedClient } from "@/server/supabase/privileged-client";

const metadataSchema = z.object({
  orderItemId: z.uuid(),
  width: z.coerce.number().int().min(1).max(1600),
  height: z.coerce.number().int().min(1).max(1600),
});
const deleteSchema = z.object({ id: z.uuid() });
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const bucket = "order-reference-images";

type Context = { params: Promise<{ orderNumber: string }> };

async function authorizedOrder(orderNumber: string) {
  const token = (await cookies()).get("bb_order_access")?.value;
  if (!verifyOrderAccessToken(token, orderNumber))
    throw new ApiProblem("UNAUTHORIZED", "주문 조회 인증이 필요해요.", 401);
  const client = createPrivilegedClient();
  const { data: order, error } = await client
    .from("orders")
    .select("id,sale_id,order_state")
    .eq("order_number", orderNumber)
    .maybeSingle();
  if (error || !order)
    throw new ApiProblem("ORDER_NOT_FOUND", "주문을 찾지 못했어요.", 404);
  return { client, order };
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    assertSameOrigin(request);
    await enforceRateLimit(request, "order-image-edit-upload", 40, 3600);
    const { orderNumber } = await params;
    const { client, order } = await authorizedOrder(orderNumber);
    if (order.order_state !== "payment_pending")
      throw new ApiProblem(
        "ORDER_NOT_EDITABLE",
        "입금 완료 이후에는 주문서를 수정할 수 없어요.",
        409,
      );

    const formData = await request.formData();
    const parsed = metadataSchema.safeParse({
      orderItemId: formData.get("orderItemId"),
      width: formData.get("width"),
      height: formData.get("height"),
    });
    if (!parsed.success)
      throw new ApiProblem(
        "INVALID_INPUT",
        "이미지 정보를 확인해주세요.",
        422,
      );
    const file = formData.get("file");
    if (
      !(file instanceof File) ||
      file.size < 1 ||
      file.size > 2 * 1024 * 1024 ||
      !allowedTypes.has(file.type)
    ) {
      throw new ApiProblem(
        "INVALID_IMAGE",
        "이미지는 JPEG, PNG, WebP 형식으로 2MB 이하만 업로드할 수 있어요.",
        422,
      );
    }

    const { data: orderItem } = await client
      .from("order_items")
      .select("id")
      .eq("id", parsed.data.orderItemId)
      .eq("order_id", order.id)
      .maybeSingle();
    if (!orderItem)
      throw new ApiProblem("INVALID_ITEM", "상품 정보를 확인해주세요.", 422);

    const [{ count: itemCount }, { count: totalCount }] = await Promise.all([
      client
        .from("order_image_uploads")
        .select("id", { count: "exact", head: true })
        .eq("order_id", order.id)
        .eq("client_item_id", orderItem.id)
        .is("consumed_at", null),
      client
        .from("order_image_uploads")
        .select("id", { count: "exact", head: true })
        .eq("order_id", order.id)
        .is("consumed_at", null),
    ]);
    if ((itemCount ?? 0) >= 3)
      throw new ApiProblem(
        "TOO_MANY_IMAGES",
        "상품 하나에 새 이미지는 최대 3장까지 업로드할 수 있어요.",
        409,
      );
    if ((totalCount ?? 0) >= 20)
      throw new ApiProblem(
        "TOO_MANY_IMAGES",
        "한 주문에는 새 이미지를 최대 20장까지 업로드할 수 있어요.",
        409,
      );

    const extension =
      file.type === "image/png"
        ? "png"
        : file.type === "image/webp"
          ? "webp"
          : "jpg";
    const imageId = crypto.randomUUID();
    const storagePath = `${order.sale_id}/${order.id}/${imageId}.${extension}`;
    const { error: uploadError } = await client.storage
      .from(bucket)
      .upload(storagePath, await file.arrayBuffer(), {
        contentType: file.type,
        upsert: false,
      });
    if (uploadError)
      throw new ApiProblem(
        "IMAGE_UPLOAD_ERROR",
        "이미지를 업로드하지 못했어요.",
        500,
      );

    const { error: metadataError } = await client
      .from("order_image_uploads")
      .insert({
        id: imageId,
        order_id: order.id,
        client_item_id: orderItem.id,
        storage_path: storagePath,
        mime_type: file.type,
        byte_size: file.size,
        width: parsed.data.width,
        height: parsed.data.height,
      });
    if (metadataError) {
      await client.storage.from(bucket).remove([storagePath]);
      throw new ApiProblem(
        "IMAGE_UPLOAD_ERROR",
        "이미지 정보를 저장하지 못했어요.",
        500,
      );
    }
    return NextResponse.json({ id: imageId });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Context) {
  try {
    assertSameOrigin(request);
    const { orderNumber } = await params;
    const { client, order } = await authorizedOrder(orderNumber);
    const parsed = deleteSchema.safeParse(await request.json());
    if (!parsed.success)
      throw new ApiProblem(
        "INVALID_INPUT",
        "삭제할 이미지를 확인해주세요.",
        422,
      );
    const { data: upload } = await client
      .from("order_image_uploads")
      .select("id,storage_path")
      .eq("id", parsed.data.id)
      .eq("order_id", order.id)
      .is("consumed_at", null)
      .maybeSingle();
    if (!upload) return NextResponse.json({ deleted: true });
    const { error: storageError } = await client.storage
      .from(bucket)
      .remove([upload.storage_path]);
    if (storageError)
      throw new ApiProblem(
        "IMAGE_DELETE_ERROR",
        "임시 이미지를 정리하지 못했어요.",
        500,
      );
    await client.from("order_image_uploads").delete().eq("id", upload.id);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiError(error);
  }
}
