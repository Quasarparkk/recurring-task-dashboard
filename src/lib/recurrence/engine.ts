/**
 * 반복 일정 계산 엔진
 * ============================================================================
 *
 * `RecurrenceConfig` (Task 의 반복 규칙) → `GeneratedOccurrence[]` 변환을 담당한다.
 *
 * [설계 규칙]
 *   1. 이 모듈의 모든 함수는 **순수 함수**다. DB, 현재 시각, 로컬 타임존에
 *      의존하지 않는다. 공휴일 데이터도 인자로 주입받는다.
 *      → 단위 테스트에서 모든 경계 조건을 결정적으로 검증할 수 있다.
 *
 *   2. 회차 번호(sequenceIndex)는 **항상 config.startDate 부터 0번으로 시작해**
 *      순차 부여된다. 조회 범위(from~to)를 좁혀도 번호는 달라지지 않는다.
 *      의존관계의 SAME_SEQUENCE 매칭과 maxOccurrences 판정이 이 불변성에 의존한다.
 *
 *   3. 계산 순서는 다음과 같다. 순서를 바꾸면 결과가 달라진다.
 *        후보 날짜 산출(originalDate)
 *          → 종료 조건 판정(endDate / maxOccurrences)
 *          → 회차 번호 부여
 *          → 1회성 예외 적용(SKIP / RESCHEDULE)
 *          → 공휴일·주말 보정 (RESCHEDULE 된 회차는 보정하지 않음)
 *          → 조회 범위 필터
 */

import {
  EMPTY_HOLIDAY_CALENDAR,
  addByUnit,
  needsShift,
  nextBusinessDay,
  previousBusinessDay,
  type HolidayCalendar,
} from "../date/business-day";
import {
  addDays,
  addMonths,
  endOfMonth,
  getMonth,
  getYear,
  lastDayOfMonthNumber,
  nthWeekdayOfMonth,
  plainDateOf,
  startOfWeekMonday,
  type PlainDate,
  type Weekday,
} from "../date/plain-date";
import type {
  DayOfMonth,
  RecurrenceConfig,
  RecurrenceException,
  RecurrenceRule,
} from "./types";

// ---------------------------------------------------------------------------
// 결과 타입
// ---------------------------------------------------------------------------

/** 마감일이 원본 계산일에서 이동한 이유. */
export type ShiftReason =
  /** 주말/공휴일이라 직전 영업일로 앞당겨짐 */
  | "PREV_BUSINESS_DAY"
  /** 주말/공휴일이라 다음 영업일로 미뤄짐 */
  | "NEXT_BUSINESS_DAY"
  /** 1회성 예외로 사용자가 날짜를 직접 변경함 */
  | "EXCEPTION";

export const SHIFT_REASON_LABELS: Record<ShiftReason, string> = {
  PREV_BUSINESS_DAY: "휴일이라 직전 영업일로 앞당김",
  NEXT_BUSINESS_DAY: "휴일이라 다음 영업일로 미룸",
  EXCEPTION: "예외 규칙으로 날짜 변경",
};

export interface GeneratedOccurrence {
  /** config.startDate 부터 0번으로 시작하는 회차 번호. */
  sequenceIndex: number;
  /** 반복 규칙이 산출한 원본 날짜 (보정·예외 적용 전). */
  originalDate: PlainDate;
  /** 최종 마감일 (보정·예외 적용 후). */
  scheduledDate: PlainDate;
  /** 이동 이유. 이동하지 않았으면 null. */
  shiftReason: ShiftReason | null;
}

export interface GenerateOccurrencesOptions {
  config: RecurrenceConfig;
  /** 공휴일 달력. 생략하면 주말만 고려한다. */
  calendar?: HolidayCalendar;
  /** 결과 포함 시작 경계(포함). 생략 시 제한 없음. */
  from?: PlainDate;
  /** 결과 포함 종료 경계(포함). 생략 시 limit 또는 종료 조건에 의존. */
  to?: PlainDate;
  /** 최대 결과 개수. */
  limit?: number;
  /**
   * from/to 필터를 어느 날짜로 판정할지.
   *   ORIGINAL  : 원본 계산일 기준 (기본). 범위 경계에서 누락·중복이 없어 저장에 적합.
   *   SCHEDULED : 최종 마감일 기준. 사용자에게 보여줄 미리보기에 적합.
   */
  boundBy?: "ORIGINAL" | "SCHEDULED";
  /** 후보 날짜 순회 횟수 상한(무한 루프 방지). */
  maxIterations?: number;
}

const DEFAULT_MAX_ITERATIONS = 20_000;

/**
 * `to` 경계를 넘어서도 이만큼은 더 순회한다.
 * RESCHEDULE 예외로 마감일이 뒤로 밀린 회차를 놓치지 않기 위한 여유분.
 */
const LOOKAHEAD_BUFFER_DAYS = 90;

// ---------------------------------------------------------------------------
// 후보 날짜 산출
// ---------------------------------------------------------------------------

/**
 * 지정된 연/월에서 "N일" 또는 "말일"에 해당하는 날짜를 구한다.
 *
 * @returns 그 달에 해당 일이 없고 정책이 SKIP 이면 null
 */
export function resolveDayInMonth(
  year: number,
  month: number,
  day: DayOfMonth,
  onMissingDay: "CLAMP" | "SKIP",
): PlainDate | null {
  if (day === "LAST") {
    return endOfMonth(plainDateOf(year, month, 1));
  }

  const lastDay = lastDayOfMonthNumber(year, month);
  if (day > lastDay) {
    // 예: "매월 31일" 규칙의 2월 → CLAMP 면 2/28(윤년 2/29), SKIP 이면 건너뜀
    return onMissingDay === "CLAMP" ? plainDateOf(year, month, lastDay) : null;
  }
  return plainDateOf(year, month, day);
}

/**
 * 지정된 연/월에서 N번째 요일을 구한다.
 * nth 가 5인데 그 달에 5번째 요일이 없는 경우:
 *   - CLAMP : 마지막 해당 요일로 대체
 *   - SKIP  : 건너뜀(null)
 */
function resolveNthWeekdayInMonth(
  year: number,
  month: number,
  nth: number,
  weekday: Weekday,
  onMissingDay: "CLAMP" | "SKIP",
): PlainDate | null {
  const direct = nthWeekdayOfMonth(year, month, nth, weekday);
  if (direct) return direct;
  if (nth === 5 && onMissingDay === "CLAMP") {
    return nthWeekdayOfMonth(year, month, -1, weekday);
  }
  return null;
}

/** 절대 월 인덱스(연 * 12 + 월-1) → { year, month } */
function fromAbsoluteMonth(absoluteMonth: number): { year: number; month: number } {
  return {
    year: Math.floor(absoluteMonth / 12),
    month: (((absoluteMonth % 12) + 12) % 12) + 1,
  };
}

/**
 * 규칙에 따른 후보 날짜를 **오름차순으로 무한히** 생성한다.
 * `config.startDate` 이전 날짜는 생성하지 않는다(ONCE 는 예외).
 *
 * 종료 조건(endDate/maxOccurrences/limit)은 호출자가 판정한다.
 */
function* iterateCandidateDates(
  rule: RecurrenceRule,
  startDate: PlainDate,
  onMissingDay: "CLAMP" | "SKIP",
  calendar: HolidayCalendar,
): Generator<PlainDate> {
  switch (rule.type) {
    // -----------------------------------------------------------------------
    case "ONCE": {
      // 1회성은 사용자가 날짜를 명시했으므로 startDate 와 무관하게 그대로 발생시킨다.
      yield rule.date;
      return;
    }

    // -----------------------------------------------------------------------
    case "YEARLY": {
      let year = getYear(startDate);
      for (;;) {
        const candidate = resolveDayInMonth(year, rule.month, rule.day, onMissingDay);
        if (candidate && candidate >= startDate) yield candidate;
        year += rule.intervalYears;
      }
    }

    // -----------------------------------------------------------------------
    case "MONTHLY_DAY": {
      // 월의 1일을 커서로 잡아 addMonths 의 말일 절삭 영향을 피한다.
      let cursor = plainDateOf(getYear(startDate), getMonth(startDate), 1);
      for (;;) {
        const candidate = resolveDayInMonth(
          getYear(cursor),
          getMonth(cursor),
          rule.day,
          onMissingDay,
        );
        if (candidate && candidate >= startDate) yield candidate;
        cursor = addMonths(cursor, rule.intervalMonths);
      }
    }

    // -----------------------------------------------------------------------
    case "MONTHLY_NTH_WEEKDAY": {
      let cursor = plainDateOf(getYear(startDate), getMonth(startDate), 1);
      for (;;) {
        const candidate = resolveNthWeekdayInMonth(
          getYear(cursor),
          getMonth(cursor),
          rule.nth,
          rule.weekday as Weekday,
          onMissingDay,
        );
        if (candidate && candidate >= startDate) yield candidate;
        cursor = addMonths(cursor, rule.intervalMonths);
      }
    }

    // -----------------------------------------------------------------------
    case "SPECIFIC_MONTHS_DAY": {
      const months = [...new Set(rule.months)].sort((a, b) => a - b);
      let year = getYear(startDate);
      for (;;) {
        for (const month of months) {
          const candidate = resolveDayInMonth(year, month, rule.day, onMissingDay);
          if (candidate && candidate >= startDate) yield candidate;
        }
        year += 1;
      }
    }

    // -----------------------------------------------------------------------
    case "SPECIFIC_MONTHS_NTH_WEEKDAY": {
      const months = [...new Set(rule.months)].sort((a, b) => a - b);
      let year = getYear(startDate);
      for (;;) {
        for (const month of months) {
          const candidate = resolveNthWeekdayInMonth(
            year,
            month,
            rule.nth,
            rule.weekday as Weekday,
            onMissingDay,
          );
          if (candidate && candidate >= startDate) yield candidate;
        }
        year += 1;
      }
    }

    // -----------------------------------------------------------------------
    case "QUARTERLY": {
      const fiscalStartIndex = rule.fiscalYearStartMonth - 1; // 0-based
      const startAbsoluteMonth = getYear(startDate) * 12 + (getMonth(startDate) - 1);

      // startDate 가 속한 분기보다 2분기 앞에서 시작한다.
      // (오프셋이 음수여서 이전 분기의 결과가 startDate 이후일 수 있으므로)
      let quarterIndex = Math.floor((startAbsoluteMonth - fiscalStartIndex) / 3) - 2;

      const allowedQuarters = new Set(rule.quarters);

      for (;;) {
        const quarterStartAbsolute = fiscalStartIndex + 3 * quarterIndex;
        const quarterEndAbsolute = quarterStartAbsolute + 2;

        const startParts = fromAbsoluteMonth(quarterStartAbsolute);
        const endParts = fromAbsoluteMonth(quarterEndAbsolute);

        const quarterStart = plainDateOf(startParts.year, startParts.month, 1);
        const quarterEnd = endOfMonth(plainDateOf(endParts.year, endParts.month, 1));

        // 회계연도 내 분기 번호 (1~4)
        const quarterNumber = (((quarterIndex % 4) + 4) % 4) + 1;

        if (allowedQuarters.size === 0 || allowedQuarters.has(quarterNumber as 1 | 2 | 3 | 4)) {
          const anchor = rule.anchor === "START" ? quarterStart : quarterEnd;
          const candidate = addByUnit(anchor, rule.offsetAmount, rule.offsetUnit, calendar);
          if (candidate >= startDate) yield candidate;
        }

        quarterIndex += 1;
      }
    }

    // -----------------------------------------------------------------------
    case "WEEKLY": {
      // 주 시작을 월요일로 두므로, 주 안의 순서는 월(0)~일(6) 오프셋으로 환산한다.
      // (요일 번호 그대로 정렬하면 일요일이 맨 앞으로 와서 순서가 어긋난다)
      const offsetsFromMonday = [...new Set(rule.weekdays)]
        .map((weekday) => (weekday + 6) % 7)
        .sort((a, b) => a - b);

      let weekStart = startOfWeekMonday(startDate);
      for (;;) {
        for (const offset of offsetsFromMonday) {
          const candidate = addDays(weekStart, offset);
          if (candidate >= startDate) yield candidate;
        }
        weekStart = addDays(weekStart, 7 * rule.intervalWeeks);
      }
    }

    // -----------------------------------------------------------------------
    case "EVERY_N_DAYS": {
      let cursor = startDate;
      for (;;) {
        yield cursor;
        cursor = addDays(cursor, rule.days);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 공휴일 보정
// ---------------------------------------------------------------------------

export interface ShiftResult {
  scheduledDate: PlainDate;
  shiftReason: ShiftReason | null;
}

/**
 * 마감일이 주말/공휴일에 걸린 경우 정책에 따라 이동시킨다.
 * 이동이 필요 없으면 원본을 그대로 반환한다.
 */
export function applyHolidayPolicy(
  originalDate: PlainDate,
  config: Pick<RecurrenceConfig, "holidayPolicy" | "shiftTarget">,
  calendar: HolidayCalendar,
): ShiftResult {
  if (config.holidayPolicy === "KEEP") {
    return { scheduledDate: originalDate, shiftReason: null };
  }

  if (!needsShift(originalDate, calendar, config.shiftTarget)) {
    return { scheduledDate: originalDate, shiftReason: null };
  }

  if (config.holidayPolicy === "PREV_BUSINESS_DAY") {
    return {
      scheduledDate: previousBusinessDay(originalDate, calendar, config.shiftTarget),
      shiftReason: "PREV_BUSINESS_DAY",
    };
  }

  return {
    scheduledDate: nextBusinessDay(originalDate, calendar, config.shiftTarget),
    shiftReason: "NEXT_BUSINESS_DAY",
  };
}

// ---------------------------------------------------------------------------
// 메인 진입점
// ---------------------------------------------------------------------------

function indexExceptions(
  exceptions: readonly RecurrenceException[],
): Map<PlainDate, RecurrenceException> {
  const map = new Map<PlainDate, RecurrenceException>();
  for (const exception of exceptions) {
    // 같은 원본 날짜에 예외가 중복되면 마지막 것이 유효하다.
    map.set(exception.originalDate, exception);
  }
  return map;
}

/**
 * 반복 규칙으로부터 발생 건 목록을 계산한다.
 *
 * @example
 * // 2026년에 발생하는 모든 회차
 * generateOccurrences({
 *   config,
 *   calendar,
 *   from: "2026-01-01",
 *   to: "2026-12-31",
 * });
 */
export function generateOccurrences(
  options: GenerateOccurrencesOptions,
): GeneratedOccurrence[] {
  const {
    config,
    calendar = EMPTY_HOLIDAY_CALENDAR,
    from,
    to,
    limit,
    boundBy = "ORIGINAL",
    maxIterations = DEFAULT_MAX_ITERATIONS,
  } = options;

  const exceptionByDate = indexExceptions(config.exceptions);
  const results: GeneratedOccurrence[] = [];

  // 순회 상한선: to 가 있으면 여유분을 둔 날짜까지만 후보를 만든다.
  const iterationCeiling = to ? addDays(to, LOOKAHEAD_BUFFER_DAYS) : null;

  let sequenceIndex = 0;
  let iterations = 0;

  for (const originalDate of iterateCandidateDates(
    config.rule,
    config.startDate,
    config.onMissingDay,
    calendar,
  )) {
    iterations += 1;
    if (iterations > maxIterations) break;

    // --- 종료 조건 ---------------------------------------------------------
    if (config.endDate && originalDate > config.endDate) break;
    if (config.maxOccurrences !== null && sequenceIndex >= config.maxOccurrences) break;
    if (iterationCeiling && originalDate > iterationCeiling) break;

    // --- 회차 번호 부여 -----------------------------------------------------
    // SKIP 된 회차도 번호를 소비한다. 그래야 예외를 추가/제거해도
    // 다른 회차의 번호가 밀리지 않는다.
    const currentIndex = sequenceIndex;
    sequenceIndex += 1;

    // --- 1회성 예외 --------------------------------------------------------
    const exception = exceptionByDate.get(originalDate);
    if (exception?.kind === "SKIP") continue;

    let scheduledDate: PlainDate;
    let shiftReason: ShiftReason | null;

    if (exception?.kind === "RESCHEDULE") {
      // 사용자가 명시적으로 지정한 날짜이므로 공휴일 보정을 적용하지 않는다.
      scheduledDate = exception.newDate;
      shiftReason = "EXCEPTION";
    } else {
      const shifted = applyHolidayPolicy(originalDate, config, calendar);
      scheduledDate = shifted.scheduledDate;
      shiftReason = shifted.shiftReason;
    }

    // --- 조회 범위 필터 ----------------------------------------------------
    const boundDate = boundBy === "SCHEDULED" ? scheduledDate : originalDate;
    if (from && boundDate < from) continue;
    if (to && boundDate > to) continue;

    results.push({ sequenceIndex: currentIndex, originalDate, scheduledDate, shiftReason });

    if (limit !== undefined && results.length >= limit) break;
  }

  return results;
}

/**
 * "다음 N회 발생 예정일" 미리보기.
 * 업무 등록/수정 폼에서 실시간으로 보여주는 값이며, 사용성의 핵심 기능이다.
 *
 * @param fromDate 이 날짜(포함) 이후의 회차만 보여준다. 보통 "오늘".
 */
export function previewNextOccurrences(
  config: RecurrenceConfig,
  calendar: HolidayCalendar,
  count: number,
  fromDate: PlainDate,
): GeneratedOccurrence[] {
  return generateOccurrences({
    config,
    calendar,
    // 최종 마감일이 앞당겨져 fromDate 이전이 된 회차는 이미 지난 것으로 본다.
    from: fromDate,
    boundBy: "SCHEDULED",
    limit: count,
  });
}

/**
 * 반복이 완전히 끝났는지(더 생성할 회차가 없는지) 판정한다.
 * 롤링 윈도우 배치가 비활성 처리 여부를 결정할 때 사용한다.
 */
export function isRecurrenceExhausted(
  config: RecurrenceConfig,
  calendar: HolidayCalendar,
  afterDate: PlainDate,
): boolean {
  const next = generateOccurrences({
    config,
    calendar,
    from: addDays(afterDate, 1),
    boundBy: "ORIGINAL",
    limit: 1,
    // 종료 조건이 없는 규칙에서 무한 순회하지 않도록 상한을 둔다.
    to: addDays(afterDate, 366 * 5),
  });
  return next.length === 0;
}
