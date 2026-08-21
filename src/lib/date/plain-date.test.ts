/**
 * PlainDate 순수 함수 테스트
 *
 * 이 테스트는 `vitest.config.ts` 에서 TZ=America/Los_Angeles 로 강제된 상태로
 * 실행된다. KST 와 17시간 차이가 나는 환경에서도 모든 결과가 동일해야 한다.
 * (로컬 타임존이 계산에 새어 들어가면 여기서 즉시 실패한다)
 */

import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  addYears,
  comparePlainDate,
  diffInDays,
  endOfMonth,
  formatCompact,
  formatKoreanFull,
  getCalendarQuarter,
  getDayOfMonth,
  getMonth,
  getWeekday,
  getYear,
  isValidPlainDate,
  isWithin,
  lastDayOfMonthNumber,
  maxDate,
  minDate,
  nthWeekdayOfMonth,
  plainDateOf,
  startOfMonth,
  startOfWeekMonday,
  toDbDate,
  toPlainDate,
} from "./plain-date";

describe("환경 독립성 확인", () => {
  it("테스트 프로세스가 KST 가 아닌 타임존에서 실행된다", () => {
    // 이 전제가 깨지면 타임존 안전성 검증이 무의미해진다.
    expect(new Date().getTimezoneOffset()).not.toBe(-540); // -540 = KST
  });
});

describe("isValidPlainDate", () => {
  it("올바른 날짜를 허용한다", () => {
    expect(isValidPlainDate("2026-03-05")).toBe(true);
    expect(isValidPlainDate("2024-02-29")).toBe(true); // 윤년
    expect(isValidPlainDate("2026-12-31")).toBe(true);
  });

  it("실재하지 않는 날짜를 거부한다", () => {
    expect(isValidPlainDate("2026-02-30")).toBe(false);
    expect(isValidPlainDate("2025-02-29")).toBe(false); // 평년
    expect(isValidPlainDate("2026-04-31")).toBe(false);
    expect(isValidPlainDate("2026-13-01")).toBe(false);
    expect(isValidPlainDate("2026-00-10")).toBe(false);
  });

  it("형식이 다른 값을 거부한다", () => {
    expect(isValidPlainDate("2026-3-5")).toBe(false);
    expect(isValidPlainDate("2026/03/05")).toBe(false);
    expect(isValidPlainDate("20260305")).toBe(false);
    expect(isValidPlainDate("")).toBe(false);
    expect(isValidPlainDate(null)).toBe(false);
    expect(isValidPlainDate(20260305)).toBe(false);
  });
});

describe("변환", () => {
  it("plainDateOf 는 월을 1~12 로 받는다", () => {
    expect(plainDateOf(2026, 1, 5)).toBe("2026-01-05");
    expect(plainDateOf(2026, 12, 31)).toBe("2026-12-31");
  });

  it("toDbDate 는 UTC 자정 Date 를 만든다", () => {
    const dbDate = toDbDate("2026-03-05");
    expect(dbDate.toISOString()).toBe("2026-03-05T00:00:00.000Z");
  });

  it("toDbDate → toPlainDate 왕복 시 날짜가 보존된다", () => {
    // 로컬 타임존이 UTC-8 이어도 하루가 밀리지 않아야 한다.
    for (const date of ["2026-01-01", "2026-03-05", "2026-12-31", "2024-02-29"]) {
      expect(toPlainDate(toDbDate(date))).toBe(date);
    }
  });
});

describe("구성 요소 추출", () => {
  it("연/월/일을 문자열에서 직접 읽는다", () => {
    expect(getYear("2026-03-05")).toBe(2026);
    expect(getMonth("2026-03-05")).toBe(3);
    expect(getDayOfMonth("2026-03-05")).toBe(5);
  });

  it("요일을 정확히 계산한다 (0=일 ~ 6=토)", () => {
    expect(getWeekday("2026-01-01")).toBe(4); // 목요일
    expect(getWeekday("2026-01-03")).toBe(6); // 토요일
    expect(getWeekday("2026-01-04")).toBe(0); // 일요일
    expect(getWeekday("2026-03-31")).toBe(2); // 화요일
  });

  it("역년 기준 분기를 계산한다", () => {
    expect(getCalendarQuarter("2026-01-01")).toBe(1);
    expect(getCalendarQuarter("2026-03-31")).toBe(1);
    expect(getCalendarQuarter("2026-04-01")).toBe(2);
    expect(getCalendarQuarter("2026-12-31")).toBe(4);
  });
});

describe("산술", () => {
  it("addDays 는 월/연 경계를 넘는다", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("addDays 는 윤년 2월을 정확히 처리한다", () => {
    expect(addDays("2024-02-28", 1)).toBe("2024-02-29");
    expect(addDays("2024-02-29", 1)).toBe("2024-03-01");
    expect(addDays("2025-02-28", 1)).toBe("2025-03-01");
  });

  it("addMonths 는 존재하지 않는 일자를 말일로 절삭한다", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29"); // 윤년
    expect(addMonths("2026-03-31", 1)).toBe("2026-04-30");
    expect(addMonths("2026-01-15", 1)).toBe("2026-02-15");
  });

  it("addYears 는 2/29 를 평년의 2/28 로 절삭한다", () => {
    expect(addYears("2024-02-29", 1)).toBe("2025-02-28");
    expect(addYears("2024-02-29", 4)).toBe("2028-02-29");
  });

  it("diffInDays 는 부호 있는 일수 차이를 준다", () => {
    expect(diffInDays("2026-03-05", "2026-03-01")).toBe(4);
    expect(diffInDays("2026-03-01", "2026-03-05")).toBe(-4);
    expect(diffInDays("2026-03-01", "2026-03-01")).toBe(0);
    // 윤년을 포함한 1년
    expect(diffInDays("2025-01-01", "2024-01-01")).toBe(366);
  });
});

describe("월 경계", () => {
  it("startOfMonth / endOfMonth", () => {
    expect(startOfMonth("2026-03-15")).toBe("2026-03-01");
    expect(endOfMonth("2026-03-15")).toBe("2026-03-31");
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28");
    expect(endOfMonth("2024-02-10")).toBe("2024-02-29"); // 윤년
    expect(endOfMonth("2026-04-10")).toBe("2026-04-30");
  });

  it("lastDayOfMonthNumber 는 윤년 규칙을 따른다", () => {
    expect(lastDayOfMonthNumber(2026, 2)).toBe(28);
    expect(lastDayOfMonthNumber(2024, 2)).toBe(29); // 4로 나뉨
    expect(lastDayOfMonthNumber(2000, 2)).toBe(29); // 400으로 나뉨 → 윤년
    expect(lastDayOfMonthNumber(1900, 2)).toBe(28); // 100으로 나뉘지만 400은 아님 → 평년
    expect(lastDayOfMonthNumber(2026, 4)).toBe(30);
    expect(lastDayOfMonthNumber(2026, 12)).toBe(31);
  });
});

describe("주 경계 (월요일 시작)", () => {
  it("주중 어느 날이든 그 주 월요일을 반환한다", () => {
    // 2026-03-05 는 목요일 → 그 주 월요일은 2026-03-02
    expect(startOfWeekMonday("2026-03-05")).toBe("2026-03-02");
    expect(startOfWeekMonday("2026-03-02")).toBe("2026-03-02");
  });

  it("일요일은 그 주(직전 월요일)에 속한다", () => {
    // 2026-03-08 은 일요일 → 2026-03-02
    expect(getWeekday("2026-03-08")).toBe(0);
    expect(startOfWeekMonday("2026-03-08")).toBe("2026-03-02");
  });
});

describe("nthWeekdayOfMonth (N번째 요일)", () => {
  it("매월 셋째 주 화요일을 계산한다", () => {
    // 2026-01: 1일이 목요일 → 첫 화요일 1/6, 셋째 화요일 1/20
    expect(nthWeekdayOfMonth(2026, 1, 3, 2)).toBe("2026-01-20");
    // 2026-02: 1일이 일요일 → 첫 화요일 2/3, 셋째 화요일 2/17
    expect(nthWeekdayOfMonth(2026, 2, 3, 2)).toBe("2026-02-17");
    // 2026-03: 1일이 일요일 → 셋째 화요일 3/17
    expect(nthWeekdayOfMonth(2026, 3, 3, 2)).toBe("2026-03-17");
  });

  it("해당 요일이 1일인 달에서 첫째 주를 정확히 잡는다", () => {
    // 2026-02-01 은 일요일 → 첫째 주 일요일은 2/1 그 자체
    expect(nthWeekdayOfMonth(2026, 2, 1, 0)).toBe("2026-02-01");
  });

  it("nth = -1 은 그 달의 마지막 해당 요일이다", () => {
    // 2026-01-31 은 토요일 → 마지막 금요일은 1/30
    expect(nthWeekdayOfMonth(2026, 1, -1, 5)).toBe("2026-01-30");
    // 마지막 토요일은 1/31
    expect(nthWeekdayOfMonth(2026, 1, -1, 6)).toBe("2026-01-31");
    // 2026-02 마지막 날은 28일(토) → 마지막 토요일 2/28
    expect(nthWeekdayOfMonth(2026, 2, -1, 6)).toBe("2026-02-28");
  });

  it("5번째 요일이 없는 달에는 null 을 반환한다", () => {
    // 2026-02 는 1일이 일요일이고 28일뿐 → 정확히 4주. 5번째 요일은 존재하지 않는다.
    expect(nthWeekdayOfMonth(2026, 2, 5, 0)).toBeNull();
    expect(nthWeekdayOfMonth(2026, 2, 5, 6)).toBeNull();
  });

  it("5번째 요일이 있는 달에는 값을 반환한다", () => {
    // 2026-01: 1일 목요일. 목요일은 1,8,15,22,29 → 5번째 목요일 존재
    expect(nthWeekdayOfMonth(2026, 1, 5, 4)).toBe("2026-01-29");
    // 금요일은 2,9,16,23,30 → 5번째 존재
    expect(nthWeekdayOfMonth(2026, 1, 5, 5)).toBe("2026-01-30");
    // 월요일은 5,12,19,26 → 4개뿐
    expect(nthWeekdayOfMonth(2026, 1, 5, 1)).toBeNull();
  });

  it("윤년 2월의 5번째 요일을 처리한다", () => {
    // 2024-02 는 29일, 1일이 목요일 → 목요일 1,8,15,22,29 → 5번째 목요일 2/29
    expect(getWeekday("2024-02-01")).toBe(4);
    expect(nthWeekdayOfMonth(2024, 2, 5, 4)).toBe("2024-02-29");
  });

  it("범위를 벗어난 nth 는 null 이다", () => {
    expect(nthWeekdayOfMonth(2026, 1, 0, 1)).toBeNull();
    expect(nthWeekdayOfMonth(2026, 1, 6, 1)).toBeNull();
  });
});

describe("비교", () => {
  it("문자열 비교로 시간순 정렬이 성립한다", () => {
    const dates = ["2026-12-01", "2026-01-05", "2025-12-31", "2026-01-15"];
    expect([...dates].sort(comparePlainDate)).toEqual([
      "2025-12-31",
      "2026-01-05",
      "2026-01-15",
      "2026-12-01",
    ]);
  });

  it("isWithin 은 양 끝을 포함한다", () => {
    expect(isWithin("2026-01-01", "2026-01-01", "2026-12-31")).toBe(true);
    expect(isWithin("2026-12-31", "2026-01-01", "2026-12-31")).toBe(true);
    expect(isWithin("2025-12-31", "2026-01-01", "2026-12-31")).toBe(false);
  });

  it("minDate / maxDate", () => {
    expect(minDate("2026-03-05", "2026-01-01")).toBe("2026-01-01");
    expect(maxDate("2026-03-05", "2026-01-01")).toBe("2026-03-05");
  });
});

describe("표시용 포맷", () => {
  it("한국어 전체 형식", () => {
    expect(formatKoreanFull("2026-03-05")).toBe("2026년 3월 5일 (목)");
    expect(formatKoreanFull("2026-01-01")).toBe("2026년 1월 1일 (목)");
  });

  it("컴팩트 형식", () => {
    expect(formatCompact("2026-03-05")).toBe("03.05");
  });
});
