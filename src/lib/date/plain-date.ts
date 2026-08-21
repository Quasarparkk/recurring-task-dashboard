/**
 * PlainDate — 타임존 개념이 없는 "달력 날짜" 표현
 * ============================================================================
 *
 * 이 프로젝트의 모든 업무 마감일은 "2026-03-05" 같은 **달력상의 날짜**이며,
 * 시각(時刻) 개념이 없다. 이를 JavaScript `Date` 로 다루면 실행 환경의
 * 로컬 타임존에 따라 날짜가 하루씩 밀리는 버그가 반드시 발생한다.
 *
 * 그래서 달력 날짜는 `"YYYY-MM-DD"` 문자열(PlainDate)로만 주고받고,
 * 계산이 필요할 때만 내부에서 `UTCDate` 로 변환해 date-fns 함수를 사용한다.
 * `UTCDate` 는 모든 getter 가 UTC 기준으로 동작하므로 로컬 타임존이
 * 무엇이든 결과가 동일하다 → 테스트가 결정적(deterministic)이 된다.
 *
 * 즉 이 모듈의 모든 함수는 **순수 함수**이며 실행 환경에 의존하지 않는다.
 * "오늘"처럼 환경에 의존하는 값은 src/lib/date/kst.ts 가 별도로 담당한다.
 */

import { UTCDate } from "@date-fns/utc";
import {
  addDays as fnsAddDays,
  addMonths as fnsAddMonths,
  addYears as fnsAddYears,
  differenceInCalendarDays as fnsDiffDays,
  getDay as fnsGetDay,
  lastDayOfMonth as fnsLastDayOfMonth,
  startOfMonth as fnsStartOfMonth,
  startOfWeek as fnsStartOfWeek,
} from "date-fns";

/** `"YYYY-MM-DD"` 형식의 달력 날짜 문자열. */
export type PlainDate = string;

/** 요일. date-fns `getDay()` 와 동일한 체계: 0=일, 1=월, ... 6=토 */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAY_LABELS_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

const PLAIN_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// 검증 / 변환
// ---------------------------------------------------------------------------

/** 형식과 실재 여부(예: 2026-02-30 은 거짓)를 모두 검사한다. */
export function isValidPlainDate(value: unknown): value is PlainDate {
  if (typeof value !== "string" || !PLAIN_DATE_PATTERN.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  // 윤년·월별 일수까지 검증: 정규화 결과가 입력과 같아야 실재하는 날짜다.
  const utc = new Date(Date.UTC(y, m - 1, d));
  return (
    utc.getUTCFullYear() === y &&
    utc.getUTCMonth() === m - 1 &&
    utc.getUTCDate() === d
  );
}

/** 유효하지 않으면 예외를 던진다. 경계(API 입력 등)에서 사용. */
export function assertPlainDate(value: unknown): PlainDate {
  if (!isValidPlainDate(value)) {
    throw new Error(`올바르지 않은 날짜 형식입니다: ${String(value)} (YYYY-MM-DD 필요)`);
  }
  return value;
}

/** 연/월/일(월은 1~12)로 PlainDate 를 만든다. 범위를 넘는 값은 정규화된다. */
export function plainDateOf(year: number, month: number, day: number): PlainDate {
  return toPlainDate(new UTCDate(Date.UTC(year, month - 1, day)));
}

/** date-fns 계산용 UTCDate 로 변환한다. */
export function toUTCDate(date: PlainDate): UTCDate {
  const [y, m, d] = date.split("-").map(Number);
  return new UTCDate(Date.UTC(y, m - 1, d));
}

/**
 * Date → PlainDate. **UTC getter 만 사용**하므로 로컬 타임존 영향이 없다.
 * DB 에서 읽은 캘린더 날짜 컬럼(UTC 자정 저장)을 변환할 때도 이 함수를 쓴다.
 */
export function toPlainDate(date: Date): PlainDate {
  const y = String(date.getUTCFullYear()).padStart(4, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * PlainDate → DB 저장용 Date (UTC 자정).
 * 스키마의 "캘린더 날짜 규약"에 맞는 값을 만든다.
 */
export function toDbDate(date: PlainDate): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

// ---------------------------------------------------------------------------
// 구성 요소 추출
// ---------------------------------------------------------------------------

export function getYear(date: PlainDate): number {
  return Number(date.slice(0, 4));
}

/** 1~12 */
export function getMonth(date: PlainDate): number {
  return Number(date.slice(5, 7));
}

export function getDayOfMonth(date: PlainDate): number {
  return Number(date.slice(8, 10));
}

/** 0=일 ~ 6=토 */
export function getWeekday(date: PlainDate): Weekday {
  return fnsGetDay(toUTCDate(date)) as Weekday;
}

/** 1~4 (fiscalYearStartMonth 를 1로 본 역년 기준 분기) */
export function getCalendarQuarter(date: PlainDate): 1 | 2 | 3 | 4 {
  return (Math.floor((getMonth(date) - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

// ---------------------------------------------------------------------------
// 산술
// ---------------------------------------------------------------------------

export function addDays(date: PlainDate, days: number): PlainDate {
  return toPlainDate(fnsAddDays(toUTCDate(date), days));
}

/**
 * 개월 수를 더한다. date-fns 규칙에 따라 **말일은 자동으로 잘린다**.
 * 예: addMonths("2026-01-31", 1) → "2026-02-28"
 */
export function addMonths(date: PlainDate, months: number): PlainDate {
  return toPlainDate(fnsAddMonths(toUTCDate(date), months));
}

export function addYears(date: PlainDate, years: number): PlainDate {
  return toPlainDate(fnsAddYears(toUTCDate(date), years));
}

/** a - b (일 단위). a 가 나중이면 양수. */
export function diffInDays(a: PlainDate, b: PlainDate): number {
  return fnsDiffDays(toUTCDate(a), toUTCDate(b));
}

// ---------------------------------------------------------------------------
// 월/주 경계
// ---------------------------------------------------------------------------

export function startOfMonth(date: PlainDate): PlainDate {
  return toPlainDate(fnsStartOfMonth(toUTCDate(date)));
}

export function endOfMonth(date: PlainDate): PlainDate {
  return toPlainDate(fnsLastDayOfMonth(toUTCDate(date)));
}

/** 해당 연/월의 마지막 날. 윤년의 2월도 정확히 처리된다. */
export function lastDayOfMonthNumber(year: number, month: number): number {
  return getDayOfMonth(endOfMonth(plainDateOf(year, month, 1)));
}

/** 주의 시작일. 한국 업무 관행에 맞춰 **월요일** 기준. */
export function startOfWeekMonday(date: PlainDate): PlainDate {
  return toPlainDate(fnsStartOfWeek(toUTCDate(date), { weekStartsOn: 1 }));
}

/**
 * 해당 월의 N번째 특정 요일을 구한다.
 *
 * @param nth 1~5 = N번째, -1 = 마지막
 * @returns 존재하지 않으면 null (예: 5번째 화요일이 없는 달)
 */
export function nthWeekdayOfMonth(
  year: number,
  month: number,
  nth: number,
  weekday: Weekday,
): PlainDate | null {
  if (nth === -1) {
    // 말일부터 거꾸로 올라가며 해당 요일을 찾는다.
    let cursor = endOfMonth(plainDateOf(year, month, 1));
    for (let i = 0; i < 7; i += 1) {
      if (getWeekday(cursor) === weekday) return cursor;
      cursor = addDays(cursor, -1);
    }
    return null;
  }

  if (nth < 1 || nth > 5) return null;

  const first = plainDateOf(year, month, 1);
  const firstWeekday = getWeekday(first);
  // 1일부터 목표 요일까지의 거리 (0~6)
  const delta = (weekday - firstWeekday + 7) % 7;
  const day = 1 + delta + (nth - 1) * 7;

  if (day > lastDayOfMonthNumber(year, month)) return null;
  return plainDateOf(year, month, day);
}

// ---------------------------------------------------------------------------
// 비교
// ---------------------------------------------------------------------------
// PlainDate 는 고정 폭 ISO 문자열이므로 사전순 비교 = 시간순 비교가 성립한다.

export function isBefore(a: PlainDate, b: PlainDate): boolean {
  return a < b;
}

export function isAfter(a: PlainDate, b: PlainDate): boolean {
  return a > b;
}

export function isSameDate(a: PlainDate, b: PlainDate): boolean {
  return a === b;
}

/** from <= date <= to (양 끝 포함) */
export function isWithin(date: PlainDate, from: PlainDate, to: PlainDate): boolean {
  return date >= from && date <= to;
}

export function minDate(a: PlainDate, b: PlainDate): PlainDate {
  return a <= b ? a : b;
}

export function maxDate(a: PlainDate, b: PlainDate): PlainDate {
  return a >= b ? a : b;
}

/** 정렬 비교자. `array.sort(comparePlainDate)` */
export function comparePlainDate(a: PlainDate, b: PlainDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// 표시용 포맷
// ---------------------------------------------------------------------------

/** "2026-03-05" → "2026년 3월 5일 (목)" */
export function formatKoreanFull(date: PlainDate): string {
  return `${getYear(date)}년 ${getMonth(date)}월 ${getDayOfMonth(date)}일 (${
    WEEKDAY_LABELS_KO[getWeekday(date)]
  })`;
}

/** "2026-03-05" → "3월 5일 (목)" */
export function formatKoreanShort(date: PlainDate): string {
  return `${getMonth(date)}월 ${getDayOfMonth(date)}일 (${
    WEEKDAY_LABELS_KO[getWeekday(date)]
  })`;
}

/** "2026-03-05" → "03.05" */
export function formatCompact(date: PlainDate): string {
  return `${date.slice(5, 7)}.${date.slice(8, 10)}`;
}
