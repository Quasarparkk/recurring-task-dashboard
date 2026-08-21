/**
 * 반복 규칙 스키마
 * ============================================================================
 *
 * [왜 RRULE 문자열이 아닌 자체 JSON 스키마인가]
 *
 * RFC 5545 의 RRULE 은 캘린더 이벤트 반복을 위한 표준이지만, 이 프로젝트의
 * 요구사항 중 상당 부분을 표현할 표준 필드가 없다:
 *
 *   - "분기 종료 후 10영업일"      → 영업일 개념 자체가 RRULE 에 없다
 *   - "마감일이 공휴일이면 앞당김"  → 대체 규칙을 표현할 필드가 없다
 *   - "회계연도 시작월이 4월인 분기" → BYMONTH 조합으로 우회해야 함
 *   - "특정 회차만 날짜 변경"       → RDATE/EXDATE 로 가능하지만 원본 회차와의
 *                                    대응 관계가 소실된다
 *
 * RRULE 로 억지로 표현하면 `FREQ=MONTHLY;BYDAY=3TU` 같은 문자열을 파싱·역파싱하는
 * 계층이 추가로 필요하고, 위 항목들은 결국 별도 필드로 빼야 한다. 즉 표준을
 * 따르는 이득 없이 복잡도만 늘어난다.
 *
 * 그래서 `type` 을 판별자로 갖는 **판별 유니온(discriminated union)** 을 정의하고
 * JSON 으로 직렬화해 저장한다. 이 방식의 이점:
 *
 *   1. UI 폼의 각 입력 항목이 스키마 필드와 1:1 로 대응 → 미리보기 구현이 단순
 *   2. TypeScript 가 `type` 에 따라 필드를 좁혀줌 → 계산 로직에서 실수 방지
 *   3. zod 로 런타임 검증 → 잘못된 JSON 이 DB 에 들어가지 않음
 *
 * 외부 캘린더(Google/Outlook) 연동이 필요해지면 이 스키마 → RRULE 변환기를
 * 단방향 어댑터로 추가하면 된다. (대부분의 규칙은 손실 없이 변환 가능)
 */

import { z } from "zod";

import { isValidPlainDate, type PlainDate, type Weekday } from "../date/plain-date";

// ---------------------------------------------------------------------------
// 기본 스칼라
// ---------------------------------------------------------------------------

export const plainDateSchema = z
  .string()
  .refine(isValidPlainDate, { message: "YYYY-MM-DD 형식의 실재하는 날짜여야 합니다." });

/** 0=일 ~ 6=토 */
export const weekdaySchema = z
  .number()
  .int()
  .min(0, "요일은 0(일)~6(토) 사이여야 합니다.")
  .max(6, "요일은 0(일)~6(토) 사이여야 합니다.");

/** 1~12 */
export const monthSchema = z
  .number()
  .int()
  .min(1, "월은 1~12 사이여야 합니다.")
  .max(12, "월은 1~12 사이여야 합니다.");

/**
 * 날짜 지정. 숫자(1~31) 또는 `"LAST"`(말일).
 * "매월 31일"처럼 존재하지 않는 달이 생기는 경우의 처리는
 * `RecurrenceConfig.onMissingDay` 로 제어한다.
 */
export const dayOfMonthSchema = z.union([
  z.number().int().min(1, "일은 1~31 사이여야 합니다.").max(31, "일은 1~31 사이여야 합니다."),
  z.literal("LAST"),
]);

export type DayOfMonth = number | "LAST";

/** N번째 요일 지정. 1~5번째 또는 -1(마지막). */
export const nthSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(-1),
]);

export type Nth = 1 | 2 | 3 | 4 | 5 | -1;

// ---------------------------------------------------------------------------
// 반복 규칙 (판별 유니온)
// ---------------------------------------------------------------------------

/** 1회성. 반복하지 않는 단발 업무. */
export const onceRuleSchema = z.object({
  type: z.literal("ONCE"),
  date: plainDateSchema,
});

/** 매년 특정 월/일. 예: 매년 1월 31일, 매년 12월 말일 */
export const yearlyRuleSchema = z.object({
  type: z.literal("YEARLY"),
  month: monthSchema,
  day: dayOfMonthSchema,
  /** N년마다. 1 = 매년, 2 = 격년 */
  intervalYears: z.number().int().min(1).max(10).default(1),
});

/** 매월 N일 또는 말일. 예: 매월 5일, 매월 말일, 격월 10일 */
export const monthlyDayRuleSchema = z.object({
  type: z.literal("MONTHLY_DAY"),
  day: dayOfMonthSchema,
  /** N개월마다. 1 = 매월, 2 = 격월, 3 = 3개월마다 */
  intervalMonths: z.number().int().min(1).max(24).default(1),
});

/** 매월 N번째 요일. 예: 매월 셋째 주 화요일, 매월 마지막 금요일 */
export const monthlyNthWeekdayRuleSchema = z.object({
  type: z.literal("MONTHLY_NTH_WEEKDAY"),
  nth: nthSchema,
  weekday: weekdaySchema,
  intervalMonths: z.number().int().min(1).max(24).default(1),
});

/** 특정 월 복수 지정 + N일. 예: 3·6·9·12월 15일 */
export const specificMonthsDayRuleSchema = z.object({
  type: z.literal("SPECIFIC_MONTHS_DAY"),
  months: z.array(monthSchema).min(1, "월을 최소 1개 선택해야 합니다."),
  day: dayOfMonthSchema,
});

/** 특정 월 복수 지정 + N번째 요일. 예: 3·9월 첫째 주 월요일 */
export const specificMonthsNthWeekdayRuleSchema = z.object({
  type: z.literal("SPECIFIC_MONTHS_NTH_WEEKDAY"),
  months: z.array(monthSchema).min(1, "월을 최소 1개 선택해야 합니다."),
  nth: nthSchema,
  weekday: weekdaySchema,
});

/**
 * 매분기. 분기 시작일 또는 종료일을 기준점으로 삼고 오프셋을 더한다.
 * 예: 분기 종료 후 10영업일 → { anchor: "END", offsetAmount: 10, offsetUnit: "BUSINESS_DAY" }
 *     분기 시작 5일 후      → { anchor: "START", offsetAmount: 5, offsetUnit: "CALENDAR_DAY" }
 */
export const quarterlyRuleSchema = z.object({
  type: z.literal("QUARTERLY"),
  anchor: z.enum(["START", "END"]),
  /** 기준점에서 더할 일수. 음수면 기준점 이전. */
  offsetAmount: z.number().int().min(-90).max(90).default(0),
  offsetUnit: z.enum(["CALENDAR_DAY", "BUSINESS_DAY"]).default("CALENDAR_DAY"),
  /**
   * 회계연도 시작 월(1~12). 기본 1 = 역년 기준 분기(1·4·7·10월 시작).
   * 4 로 설정하면 4·7·10·1월이 각 분기 시작이 된다.
   */
  fiscalYearStartMonth: monthSchema.default(1),
  /** 특정 분기만 대상으로 할 경우 지정. 예: [1, 3] = 1·3분기만. 비우면 전 분기. */
  quarters: z.array(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])).default([]),
});

/** 매주 / 격주 / N주마다. 요일 복수 선택 가능. */
export const weeklyRuleSchema = z.object({
  type: z.literal("WEEKLY"),
  weekdays: z.array(weekdaySchema).min(1, "요일을 최소 1개 선택해야 합니다."),
  /** N주마다. 1 = 매주, 2 = 격주 */
  intervalWeeks: z.number().int().min(1).max(52).default(1),
});

/** N일마다. 시작일을 기준으로 일정 간격 반복. */
export const everyNDaysRuleSchema = z.object({
  type: z.literal("EVERY_N_DAYS"),
  days: z.number().int().min(1, "간격은 1일 이상이어야 합니다.").max(3650),
});

export const recurrenceRuleSchema = z.discriminatedUnion("type", [
  onceRuleSchema,
  yearlyRuleSchema,
  monthlyDayRuleSchema,
  monthlyNthWeekdayRuleSchema,
  specificMonthsDayRuleSchema,
  specificMonthsNthWeekdayRuleSchema,
  quarterlyRuleSchema,
  weeklyRuleSchema,
  everyNDaysRuleSchema,
]);

export type RecurrenceRule = z.infer<typeof recurrenceRuleSchema>;
export type RecurrenceRuleType = RecurrenceRule["type"];

/** 규칙 종류의 한국어 라벨. UI 셀렉트 박스에 사용. */
export const RECURRENCE_TYPE_LABELS: Record<RecurrenceRuleType, string> = {
  ONCE: "1회성",
  YEARLY: "매년 (특정 월/일)",
  MONTHLY_DAY: "매월 (N일 / 말일)",
  MONTHLY_NTH_WEEKDAY: "매월 (N번째 요일)",
  SPECIFIC_MONTHS_DAY: "특정 월 복수 지정 (N일)",
  SPECIFIC_MONTHS_NTH_WEEKDAY: "특정 월 복수 지정 (N번째 요일)",
  QUARTERLY: "매분기 (시작/종료 기준 오프셋)",
  WEEKLY: "매주 / 격주 / N주마다",
  EVERY_N_DAYS: "N일마다",
};

// ---------------------------------------------------------------------------
// 1회성 예외
// ---------------------------------------------------------------------------

/**
 * 예외는 **원본 계산일(originalDate)** 을 키로 삼는다.
 *
 * 회차 번호(sequenceIndex)를 키로 쓰면 반복 규칙을 수정했을 때 번호의 의미가
 * 어긋나 엉뚱한 회차에 예외가 적용된다. 원본 날짜를 키로 쓰면
 * 규칙 변경으로 그 날짜가 더는 생성되지 않을 경우 예외가 그냥 무효화되므로
 * (= 조용히 잘못 적용되는 대신 아무 일도 일어나지 않음) 안전하다.
 */
export const skipExceptionSchema = z.object({
  kind: z.literal("SKIP"),
  originalDate: plainDateSchema,
  reason: z.string().max(200).optional(),
});

export const rescheduleExceptionSchema = z.object({
  kind: z.literal("RESCHEDULE"),
  originalDate: plainDateSchema,
  /** 변경된 마감일. 이 날짜에는 공휴일 보정을 적용하지 않는다(사용자가 명시했으므로). */
  newDate: plainDateSchema,
  reason: z.string().max(200).optional(),
});

export const recurrenceExceptionSchema = z.discriminatedUnion("kind", [
  skipExceptionSchema,
  rescheduleExceptionSchema,
]);

export type RecurrenceException = z.infer<typeof recurrenceExceptionSchema>;

// ---------------------------------------------------------------------------
// 공휴일 정책
// ---------------------------------------------------------------------------

/**
 * 마감일이 주말/공휴일에 걸렸을 때의 처리.
 *   KEEP              : 그대로 유지
 *   PREV_BUSINESS_DAY : 직전 영업일로 앞당김 (마감 성격의 업무에 적합)
 *   NEXT_BUSINESS_DAY : 다음 영업일로 미룸  (착수 성격의 업무에 적합)
 */
export const holidayPolicySchema = z.enum([
  "KEEP",
  "PREV_BUSINESS_DAY",
  "NEXT_BUSINESS_DAY",
]);

export type HolidayPolicy = z.infer<typeof holidayPolicySchema>;

export const HOLIDAY_POLICY_LABELS: Record<HolidayPolicy, string> = {
  KEEP: "그대로 유지",
  PREV_BUSINESS_DAY: "직전 영업일로 앞당김",
  NEXT_BUSINESS_DAY: "다음 영업일로 미룸",
};

export const shiftTargetSchema = z.enum([
  "WEEKEND_AND_HOLIDAY",
  "WEEKEND_ONLY",
  "HOLIDAY_ONLY",
]);

export const SHIFT_TARGET_LABELS = {
  WEEKEND_AND_HOLIDAY: "주말 + 공휴일",
  WEEKEND_ONLY: "주말만",
  HOLIDAY_ONLY: "공휴일만",
} as const;

/**
 * 지정한 날짜가 그 달에 없을 때의 처리. 예: "매월 31일" 의 2월.
 *   CLAMP : 그 달의 말일로 당김 (기본. 대부분의 마감 업무에 자연스럽다)
 *   SKIP  : 그 달은 건너뜀
 */
export const onMissingDaySchema = z.enum(["CLAMP", "SKIP"]);

export const ON_MISSING_DAY_LABELS = {
  CLAMP: "그 달의 말일로 당김",
  SKIP: "그 달은 건너뜀",
} as const;

// ---------------------------------------------------------------------------
// 반복 설정 전체
// ---------------------------------------------------------------------------

export const recurrenceConfigSchema = z.object({
  rule: recurrenceRuleSchema,

  /** 반복 시작일. 이 날짜 이전의 회차는 생성되지 않는다. */
  startDate: plainDateSchema,

  /** 반복 종료일. null 이면 무한 반복. */
  endDate: plainDateSchema.nullable().default(null),

  /** 총 반복 횟수 제한. null 이면 제한 없음. */
  maxOccurrences: z.number().int().min(1).max(10_000).nullable().default(null),

  holidayPolicy: holidayPolicySchema.default("KEEP"),
  shiftTarget: shiftTargetSchema.default("WEEKEND_AND_HOLIDAY"),
  onMissingDay: onMissingDaySchema.default("CLAMP"),

  exceptions: z.array(recurrenceExceptionSchema).default([]),

  /**
   * 이 업무의 Occurrence 를 몇 개월 앞까지 미리 생성해 둘지.
   * null 이면 전역 설정(AppSetting."rollingWindowMonths", 기본 18)을 따른다.
   */
  rollingWindowMonths: z.number().int().min(1).max(120).nullable().default(null),
});

export type RecurrenceConfig = z.infer<typeof recurrenceConfigSchema>;

/** 스키마 기본값이 모두 채워지기 전의 입력 형태(폼 → 서버 전송용). */
export type RecurrenceConfigInput = z.input<typeof recurrenceConfigSchema>;

// ---------------------------------------------------------------------------
// 직렬화 / 역직렬화
// ---------------------------------------------------------------------------

/**
 * DB 의 `Task.recurrenceConfig` 문자열을 파싱하고 검증한다.
 * 검증 실패 시 예외를 던진다 — 잘못된 규칙으로 일정을 계산하는 것보다
 * 명확히 실패하는 편이 안전하다.
 */
export function parseRecurrenceConfig(raw: string): RecurrenceConfig {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error("반복 규칙 JSON 을 파싱할 수 없습니다.");
  }
  return recurrenceConfigSchema.parse(json);
}

/** 파싱 실패를 예외 대신 결과로 받고 싶을 때. */
export function safeParseRecurrenceConfig(
  raw: string,
): { ok: true; config: RecurrenceConfig } | { ok: false; error: string } {
  try {
    return { ok: true, config: parseRecurrenceConfig(raw) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function serializeRecurrenceConfig(config: RecurrenceConfig): string {
  return JSON.stringify(config);
}

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

/** 규칙이 단 한 번만 발생하는지 여부. UI 에서 종료 조건 입력을 숨기는 데 사용. */
export function isSingleOccurrenceRule(rule: RecurrenceRule): boolean {
  return rule.type === "ONCE";
}

/** 해당 월이 가질 수 있는 **최소** 일수. 2월은 평년 기준 28일. */
function minDaysInMonth(month: number): number {
  if (month === 2) return 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

/**
 * 이 규칙에서 "지정한 날짜가 없는 달"이 실제로 발생할 수 있는지 판정한다.
 *
 * `onMissingDay` 옵션과 그 안내 문구를 보여줄지 결정하는 데 쓴다.
 * 예: "매년 3월 31일"은 3월이 항상 31일이므로 해당 없음 → 옵션을 숨긴다.
 *     "매년 2월 29일"은 평년에 없으므로 해당 → 옵션을 보여준다.
 */
export function ruleCanMissTargetDay(rule: RecurrenceRule): boolean {
  switch (rule.type) {
    case "MONTHLY_DAY":
      // 매월 반복이면 2월(28일)을 반드시 만나므로 29일 이상은 모두 해당된다.
      return rule.day !== "LAST" && rule.day >= 29;

    case "YEARLY":
      return rule.day !== "LAST" && rule.day > minDaysInMonth(rule.month);

    case "SPECIFIC_MONTHS_DAY":
      return (
        rule.day !== "LAST" &&
        rule.months.some((month) => (rule.day as number) > minDaysInMonth(month))
      );

    case "MONTHLY_NTH_WEEKDAY":
    case "SPECIFIC_MONTHS_NTH_WEEKDAY":
      // 5번째 요일은 없는 달이 존재한다. 1~4번째와 마지막은 항상 존재한다.
      return rule.nth === 5;

    default:
      return false;
  }
}

/** 폼 초기값으로 쓸 기본 설정. */
export function createDefaultRecurrenceConfig(startDate: PlainDate): RecurrenceConfig {
  return recurrenceConfigSchema.parse({
    rule: { type: "MONTHLY_DAY", day: 1, intervalMonths: 1 },
    startDate,
  });
}

/** 규칙 종류별 기본 파라미터. UI 에서 종류를 바꿀 때 사용. */
export function createDefaultRule(
  type: RecurrenceRuleType,
  referenceDate: PlainDate,
): RecurrenceRule {
  const [year, month, day] = referenceDate.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay() as Weekday;

  switch (type) {
    case "ONCE":
      return { type: "ONCE", date: referenceDate };
    case "YEARLY":
      return { type: "YEARLY", month, day, intervalYears: 1 };
    case "MONTHLY_DAY":
      return { type: "MONTHLY_DAY", day, intervalMonths: 1 };
    case "MONTHLY_NTH_WEEKDAY":
      return {
        type: "MONTHLY_NTH_WEEKDAY",
        nth: Math.min(Math.ceil(day / 7), 5) as Nth,
        weekday,
        intervalMonths: 1,
      };
    case "SPECIFIC_MONTHS_DAY":
      return { type: "SPECIFIC_MONTHS_DAY", months: [3, 6, 9, 12], day };
    case "SPECIFIC_MONTHS_NTH_WEEKDAY":
      return {
        type: "SPECIFIC_MONTHS_NTH_WEEKDAY",
        months: [3, 6, 9, 12],
        nth: 1,
        weekday,
      };
    case "QUARTERLY":
      return {
        type: "QUARTERLY",
        anchor: "END",
        offsetAmount: 10,
        offsetUnit: "BUSINESS_DAY",
        fiscalYearStartMonth: 1,
        quarters: [],
      };
    case "WEEKLY":
      return { type: "WEEKLY", weekdays: [weekday], intervalWeeks: 1 };
    case "EVERY_N_DAYS":
      return { type: "EVERY_N_DAYS", days: 14 };
  }
}
