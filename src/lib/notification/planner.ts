/**
 * 알림 발송 계획 계산 (순수 함수)
 * ============================================================================
 *
 * [설계: 사전 materialize 대신 매 틱 계산]
 *
 * 발송할 알림을 미리 테이블에 만들어 두지 않는다. 스케줄러가 매 틱마다
 * "미완료 회차 × 알림 규칙"으로 발송 예정 시각을 계산하고,
 * NotificationLog 의 dedupeKey 유니크 제약으로 중복 발송을 막는다.
 *
 * 이 방식의 이점:
 *   1. **서버 재시작 후 누락 없는 재개가 구조적으로 보장된다.**
 *      놓친 알림은 다음 틱에 "예정 시각이 지났고 로그에 없는 알림"으로
 *      자동 발견된다. 별도의 복구 로직이 필요 없다.
 *   2. 알림 규칙이나 마감일이 수정되어도 materialize 된 레코드를
 *      재생성/정리할 필요가 없다. (이 재생성 로직이 실무 버그의 주된 원천이다)
 *
 * 이 모듈은 순수 함수이므로 `now` 를 주입해 모든 경계 조건을 테스트할 수 있다.
 */

import {
  addBusinessDays,
  type HolidayCalendar,
} from "@/lib/date/business-day";
import { toInstant, type WallClockTime } from "@/lib/date/kst";
import { addDays, diffInDays, type PlainDate } from "@/lib/date/plain-date";
import type { StoredOccurrenceStatus } from "@/lib/dependency/status";
import type { ChannelId } from "./types";

// ---------------------------------------------------------------------------
// 입력 타입
// ---------------------------------------------------------------------------

export interface NotificationRuleSpec {
  id: string;
  /** 마감일 기준 오프셋(일). 음수 = 마감 전, 0 = 당일, 양수 = 마감 후 */
  offsetDays: number;
  timeOfDay: WallClockTime;
  offsetUnit: "CALENDAR_DAY" | "BUSINESS_DAY";
  channels: ChannelId[];
  isOverdueReminder: boolean;
  repeatIntervalHours: number | null;
  maxRepeats: number | null;
  isActive: boolean;
}

export interface OccurrenceSpec {
  id: string;
  taskId: string;
  scheduledDate: PlainDate;
  status: StoredOccurrenceStatus;
}

export interface PlanOptions {
  occurrence: OccurrenceSpec;
  rules: readonly NotificationRuleSpec[];
  /** 현재 시각 */
  now: Date;
  /** 서울 기준 오늘 */
  today: PlainDate;
  calendar: HolidayCalendar;
  /**
   * 이 시간(밀리초) 이상 지난 알림은 발송하지 않고 폐기한다.
   * 서버가 오래 정지했을 때 낡은 알림이 폭주하는 것을 막는다.
   */
  staleThresholdMs: number;
}

// ---------------------------------------------------------------------------
// 결과 타입
// ---------------------------------------------------------------------------

export interface PlannedNotification {
  kind: "SCHEDULED" | "OVERDUE_REMINDER";
  ruleId: string;
  occurrenceId: string;
  channel: ChannelId;
  /** 발송 예정 시각 (instant) */
  plannedAt: Date;
  /** 중복 방지 키 */
  dedupeKey: string;
  /** true 면 너무 오래 지나 폐기해야 한다 (로그만 남김) */
  isStale: boolean;
  /** 지연 리마인더의 반복 슬롯 번호 (1부터) */
  slotIndex?: number;
  /** 마감일까지 남은 일수 (알림 본문 구성용) */
  daysUntilDue: number;
}

// ---------------------------------------------------------------------------
// 중복 방지 키
// ---------------------------------------------------------------------------

/**
 * 정기 알림 키. 발송 예정 시각을 포함하므로 마감일이 바뀌면 새 알림으로 취급된다.
 * (마감일이 변경되었으면 다시 알려주는 것이 맞다)
 */
export function scheduledDedupeKey(
  ruleId: string,
  occurrenceId: string,
  channel: ChannelId,
  plannedAt: Date,
): string {
  return `rule:${ruleId}:occ:${occurrenceId}:${channel}:${plannedAt.toISOString()}`;
}

/** 지연 리마인더 키. 슬롯 번호로 구분한다. */
export function overdueDedupeKey(
  ruleId: string,
  occurrenceId: string,
  channel: ChannelId,
  slotIndex: number,
): string {
  return `overdue:${ruleId}:occ:${occurrenceId}:${channel}:${slotIndex}`;
}

/** 선행 완료 알림 키. 회차 쌍당 1회만 발송된다. */
export function unblockedDedupeKey(
  predecessorOccurrenceId: string,
  successorOccurrenceId: string,
  channel: ChannelId,
): string {
  return `unblocked:${predecessorOccurrenceId}:occ:${successorOccurrenceId}:${channel}`;
}

// ---------------------------------------------------------------------------
// 계획 계산
// ---------------------------------------------------------------------------

/** 오프셋을 적용한 알림 기준 날짜를 구한다. */
function resolveTargetDate(
  scheduledDate: PlainDate,
  rule: NotificationRuleSpec,
  calendar: HolidayCalendar,
): PlainDate {
  return rule.offsetUnit === "BUSINESS_DAY"
    ? addBusinessDays(scheduledDate, rule.offsetDays, calendar)
    : addDays(scheduledDate, rule.offsetDays);
}

/**
 * 한 회차에 대해 **지금 발송해야 하는** 알림 목록을 계산한다.
 * 아직 시각이 되지 않은 알림은 포함하지 않는다.
 */
export function planNotificationsForOccurrence(
  options: PlanOptions,
): PlannedNotification[] {
  const { occurrence, rules, now, today, calendar, staleThresholdMs } = options;

  // 종료된 회차에는 알림을 보내지 않는다.
  if (occurrence.status === "DONE" || occurrence.status === "SKIPPED") return [];

  const daysUntilDue = diffInDays(occurrence.scheduledDate, today);
  const planned: PlannedNotification[] = [];

  for (const rule of rules) {
    if (!rule.isActive) continue;
    if (rule.channels.length === 0) continue;

    if (rule.isOverdueReminder) {
      planned.push(
        ...planOverdueReminder({
          occurrence,
          rule,
          now,
          today,
          daysUntilDue,
          staleThresholdMs,
        }),
      );
      continue;
    }

    // --- 정기 알림 -------------------------------------------------------
    const targetDate = resolveTargetDate(occurrence.scheduledDate, rule, calendar);
    const plannedAt = toInstant(targetDate, rule.timeOfDay);

    // 아직 시각이 되지 않았으면 대상이 아니다.
    if (plannedAt.getTime() > now.getTime()) continue;

    const isStale = now.getTime() - plannedAt.getTime() > staleThresholdMs;

    for (const channel of rule.channels) {
      planned.push({
        kind: "SCHEDULED",
        ruleId: rule.id,
        occurrenceId: occurrence.id,
        channel,
        plannedAt,
        dedupeKey: scheduledDedupeKey(rule.id, occurrence.id, channel, plannedAt),
        isStale,
        daysUntilDue,
      });
    }
  }

  return planned;
}

/**
 * 지연 리마인더 계획.
 *
 * [중요] 지난 슬롯을 모두 발송하지 않고 **가장 최근에 도달한 슬롯 하나만** 낸다.
 * 서버가 3일간 정지했고 리마인더 간격이 6시간이라면 12건이 아니라 1건만 보내야 한다.
 * 이전 슬롯들은 dedupeKey 가 생성되지 않으므로 영구적으로 발송되지 않는다(의도된 동작).
 */
function planOverdueReminder(args: {
  occurrence: OccurrenceSpec;
  rule: NotificationRuleSpec;
  now: Date;
  today: PlainDate;
  daysUntilDue: number;
  staleThresholdMs: number;
}): PlannedNotification[] {
  const { occurrence, rule, now, daysUntilDue, staleThresholdMs } = args;

  // 마감일이 지나지 않았으면 대상이 아니다.
  if (daysUntilDue >= 0) return [];
  if (rule.repeatIntervalHours === null || rule.repeatIntervalHours <= 0) return [];

  // 기준점: 마감일의 지정 시각. 여기서부터 간격마다 슬롯이 열린다.
  const anchor = toInstant(occurrence.scheduledDate, rule.timeOfDay);
  const intervalMs = rule.repeatIntervalHours * 60 * 60 * 1000;

  const elapsedMs = now.getTime() - anchor.getTime();
  if (elapsedMs < intervalMs) return []; // 첫 슬롯도 아직 안 열림

  let slotIndex = Math.floor(elapsedMs / intervalMs);
  if (rule.maxRepeats !== null) {
    if (slotIndex > rule.maxRepeats) slotIndex = rule.maxRepeats;
  }
  if (slotIndex < 1) return [];

  const plannedAt = new Date(anchor.getTime() + slotIndex * intervalMs);
  const isStale = now.getTime() - plannedAt.getTime() > staleThresholdMs;

  return rule.channels.map((channel) => ({
    kind: "OVERDUE_REMINDER" as const,
    ruleId: rule.id,
    occurrenceId: occurrence.id,
    channel,
    plannedAt,
    dedupeKey: overdueDedupeKey(rule.id, occurrence.id, channel, slotIndex),
    isStale,
    slotIndex,
    daysUntilDue,
  }));
}

// ---------------------------------------------------------------------------
// 미리보기 (다가올 알림)
// ---------------------------------------------------------------------------

export interface UpcomingNotification {
  ruleId: string;
  occurrenceId: string;
  channels: ChannelId[];
  plannedAt: Date;
  targetDate: PlainDate;
  kind: "SCHEDULED" | "OVERDUE_REMINDER";
}

/**
 * 아직 발송되지 않은 **향후** 알림을 계산한다.
 * 업무 상세 화면에서 "다음 알림 예정" 을 보여주는 데 사용한다.
 *
 * 발송 계획을 materialize 하지 않기 때문에, 이런 조회는 온디맨드 계산으로 해결한다.
 */
export function previewUpcomingNotifications(options: {
  occurrence: OccurrenceSpec;
  rules: readonly NotificationRuleSpec[];
  now: Date;
  calendar: HolidayCalendar;
}): UpcomingNotification[] {
  const { occurrence, rules, now, calendar } = options;

  if (occurrence.status === "DONE" || occurrence.status === "SKIPPED") return [];

  const upcoming: UpcomingNotification[] = [];

  for (const rule of rules) {
    if (!rule.isActive || rule.channels.length === 0) continue;

    if (rule.isOverdueReminder) {
      if (rule.repeatIntervalHours === null) continue;
      // 지연 리마인더는 마감 후 첫 슬롯 시각을 보여준다.
      const anchor = toInstant(occurrence.scheduledDate, rule.timeOfDay);
      const first = new Date(anchor.getTime() + rule.repeatIntervalHours * 3_600_000);
      if (first.getTime() > now.getTime()) {
        upcoming.push({
          ruleId: rule.id,
          occurrenceId: occurrence.id,
          channels: rule.channels,
          plannedAt: first,
          targetDate: occurrence.scheduledDate,
          kind: "OVERDUE_REMINDER",
        });
      }
      continue;
    }

    const targetDate = resolveTargetDate(occurrence.scheduledDate, rule, calendar);
    const plannedAt = toInstant(targetDate, rule.timeOfDay);
    if (plannedAt.getTime() <= now.getTime()) continue;

    upcoming.push({
      ruleId: rule.id,
      occurrenceId: occurrence.id,
      channels: rule.channels,
      plannedAt,
      targetDate,
      kind: "SCHEDULED",
    });
  }

  return upcoming.sort((a, b) => a.plannedAt.getTime() - b.plannedAt.getTime());
}
