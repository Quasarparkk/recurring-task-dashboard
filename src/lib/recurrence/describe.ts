/**
 * 반복 규칙 → 한국어 설명 문장 생성
 * ============================================================================
 *
 * 목록·상세·폼 미리보기에서 규칙을 사람이 읽을 수 있게 보여준다.
 * 순수 함수이며 UI 프레임워크에 의존하지 않는다.
 */

import { WEEKDAY_LABELS_KO, type Weekday } from "../date/plain-date";
import {
  HOLIDAY_POLICY_LABELS,
  ON_MISSING_DAY_LABELS,
  ruleCanMissTargetDay,
  SHIFT_TARGET_LABELS,
  type DayOfMonth,
  type Nth,
  type RecurrenceConfig,
  type RecurrenceRule,
} from "./types";

function weekdayLabel(weekday: number): string {
  return `${WEEKDAY_LABELS_KO[weekday as Weekday]}요일`;
}

function weekdayListLabel(weekdays: readonly number[]): string {
  // 월요일 시작 순서로 정렬해 자연스럽게 읽히게 한다.
  return [...new Set(weekdays)]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((w) => WEEKDAY_LABELS_KO[w as Weekday])
    .join("·");
}

function dayLabel(day: DayOfMonth): string {
  return day === "LAST" ? "말일" : `${day}일`;
}

function nthLabel(nth: Nth): string {
  return nth === -1 ? "마지막" : `${nth}번째`;
}

function monthListLabel(months: readonly number[]): string {
  return [...new Set(months)]
    .sort((a, b) => a - b)
    .map((m) => `${m}월`)
    .join("·");
}

function offsetLabel(amount: number, unit: "CALENDAR_DAY" | "BUSINESS_DAY"): string {
  const unitLabel = unit === "BUSINESS_DAY" ? "영업일" : "일";
  if (amount === 0) return "당일";
  if (amount > 0) return `${amount}${unitLabel} 후`;
  return `${Math.abs(amount)}${unitLabel} 전`;
}

/**
 * 반복 규칙 한 줄 설명.
 * 예: "매월 5일", "매월 셋째 주 화요일", "분기 종료 후 10영업일"
 */
export function describeRule(rule: RecurrenceRule): string {
  switch (rule.type) {
    case "ONCE":
      return `1회성 (${rule.date})`;

    case "YEARLY": {
      const cycle = rule.intervalYears === 1 ? "매년" : `${rule.intervalYears}년마다`;
      return `${cycle} ${rule.month}월 ${dayLabel(rule.day)}`;
    }

    case "MONTHLY_DAY": {
      const cycle =
        rule.intervalMonths === 1
          ? "매월"
          : rule.intervalMonths === 2
            ? "격월"
            : `${rule.intervalMonths}개월마다`;
      return `${cycle} ${dayLabel(rule.day)}`;
    }

    case "MONTHLY_NTH_WEEKDAY": {
      const cycle =
        rule.intervalMonths === 1
          ? "매월"
          : rule.intervalMonths === 2
            ? "격월"
            : `${rule.intervalMonths}개월마다`;
      return `${cycle} ${nthLabel(rule.nth)} ${weekdayLabel(rule.weekday)}`;
    }

    case "SPECIFIC_MONTHS_DAY":
      return `${monthListLabel(rule.months)} ${dayLabel(rule.day)}`;

    case "SPECIFIC_MONTHS_NTH_WEEKDAY":
      return `${monthListLabel(rule.months)} ${nthLabel(rule.nth)} ${weekdayLabel(rule.weekday)}`;

    case "QUARTERLY": {
      const anchor = rule.anchor === "START" ? "분기 시작" : "분기 종료";
      const offset = offsetLabel(rule.offsetAmount, rule.offsetUnit);
      const fiscal =
        rule.fiscalYearStartMonth === 1 ? "" : ` (회계연도 ${rule.fiscalYearStartMonth}월 시작)`;
      const quarters =
        rule.quarters.length === 0
          ? ""
          : ` [${rule.quarters.map((q) => `${q}분기`).join("·")}만]`;
      return `${anchor} ${offset}${fiscal}${quarters}`;
    }

    case "WEEKLY": {
      const cycle =
        rule.intervalWeeks === 1
          ? "매주"
          : rule.intervalWeeks === 2
            ? "격주"
            : `${rule.intervalWeeks}주마다`;
      return `${cycle} ${weekdayListLabel(rule.weekdays)}요일`;
    }

    case "EVERY_N_DAYS":
      return `${rule.days}일마다`;
  }
}

/**
 * 규칙 + 부가 정책을 포함한 상세 설명 조각들.
 * UI 에서 배지나 목록으로 나눠 표시할 수 있게 배열로 반환한다.
 */
export function describeConfigParts(config: RecurrenceConfig): string[] {
  const parts: string[] = [describeRule(config.rule)];

  // 공휴일 정책
  if (config.holidayPolicy !== "KEEP") {
    const target = SHIFT_TARGET_LABELS[config.shiftTarget];
    parts.push(`${target}이면 ${HOLIDAY_POLICY_LABELS[config.holidayPolicy]}`);
  }

  // 존재하지 않는 날짜 처리 — 실제로 그런 달이 생길 수 있는 규칙에만 표시한다.
  // (예: "매년 3월 31일"은 3월이 항상 31일이므로 이 안내가 노이즈다)
  if (ruleCanMissTargetDay(config.rule)) {
    parts.push(`해당 날짜가 없는 달은 ${ON_MISSING_DAY_LABELS[config.onMissingDay]}`);
  }

  // 기간 / 횟수 제한
  if (config.endDate) parts.push(`${config.endDate} 까지`);
  if (config.maxOccurrences !== null) parts.push(`총 ${config.maxOccurrences}회`);

  // 예외
  const skipCount = config.exceptions.filter((e) => e.kind === "SKIP").length;
  const rescheduleCount = config.exceptions.filter((e) => e.kind === "RESCHEDULE").length;
  if (skipCount > 0) parts.push(`건너뛴 회차 ${skipCount}건`);
  if (rescheduleCount > 0) parts.push(`날짜 변경 ${rescheduleCount}건`);

  return parts;
}

/** 한 문장으로 합친 설명. 예: "매월 말일 · 주말 + 공휴일이면 직전 영업일로 앞당김" */
export function describeConfig(config: RecurrenceConfig): string {
  return describeConfigParts(config).join(" · ");
}
