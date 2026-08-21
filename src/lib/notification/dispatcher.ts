/**
 * 알림 발송 디스패처
 * ============================================================================
 *
 * planner(순수 함수)가 계산한 발송 계획을 실제로 처리한다.
 *   1. 발송 대상 회차를 조회
 *   2. planner 로 "지금 보내야 하는" 알림 계산
 *   3. NotificationLog 에서 이미 보낸 것을 제외 (dedupeKey 기준)
 *   4. 낡은 알림은 SKIPPED_STALE 로 기록만 하고 폐기
 *   5. 나머지는 어댑터로 발송하고 결과를 로그에 기록
 *
 * dedupeKey 에 유니크 제약이 있으므로, 여러 프로세스가 동시에 실행되어도
 * 중복 발송은 DB 레벨에서 차단된다.
 */

import { formatKoreanShort, toDbDate, toPlainDate, type PlainDate } from "@/lib/date/plain-date";
import { todayInSeoul } from "@/lib/date/kst";
import { addMonths } from "@/lib/date/plain-date";
import { prisma } from "@/lib/db";
import {
  findUnblockedSuccessors,
  type OccurrenceNode,
  type OccurrenceOverrideLink,
  type StoredOccurrenceStatus,
  type TaskDependencyLink,
} from "@/lib/dependency/status";
import { getHolidayCalendar } from "@/lib/services/holiday-service";
import {
  getStaleNotificationHours,
  recordRunTimestamp,
  SETTING_KEYS,
} from "@/lib/services/settings-service";
import {
  planNotificationsForOccurrence,
  unblockedDedupeKey,
  type NotificationRuleSpec,
  type PlannedNotification,
} from "./planner";
import { getAdapter, parseChannels } from "./registry";
import type { NotificationPayload } from "./types";

// ---------------------------------------------------------------------------
// 조회 범위
// ---------------------------------------------------------------------------

/**
 * 알림 대상 회차의 조회 범위.
 * 오프셋이 최대 ±365일이므로 넉넉히 잡되, 전체 스캔은 피한다.
 */
const LOOKBEHIND_MONTHS = 6;
const LOOKAHEAD_MONTHS = 14;

export interface DispatchSummary {
  planned: number;
  sent: number;
  skippedDuplicate: number;
  skippedStale: number;
  skippedUnavailable: number;
  failed: number;
  details: string[];
}

function emptySummary(): DispatchSummary {
  return {
    planned: 0,
    sent: 0,
    skippedDuplicate: 0,
    skippedStale: 0,
    skippedUnavailable: 0,
    failed: 0,
    details: [],
  };
}

// ---------------------------------------------------------------------------
// 본문 생성
// ---------------------------------------------------------------------------

function buildTitle(
  kind: PlannedNotification["kind"] | "DEPENDENCY_UNBLOCKED",
  taskTitle: string,
  daysUntilDue: number,
): string {
  if (kind === "DEPENDENCY_UNBLOCKED") {
    return `착수 가능: ${taskTitle}`;
  }
  if (kind === "OVERDUE_REMINDER" || daysUntilDue < 0) {
    return `[지연 ${Math.abs(daysUntilDue)}일] ${taskTitle}`;
  }
  if (daysUntilDue === 0) return `[오늘 마감] ${taskTitle}`;
  return `[D-${daysUntilDue}] ${taskTitle}`;
}

function buildBody(
  kind: PlannedNotification["kind"] | "DEPENDENCY_UNBLOCKED",
  taskTitle: string,
  scheduledDate: PlainDate,
  daysUntilDue: number,
  extra?: string,
): string {
  const due = formatKoreanShort(scheduledDate);

  switch (kind) {
    case "DEPENDENCY_UNBLOCKED":
      return `선행 업무가 완료되어 "${taskTitle}" 을(를) 시작할 수 있습니다.${
        extra ? `\n(${extra})` : ""
      }\n마감일: ${due}`;

    case "OVERDUE_REMINDER":
      return `"${taskTitle}" 이(가) 마감일(${due})을 ${Math.abs(
        daysUntilDue,
      )}일 초과했습니다. 아직 완료되지 않았습니다.`;

    default:
      if (daysUntilDue === 0) {
        return `"${taskTitle}" 의 마감일이 오늘(${due})입니다.`;
      }
      if (daysUntilDue < 0) {
        return `"${taskTitle}" 이(가) 마감일(${due})을 ${Math.abs(daysUntilDue)}일 초과했습니다.`;
      }
      return `"${taskTitle}" 의 마감일이 ${daysUntilDue}일 뒤(${due})입니다.`;
  }
}

// ---------------------------------------------------------------------------
// 발송 실행
// ---------------------------------------------------------------------------

interface DispatchContext {
  occurrenceId: string;
  taskId: string;
  taskTitle: string;
  taskPriority: string;
  scheduledDate: PlainDate;
  recipient: { id: string | null; name: string; email: string | null };
}

/**
 * 알림 1건을 발송하고 이력을 기록한다.
 * dedupeKey 유니크 제약 위반은 "이미 보냈다"는 뜻이므로 정상 처리한다.
 */
async function dispatchOne(
  plan: {
    kind: "SCHEDULED" | "OVERDUE_REMINDER" | "DEPENDENCY_UNBLOCKED";
    channel: string;
    plannedAt: Date;
    dedupeKey: string;
    isStale: boolean;
    daysUntilDue: number;
    extraNote?: string;
  },
  context: DispatchContext,
  summary: DispatchSummary,
): Promise<void> {
  const title = buildTitle(plan.kind, context.taskTitle, plan.daysUntilDue);
  const body = buildBody(
    plan.kind,
    context.taskTitle,
    context.scheduledDate,
    plan.daysUntilDue,
    plan.extraNote,
  );

  // --- 낡은 알림 폐기 ---------------------------------------------------
  if (plan.isStale) {
    await writeLog({
      ...plan,
      context,
      title,
      body,
      status: "SKIPPED_STALE",
      error: "발송 예정 시각이 너무 오래 지나 폐기했습니다(서버 정지 등).",
      sentAt: null,
    });
    summary.skippedStale += 1;
    return;
  }

  const adapter = getAdapter(plan.channel);
  if (!adapter) {
    summary.skippedUnavailable += 1;
    summary.details.push(`알 수 없는 채널: ${plan.channel}`);
    return;
  }

  const payload: NotificationPayload = {
    kind: plan.kind,
    title,
    body,
    recipient: context.recipient,
    task: {
      id: context.taskId,
      title: context.taskTitle,
      priority: context.taskPriority,
    },
    occurrence: {
      id: context.occurrenceId,
      scheduledDate: context.scheduledDate,
      daysUntilDue: plan.daysUntilDue,
    },
    linkPath: `/tasks/${context.taskId}?occurrence=${context.occurrenceId}`,
  };

  // --- 채널 가용성 확인 -------------------------------------------------
  const availability = adapter.isAvailable(payload);
  if (!availability.ok) {
    await writeLog({
      ...plan,
      context,
      title,
      body,
      status: "FAILED",
      error: availability.reason,
      sentAt: null,
    });
    summary.skippedUnavailable += 1;
    summary.details.push(`${adapter.label} 발송 불가: ${availability.reason}`);
    return;
  }

  // --- 실제 발송 --------------------------------------------------------
  const result = await adapter.send(payload);

  const written = await writeLog({
    ...plan,
    context,
    title,
    body,
    status: result.ok ? "SENT" : "FAILED",
    error: result.ok ? null : (result.error ?? "알 수 없는 오류"),
    sentAt: result.ok ? new Date() : null,
  });

  if (written === "DUPLICATE") {
    summary.skippedDuplicate += 1;
    return;
  }

  if (result.ok) summary.sent += 1;
  else {
    summary.failed += 1;
    summary.details.push(`${adapter.label} 발송 실패: ${result.error}`);
  }
}

/**
 * 이력 기록. dedupeKey 충돌 시 "DUPLICATE" 를 반환한다.
 *
 * 실패한 알림은 재시도할 수 있어야 하므로 upsert 로 갱신하되,
 * 이미 SENT 상태인 행은 절대 덮어쓰지 않는다.
 */
async function writeLog(args: {
  kind: string;
  channel: string;
  plannedAt: Date;
  dedupeKey: string;
  context: DispatchContext;
  title: string;
  body: string;
  status: "SENT" | "FAILED" | "SKIPPED_STALE";
  error: string | null;
  sentAt: Date | null;
}): Promise<"WRITTEN" | "DUPLICATE"> {
  const existing = await prisma.notificationLog.findUnique({
    where: { dedupeKey: args.dedupeKey },
    select: { id: true, status: true, attempts: true },
  });

  if (existing) {
    // 이미 성공적으로 보낸 알림은 다시 건드리지 않는다.
    if (existing.status === "SENT") return "DUPLICATE";

    await prisma.notificationLog.update({
      where: { id: existing.id },
      data: {
        status: args.status,
        error: args.error,
        sentAt: args.sentAt,
        attempts: existing.attempts + 1,
      },
    });
    return "WRITTEN";
  }

  try {
    await prisma.notificationLog.create({
      data: {
        occurrenceId: args.context.occurrenceId,
        recipientId: args.context.recipient.id,
        recipientAddr: args.context.recipient.email,
        channel: args.channel,
        kind: args.kind,
        dedupeKey: args.dedupeKey,
        plannedAt: args.plannedAt,
        sentAt: args.sentAt,
        status: args.status,
        error: args.error,
        title: args.title,
        body: args.body,
      },
    });
    return "WRITTEN";
  } catch (error) {
    // 동시 실행으로 유니크 제약이 걸린 경우 = 다른 프로세스가 이미 보냈다.
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("Unique constraint") || message.includes("UNIQUE")) {
      return "DUPLICATE";
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// 정기 알림 / 지연 리마인더 스캔
// ---------------------------------------------------------------------------

/**
 * 발송해야 할 알림을 찾아 모두 처리한다. 스케줄러가 매 틱 호출한다.
 *
 * @param options.now 기준 시각 (테스트/수동 실행에서 주입 가능)
 */
export async function dispatchDueNotifications(
  options: { now?: Date } = {},
): Promise<DispatchSummary> {
  const now = options.now ?? new Date();
  const today = todayInSeoul(now);
  const summary = emptySummary();

  const [calendar, staleHours] = await Promise.all([
    getHolidayCalendar(),
    getStaleNotificationHours(),
  ]);
  const staleThresholdMs = staleHours * 60 * 60 * 1000;

  const from = addMonths(today, -LOOKBEHIND_MONTHS);
  const to = addMonths(today, LOOKAHEAD_MONTHS);

  // 미완료 회차 + 그 업무의 활성 알림 규칙
  const rows = await prisma.occurrence.findMany({
    where: {
      status: { in: ["PENDING", "IN_PROGRESS"] },
      scheduledDate: { gte: toDbDate(from), lte: toDbDate(to) },
    },
    select: {
      id: true,
      taskId: true,
      scheduledDate: true,
      status: true,
      assignee: { select: { id: true, name: true, email: true } },
      task: {
        select: {
          id: true,
          title: true,
          priority: true,
          isActive: true,
          defaultAssignee: { select: { id: true, name: true, email: true } },
          notificationRules: { where: { isActive: true } },
        },
      },
    },
  });

  for (const row of rows) {
    const rules: NotificationRuleSpec[] = row.task.notificationRules.map((rule) => ({
      id: rule.id,
      offsetDays: rule.offsetDays,
      timeOfDay: rule.timeOfDay,
      offsetUnit: rule.offsetUnit as NotificationRuleSpec["offsetUnit"],
      channels: parseChannels(rule.channels),
      isOverdueReminder: rule.isOverdueReminder,
      repeatIntervalHours: rule.repeatIntervalHours,
      maxRepeats: rule.maxRepeats,
      isActive: rule.isActive,
    }));

    if (rules.length === 0) continue;

    const scheduledDate = toPlainDate(row.scheduledDate);

    const plans = planNotificationsForOccurrence({
      occurrence: {
        id: row.id,
        taskId: row.taskId,
        scheduledDate,
        status: row.status as StoredOccurrenceStatus,
      },
      rules,
      now,
      today,
      calendar,
      staleThresholdMs,
    });

    if (plans.length === 0) continue;
    summary.planned += plans.length;

    // 회차 담당자 → 없으면 업무 기본 담당자
    const assignee = row.assignee ?? row.task.defaultAssignee;
    const context: DispatchContext = {
      occurrenceId: row.id,
      taskId: row.taskId,
      taskTitle: row.task.title,
      taskPriority: row.task.priority,
      scheduledDate,
      recipient: {
        id: assignee?.id ?? null,
        name: assignee?.name ?? "담당자 미지정",
        email: assignee?.email ?? null,
      },
    };

    for (const plan of plans) {
      await dispatchOne(
        {
          kind: plan.kind,
          channel: plan.channel,
          plannedAt: plan.plannedAt,
          dedupeKey: plan.dedupeKey,
          isStale: plan.isStale,
          daysUntilDue: plan.daysUntilDue,
        },
        context,
        summary,
      );
    }
  }

  await recordRunTimestamp(SETTING_KEYS.lastSchedulerRunAt, now);

  return summary;
}

// ---------------------------------------------------------------------------
// 선행 완료 알림
// ---------------------------------------------------------------------------

function toNode(row: {
  id: string;
  taskId: string;
  sequenceIndex: number;
  scheduledDate: Date;
  status: string;
  completedAt: Date | null;
}): OccurrenceNode {
  return {
    id: row.id,
    taskId: row.taskId,
    sequenceIndex: row.sequenceIndex,
    scheduledDate: toPlainDate(row.scheduledDate),
    status: row.status as StoredOccurrenceStatus,
    completedDate: row.completedAt ? todayInSeoul(row.completedAt) : null,
  };
}

/**
 * 선행 회차가 완료되었을 때, 차단이 풀린 후행 회차의 담당자에게 알린다.
 * 회차 완료 처리 시점에 호출된다 (cron 이 아님).
 */
export async function notifyUnblockedSuccessors(
  completedOccurrenceId: string,
  options: { now?: Date } = {},
): Promise<DispatchSummary> {
  const now = options.now ?? new Date();
  const today = todayInSeoul(now);
  const summary = emptySummary();

  const completed = await prisma.occurrence.findUnique({
    where: { id: completedOccurrenceId },
    select: {
      id: true,
      taskId: true,
      sequenceIndex: true,
      scheduledDate: true,
      status: true,
      completedAt: true,
      task: { select: { title: true } },
    },
  });

  if (!completed || completed.status !== "DONE") return summary;

  const [allRows, linkRows, overrideRows, calendar] = await Promise.all([
    prisma.occurrence.findMany({
      select: {
        id: true,
        taskId: true,
        sequenceIndex: true,
        scheduledDate: true,
        status: true,
        completedAt: true,
      },
    }),
    prisma.taskDependency.findMany(),
    prisma.occurrenceDependencyOverride.findMany(),
    getHolidayCalendar(),
  ]);

  const links: TaskDependencyLink[] = linkRows.map((row) => ({
    id: row.id,
    predecessorTaskId: row.predecessorId,
    successorTaskId: row.successorId,
    lagAmount: row.lagAmount,
    lagUnit: row.lagUnit as TaskDependencyLink["lagUnit"],
    matchStrategy: row.matchStrategy as TaskDependencyLink["matchStrategy"],
    isBlocking: row.isBlocking,
  }));

  const overrides: OccurrenceOverrideLink[] = overrideRows.map((row) => ({
    id: row.id,
    predecessorOccurrenceId: row.predecessorOccurrenceId,
    successorOccurrenceId: row.successorOccurrenceId,
    lagAmount: row.lagAmount,
    lagUnit: row.lagUnit as OccurrenceOverrideLink["lagUnit"],
    isBlocking: row.isBlocking,
  }));

  const unblocked = findUnblockedSuccessors({
    completedOccurrence: toNode(completed),
    allOccurrences: allRows.map(toNode),
    links,
    overrides,
    today,
    calendar,
  });

  if (unblocked.length === 0) return summary;

  // 후행 회차의 담당자·업무 정보를 한 번에 읽는다.
  const details = await prisma.occurrence.findMany({
    where: { id: { in: unblocked.map((o) => o.id) } },
    select: {
      id: true,
      taskId: true,
      scheduledDate: true,
      assignee: { select: { id: true, name: true, email: true } },
      task: {
        select: {
          id: true,
          title: true,
          priority: true,
          defaultAssignee: { select: { id: true, name: true, email: true } },
          notificationRules: {
            where: { isActive: true, isOverdueReminder: false },
            select: { channels: true },
          },
        },
      },
    },
  });

  for (const row of details) {
    // 후행 업무에 설정된 채널을 재사용한다. 규칙이 없으면 브라우저 알림으로 보낸다.
    const channels = new Set<string>();
    for (const rule of row.task.notificationRules) {
      for (const channel of parseChannels(rule.channels)) channels.add(channel);
    }
    if (channels.size === 0) channels.add("WEB_PUSH");

    const assignee = row.assignee ?? row.task.defaultAssignee;
    const scheduledDate = toPlainDate(row.scheduledDate);

    const context: DispatchContext = {
      occurrenceId: row.id,
      taskId: row.taskId,
      taskTitle: row.task.title,
      taskPriority: row.task.priority,
      scheduledDate,
      recipient: {
        id: assignee?.id ?? null,
        name: assignee?.name ?? "담당자 미지정",
        email: assignee?.email ?? null,
      },
    };

    for (const channel of channels) {
      summary.planned += 1;
      await dispatchOne(
        {
          kind: "DEPENDENCY_UNBLOCKED",
          channel,
          plannedAt: now,
          dedupeKey: unblockedDedupeKey(completed.id, row.id, channel),
          isStale: false,
          daysUntilDue: 0,
          extraNote: `선행 업무: ${completed.task.title}`,
        },
        context,
        summary,
      );
    }
  }

  return summary;
}

/** 요약을 로그 한 줄로 만든다. */
export function formatDispatchSummary(summary: DispatchSummary): string {
  const parts = [`계획 ${summary.planned}`, `발송 ${summary.sent}`];
  if (summary.skippedDuplicate > 0) parts.push(`중복제외 ${summary.skippedDuplicate}`);
  if (summary.skippedStale > 0) parts.push(`폐기 ${summary.skippedStale}`);
  if (summary.skippedUnavailable > 0) parts.push(`불가 ${summary.skippedUnavailable}`);
  if (summary.failed > 0) parts.push(`실패 ${summary.failed}`);
  return parts.join(" · ");
}
