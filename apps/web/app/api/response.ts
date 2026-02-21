import { NextResponse } from "next/server";
import type { ApiErrorObject } from "../contracts/api";

export function apiSuccess<T>(
  requestId: string,
  data: T,
  status = 200,
): NextResponse {
  return NextResponse.json(
    {
      ok: true,
      requestId,
      data,
    },
    { status },
  );
}

export function apiError(
  requestId: string,
  error: ApiErrorObject,
  status: number,
): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      requestId,
      error,
    },
    { status },
  );
}
