/**
 * 알림 계획 계산 테스트
 *
 * 서버 재시작 후 누락 없는 재개, 낡은 알림 폐기, 지연 리마인더 폭주 방지 등
 * 스케줄러의 핵심 동작을 순수 함수 수준에서 검증한다.
 */

import { describe, expect, it } from "vitest";

import { createHolidayCalendar, EMPTY_HOLIDAY_CALENDAR } from "@/lib/date/business-day";
import { toInstant } from "@/lib/date/kst";
import {
  overdueDedupeKey,
  planNotificationsForOccurrence,
  previewUpcomingNotifications,
  scheduledDedupeKey,
  unblockedDedupeKey,
  type NotificationRuleSpec,
  type OccurrenceSpec,
} from "./planner";

const HOUR_MS = 3_600_000;
const STALE_48H = 48 * HOUR_MS;

function rule(overrides: Partial<NotificationRuleSpec> = {}): NotificationRuleSpec {
  return {
    id: "r1",
    offsetDays: -1,
    timeOfDay: "09:00",
    offsetUnit: "CALENDAR_DAY",
    channels: ["WEB_PUSH"],
    isOverdueReminder: false,
    repeatIntervalHours: null,
    maxRepeats: null,
    isActive: true,
    ...overrides,
  };
}

function occurrence(overrides: Partial<OccurrenceSpec> = {}): OccurrenceSpec {
  return {
    id: "o1",
    taskId: "t1",
    scheduledDate: "2026-03-10",
    status: "PENDING",
    ...overrides,
  };
}

describe("planNotificationsForOccurrence — 정기 알림", () => {
  it("예정 시각이 지나면 발송 대상이 된다", () => {
    // D-1 09:00 = 2026-03-09 09:00 KST
    const now = toInstant("2026-03-09", "09:30");

    const planned = planNotificationsForOccurrence({
      occurrence: occurrence(),
      rules: [rule({ offsetDays: -1, timeOfDay: "09:00" })],
      now,
      today: "2026-03-09",
      calendar: EMPTY_HOLIDAY_CALENDAR,
      staleThresholdMs: STALE_48H,
    });

    expect(planned).toHaveLength(1);
    expect(planned[0].kind).toBe("SCHEDULED");
    expect(planned[0].plannedAt.toISOString()).toBe(
      toInstant("2026-03-09", "09:00").toISOString(),
    );
    expect(planned[0].isStale).toBe(false);
    expect(planned[0].daysUntilDue).toBe(1);
  });

  it("예정 시각이 되지 않았으면 대상이 아니다", () => {
    const now = toInstant("2026-03-09", "08:59");

    const planned = planNotificationsForOccurrence({
      occurrence: occurrence(),
      rules: [rule({ offsetDays: -1, timeOfDay: "09:00" })],
      now,
      today: "2026-03-09",
      calendar: EMPTY_HOLIDAY_CALENDAR,
      staleThresholdMs: STALE_48H,
    });

    expect(planned).toHaveLength(0);
  });

  it("예정 시각과 정확히 같으면 발송한다 (경계 포함)", () => {
    const now = toInstant("2026-03-09", "09:00");

    const planned = planNotificationsForOccurrence({
      occurrence: occurrence(),
      rules: [rule({ offsetDays: -1, timeOfDay: "09:00" })],
      now,
      today: "2026-03-09",
      calendar: EMPTY_HOLIDAY_CALENDAR,
      staleThresholdMs: STALE_48H,
    });

    expect(planned).toHaveLength(1);
  });

  it("여러 알림 시점(D-7, D-1, 당일)을 모두 지원한다", () => {
    // 당일 09:00 시점 → D-7, D-1, 당일 모두 이미 지났다
    const now = toInstant("2026-03-10", "09:00");

    const planned = planNotificationsForOccurrence({
      occurrence: occurrence(),
      rules: [
        rule({ id: "d7", offsetDays: -7, timeOfDay: "09:00" }),
        rule({ id: "d1", offsetDays: -1, timeOfDay: "18:00" }),
        rule({ id: "d0", offsetDays: 0, timeOfDay: "09:00" }),
      ],
      now,
      today: "2026-03-10",
      calendar: EMPTY_HOLIDAY_CALENDAR,
      staleThresholdMs: STALE_48H,
    });

    expect(planned.map((p) => p.ruleId).sort()).toEqual(["d0", "d1", "d7"]);
  });

  it("채널마다 별도 알림을 만든다", () => {
    const now = toInstant("2026-03-09", "10:00");

    const planned = planNotificationsForOccurrence({
      occurrence: occurrence(),
      rules: [rule({ channels: ["WEB_PUSH", "EMAIL"] })],
      now,
      today: "2026-03-09",
      calendar: EMPTY_HOLIDAY_CALENDAR,
      staleThresholdMs: STALE_48H,
    });

    expect(planned).toHaveLength(2);
    expect(planned.map((p) => p.channel).sort()).toEqual(["EMAIL", "WEB_PUSH"]);
    // 채널이 다르면 dedupeKey 도 달라야 한다
    expect(planned[0].dedupeKey).not.toBe(planned[1].dedupeKey);
  });

  it("BUSINESS_DAY 오프셋은 영업일 기준으로 계산한다", () => {
    // 2026-03-10(화) 마감, D-3영업일 → 3/5(목)
    // (3/7 토, 3/8 일 제외)
    const calendar = createHolidayCalendar([]);
    const now = toInstant("2026-03-05", "09:30");

    const planned = planNotificationsForOccurrence({
      occurrence: occurrence({ scheduledDate: "2026-03-10" }),
      rules: [rule({ offsetDays: -3, offsetUnit: "BUSINESS_DAY", timeOfDay: "09:00" })],
      now,
      today: "2026-03-05",
      calendar,
      staleThresholdMs: STALE_48H,
    });

    expect(planned).toHaveLength(1);
    expect(planned[0].plannedAt.toISOString()).toBe(
      toInstant("2026-03-05", "09:00").toISOString(),
    );
  });

  it("비활성 규칙은 무시한다", () => {
    const now = toInstant("2026-03-09", "10:00");

    const planned = planNotificationsForOccurrence({
      occurrence: occurrence(),
      rules: [rule({ isActive: false })],
      now,
      today: "2026-03-09",
      calendar: EMPTY_HOLIDAY_CALENDAR,
      staleThresholdMs: STALE_48H,
    });

    expect(planned).toHaveLength(0);
  });

  it("완료/건너뜀 회차에는 알림을 보내지 않는다", () => {
    const now = toInstant("2026-03-09", "10:00");

    for (const status of ["DONE", "SKIPPED"] as const) {
      const planned = planNotificationsForOccurrence({
        occurrence: occurrence({ status }),
        rules: [rule()],
        now,
        today: "2026-03-09",
        calendar: EMPTY_HOLIDAY_CALENDAR,
        staleThresholdMs: STALE_48H,
      });
      expect(planned).toHaveLength(0);
    }
  });
});

describe("planNotificationsForOccurrence — 서버 재시작 후 재개", () => {
  it("서버가 정지해 놓친 알림도 다음 틱에 발견된다", () => {
    // D-1 09:00 은 3/9 09:00. 서버가 3/9 08:00 ~ 3/9 14:00 정지했다고 가정.
    // 재시작 후 첫 틱(3/9 14:00)에서 여전히 발송 대상이어야 한다.
    const now = toInstant("2026-03-09", "14:00");

    const planned = planNotificationsForOccurrence({
      occurrence: occurrence(),
      rules: [rule({ offsetDays: -1, timeOfDay: "09:00" })],
      now,
      today: "2026-03-09",
      calendar: EMPTY_HOLIDAY_CALENDAR,
      staleThresholdMs: STALE_48H,
    });

    expect(planned).toHaveLength(1);
    expect(planned[0].isStale).toBe(false);
    // dedupeKey 는 예정 시각 기준이므로 재시작 전후로 동일하다
    // → 이미 보냈다면 유니크 제약이 재발송을 막는다
    expect(planned[0].dedupeKey).toBe(
      scheduledDedupeKey("r1", "o1", "WEB_PUSH", toInstant("2026-03-09", "09:00")),
    );
  });

  it("staleThreshold 를 넘긴 알림은 isStale = true 로 표시된다", () => {
    // D-1 09:00(3/9) 인데 지금은 3/12 → 3일 경과, 48시간 초과
    const now = toInstant("2026-03-12", "10:00");

    const planned = planNotificationsForOccurrence({
      occurrence: occurrence(),
      rules: [rule({ offsetDays: -1, timeOfDay: "09:00" })],
      now,
      today: "2026-03-12",
      calendar: EMPTY_HOLIDAY_CALENDAR,
      staleThresholdMs: STALE_48H,
    });

    expect(planned).toHaveLength(1);
    expect(planned[0].isStale).toBe(true);
  });

  it("staleThreshold 경계 바로 안쪽은 isStale = false", () => {
    const plannedAt = toInstant("2026-03-09", "09:00");
    const now = new Date(plannedAt.getTime() + STALE_48H - 1000);

    const planned = planNotificationsForOccurrence({
      occurrence: occurrence(),
      rules: [rule({ offsetDays: -1, timeOfDay: "09:00" })],
      now,
      today: "2026-03-11",
      calendar: EMPTY_HOLIDAY_CALENDAR,
      staleThresholdMs: STALE_48H,
    });

    expect(planned[0].isStale).toBe(false);
  });
});

describe("planNotificationsForOccurrence — 지연 리마인더", () => {
  const overdueRule = rule({
    id: "od",
    isOverdueReminder: true,
    repeatIntervalHours: 6,
    timeOfDay: "18:00",
  });

  it("마감일이 지나지 않으면 발송하지 않는다", () => {
    const planned = planNotificationsForOccurrence({
      occurrence: occurrence({ scheduledDate: "2026-03-10" }),
      rules: [overdueRule],
      now: toInstant("2026-03-10", "23:00"),
      today: "2026-03-10", // 아직 마감일 당일
      calendar: EMPTY_HOLIDAY_CALENDAR,
      staleThresholdMs: STALE_48H,
    });

    expect(planned).toHaveLength(0);
  });

  it("첫 슬롯(간격 1회분)이 지나면 발송한다", () => {
    // 기준점: 3/10 18:00. 간격 6시간 → 첫 슬롯 3/11 00:00
    const planned = planNotificationsForOccurrence({
      occurrence: occurrence({ scheduledDate: "2026-03-10" }),
      rules: [overdueRule],
      now: toInstant("2026-03-11", "01:00"),
      today: "2026-03-11",
      calendar: EMPTY_HOLIDAY_CALENDAR,
      staleThresholdMs: STALE_48H,
    });

    expect(planned).toHaveLength(1);
    expect(planned[0].kind).toBe("OVERDUE_REMINDER");
    expect(planned[0].slotIndex).toBe(1);
  });

  it("첫 슬롯 전에는 발송하지 않는다", () => {
    const planned = planNotificationsForOccurrence({
      occurrence: occurrence({ scheduledDate: "2026-03-10" }),
      rules: [overdueRule],
      now: toInstant("2026-03-10", "23:00"),
      today: "2026-03-11", // 날짜는 넘겼지만 6시간이 안 지남
      calendar: EMPTY_HOLIDAY_CALENDAR,
      staleThresholdMs: STALE_48H,
    });

    expect(planned).toHaveLength(0);
  });

  it("여러 슬롯이 지났어도 가장 최근 슬롯 1건만 발송한다 (폭주 방지)", () => {
    // 기준점 3/10 18:00, 간격 6시간.
    // 3/13 06:00 까지 경과 시간 = 60시간 → 10슬롯 경과.
    // 그래도 1건만 나와야 한다.
    const planned = planNotificationsForOccurrence({
      occurrence: occurrence({ scheduledDate: "2026-03-10" }),
      rules: [overdueRule],
      now: toInstant("2026-03-13", "06:00"),
      today: "2026-03-13",
      calendar: EMPTY_HOLIDAY_CALENDAR,
      staleThresholdMs: STALE_48H,
    });

    expect(planned).toHaveLength(1);
    expect(planned[0].slotIndex).toBe(10);
    // 최신 슬롯이므로 낡은 알림이 아니다
    expect(planned[0].isStale).toBe(false);
  });

  it("maxRepeats 를 넘으면 슬롯 번호가 고정된다 (더 이상 새 알림 없음)", () => {
    const limited = rule({
      id: "od",
      isOverdueReminder: true,
      repeatIntervalHours: 6,
      maxRepeats: 3,
      timeOfDay: "18:00",
    });

    const first = planNotificationsForOccurrence({
      occurrence: occurrence({ scheduledDate: "2026-03-10" }),
      rules: [limited],
      now: toInstant("2026-03-11", "13:00"), // 3슬롯 경과
      today: "2026-03-11",
      calendar: EMPTY_HOLIDAY_CALENDAR,
      staleThresholdMs: STALE_48H,
    });
    expect(first[0].slotIndex).toBe(3);

    const later = planNotificationsForOccurrence({
      occurrence: occurrence({ scheduledDate: "2026-03-10" }),
      rules: [limited],
      now: toInstant("2026-03-15", "13:00"), // 훨씬 뒤
      today: "2026-03-15",
      calendar: EMPTY_HOLIDAY_CALENDAR,
      staleThresholdMs: STALE_48H,
    });

    // 슬롯 번호가 3 으로 고정 → dedupeKey 가 같으므로 재발송되지 않는다
    expect(later[0].slotIndex).toBe(3);
    expect(later[0].dedupeKey).toBe(first[0].dedupeKey);
  });

  it("repeatIntervalHours 가 없으면 발송하지 않는다", () => {
    const planned = planNotificationsForOccurrence({
      occurrence: occurrence({ scheduledDate: "2026-03-10" }),
      rules: [rule({ isOverdueReminder: true, repeatIntervalHours: null })],
      now: toInstant("2026-03-15", "10:00"),
      today: "2026-03-15",
      calendar: EMPTY_HOLIDAY_CALENDAR,
      staleThresholdMs: STALE_48H,
    });

    expect(planned).toHaveLength(0);
  });
});

describe("dedupeKey 생성", () => {
  it("정기 알림 키는 규칙·회차·채널·예정시각을 모두 포함한다", () => {
    const at = toInstant("2026-03-09", "09:00");
    const key = scheduledDedupeKey("r1", "o1", "EMAIL", at);

    expect(key).toContain("rule:r1");
    expect(key).toContain("occ:o1");
    expect(key).toContain("EMAIL");
    expect(key).toContain(at.toISOString());
  });

  it("예정 시각이 다르면 키가 다르다 (마감일 변경 시 재알림)", () => {
    const a = scheduledDedupeKey("r1", "o1", "EMAIL", toInstant("2026-03-09", "09:00"));
    const b = scheduledDedupeKey("r1", "o1", "EMAIL", toInstant("2026-03-16", "09:00"));
    expect(a).not.toBe(b);
  });

  it("지연 리마인더 키는 슬롯 번호로 구분된다", () => {
    expect(overdueDedupeKey("r1", "o1", "EMAIL", 1)).not.toBe(
      overdueDedupeKey("r1", "o1", "EMAIL", 2),
    );
  });

  it("선행 완료 알림 키는 회차 쌍당 하나다", () => {
    const key = unblockedDedupeKey("p1", "s1", "WEB_PUSH");
    expect(key).toBe("unblocked:p1:occ:s1:WEB_PUSH");
    // 같은 쌍은 항상 같은 키 → 1회만 발송
    expect(unblockedDedupeKey("p1", "s1", "WEB_PUSH")).toBe(key);
  });
});

describe("previewUpcomingNotifications (다가올 알림 미리보기)", () => {
  it("아직 시각이 되지 않은 알림만 반환한다", () => {
    const now = toInstant("2026-03-05", "12:00");

    const upcoming = previewUpcomingNotifications({
      occurrence: occurrence({ scheduledDate: "2026-03-10" }),
      rules: [
        rule({ id: "d7", offsetDays: -7 }), // 3/3 → 이미 지남
        rule({ id: "d1", offsetDays: -1 }), // 3/9 → 예정
        rule({ id: "d0", offsetDays: 0 }), // 3/10 → 예정
      ],
      now,
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    expect(upcoming.map((u) => u.ruleId)).toEqual(["d1", "d0"]);
  });

  it("시각 오름차순으로 정렬된다", () => {
    const now = toInstant("2026-03-01", "00:00");

    const upcoming = previewUpcomingNotifications({
      occurrence: occurrence({ scheduledDate: "2026-03-10" }),
      rules: [
        rule({ id: "d0", offsetDays: 0 }),
        rule({ id: "d7", offsetDays: -7 }),
        rule({ id: "d1", offsetDays: -1 }),
      ],
      now,
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    expect(upcoming.map((u) => u.ruleId)).toEqual(["d7", "d1", "d0"]);
  });

  it("완료된 회차는 다가올 알림이 없다", () => {
    const upcoming = previewUpcomingNotifications({
      occurrence: occurrence({ status: "DONE" }),
      rules: [rule()],
      now: toInstant("2026-03-01", "00:00"),
      calendar: EMPTY_HOLIDAY_CALENDAR,
    });

    expect(upcoming).toHaveLength(0);
  });
});
