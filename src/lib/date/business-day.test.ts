/**
 * 영업일 계산 테스트
 *
 * 공휴일 데이터는 실제 값이 아니라 **테스트 픽스처**를 사용한다.
 * 실제 공휴일 데이터의 정확성은 별개 문제(데이터 갱신 절차)이며,
 * 계산 로직은 어떤 데이터가 주어져도 옳게 동작해야 한다.
 */

import { describe, expect, it } from "vitest";

import {
  addBusinessDays,
  addByUnit,
  countBusinessDays,
  createHolidayCalendar,
  EMPTY_HOLIDAY_CALENDAR,
  needsShift,
  nextBusinessDay,
  previousBusinessDay,
} from "./business-day";

/**
 * 2026년 1~3월 픽스처.
 * 신정(목)과 설 연휴(월~수)를 포함해 "연휴가 주말에 붙는" 케이스를 만든다.
 */
const FIXTURE_CALENDAR = createHolidayCalendar([
  { date: "2026-01-01", name: "신정" },
  { date: "2026-02-16", name: "설날 연휴" },
  { date: "2026-02-17", name: "설날" },
  { date: "2026-02-18", name: "설날 연휴" },
  { date: "2026-03-02", name: "삼일절 대체공휴일" },
]);

describe("createHolidayCalendar", () => {
  it("공휴일과 주말을 구분해 판정한다", () => {
    expect(FIXTURE_CALENDAR.isHoliday("2026-01-01")).toBe(true);
    expect(FIXTURE_CALENDAR.isWeekend("2026-01-01")).toBe(false); // 목요일
    expect(FIXTURE_CALENDAR.isBusinessDay("2026-01-01")).toBe(false);

    expect(FIXTURE_CALENDAR.isHoliday("2026-01-03")).toBe(false);
    expect(FIXTURE_CALENDAR.isWeekend("2026-01-03")).toBe(true); // 토요일
    expect(FIXTURE_CALENDAR.isBusinessDay("2026-01-03")).toBe(false);

    expect(FIXTURE_CALENDAR.isBusinessDay("2026-01-02")).toBe(true); // 금요일
  });

  it("공휴일 이름을 조회할 수 있다", () => {
    expect(FIXTURE_CALENDAR.getHolidayName("2026-02-17")).toBe("설날");
    expect(FIXTURE_CALENDAR.getHolidayName("2026-02-19")).toBeNull();
  });

  it("문자열 배열만 넘겨도 동작한다", () => {
    const calendar = createHolidayCalendar(["2026-05-05"]);
    expect(calendar.isHoliday("2026-05-05")).toBe(true);
    expect(calendar.getHolidayName("2026-05-05")).toBe("공휴일");
  });

  it("주말 요일을 커스터마이즈할 수 있다", () => {
    // 일요일만 쉬는 조직
    const calendar = createHolidayCalendar([], { weekendDays: [0] });
    expect(calendar.isWeekend("2026-01-03")).toBe(false); // 토요일 → 영업일
    expect(calendar.isWeekend("2026-01-04")).toBe(true); // 일요일
  });

  it("EMPTY_HOLIDAY_CALENDAR 는 주말만 반영한다", () => {
    expect(EMPTY_HOLIDAY_CALENDAR.isHoliday("2026-01-01")).toBe(false);
    expect(EMPTY_HOLIDAY_CALENDAR.isWeekend("2026-01-03")).toBe(true);
  });
});

describe("needsShift (이동 대상 판정)", () => {
  it("WEEKEND_AND_HOLIDAY: 주말과 공휴일 모두 대상", () => {
    expect(needsShift("2026-01-01", FIXTURE_CALENDAR, "WEEKEND_AND_HOLIDAY")).toBe(true);
    expect(needsShift("2026-01-03", FIXTURE_CALENDAR, "WEEKEND_AND_HOLIDAY")).toBe(true);
    expect(needsShift("2026-01-02", FIXTURE_CALENDAR, "WEEKEND_AND_HOLIDAY")).toBe(false);
  });

  it("WEEKEND_ONLY: 공휴일은 그대로 둔다", () => {
    expect(needsShift("2026-01-01", FIXTURE_CALENDAR, "WEEKEND_ONLY")).toBe(false);
    expect(needsShift("2026-01-03", FIXTURE_CALENDAR, "WEEKEND_ONLY")).toBe(true);
  });

  it("HOLIDAY_ONLY: 주말은 그대로 둔다", () => {
    expect(needsShift("2026-01-01", FIXTURE_CALENDAR, "HOLIDAY_ONLY")).toBe(true);
    expect(needsShift("2026-01-03", FIXTURE_CALENDAR, "HOLIDAY_ONLY")).toBe(false);
  });
});

describe("nextBusinessDay / previousBusinessDay", () => {
  it("영업일이면 그대로 반환한다 (당일 포함)", () => {
    expect(nextBusinessDay("2026-01-02", FIXTURE_CALENDAR)).toBe("2026-01-02");
    expect(previousBusinessDay("2026-01-02", FIXTURE_CALENDAR)).toBe("2026-01-02");
  });

  it("주말이면 앞/뒤 영업일로 이동한다", () => {
    // 2026-01-03(토) → 다음 영업일 1/5(월), 직전 영업일 1/2(금)
    expect(nextBusinessDay("2026-01-03", FIXTURE_CALENDAR)).toBe("2026-01-05");
    expect(previousBusinessDay("2026-01-03", FIXTURE_CALENDAR)).toBe("2026-01-02");
  });

  it("신정(목)에서 직전 영업일은 전년도 12/31 이다", () => {
    // 2025-12-31 은 수요일 → 영업일
    expect(previousBusinessDay("2026-01-01", FIXTURE_CALENDAR)).toBe("2025-12-31");
  });

  it("연휴 전체를 건너뛴다", () => {
    // 설 연휴 2/16(월)~2/18(수). 직전 영업일은 2/13(금), 다음 영업일은 2/19(목)
    expect(previousBusinessDay("2026-02-16", FIXTURE_CALENDAR)).toBe("2026-02-13");
    expect(nextBusinessDay("2026-02-16", FIXTURE_CALENDAR)).toBe("2026-02-19");
    expect(nextBusinessDay("2026-02-17", FIXTURE_CALENDAR)).toBe("2026-02-19");
  });

  it("연휴가 주말에 붙어도 끝까지 건너뛴다", () => {
    // 2026-02-14(토), 2/15(일), 2/16~18 연휴 → 2/14 의 다음 영업일은 2/19(목)
    expect(nextBusinessDay("2026-02-14", FIXTURE_CALENDAR)).toBe("2026-02-19");
    // 2026-02-28(토), 3/1(일), 3/2(대체공휴일 월) → 다음 영업일 3/3(화)
    expect(nextBusinessDay("2026-02-28", FIXTURE_CALENDAR)).toBe("2026-03-03");
    // 3/2(월, 대체공휴일)의 직전 영업일은 2/27(금)
    expect(previousBusinessDay("2026-03-02", FIXTURE_CALENDAR)).toBe("2026-02-27");
  });
});

describe("addBusinessDays", () => {
  it("n = 0 이면 이동하지 않는다 (휴일이어도 그대로)", () => {
    expect(addBusinessDays("2026-01-01", 0, FIXTURE_CALENDAR)).toBe("2026-01-01");
    expect(addBusinessDays("2026-01-03", 0, FIXTURE_CALENDAR)).toBe("2026-01-03");
  });

  it("시작일 자체는 세지 않는다", () => {
    // 2026-01-02(금) + 1영업일 = 1/5(월)
    expect(addBusinessDays("2026-01-02", 1, FIXTURE_CALENDAR)).toBe("2026-01-05");
    // 2026-01-05(월) + 1영업일 = 1/6(화)
    expect(addBusinessDays("2026-01-05", 1, FIXTURE_CALENDAR)).toBe("2026-01-06");
  });

  it("주말을 건너뛰며 센다", () => {
    // 2026-01-05(월) 기준: 화(1) 수(2) 목(3) 금(4) → 1/9
    expect(addBusinessDays("2026-01-05", 4, FIXTURE_CALENDAR)).toBe("2026-01-09");
    // +5 는 주말을 넘겨 1/12(월)
    expect(addBusinessDays("2026-01-05", 5, FIXTURE_CALENDAR)).toBe("2026-01-12");
  });

  it("공휴일을 건너뛰며 센다", () => {
    // 2026-02-13(금) + 1영업일 → 2/16~18 연휴, 2/14~15 주말 → 2/19(목)
    expect(addBusinessDays("2026-02-13", 1, FIXTURE_CALENDAR)).toBe("2026-02-19");
    // +2 → 2/20(금)
    expect(addBusinessDays("2026-02-13", 2, FIXTURE_CALENDAR)).toBe("2026-02-20");
  });

  it("분기 종료 후 10영업일을 정확히 계산한다", () => {
    // 2026-03-31(화)부터: 4/1,2,3(수목금)=3, 4/6~10=8, 4/13,14=10 → 2026-04-14
    expect(addBusinessDays("2026-03-31", 10, FIXTURE_CALENDAR)).toBe("2026-04-14");
  });

  it("음수는 과거 방향으로 센다", () => {
    // 2026-01-05(월) - 1영업일 = 1/2(금)
    expect(addBusinessDays("2026-01-05", -1, FIXTURE_CALENDAR)).toBe("2026-01-02");
    // -2 = 2025-12-31(수). 1/1 은 공휴일이므로 건너뜀
    expect(addBusinessDays("2026-01-05", -2, FIXTURE_CALENDAR)).toBe("2025-12-31");
  });

  it("휴일에서 시작해도 다음 영업일부터 센다", () => {
    // 2026-01-03(토) + 1영업일 = 1/5(월)
    expect(addBusinessDays("2026-01-03", 1, FIXTURE_CALENDAR)).toBe("2026-01-05");
  });
});

describe("addByUnit", () => {
  it("CALENDAR_DAY 는 주말/공휴일을 무시한다", () => {
    expect(addByUnit("2026-01-02", 3, "CALENDAR_DAY", FIXTURE_CALENDAR)).toBe("2026-01-05");
  });

  it("BUSINESS_DAY 는 영업일 기준으로 센다", () => {
    expect(addByUnit("2026-01-02", 3, "BUSINESS_DAY", FIXTURE_CALENDAR)).toBe("2026-01-07");
  });
});

describe("countBusinessDays", () => {
  it("양 끝을 포함해 영업일을 센다", () => {
    // 2026-01-05(월) ~ 01-09(금) = 5영업일
    expect(countBusinessDays("2026-01-05", "2026-01-09", FIXTURE_CALENDAR)).toBe(5);
    // 주말 포함 1주 = 여전히 5영업일
    expect(countBusinessDays("2026-01-05", "2026-01-11", FIXTURE_CALENDAR)).toBe(5);
  });

  it("공휴일을 제외한다", () => {
    // 2026-02-16 ~ 02-20: 16,17,18 은 연휴 → 19(목), 20(금) 2영업일
    expect(countBusinessDays("2026-02-16", "2026-02-20", FIXTURE_CALENDAR)).toBe(2);
  });

  it("역순 범위는 0 이다", () => {
    expect(countBusinessDays("2026-01-09", "2026-01-05", FIXTURE_CALENDAR)).toBe(0);
  });
});
