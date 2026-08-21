/**
 * 영업일 계산 — 주말/공휴일을 고려한 순수 함수 모듈
 * ============================================================================
 *
 * 공휴일 데이터는 이 모듈이 **직접 알지 못한다**. 호출자가 `HolidayCalendar` 를
 * 주입한다. 이유:
 *   - 대한민국 공휴일에는 음력 기반(설날·추석·석가탄신일)과 대체공휴일,
 *     그리고 매년 정부가 지정하는 임시공휴일이 있어 계산으로 유도할 수 없다.
 *   - 따라서 데이터는 반드시 외부(DB 또는 data/holidays/*.json)에서 와야 하며,
 *     계산 로직은 그 데이터에 의존하지 않는 순수 함수로 유지되어야 테스트가 쉽다.
 */

import {
  addDays,
  getWeekday,
  type PlainDate,
  type Weekday,
} from "./plain-date";

/** 주말로 취급할 요일. 기본값은 토(6)·일(0). */
export const DEFAULT_WEEKEND_DAYS: readonly Weekday[] = [0, 6];

/**
 * 무한 루프 방지용 안전 상한.
 * 연속 비영업일이 이보다 길 수는 없다(설 연휴 + 주말도 최대 6~7일).
 */
const MAX_SCAN_DAYS = 400;

export interface HolidayCalendar {
  /** 공휴일(사내 휴무일 포함) 여부 */
  isHoliday(date: PlainDate): boolean;
  /** 주말 여부 */
  isWeekend(date: PlainDate): boolean;
  /** 영업일 여부 (= 주말도 공휴일도 아님) */
  isBusinessDay(date: PlainDate): boolean;
  /** 공휴일 이름 (없으면 null) */
  getHolidayName(date: PlainDate): string | null;
}

export interface HolidayEntry {
  date: PlainDate;
  name: string;
}

export interface CreateHolidayCalendarOptions {
  /** 주말로 취급할 요일 목록. 기본 [토, 일] */
  weekendDays?: readonly Weekday[];
}

/**
 * 공휴일 목록으로부터 달력을 만든다.
 *
 * @param holidays 날짜와 이름 목록. 문자열 배열만 넘겨도 된다.
 */
export function createHolidayCalendar(
  holidays: Iterable<HolidayEntry | PlainDate>,
  options: CreateHolidayCalendarOptions = {},
): HolidayCalendar {
  const weekendDays = new Set<Weekday>(options.weekendDays ?? DEFAULT_WEEKEND_DAYS);
  const nameByDate = new Map<PlainDate, string>();

  for (const entry of holidays) {
    if (typeof entry === "string") {
      nameByDate.set(entry, "공휴일");
    } else {
      nameByDate.set(entry.date, entry.name);
    }
  }

  const isHoliday = (date: PlainDate) => nameByDate.has(date);
  const isWeekend = (date: PlainDate) => weekendDays.has(getWeekday(date));

  return {
    isHoliday,
    isWeekend,
    isBusinessDay: (date) => !isWeekend(date) && !isHoliday(date),
    getHolidayName: (date) => nameByDate.get(date) ?? null,
  };
}

/** 공휴일이 전혀 없는 달력(주말만 반영). 테스트와 폴백에 사용. */
export const EMPTY_HOLIDAY_CALENDAR: HolidayCalendar = createHolidayCalendar([]);

/**
 * 이동 대상 판정 기준.
 *   WEEKEND_AND_HOLIDAY : 주말 또는 공휴일이면 이동 (기본)
 *   WEEKEND_ONLY        : 주말만 이동 (공휴일에도 마감을 유지하는 업무)
 *   HOLIDAY_ONLY        : 공휴일만 이동 (주말 근무가 있는 업무)
 */
export type ShiftTarget = "WEEKEND_AND_HOLIDAY" | "WEEKEND_ONLY" | "HOLIDAY_ONLY";

/** 해당 날짜가 "이동 대상"인지 판정한다. */
export function needsShift(
  date: PlainDate,
  calendar: HolidayCalendar,
  target: ShiftTarget = "WEEKEND_AND_HOLIDAY",
): boolean {
  switch (target) {
    case "WEEKEND_ONLY":
      return calendar.isWeekend(date);
    case "HOLIDAY_ONLY":
      return calendar.isHoliday(date);
    case "WEEKEND_AND_HOLIDAY":
    default:
      return calendar.isWeekend(date) || calendar.isHoliday(date);
  }
}

/**
 * 주어진 날짜가 이동 대상이 아닐 때까지 `step` 방향으로 이동한다.
 * 이미 조건을 만족하면 그대로 반환한다.
 */
function scanUntilOk(
  date: PlainDate,
  step: 1 | -1,
  calendar: HolidayCalendar,
  target: ShiftTarget,
): PlainDate {
  let cursor = date;
  for (let i = 0; i < MAX_SCAN_DAYS; i += 1) {
    if (!needsShift(cursor, calendar, target)) return cursor;
    cursor = addDays(cursor, step);
  }
  throw new Error(
    `영업일을 찾지 못했습니다(${MAX_SCAN_DAYS}일 초과). 공휴일 데이터를 확인하세요: ${date}`,
  );
}

/** 해당 날짜 이후(당일 포함) 첫 영업일 */
export function nextBusinessDay(
  date: PlainDate,
  calendar: HolidayCalendar,
  target: ShiftTarget = "WEEKEND_AND_HOLIDAY",
): PlainDate {
  return scanUntilOk(date, 1, calendar, target);
}

/** 해당 날짜 이전(당일 포함) 첫 영업일 */
export function previousBusinessDay(
  date: PlainDate,
  calendar: HolidayCalendar,
  target: ShiftTarget = "WEEKEND_AND_HOLIDAY",
): PlainDate {
  return scanUntilOk(date, -1, calendar, target);
}

/**
 * 영업일 기준으로 N일을 더한다.
 *
 * 규약: 시작일 자체는 세지 않는다. 즉 `addBusinessDays(금요일, 1)` = 다음 월요일.
 *       n = 0 이면 시작일을 그대로 반환한다(영업일이 아니어도 이동하지 않음).
 *       n < 0 이면 과거 방향으로 센다.
 */
export function addBusinessDays(
  date: PlainDate,
  n: number,
  calendar: HolidayCalendar,
  target: ShiftTarget = "WEEKEND_AND_HOLIDAY",
): PlainDate {
  if (n === 0) return date;

  const step = n > 0 ? 1 : -1;
  let remaining = Math.abs(n);
  let cursor = date;
  let guard = 0;

  while (remaining > 0) {
    cursor = addDays(cursor, step);
    if (!needsShift(cursor, calendar, target)) remaining -= 1;

    guard += 1;
    if (guard > MAX_SCAN_DAYS * Math.abs(n) + MAX_SCAN_DAYS) {
      throw new Error(`영업일 계산이 종료되지 않았습니다: ${date} + ${n}영업일`);
    }
  }

  return cursor;
}

/**
 * 오프셋 단위를 구분해 날짜를 더한다.
 * 분기 오프셋("분기 종료 후 10영업일")과 의존관계 lag 계산에 공용으로 쓰인다.
 */
export function addByUnit(
  date: PlainDate,
  amount: number,
  unit: "CALENDAR_DAY" | "BUSINESS_DAY",
  calendar: HolidayCalendar,
): PlainDate {
  return unit === "BUSINESS_DAY"
    ? addBusinessDays(date, amount, calendar)
    : addDays(date, amount);
}

/** from ~ to 사이(양 끝 포함)의 영업일 수 */
export function countBusinessDays(
  from: PlainDate,
  to: PlainDate,
  calendar: HolidayCalendar,
): number {
  if (from > to) return 0;
  let count = 0;
  let cursor = from;
  while (cursor <= to) {
    if (calendar.isBusinessDay(cursor)) count += 1;
    cursor = addDays(cursor, 1);
  }
  return count;
}
