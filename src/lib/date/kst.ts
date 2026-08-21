/**
 * Asia/Seoul 타임존 처리
 * ============================================================================
 *
 * plain-date.ts 가 "달력 날짜"(순수 함수)를 담당하는 것과 달리,
 * 이 모듈은 **실제 시각(instant)** 과 관련된 환경 의존적 변환을 담당한다.
 *
 *   - "지금 서울은 며칠인가?"
 *   - "2026-03-05 의 09:00(KST)은 UTC 로 언제인가?"  → 알림 발송 시각 계산
 *
 * 타임존은 `Asia/Seoul` 로 고정한다. 서버가 어느 리전에서 돌든,
 * 개발자 PC 의 로컬 타임존이 무엇이든 업무 기준일은 항상 한국 시각이어야 한다.
 *
 * 구현은 `@date-fns/tz` 의 `TZDate` 에 위임한다. 직접 오프셋(+9)을 더하는
 * 방식은 쓰지 않는다 — 타임존 규칙 변경에 취약하고 검증이 어렵기 때문이다.
 */

import { TZDate } from "@date-fns/tz";

import { assertPlainDate, type PlainDate } from "./plain-date";

/** 업무 기준 타임존. 전 애플리케이션에서 이 상수만 사용한다. */
export const APP_TIME_ZONE = "Asia/Seoul" as const;

/** `"HH:mm"` 형식의 KST 벽시계 시각. */
export type WallClockTime = string;

const WALL_CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidWallClockTime(value: unknown): value is WallClockTime {
  return typeof value === "string" && WALL_CLOCK_PATTERN.test(value);
}

export function assertWallClockTime(value: unknown): WallClockTime {
  if (!isValidWallClockTime(value)) {
    throw new Error(`올바르지 않은 시각 형식입니다: ${String(value)} (HH:mm 필요)`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// "오늘" / "지금"
// ---------------------------------------------------------------------------

/**
 * 서울 기준 오늘 날짜.
 *
 * @param now 기준 시각. 테스트에서는 고정된 Date 를 주입해 결정적으로 만든다.
 */
export function todayInSeoul(now: Date = new Date()): PlainDate {
  const seoul = new TZDate(now.getTime(), APP_TIME_ZONE);
  const y = String(seoul.getFullYear()).padStart(4, "0");
  const m = String(seoul.getMonth() + 1).padStart(2, "0");
  const d = String(seoul.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 서울 기준 현재 벽시계 시각 `"HH:mm"`. */
export function currentTimeInSeoul(now: Date = new Date()): WallClockTime {
  const seoul = new TZDate(now.getTime(), APP_TIME_ZONE);
  const h = String(seoul.getHours()).padStart(2, "0");
  const m = String(seoul.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** 서울 기준 올해 연도. */
export function currentYearInSeoul(now: Date = new Date()): number {
  return Number(todayInSeoul(now).slice(0, 4));
}

// ---------------------------------------------------------------------------
// 달력 날짜 + 벽시계 시각 → 실제 시각(instant)
// ---------------------------------------------------------------------------

/**
 * KST 달력 날짜와 벽시계 시각을 실제 순간(UTC Date)으로 변환한다.
 * 알림 발송 예정 시각을 계산하는 핵심 함수.
 *
 * 예: toInstant("2026-03-05", "09:00") → 2026-03-05T00:00:00.000Z
 *     (KST 는 UTC+9 이므로 09:00 KST = 00:00 UTC)
 */
export function toInstant(date: PlainDate, time: WallClockTime = "00:00"): Date {
  assertPlainDate(date);
  assertWallClockTime(time);

  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);

  // TZDate 생성자는 주어진 연·월·일·시·분을 해당 타임존의 벽시계 시각으로 해석한다.
  const tz = new TZDate(year, month - 1, day, hour, minute, 0, 0, APP_TIME_ZONE);
  return new Date(tz.getTime());
}

/** 실제 시각 → 서울 기준 달력 날짜. */
export function instantToPlainDate(instant: Date): PlainDate {
  return todayInSeoul(instant);
}

// ---------------------------------------------------------------------------
// 표시용 포맷 (항상 서울 기준)
// ---------------------------------------------------------------------------

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const TIME_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: APP_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** 예: "2026. 03. 05. 09:00" */
export function formatInstantKst(instant: Date | string | null | undefined): string {
  if (!instant) return "-";
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) return "-";
  return DATE_TIME_FORMATTER.format(date);
}

/** 예: "09:00" */
export function formatInstantTimeKst(instant: Date | string | null | undefined): string {
  if (!instant) return "-";
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) return "-";
  return TIME_FORMATTER.format(date);
}

/** "3시간 전", "2일 후" 같은 상대 표현. 대시보드 요약에 사용. */
export function formatRelativeKst(instant: Date, now: Date = new Date()): string {
  const diffMs = instant.getTime() - now.getTime();
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  const suffix = diffMs >= 0 ? "후" : "전";

  if (abs < minute) return "방금";
  if (abs < hour) return `${Math.floor(abs / minute)}분 ${suffix}`;
  if (abs < day) return `${Math.floor(abs / hour)}시간 ${suffix}`;
  return `${Math.floor(abs / day)}일 ${suffix}`;
}
