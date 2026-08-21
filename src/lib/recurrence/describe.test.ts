/**
 * 반복 규칙 → 한국어 설명 생성 테스트
 */

import { describe, expect, it } from "vitest";

import { describeConfig, describeConfigParts, describeRule } from "./describe";
import {
  recurrenceConfigSchema,
  ruleCanMissTargetDay,
  type RecurrenceConfigInput,
  type RecurrenceRule,
} from "./types";

function config(input: RecurrenceConfigInput) {
  return recurrenceConfigSchema.parse(input);
}

/** 규칙 기본값(intervalMonths 등)을 채운 뒤 규칙만 꺼낸다. */
function rule(input: Record<string, unknown>): RecurrenceRule {
  return config({ rule: input as RecurrenceRule, startDate: "2026-01-01" }).rule;
}

describe("describeRule", () => {
  it("매월 N일 / 말일", () => {
    expect(describeRule(rule({ type: "MONTHLY_DAY", day: 5 }))).toBe("매월 5일");
    expect(describeRule(rule({ type: "MONTHLY_DAY", day: "LAST" }))).toBe("매월 말일");
  });

  it("격월·N개월마다를 자연스러운 한국어로 표기한다", () => {
    expect(
      describeRule(rule({ type: "MONTHLY_DAY", day: 10, intervalMonths: 2 })),
    ).toBe("격월 10일");
    expect(
      describeRule(rule({ type: "MONTHLY_DAY", day: "LAST", intervalMonths: 3 })),
    ).toBe("3개월마다 말일");
  });

  it("매년 / 격년", () => {
    expect(describeRule(rule({ type: "YEARLY", month: 1, day: 31 }))).toBe(
      "매년 1월 31일",
    );
    expect(
      describeRule(rule({ type: "YEARLY", month: 7, day: 1, intervalYears: 2 })),
    ).toBe("2년마다 7월 1일");
  });

  it("매월 N번째 요일", () => {
    expect(
      describeRule(rule({ type: "MONTHLY_NTH_WEEKDAY", nth: 3, weekday: 2 })),
    ).toBe("매월 3번째 화요일");
    expect(
      describeRule(rule({ type: "MONTHLY_NTH_WEEKDAY", nth: -1, weekday: 5 })),
    ).toBe("매월 마지막 금요일");
  });

  it("특정 월 복수 지정은 오름차순으로 표기한다", () => {
    expect(
      describeRule(
        rule({ type: "SPECIFIC_MONTHS_DAY", months: [12, 3, 9, 6], day: 15 }),
      ),
    ).toBe("3월·6월·9월·12월 15일");
  });

  it("매분기 (기준점 + 오프셋)", () => {
    expect(
      describeRule(
        rule({
          type: "QUARTERLY",
          anchor: "END",
          offsetAmount: 10,
          offsetUnit: "BUSINESS_DAY",
        }),
      ),
    ).toBe("분기 종료 10영업일 후");

    expect(
      describeRule(rule({ type: "QUARTERLY", anchor: "START", offsetAmount: -5 })),
    ).toBe("분기 시작 5일 전");

    expect(
      describeRule(rule({ type: "QUARTERLY", anchor: "END", offsetAmount: 0 })),
    ).toBe("분기 종료 당일");
  });

  it("회계연도와 대상 분기를 함께 표기한다", () => {
    expect(
      describeRule(
        rule({
          type: "QUARTERLY",
          anchor: "START",
          offsetAmount: 0,
          fiscalYearStartMonth: 4,
          quarters: [1, 3],
        }),
      ),
    ).toBe("분기 시작 당일 (회계연도 4월 시작) [1분기·3분기만]");
  });

  it("매주 / 격주 — 요일을 월요일부터 정렬한다", () => {
    expect(describeRule(rule({ type: "WEEKLY", weekdays: [5, 1, 3] }))).toBe(
      "매주 월·수·금요일",
    );
    // 일요일은 주의 마지막에 온다
    expect(describeRule(rule({ type: "WEEKLY", weekdays: [0, 1] }))).toBe(
      "매주 월·일요일",
    );
    expect(
      describeRule(rule({ type: "WEEKLY", weekdays: [2], intervalWeeks: 2 })),
    ).toBe("격주 화요일");
  });

  it("N일마다 / 1회성", () => {
    expect(describeRule(rule({ type: "EVERY_N_DAYS", days: 10 }))).toBe("10일마다");
    expect(describeRule(rule({ type: "ONCE", date: "2026-05-20" }))).toBe(
      "1회성 (2026-05-20)",
    );
  });
});

describe("describeConfigParts", () => {
  it("공휴일 정책을 함께 표기한다", () => {
    const parts = describeConfigParts(
      config({
        rule: { type: "MONTHLY_DAY", day: "LAST" },
        startDate: "2026-01-01",
        holidayPolicy: "PREV_BUSINESS_DAY",
      }),
    );

    expect(parts[0]).toBe("매월 말일");
    expect(parts).toContain("주말 + 공휴일이면 직전 영업일로 앞당김");
  });

  it("KEEP 정책은 표기하지 않는다 (기본값이라 노이즈가 된다)", () => {
    const parts = describeConfigParts(
      config({
        rule: { type: "MONTHLY_DAY", day: 5 },
        startDate: "2026-01-01",
        holidayPolicy: "KEEP",
      }),
    );

    expect(parts).toEqual(["매월 5일"]);
  });

  it("종료 조건과 예외 개수를 표기한다", () => {
    const parts = describeConfigParts(
      config({
        rule: { type: "MONTHLY_DAY", day: 5 },
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        maxOccurrences: 12,
        exceptions: [
          { kind: "SKIP", originalDate: "2026-03-05" },
          { kind: "RESCHEDULE", originalDate: "2026-04-05", newDate: "2026-04-10" },
        ],
      }),
    );

    expect(parts).toContain("2026-12-31 까지");
    expect(parts).toContain("총 12회");
    expect(parts).toContain("건너뛴 회차 1건");
    expect(parts).toContain("날짜 변경 1건");
  });

  it("describeConfig 는 부분들을 가운뎃점으로 이어붙인다", () => {
    const text = describeConfig(
      config({
        rule: { type: "MONTHLY_DAY", day: "LAST" },
        startDate: "2026-01-01",
        holidayPolicy: "PREV_BUSINESS_DAY",
      }),
    );

    expect(text).toBe("매월 말일 · 주말 + 공휴일이면 직전 영업일로 앞당김");
  });
});

// ===========================================================================
// ruleCanMissTargetDay — "지정한 날짜가 없는 달" 안내를 언제 보여줄지
// ===========================================================================

describe("ruleCanMissTargetDay", () => {
  it("매월 29일 이상은 2월을 반드시 만나므로 해당된다", () => {
    expect(ruleCanMissTargetDay(rule({ type: "MONTHLY_DAY", day: 29 }))).toBe(true);
    expect(ruleCanMissTargetDay(rule({ type: "MONTHLY_DAY", day: 31 }))).toBe(true);
  });

  it("매월 28일 이하와 말일은 해당되지 않는다", () => {
    expect(ruleCanMissTargetDay(rule({ type: "MONTHLY_DAY", day: 28 }))).toBe(false);
    expect(ruleCanMissTargetDay(rule({ type: "MONTHLY_DAY", day: "LAST" }))).toBe(false);
  });

  it("매년 규칙은 지정한 월의 일수를 따진다", () => {
    // 3월은 항상 31일 → 해당 없음 (안내가 노이즈였던 케이스)
    expect(ruleCanMissTargetDay(rule({ type: "YEARLY", month: 3, day: 31 }))).toBe(false);
    // 4월은 30일까지 → 31일은 해당
    expect(ruleCanMissTargetDay(rule({ type: "YEARLY", month: 4, day: 31 }))).toBe(true);
    // 2월 29일은 평년에 없음 → 해당
    expect(ruleCanMissTargetDay(rule({ type: "YEARLY", month: 2, day: 29 }))).toBe(true);
    // 2월 28일은 항상 있음 → 해당 없음
    expect(ruleCanMissTargetDay(rule({ type: "YEARLY", month: 2, day: 28 }))).toBe(false);
  });

  it("특정 월 복수 지정은 하나라도 해당되면 true", () => {
    // 1·3월은 모두 31일 → 해당 없음
    expect(
      ruleCanMissTargetDay(
        rule({ type: "SPECIFIC_MONTHS_DAY", months: [1, 3], day: 31 }),
      ),
    ).toBe(false);
    // 6월(30일)이 포함되면 해당
    expect(
      ruleCanMissTargetDay(
        rule({ type: "SPECIFIC_MONTHS_DAY", months: [1, 6], day: 31 }),
      ),
    ).toBe(true);
  });

  it("N번째 요일은 5번째만 해당된다", () => {
    expect(
      ruleCanMissTargetDay(rule({ type: "MONTHLY_NTH_WEEKDAY", nth: 5, weekday: 1 })),
    ).toBe(true);
    expect(
      ruleCanMissTargetDay(rule({ type: "MONTHLY_NTH_WEEKDAY", nth: 4, weekday: 1 })),
    ).toBe(false);
    expect(
      ruleCanMissTargetDay(rule({ type: "MONTHLY_NTH_WEEKDAY", nth: -1, weekday: 1 })),
    ).toBe(false);
  });

  it("주기·일수 기반 규칙은 해당되지 않는다", () => {
    expect(ruleCanMissTargetDay(rule({ type: "WEEKLY", weekdays: [1] }))).toBe(false);
    expect(ruleCanMissTargetDay(rule({ type: "EVERY_N_DAYS", days: 10 }))).toBe(false);
    expect(ruleCanMissTargetDay(rule({ type: "ONCE", date: "2026-02-28" }))).toBe(false);
  });

  it("설명 문구에도 같은 판정이 적용된다", () => {
    // 매년 3월 31일 → 안내가 붙지 않는다
    const march = describeConfigParts(
      config({ rule: { type: "YEARLY", month: 3, day: 31 }, startDate: "2026-01-01" }),
    );
    expect(march.some((part) => part.includes("해당 날짜가 없는 달"))).toBe(false);

    // 매년 2월 29일 → 안내가 붙는다
    const february = describeConfigParts(
      config({ rule: { type: "YEARLY", month: 2, day: 29 }, startDate: "2026-01-01" }),
    );
    expect(february.some((part) => part.includes("해당 날짜가 없는 달"))).toBe(true);
  });
});
