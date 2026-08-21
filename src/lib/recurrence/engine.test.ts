/**
 * 반복 일정 계산 엔진 테스트
 * ============================================================================
 *
 * 요구사항에 명시된 경계 조건을 모두 포함한다:
 *   - 말일 처리 (매월 말일 / 존재하지 않는 일자)
 *   - 윤년 (2/29)
 *   - N번째 요일 (셋째 주 화요일 / 마지막 금요일 / 5번째가 없는 달)
 *   - 공휴일 이동 (앞당김 / 미룸 / 연휴 전체 건너뛰기)
 *   - 1회성 예외 (건너뛰기 / 날짜 변경)
 *   - 종료 조건 (종료일 / 총 횟수)
 *   - 회차 번호의 불변성
 */

import { describe, expect, it } from "vitest";

import { createHolidayCalendar, EMPTY_HOLIDAY_CALENDAR } from "../date/business-day";
import {
  applyHolidayPolicy,
  generateOccurrences,
  isRecurrenceExhausted,
  previewNextOccurrences,
  resolveDayInMonth,
  type GeneratedOccurrence,
} from "./engine";
import {
  recurrenceConfigSchema,
  type RecurrenceConfigInput,
} from "./types";

// ---------------------------------------------------------------------------
// 테스트 헬퍼
// ---------------------------------------------------------------------------

/** 기본값을 채워 완전한 RecurrenceConfig 를 만든다. */
function config(input: RecurrenceConfigInput) {
  return recurrenceConfigSchema.parse(input);
}

/** 결과에서 최종 마감일만 뽑는다. */
function scheduled(occurrences: GeneratedOccurrence[]): string[] {
  return occurrences.map((o) => o.scheduledDate);
}

/** 결과에서 원본 계산일만 뽑는다. */
function original(occurrences: GeneratedOccurrence[]): string[] {
  return occurrences.map((o) => o.originalDate);
}

/**
 * 2026년 대한민국 공휴일 픽스처.
 * 실제 데이터 정확성은 시드 데이터의 책임이고, 여기서는 로직 검증용으로만 쓴다.
 */
const CAL_2026 = createHolidayCalendar([
  { date: "2026-01-01", name: "신정" },
  { date: "2026-02-16", name: "설날 연휴" },
  { date: "2026-02-17", name: "설날" },
  { date: "2026-02-18", name: "설날 연휴" },
  { date: "2026-03-01", name: "삼일절" },
  { date: "2026-03-02", name: "삼일절 대체공휴일" },
  { date: "2026-05-05", name: "어린이날" },
  { date: "2026-06-06", name: "현충일" },
  { date: "2026-08-15", name: "광복절" },
  { date: "2026-10-03", name: "개천절" },
  { date: "2026-10-09", name: "한글날" },
  { date: "2026-12-25", name: "성탄절" },
]);

// ===========================================================================
// resolveDayInMonth — 말일 / 존재하지 않는 일자
// ===========================================================================

describe("resolveDayInMonth", () => {
  it('"LAST" 는 각 달의 말일을 정확히 반환한다', () => {
    expect(resolveDayInMonth(2026, 1, "LAST", "CLAMP")).toBe("2026-01-31");
    expect(resolveDayInMonth(2026, 2, "LAST", "CLAMP")).toBe("2026-02-28");
    expect(resolveDayInMonth(2024, 2, "LAST", "CLAMP")).toBe("2024-02-29"); // 윤년
    expect(resolveDayInMonth(2026, 4, "LAST", "CLAMP")).toBe("2026-04-30");
  });

  it("존재하는 일자는 그대로 반환한다", () => {
    expect(resolveDayInMonth(2026, 3, 15, "CLAMP")).toBe("2026-03-15");
  });

  it("CLAMP: 존재하지 않는 일자는 말일로 당긴다", () => {
    expect(resolveDayInMonth(2026, 2, 31, "CLAMP")).toBe("2026-02-28");
    expect(resolveDayInMonth(2024, 2, 30, "CLAMP")).toBe("2024-02-29");
    expect(resolveDayInMonth(2026, 4, 31, "CLAMP")).toBe("2026-04-30");
  });

  it("SKIP: 존재하지 않는 일자는 null", () => {
    expect(resolveDayInMonth(2026, 2, 31, "SKIP")).toBeNull();
    expect(resolveDayInMonth(2026, 4, 31, "SKIP")).toBeNull();
    expect(resolveDayInMonth(2026, 3, 31, "SKIP")).toBe("2026-03-31");
  });
});

// ===========================================================================
// 매월 (MONTHLY_DAY)
// ===========================================================================

describe("매월 N일", () => {
  it("매월 5일을 생성한다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 5 },
        startDate: "2026-01-01",
      }),
      to: "2026-06-30",
    });

    expect(scheduled(result)).toEqual([
      "2026-01-05",
      "2026-02-05",
      "2026-03-05",
      "2026-04-05",
      "2026-05-05",
      "2026-06-05",
    ]);
  });

  it("시작일이 월 중간이면 그 달의 회차는 건너뛴다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 5 },
        startDate: "2026-01-10", // 1/5 는 이미 지남
      }),
      to: "2026-03-31",
    });

    expect(scheduled(result)).toEqual(["2026-02-05", "2026-03-05"]);
  });

  it("시작일이 마감일과 같은 날이면 포함한다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 5 },
        startDate: "2026-01-05",
      }),
      to: "2026-02-28",
    });

    expect(scheduled(result)).toEqual(["2026-01-05", "2026-02-05"]);
  });

  it("매월 말일을 정확히 생성한다 (말일 길이가 달라도)", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: "LAST" },
        startDate: "2026-01-01",
      }),
      to: "2026-12-31",
    });

    expect(scheduled(result)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
      "2026-06-30",
      "2026-07-31",
      "2026-08-31",
      "2026-09-30",
      "2026-10-31",
      "2026-11-30",
      "2026-12-31",
    ]);
  });

  it("윤년의 매월 말일: 2월은 29일이 된다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: "LAST" },
        startDate: "2024-01-01",
      }),
      to: "2024-03-31",
    });

    expect(scheduled(result)).toEqual(["2024-01-31", "2024-02-29", "2024-03-31"]);
  });

  it("매월 31일 + CLAMP: 짧은 달은 말일로 당긴다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 31 },
        startDate: "2026-01-01",
        onMissingDay: "CLAMP",
      }),
      to: "2026-06-30",
    });

    expect(scheduled(result)).toEqual([
      "2026-01-31",
      "2026-02-28", // 당김
      "2026-03-31",
      "2026-04-30", // 당김
      "2026-05-31",
      "2026-06-30", // 당김
    ]);
  });

  it("매월 31일 + SKIP: 31일이 없는 달은 생성하지 않는다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 31 },
        startDate: "2026-01-01",
        onMissingDay: "SKIP",
      }),
      to: "2026-12-31",
    });

    expect(scheduled(result)).toEqual([
      "2026-01-31",
      "2026-03-31",
      "2026-05-31",
      "2026-07-31",
      "2026-08-31",
      "2026-10-31",
      "2026-12-31",
    ]);
  });

  it("SKIP 된 달은 회차 번호도 소비하지 않는다", () => {
    // SKIP(onMissingDay)은 애초에 후보가 생성되지 않으므로 번호를 소비하지 않는다.
    // (1회성 예외의 SKIP 과 동작이 다르다 — 아래 예외 테스트 참고)
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 31 },
        startDate: "2026-01-01",
        onMissingDay: "SKIP",
      }),
      to: "2026-05-31",
    });

    expect(result.map((o) => o.sequenceIndex)).toEqual([0, 1, 2]);
    expect(scheduled(result)).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });

  it("격월(intervalMonths=2)을 지원한다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 10, intervalMonths: 2 },
        startDate: "2026-01-01",
      }),
      to: "2026-12-31",
    });

    expect(scheduled(result)).toEqual([
      "2026-01-10",
      "2026-03-10",
      "2026-05-10",
      "2026-07-10",
      "2026-09-10",
      "2026-11-10",
    ]);
  });

  it("3개월마다 말일을 지원한다 (분기 결산 대안 표현)", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: "LAST", intervalMonths: 3 },
        startDate: "2026-03-01",
      }),
      to: "2026-12-31",
    });

    expect(scheduled(result)).toEqual([
      "2026-03-31",
      "2026-06-30",
      "2026-09-30",
      "2026-12-31",
    ]);
  });
});

// ===========================================================================
// 매월 N번째 요일 (MONTHLY_NTH_WEEKDAY)
// ===========================================================================

describe("매월 N번째 요일", () => {
  it("매월 셋째 주 화요일", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_NTH_WEEKDAY", nth: 3, weekday: 2 },
        startDate: "2026-01-01",
      }),
      to: "2026-06-30",
    });

    expect(scheduled(result)).toEqual([
      "2026-01-20",
      "2026-02-17",
      "2026-03-17",
      "2026-04-21",
      "2026-05-19",
      "2026-06-16",
    ]);
  });

  it("매월 마지막 금요일 (nth = -1)", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_NTH_WEEKDAY", nth: -1, weekday: 5 },
        startDate: "2026-01-01",
      }),
      to: "2026-04-30",
    });

    expect(scheduled(result)).toEqual([
      "2026-01-30",
      "2026-02-27",
      "2026-03-27",
      "2026-04-24",
    ]);
  });

  it("매월 첫째 주 월요일", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_NTH_WEEKDAY", nth: 1, weekday: 1 },
        startDate: "2026-01-01",
      }),
      to: "2026-04-30",
    });

    expect(scheduled(result)).toEqual([
      "2026-01-05",
      "2026-02-02",
      "2026-03-02",
      "2026-04-06",
    ]);
  });

  it("5번째 요일 + SKIP: 없는 달은 건너뛴다", () => {
    // 2026년에 5번째 월요일이 있는 달만 생성되어야 한다.
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_NTH_WEEKDAY", nth: 5, weekday: 1 },
        startDate: "2026-01-01",
        onMissingDay: "SKIP",
      }),
      to: "2026-12-31",
    });

    // 각 결과가 실제로 그 달의 5번째 월요일인지 검증
    for (const date of scheduled(result)) {
      const day = Number(date.slice(8, 10));
      expect(day).toBeGreaterThanOrEqual(29); // 5번째 주는 29일 이후
    }
    // 2026-03-30, 2026-06-29, 2026-08-31, 2026-11-30 이 해당된다
    expect(scheduled(result)).toEqual([
      "2026-03-30",
      "2026-06-29",
      "2026-08-31",
      "2026-11-30",
    ]);
  });

  it("5번째 요일 + CLAMP: 없는 달은 마지막 해당 요일로 대체한다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_NTH_WEEKDAY", nth: 5, weekday: 1 },
        startDate: "2026-01-01",
        onMissingDay: "CLAMP",
      }),
      to: "2026-03-31",
    });

    // 1월은 5번째 월요일이 없으므로 마지막 월요일 1/26,
    // 2월도 없으므로 2/23, 3월은 5번째 월요일 3/30 이 존재
    expect(scheduled(result)).toEqual(["2026-01-26", "2026-02-23", "2026-03-30"]);
  });

  it("윤년 2월의 5번째 목요일을 처리한다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_NTH_WEEKDAY", nth: 5, weekday: 4 },
        startDate: "2024-02-01",
        onMissingDay: "SKIP",
      }),
      to: "2024-02-29",
    });

    expect(scheduled(result)).toEqual(["2024-02-29"]);
  });
});

// ===========================================================================
// 매년 (YEARLY)
// ===========================================================================

describe("매년", () => {
  it("매년 1월 31일", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "YEARLY", month: 1, day: 31 },
        startDate: "2026-01-01",
      }),
      to: "2029-12-31",
    });

    expect(scheduled(result)).toEqual([
      "2026-01-31",
      "2027-01-31",
      "2028-01-31",
      "2029-01-31",
    ]);
  });

  it("매년 2월 말일: 윤년만 29일", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "YEARLY", month: 2, day: "LAST" },
        startDate: "2024-01-01",
      }),
      to: "2028-12-31",
    });

    expect(scheduled(result)).toEqual([
      "2024-02-29", // 윤년
      "2025-02-28",
      "2026-02-28",
      "2027-02-28",
      "2028-02-29", // 윤년
    ]);
  });

  it("매년 2월 29일 + CLAMP: 평년은 2/28", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "YEARLY", month: 2, day: 29 },
        startDate: "2024-01-01",
        onMissingDay: "CLAMP",
      }),
      to: "2027-12-31",
    });

    expect(scheduled(result)).toEqual([
      "2024-02-29",
      "2025-02-28",
      "2026-02-28",
      "2027-02-28",
    ]);
  });

  it("매년 2월 29일 + SKIP: 윤년에만 발생 (4년마다)", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "YEARLY", month: 2, day: 29 },
        startDate: "2024-01-01",
        onMissingDay: "SKIP",
      }),
      to: "2033-12-31",
    });

    expect(scheduled(result)).toEqual(["2024-02-29", "2028-02-29", "2032-02-29"]);
  });

  it("격년(intervalYears=2)을 지원한다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "YEARLY", month: 7, day: 1, intervalYears: 2 },
        startDate: "2026-01-01",
      }),
      to: "2032-12-31",
    });

    expect(scheduled(result)).toEqual([
      "2026-07-01",
      "2028-07-01",
      "2030-07-01",
      "2032-07-01",
    ]);
  });

  it("시작일이 해당 월/일을 지났으면 다음 해부터 생성한다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "YEARLY", month: 1, day: 31 },
        startDate: "2026-06-01",
      }),
      to: "2028-12-31",
    });

    expect(scheduled(result)).toEqual(["2027-01-31", "2028-01-31"]);
  });
});

// ===========================================================================
// 특정 월 복수 지정
// ===========================================================================

describe("특정 월 복수 지정", () => {
  it("3·6·9·12월 15일", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "SPECIFIC_MONTHS_DAY", months: [3, 6, 9, 12], day: 15 },
        startDate: "2026-01-01",
      }),
      to: "2027-06-30",
    });

    expect(scheduled(result)).toEqual([
      "2026-03-15",
      "2026-06-15",
      "2026-09-15",
      "2026-12-15",
      "2027-03-15",
      "2027-06-15",
    ]);
  });

  it("월 순서가 뒤섞여 입력되어도 오름차순으로 생성한다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "SPECIFIC_MONTHS_DAY", months: [12, 3, 9, 6], day: 1 },
        startDate: "2026-01-01",
      }),
      to: "2026-12-31",
    });

    expect(scheduled(result)).toEqual([
      "2026-03-01",
      "2026-06-01",
      "2026-09-01",
      "2026-12-01",
    ]);
  });

  it("중복 월 입력을 제거한다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "SPECIFIC_MONTHS_DAY", months: [3, 3, 6], day: 1 },
        startDate: "2026-01-01",
      }),
      to: "2026-12-31",
    });

    expect(scheduled(result)).toEqual(["2026-03-01", "2026-06-01"]);
  });

  it("특정 월 + 말일", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "SPECIFIC_MONTHS_DAY", months: [2, 8], day: "LAST" },
        startDate: "2024-01-01",
      }),
      to: "2025-12-31",
    });

    expect(scheduled(result)).toEqual([
      "2024-02-29", // 윤년
      "2024-08-31",
      "2025-02-28",
      "2025-08-31",
    ]);
  });

  it("특정 월 + N번째 요일", () => {
    const result = generateOccurrences({
      config: config({
        rule: {
          type: "SPECIFIC_MONTHS_NTH_WEEKDAY",
          months: [3, 9],
          nth: 1,
          weekday: 1, // 월요일
        },
        startDate: "2026-01-01",
      }),
      to: "2026-12-31",
    });

    expect(scheduled(result)).toEqual(["2026-03-02", "2026-09-07"]);
  });
});

// ===========================================================================
// 매분기 (QUARTERLY)
// ===========================================================================

describe("매분기", () => {
  it("분기 시작일 (오프셋 0)", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "QUARTERLY", anchor: "START", offsetAmount: 0 },
        startDate: "2026-01-01",
      }),
      to: "2026-12-31",
    });

    expect(scheduled(result)).toEqual([
      "2026-01-01",
      "2026-04-01",
      "2026-07-01",
      "2026-10-01",
    ]);
  });

  it("분기 종료일 (오프셋 0)", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "QUARTERLY", anchor: "END", offsetAmount: 0 },
        startDate: "2026-01-01",
      }),
      to: "2026-12-31",
    });

    expect(scheduled(result)).toEqual([
      "2026-03-31",
      "2026-06-30",
      "2026-09-30",
      "2026-12-31",
    ]);
  });

  it("분기 종료 후 10영업일 (공휴일 반영)", () => {
    const result = generateOccurrences({
      config: config({
        rule: {
          type: "QUARTERLY",
          anchor: "END",
          offsetAmount: 10,
          offsetUnit: "BUSINESS_DAY",
        },
        startDate: "2026-01-01",
      }),
      calendar: CAL_2026,
      to: "2026-12-31",
    });

    // 중요: 첫 건은 **직전 분기(2025 Q4)** 의 마감이다.
    //   2025-12-31 + 10영업일 = 2026-01-15 (1/1 신정 제외)
    //   시작일(2026-01-01) 이후이므로 정상적으로 포함되어야 한다.
    //   "분기 종료 후 N일" 규칙은 본질적으로 마감일이 다음 분기에 오기 때문에,
    //   이 동작이 없으면 연초에 전분기 결산 업무가 누락된다.
    // 2026 Q1: 3/31(화) + 10영업일 → 4/14(화)
    // 2026 Q2: 6/30(화) + 10영업일 → 7/14(화)
    // 2026 Q3: 9/30(수) + 10영업일 → 10/15(목) — 10/3(토), 10/9(금, 한글날) 제외
    // 2026 Q4 는 마감일이 2027-01-14 로 조회 범위(to)를 벗어나 제외된다.
    expect(scheduled(result)).toEqual([
      "2026-01-15",
      "2026-04-14",
      "2026-07-14",
      "2026-10-15",
    ]);
  });

  it("분기 종료 후 10일 (달력일)", () => {
    const result = generateOccurrences({
      config: config({
        rule: {
          type: "QUARTERLY",
          anchor: "END",
          offsetAmount: 10,
          offsetUnit: "CALENDAR_DAY",
        },
        startDate: "2026-01-01",
      }),
      to: "2026-12-31",
    });

    // 첫 건은 직전 분기(2025 Q4) 마감: 2025-12-31 + 10일 = 2026-01-10
    expect(scheduled(result)).toEqual([
      "2026-01-10",
      "2026-04-10",
      "2026-07-10",
      "2026-10-10",
    ]);
  });

  it("분기 시작 전 오프셋 (음수)", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "QUARTERLY", anchor: "START", offsetAmount: -5 },
        startDate: "2026-01-01",
      }),
      to: "2026-12-31",
    });

    // 각 분기 시작 5일 전.
    // 2026 Q1(1/1)의 5일 전은 2025-12-27 → 시작일 이전이므로 제외.
    // 2027 Q1(2027-01-01)의 5일 전은 2026-12-27 → 조회 범위 안이므로 포함.
    expect(scheduled(result)).toEqual([
      "2026-03-27", // 2026 Q2 시작(4/1) - 5일
      "2026-06-26", // 2026 Q3 시작(7/1) - 5일
      "2026-09-26", // 2026 Q4 시작(10/1) - 5일
      "2026-12-27", // 2027 Q1 시작(1/1) - 5일
    ]);
  });

  it("회계연도 시작월이 4월인 분기", () => {
    const result = generateOccurrences({
      config: config({
        rule: {
          type: "QUARTERLY",
          anchor: "START",
          offsetAmount: 0,
          fiscalYearStartMonth: 4,
        },
        startDate: "2026-01-01",
      }),
      to: "2027-03-31",
    });

    expect(scheduled(result)).toEqual([
      "2026-01-01", // FY2025 Q4 (1~3월)
      "2026-04-01", // FY2026 Q1
      "2026-07-01",
      "2026-10-01",
      "2027-01-01",
    ]);
  });

  it("특정 분기만 지정 (1·3분기)", () => {
    const result = generateOccurrences({
      config: config({
        rule: {
          type: "QUARTERLY",
          anchor: "END",
          offsetAmount: 0,
          quarters: [1, 3],
        },
        startDate: "2026-01-01",
      }),
      to: "2027-12-31",
    });

    expect(scheduled(result)).toEqual([
      "2026-03-31", // Q1
      "2026-09-30", // Q3
      "2027-03-31",
      "2027-09-30",
    ]);
  });
});

// ===========================================================================
// 매주 / 격주 / N일마다
// ===========================================================================

describe("매주 / 격주", () => {
  it("매주 월·수·금", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "WEEKLY", weekdays: [1, 3, 5] },
        startDate: "2026-03-02", // 월요일
      }),
      to: "2026-03-15",
    });

    expect(scheduled(result)).toEqual([
      "2026-03-02", // 월
      "2026-03-04", // 수
      "2026-03-06", // 금
      "2026-03-09", // 월
      "2026-03-11", // 수
      "2026-03-13", // 금
    ]);
  });

  it("일요일이 포함되어도 주 순서(월~일)를 지킨다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "WEEKLY", weekdays: [0, 1] }, // 일, 월
        startDate: "2026-03-02", // 월요일
      }),
      to: "2026-03-16",
    });

    // 월요일 시작 주 기준: 3/2(월) → 3/8(일) → 3/9(월) → 3/15(일) → 3/16(월)
    expect(scheduled(result)).toEqual([
      "2026-03-02",
      "2026-03-08",
      "2026-03-09",
      "2026-03-15",
      "2026-03-16",
    ]);
  });

  it("격주 화요일", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "WEEKLY", weekdays: [2], intervalWeeks: 2 },
        startDate: "2026-03-03", // 화요일
      }),
      to: "2026-04-30",
    });

    expect(scheduled(result)).toEqual([
      "2026-03-03",
      "2026-03-17",
      "2026-03-31",
      "2026-04-14",
      "2026-04-28",
    ]);
  });

  it("시작일이 주 중간이면 그 주의 이전 요일은 건너뛴다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "WEEKLY", weekdays: [1, 5] }, // 월, 금
        startDate: "2026-03-04", // 수요일
      }),
      to: "2026-03-16",
    });

    // 3/2(월)은 시작일 이전이라 제외, 3/6(금)부터
    expect(scheduled(result)).toEqual(["2026-03-06", "2026-03-09", "2026-03-13", "2026-03-16"]);
  });

  it("4주마다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "WEEKLY", weekdays: [4], intervalWeeks: 4 },
        startDate: "2026-01-01", // 목요일
      }),
      to: "2026-04-30",
    });

    expect(scheduled(result)).toEqual([
      "2026-01-01",
      "2026-01-29",
      "2026-02-26",
      "2026-03-26",
      "2026-04-23",
    ]);
  });
});

describe("N일마다", () => {
  it("10일마다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "EVERY_N_DAYS", days: 10 },
        startDate: "2026-01-01",
      }),
      to: "2026-02-10",
    });

    expect(scheduled(result)).toEqual([
      "2026-01-01",
      "2026-01-11",
      "2026-01-21",
      "2026-01-31",
      "2026-02-10",
    ]);
  });

  it("45일마다 (월 경계를 불규칙하게 넘음)", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "EVERY_N_DAYS", days: 45 },
        startDate: "2026-01-15",
      }),
      to: "2026-12-31",
    });

    expect(scheduled(result)).toEqual([
      "2026-01-15",
      "2026-03-01",
      "2026-04-15",
      "2026-05-30",
      "2026-07-14",
      "2026-08-28",
      "2026-10-12",
      "2026-11-26",
    ]);
  });
});

describe("1회성 (ONCE)", () => {
  it("지정 날짜에 정확히 한 번만 발생한다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "ONCE", date: "2026-05-20" },
        startDate: "2026-01-01",
      }),
      to: "2026-12-31",
    });

    expect(scheduled(result)).toEqual(["2026-05-20"]);
    expect(result[0].sequenceIndex).toBe(0);
  });
});

// ===========================================================================
// 공휴일 / 주말 이동
// ===========================================================================

describe("공휴일·주말 이동 정책", () => {
  it("KEEP: 휴일이어도 그대로 유지한다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 1 },
        startDate: "2026-01-01",
        holidayPolicy: "KEEP",
      }),
      calendar: CAL_2026,
      to: "2026-03-31",
    });

    expect(scheduled(result)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
    expect(result.every((o) => o.shiftReason === null)).toBe(true);
  });

  it("PREV_BUSINESS_DAY: 직전 영업일로 앞당긴다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 1 },
        startDate: "2026-01-01",
        holidayPolicy: "PREV_BUSINESS_DAY",
      }),
      calendar: CAL_2026,
      to: "2026-03-31",
    });

    // 1/1 신정(목) → 2025-12-31(수)
    // 2/1 일요일     → 1/30(금)
    // 3/1 일요일(삼일절), 3/2 대체공휴일(월) → 2/27(금)
    expect(scheduled(result)).toEqual(["2025-12-31", "2026-01-30", "2026-02-27"]);
    expect(result.map((o) => o.shiftReason)).toEqual([
      "PREV_BUSINESS_DAY",
      "PREV_BUSINESS_DAY",
      "PREV_BUSINESS_DAY",
    ]);
    // 원본 날짜는 보존된다
    expect(original(result)).toEqual(["2026-01-01", "2026-02-01", "2026-03-01"]);
  });

  it("NEXT_BUSINESS_DAY: 다음 영업일로 미룬다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 1 },
        startDate: "2026-01-01",
        holidayPolicy: "NEXT_BUSINESS_DAY",
      }),
      calendar: CAL_2026,
      to: "2026-03-31",
    });

    // 1/1 신정(목) → 1/2(금)
    // 2/1 일요일     → 2/2(월)
    // 3/1 일요일, 3/2 대체공휴일 → 3/3(화)
    expect(scheduled(result)).toEqual(["2026-01-02", "2026-02-02", "2026-03-03"]);
  });

  it("설 연휴 전체를 건너뛴다", () => {
    // 2/17 은 설날. 앞당기면 2/13(금), 미루면 2/19(목)
    const prev = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 17 },
        startDate: "2026-02-01",
        holidayPolicy: "PREV_BUSINESS_DAY",
      }),
      calendar: CAL_2026,
      to: "2026-02-28",
    });
    expect(scheduled(prev)).toEqual(["2026-02-13"]);

    const next = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 17 },
        startDate: "2026-02-01",
        holidayPolicy: "NEXT_BUSINESS_DAY",
      }),
      calendar: CAL_2026,
      to: "2026-02-28",
    });
    expect(scheduled(next)).toEqual(["2026-02-19"]);
  });

  it("WEEKEND_ONLY: 공휴일에는 이동하지 않는다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 1 },
        startDate: "2026-01-01",
        holidayPolicy: "PREV_BUSINESS_DAY",
        shiftTarget: "WEEKEND_ONLY",
      }),
      calendar: CAL_2026,
      to: "2026-01-31",
    });

    // 1/1 은 목요일이므로 공휴일이지만 주말이 아님 → 이동 없음
    expect(scheduled(result)).toEqual(["2026-01-01"]);
    expect(result[0].shiftReason).toBeNull();
  });

  it("HOLIDAY_ONLY: 주말에는 이동하지 않는다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 1 },
        startDate: "2026-02-01",
        holidayPolicy: "NEXT_BUSINESS_DAY",
        shiftTarget: "HOLIDAY_ONLY",
      }),
      calendar: CAL_2026,
      to: "2026-02-28",
    });

    // 2/1 은 일요일이지만 공휴일은 아님 → 이동 없음
    expect(scheduled(result)).toEqual(["2026-02-01"]);
    expect(result[0].shiftReason).toBeNull();
  });

  it("월 마감(말일)이 휴일일 때 앞당김", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: "LAST" },
        startDate: "2026-01-01",
        holidayPolicy: "PREV_BUSINESS_DAY",
      }),
      calendar: CAL_2026,
      to: "2026-12-31",
    });

    expect(scheduled(result)).toEqual([
      "2026-01-30", // 1/31 토 → 1/30 금
      "2026-02-27", // 2/28 토 → 2/27 금
      "2026-03-31", // 화 → 그대로
      "2026-04-30", // 목 → 그대로
      "2026-05-29", // 5/31 일 → 5/29 금
      "2026-06-30", // 화 → 그대로
      "2026-07-31", // 금 → 그대로
      "2026-08-31", // 월 → 그대로
      "2026-09-30", // 수 → 그대로
      "2026-10-30", // 10/31 토 → 10/30 금
      "2026-11-30", // 월 → 그대로
      "2026-12-31", // 목 → 그대로
    ]);
  });

  it("applyHolidayPolicy 를 직접 호출할 수 있다", () => {
    expect(
      applyHolidayPolicy(
        "2026-01-01",
        { holidayPolicy: "PREV_BUSINESS_DAY", shiftTarget: "WEEKEND_AND_HOLIDAY" },
        CAL_2026,
      ),
    ).toEqual({ scheduledDate: "2025-12-31", shiftReason: "PREV_BUSINESS_DAY" });

    expect(
      applyHolidayPolicy(
        "2026-01-02",
        { holidayPolicy: "PREV_BUSINESS_DAY", shiftTarget: "WEEKEND_AND_HOLIDAY" },
        CAL_2026,
      ),
    ).toEqual({ scheduledDate: "2026-01-02", shiftReason: null });
  });
});

// ===========================================================================
// 1회성 예외
// ===========================================================================

describe("1회성 예외", () => {
  const baseRule = { type: "MONTHLY_DAY" as const, day: 5 };

  it("SKIP: 해당 회차를 생성하지 않는다", () => {
    const result = generateOccurrences({
      config: config({
        rule: baseRule,
        startDate: "2026-01-01",
        exceptions: [{ kind: "SKIP", originalDate: "2026-03-05", reason: "설비 점검 연기" }],
      }),
      to: "2026-05-31",
    });

    expect(scheduled(result)).toEqual([
      "2026-01-05",
      "2026-02-05",
      "2026-04-05",
      "2026-05-05",
    ]);
  });

  it("SKIP 은 회차 번호를 소비한다 (다른 회차 번호가 밀리지 않음)", () => {
    const withoutException = generateOccurrences({
      config: config({ rule: baseRule, startDate: "2026-01-01" }),
      to: "2026-05-31",
    });
    const withException = generateOccurrences({
      config: config({
        rule: baseRule,
        startDate: "2026-01-01",
        exceptions: [{ kind: "SKIP", originalDate: "2026-03-05" }],
      }),
      to: "2026-05-31",
    });

    // 4월 회차의 번호가 예외 추가 전후로 동일해야 한다.
    const aprilBefore = withoutException.find((o) => o.originalDate === "2026-04-05");
    const aprilAfter = withException.find((o) => o.originalDate === "2026-04-05");
    expect(aprilBefore?.sequenceIndex).toBe(3);
    expect(aprilAfter?.sequenceIndex).toBe(3);
  });

  it("RESCHEDULE: 지정한 날짜로 변경한다", () => {
    const result = generateOccurrences({
      config: config({
        rule: baseRule,
        startDate: "2026-01-01",
        exceptions: [
          { kind: "RESCHEDULE", originalDate: "2026-03-05", newDate: "2026-03-12" },
        ],
      }),
      to: "2026-04-30",
    });

    expect(scheduled(result)).toEqual([
      "2026-01-05",
      "2026-02-05",
      "2026-03-12", // 변경됨
      "2026-04-05",
    ]);

    const march = result.find((o) => o.originalDate === "2026-03-05");
    expect(march?.scheduledDate).toBe("2026-03-12");
    expect(march?.shiftReason).toBe("EXCEPTION");
  });

  it("RESCHEDULE 된 날짜에는 공휴일 보정을 적용하지 않는다", () => {
    const result = generateOccurrences({
      config: config({
        rule: baseRule,
        startDate: "2026-01-01",
        holidayPolicy: "PREV_BUSINESS_DAY",
        // 2026-03-01 은 일요일이자 삼일절이지만, 사용자가 명시했으므로 그대로 둔다.
        exceptions: [
          { kind: "RESCHEDULE", originalDate: "2026-03-05", newDate: "2026-03-01" },
        ],
      }),
      calendar: CAL_2026,
      to: "2026-03-31",
    });

    const march = result.find((o) => o.originalDate === "2026-03-05");
    expect(march?.scheduledDate).toBe("2026-03-01");
    expect(march?.shiftReason).toBe("EXCEPTION");
  });

  it("존재하지 않는 원본 날짜의 예외는 무시된다", () => {
    const result = generateOccurrences({
      config: config({
        rule: baseRule,
        startDate: "2026-01-01",
        // 5일 규칙에 3/10 은 존재하지 않음 → 조용히 무시되어야 한다
        exceptions: [{ kind: "SKIP", originalDate: "2026-03-10" }],
      }),
      to: "2026-04-30",
    });

    expect(scheduled(result)).toEqual([
      "2026-01-05",
      "2026-02-05",
      "2026-03-05",
      "2026-04-05",
    ]);
  });

  it("여러 예외를 동시에 적용한다", () => {
    const result = generateOccurrences({
      config: config({
        rule: baseRule,
        startDate: "2026-01-01",
        exceptions: [
          { kind: "SKIP", originalDate: "2026-02-05" },
          { kind: "RESCHEDULE", originalDate: "2026-03-05", newDate: "2026-03-20" },
          { kind: "SKIP", originalDate: "2026-04-05" },
        ],
      }),
      to: "2026-05-31",
    });

    expect(scheduled(result)).toEqual(["2026-01-05", "2026-03-20", "2026-05-05"]);
  });
});

// ===========================================================================
// 종료 조건
// ===========================================================================

describe("종료 조건", () => {
  it("endDate 이후에는 생성하지 않는다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 5 },
        startDate: "2026-01-01",
        endDate: "2026-03-31",
      }),
      to: "2026-12-31",
    });

    expect(scheduled(result)).toEqual(["2026-01-05", "2026-02-05", "2026-03-05"]);
  });

  it("endDate 는 원본 날짜 기준으로 판정한다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 5 },
        startDate: "2026-01-01",
        endDate: "2026-03-05", // 정확히 원본 날짜와 같은 날
      }),
      to: "2026-12-31",
    });

    expect(scheduled(result)).toEqual(["2026-01-05", "2026-02-05", "2026-03-05"]);
  });

  it("maxOccurrences 로 총 횟수를 제한한다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 5 },
        startDate: "2026-01-01",
        maxOccurrences: 3,
      }),
      to: "2026-12-31",
    });

    expect(scheduled(result)).toEqual(["2026-01-05", "2026-02-05", "2026-03-05"]);
  });

  it("maxOccurrences 는 SKIP 된 회차도 포함해 센다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 5 },
        startDate: "2026-01-01",
        maxOccurrences: 3,
        exceptions: [{ kind: "SKIP", originalDate: "2026-02-05" }],
      }),
      to: "2026-12-31",
    });

    // 3회차(1,2,3월)까지 생성하되 2월은 SKIP → 결과 2건
    expect(scheduled(result)).toEqual(["2026-01-05", "2026-03-05"]);
  });

  it("endDate 와 maxOccurrences 중 먼저 도달한 조건이 적용된다", () => {
    const byDate = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 5 },
        startDate: "2026-01-01",
        endDate: "2026-02-28",
        maxOccurrences: 10,
      }),
      to: "2026-12-31",
    });
    expect(byDate).toHaveLength(2);

    const byCount = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 5 },
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        maxOccurrences: 2,
      }),
      to: "2026-12-31",
    });
    expect(byCount).toHaveLength(2);
  });

  it("limit 은 결과 개수만 제한한다 (회차 번호에 영향 없음)", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 5 },
        startDate: "2026-01-01",
      }),
      from: "2026-04-01",
      limit: 2,
    });

    expect(scheduled(result)).toEqual(["2026-04-05", "2026-05-05"]);
    // 1월부터 세었으므로 4월은 3번 회차
    expect(result.map((o) => o.sequenceIndex)).toEqual([3, 4]);
  });
});

// ===========================================================================
// 회차 번호 불변성
// ===========================================================================

describe("회차 번호(sequenceIndex) 불변성", () => {
  it("조회 범위를 좁혀도 번호가 달라지지 않는다", () => {
    const cfg = config({
      rule: { type: "MONTHLY_DAY", day: 5 },
      startDate: "2026-01-01",
    });

    const full = generateOccurrences({ config: cfg, to: "2026-12-31" });
    const partial = generateOccurrences({ config: cfg, from: "2026-06-01", to: "2026-08-31" });

    const juneFromFull = full.find((o) => o.originalDate === "2026-06-05");
    const juneFromPartial = partial.find((o) => o.originalDate === "2026-06-05");

    expect(juneFromFull?.sequenceIndex).toBe(5);
    expect(juneFromPartial?.sequenceIndex).toBe(5);
  });

  it("첫 회차는 항상 0 번이다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 5 },
        startDate: "2026-01-01",
      }),
      to: "2026-01-31",
    });
    expect(result[0].sequenceIndex).toBe(0);
  });
});

// ===========================================================================
// 조회 범위 판정 기준 (boundBy)
// ===========================================================================

describe("boundBy", () => {
  const cfg = config({
    rule: { type: "MONTHLY_DAY", day: 1 },
    startDate: "2026-01-01",
    holidayPolicy: "PREV_BUSINESS_DAY",
  });

  it("ORIGINAL(기본): 원본 날짜로 범위를 판정한다", () => {
    const result = generateOccurrences({
      config: cfg,
      calendar: CAL_2026,
      from: "2026-01-01",
      to: "2026-01-31",
      boundBy: "ORIGINAL",
    });

    // 원본 1/1 은 범위 안 → 포함. 단 보정된 마감일은 범위를 벗어난 2025-12-31 이다.
    // 저장 용도에는 이 기준이 맞다 — 원본 날짜 기준으로 나누면
    // 구간 경계에서 누락도 중복도 발생하지 않는다.
    expect(scheduled(result)).toEqual(["2025-12-31"]);
    expect(original(result)).toEqual(["2026-01-01"]);
  });

  it("SCHEDULED: 최종 마감일로 범위를 판정한다", () => {
    const result = generateOccurrences({
      config: cfg,
      calendar: CAL_2026,
      from: "2026-01-01",
      to: "2026-01-31",
      boundBy: "SCHEDULED",
    });

    // 1/1 회차의 마감일은 2025-12-31 → 범위 밖이므로 제외된다.
    // 반대로 2/1 회차는 일요일이라 1/30(금)으로 앞당겨져 **1월 범위 안으로 들어온다**.
    // 즉 "1월 달력에 실제로 표시되어야 하는 마감"은 이 기준으로 골라야 한다.
    expect(scheduled(result)).toEqual(["2026-01-30"]);
    expect(original(result)).toEqual(["2026-02-01"]);
    expect(result[0].sequenceIndex).toBe(1);
  });
});

// ===========================================================================
// 미리보기
// ===========================================================================

describe("previewNextOccurrences (다음 N회 미리보기)", () => {
  it("기준일 이후 N회를 반환한다", () => {
    const result = previewNextOccurrences(
      config({
        rule: { type: "MONTHLY_DAY", day: 5 },
        startDate: "2026-01-01",
      }),
      EMPTY_HOLIDAY_CALENDAR,
      10,
      "2026-03-01",
    );

    expect(result).toHaveLength(10);
    expect(scheduled(result)).toEqual([
      "2026-03-05",
      "2026-04-05",
      "2026-05-05",
      "2026-06-05",
      "2026-07-05",
      "2026-08-05",
      "2026-09-05",
      "2026-10-05",
      "2026-11-05",
      "2026-12-05",
    ]);
  });

  it("반복이 끝나면 N회보다 적게 반환한다", () => {
    const result = previewNextOccurrences(
      config({
        rule: { type: "MONTHLY_DAY", day: 5 },
        startDate: "2026-01-01",
        maxOccurrences: 3,
      }),
      EMPTY_HOLIDAY_CALENDAR,
      10,
      "2026-01-01",
    );

    expect(result).toHaveLength(3);
  });

  it("공휴일 보정이 반영된 마감일을 보여준다", () => {
    const result = previewNextOccurrences(
      config({
        rule: { type: "MONTHLY_DAY", day: 1 },
        startDate: "2026-01-01",
        holidayPolicy: "NEXT_BUSINESS_DAY",
      }),
      CAL_2026,
      3,
      "2026-01-01",
    );

    expect(scheduled(result)).toEqual(["2026-01-02", "2026-02-02", "2026-03-03"]);
    expect(result[0].shiftReason).toBe("NEXT_BUSINESS_DAY");
  });

  it("1회성 업무는 1건만 반환한다", () => {
    const result = previewNextOccurrences(
      config({
        rule: { type: "ONCE", date: "2026-05-20" },
        startDate: "2026-01-01",
      }),
      EMPTY_HOLIDAY_CALENDAR,
      10,
      "2026-01-01",
    );

    expect(scheduled(result)).toEqual(["2026-05-20"]);
  });

  it("이미 끝난 1회성 업무는 아무것도 반환하지 않는다", () => {
    const result = previewNextOccurrences(
      config({
        rule: { type: "ONCE", date: "2026-01-20" },
        startDate: "2026-01-01",
      }),
      EMPTY_HOLIDAY_CALENDAR,
      10,
      "2026-06-01",
    );

    expect(result).toHaveLength(0);
  });
});

// ===========================================================================
// 반복 종료 판정
// ===========================================================================

describe("isRecurrenceExhausted", () => {
  it("종료 조건이 없으면 항상 false", () => {
    expect(
      isRecurrenceExhausted(
        config({ rule: { type: "MONTHLY_DAY", day: 5 }, startDate: "2026-01-01" }),
        EMPTY_HOLIDAY_CALENDAR,
        "2030-01-01",
      ),
    ).toBe(false);
  });

  it("maxOccurrences 를 모두 소진하면 true", () => {
    const cfg = config({
      rule: { type: "MONTHLY_DAY", day: 5 },
      startDate: "2026-01-01",
      maxOccurrences: 3,
    });

    expect(isRecurrenceExhausted(cfg, EMPTY_HOLIDAY_CALENDAR, "2026-02-05")).toBe(false);
    expect(isRecurrenceExhausted(cfg, EMPTY_HOLIDAY_CALENDAR, "2026-03-05")).toBe(true);
  });

  it("endDate 를 지나면 true", () => {
    const cfg = config({
      rule: { type: "MONTHLY_DAY", day: 5 },
      startDate: "2026-01-01",
      endDate: "2026-03-31",
    });

    expect(isRecurrenceExhausted(cfg, EMPTY_HOLIDAY_CALENDAR, "2026-02-05")).toBe(false);
    expect(isRecurrenceExhausted(cfg, EMPTY_HOLIDAY_CALENDAR, "2026-03-31")).toBe(true);
  });

  it("1회성 업무는 발생 후 true", () => {
    const cfg = config({
      rule: { type: "ONCE", date: "2026-05-20" },
      startDate: "2026-01-01",
    });

    expect(isRecurrenceExhausted(cfg, EMPTY_HOLIDAY_CALENDAR, "2026-05-19")).toBe(false);
    expect(isRecurrenceExhausted(cfg, EMPTY_HOLIDAY_CALENDAR, "2026-05-20")).toBe(true);
  });
});

// ===========================================================================
// 안전장치
// ===========================================================================

describe("안전장치", () => {
  it("maxIterations 를 넘으면 순회를 중단한다 (무한 루프 방지)", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "EVERY_N_DAYS", days: 1 },
        startDate: "2026-01-01",
      }),
      maxIterations: 10,
    });

    expect(result).toHaveLength(10);
  });

  it("to 를 지정하지 않고 limit 만 주어도 종료한다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 5 },
        startDate: "2026-01-01",
      }),
      limit: 5,
    });

    expect(result).toHaveLength(5);
  });

  it("from > to 인 범위는 빈 결과를 반환한다", () => {
    const result = generateOccurrences({
      config: config({
        rule: { type: "MONTHLY_DAY", day: 5 },
        startDate: "2026-01-01",
      }),
      from: "2026-06-01",
      to: "2026-03-01",
    });

    expect(result).toHaveLength(0);
  });
});
