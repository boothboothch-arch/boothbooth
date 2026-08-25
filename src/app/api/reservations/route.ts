import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  apiError,
  ApiProblem,
  assertSameOrigin,
  enforceRateLimit,
} from "@/server/http/api";
import { createPrivilegedClient } from "@/server/supabase/privileged-client";
import { hmac, randomOpaqueToken } from "@/server/security/crypto";
import { hasServerEnv } from "@/shared/config/env";

const COOKIE = "bb_reservation";

function mapReservationError(message: string) {
  if (message.includes("SALE_NOT_STARTED"))
    return new ApiProblem(
      "SALE_NOT_STARTED",
      "아직 판매가 시작되지 않았어요.",
      409,
    );
  if (message.includes("SALE_ENDED"))
    return new ApiProblem("SALE_ENDED", "판매가 종료되었어요.", 409);
  if (message.includes("SALE_PAUSED"))
    return new ApiProblem("SALE_PAUSED", "판매가 조기 마감되었어요.", 409);
  if (message.includes("SOLD_OUT"))
    return new ApiProblem("SOLD_OUT", "현재 주문 가능한 자리가 없어요.", 409);
  if (message.includes("RESERVATION_ALREADY_USED"))
    return new ApiProblem(
      "RESERVATION_ALREADY_USED",
      "이미 사용된 주문 자리예요. 주문 조회를 이용해주세요.",
      409,
    );
  if (message.includes("TEST_SALE_NOT_FOUND"))
    return new ApiProblem(
      "TEST_SALE_NOT_FOUND",
      "테스트 차수를 찾지 못했어요.",
      404,
    );
  return new ApiProblem(
    "RESERVATION_ERROR",
    "주문 자리를 확보하지 못했어요.",
    500,
  );
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    if (!hasServerEnv())
      throw new ApiProblem("SETUP_REQUIRED", "현재 주문 준비 중이에요.", 503);
    await enforceRateLimit(request, "reservation", 12, 60);
    const body = request.headers
      .get("content-type")
      ?.includes("application/json")
      ? await request.json().catch(() => null)
      : null;
    const parsed = z.object({ saleId: z.uuid() }).safeParse(body);
    if (body !== null && !parsed.success)
      throw new ApiProblem(
        "INVALID_INPUT",
        "테스트 차수 정보를 확인해주세요.",
        422,
      );
    const testSaleId = parsed.success ? parsed.data.saleId : null;
    const token = testSaleId
      ? randomOpaqueToken()
      : (request.cookies.get(COOKIE)?.value ?? randomOpaqueToken());
    const client = createPrivilegedClient();
    const { data, error } = testSaleId
      ? await client.rpc("claim_test_reservation", {
          p_token_hash: hmac(token),
          p_sale_id: testSaleId,
        })
      : await client.rpc("claim_reservation", { p_token_hash: hmac(token) });
    if (error) throw mapReservationError(error.message);
    const response = NextResponse.json({ ...data, redirectTo: "/order" });
    response.cookies.set(COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 60,
    });
    return response;
  } catch (error) {
    return apiError(error);
  }
}
