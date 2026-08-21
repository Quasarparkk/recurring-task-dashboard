/**
 * API 응답 헬퍼
 * ============================================================================
 * 에러 형식을 통일해 클라이언트가 항상 같은 방식으로 메시지를 표시할 수 있게 한다.
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { DependencyCycleError } from "@/lib/dependency/graph";

export interface ApiError {
  error: string;
  /** 필드별 검증 오류 (폼에서 해당 입력에 표시) */
  fieldErrors?: Record<string, string[]>;
  /** 순환 참조 경로 등 부가 정보 */
  detail?: unknown;
}

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function badRequest(message: string, fieldErrors?: Record<string, string[]>) {
  return NextResponse.json<ApiError>({ error: message, fieldErrors }, { status: 400 });
}

export function notFound(message = "요청한 데이터를 찾을 수 없습니다.") {
  return NextResponse.json<ApiError>({ error: message }, { status: 404 });
}

/**
 * 라우트 핸들러를 감싸 예외를 일관된 응답으로 변환한다.
 *
 * - ZodError            → 400 + 필드별 메시지
 * - DependencyCycleError → 409 + 순환 경로
 * - 그 외                → 500
 */
export async function handle<T>(
  fn: () => Promise<T>,
  options: { successStatus?: number } = {},
): Promise<NextResponse> {
  try {
    const result = await fn();
    return ok(result, options.successStatus ?? 200);
  } catch (error) {
    // --- 입력 검증 실패 ---------------------------------------------------
    if (error instanceof ZodError) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of error.issues) {
        const path = issue.path.join(".") || "_";
        (fieldErrors[path] ??= []).push(issue.message);
      }
      return NextResponse.json<ApiError>(
        {
          error: "입력값을 확인해 주세요.",
          fieldErrors,
        },
        { status: 400 },
      );
    }

    // --- 순환 참조 --------------------------------------------------------
    if (error instanceof DependencyCycleError) {
      return NextResponse.json<ApiError>(
        { error: error.message, detail: { cycle: error.cycle } },
        { status: 409 },
      );
    }

    // --- Prisma 고유 제약 -------------------------------------------------
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("Unique constraint")) {
      return NextResponse.json<ApiError>(
        { error: "이미 등록된 항목입니다." },
        { status: 409 },
      );
    }
    if (message.includes("Record to update not found") || message.includes("No record was found")) {
      return notFound();
    }

    console.error("[API]", error);
    return NextResponse.json<ApiError>(
      { error: message || "서버 오류가 발생했습니다." },
      { status: 500 },
    );
  }
}
