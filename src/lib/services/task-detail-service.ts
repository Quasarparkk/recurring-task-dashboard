/**
 * 업무 상세 화면 데이터 조립
 */

import { todayInSeoul } from "@/lib/date/kst";
import { toPlainDate, type PlainDate } from "@/lib/date/plain-date";
import { prisma } from "@/lib/db";
import { extractSubgraph, type DependencyEdge } from "@/lib/dependency/graph";
import type { GraphEdge, GraphNode } from "@/components/dependency-graph";
import { previewUpcomingNotifications } from "@/lib/notification/planner";
import { parseChannels } from "@/lib/notification/registry";
import { getHolidayCalendar } from "./holiday-service";
import {
  getTaskOccurrenceHistory,
  type OccurrenceDto,
} from "./dashboard-service";

// ---------------------------------------------------------------------------
// 의존 그래프
// ---------------------------------------------------------------------------

export interface TaskGraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** 직접 선행 관계 (표 형태로도 보여주기 위함) */
  directPredecessors: DependencyDetail[];
  directSuccessors: DependencyDetail[];
}

export interface DependencyDetail {
  id: string;
  taskId: string;
  taskTitle: string;
  isActive: boolean;
  lagAmount: number;
  lagUnit: "BUSINESS_DAY" | "CALENDAR_DAY";
  matchStrategy: "SAME_SEQUENCE" | "NEAREST_PRECEDING" | "SAME_PERIOD";
  isBlocking: boolean;
  note: string | null;
}

export async function getTaskGraphData(
  taskId: string,
  today: PlainDate = todayInSeoul(),
): Promise<TaskGraphData> {
  const [allLinks, allTasks] = await Promise.all([
    prisma.taskDependency.findMany(),
    prisma.task.findMany({ select: { id: true, title: true, isActive: true } }),
  ]);

  const allEdges: DependencyEdge[] = allLinks.map((link) => ({
    predecessorId: link.predecessorId,
    successorId: link.successorId,
  }));

  // 이 업무와 연결된 부분 그래프만 추출한다 (전체 그래프는 너무 커질 수 있다).
  const subgraph = extractSubgraph(taskId, allEdges);

  // 부분 그래프에 속한 업무들의 "문제 있는 회차" 유무를 계산한다.
  const relevantTaskIds = [...subgraph.nodes];

  const openOccurrences = await prisma.occurrence.findMany({
    where: {
      taskId: { in: relevantTaskIds },
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
    select: { taskId: true, scheduledDate: true },
  });

  // 지연 = 미완료인데 마감일이 지난 회차가 있음
  const overdueTaskIds = new Set(
    openOccurrences
      .filter((o) => toPlainDate(o.scheduledDate) < today)
      .map((o) => o.taskId),
  );

  // 대기 여부는 정확히 계산하면 비용이 크므로, 그래프에서는
  // "차단 관계인 선행 업무에 미완료 회차가 있음"으로 근사한다.
  const blockingLinks = allLinks.filter((l) => l.isBlocking);
  const tasksWithOpenOccurrences = new Set(openOccurrences.map((o) => o.taskId));
  const blockedTaskIds = new Set(
    blockingLinks
      .filter(
        (link) =>
          subgraph.nodes.has(link.successorId) &&
          tasksWithOpenOccurrences.has(link.predecessorId),
      )
      .map((link) => link.successorId),
  );

  const titleById = new Map(allTasks.map((task) => [task.id, task]));

  const nodes: GraphNode[] = relevantTaskIds.map((id) => {
    const task = titleById.get(id);
    return {
      id,
      title: task?.title ?? "(삭제된 업무)",
      isFocus: id === taskId,
      hasOverdue: overdueTaskIds.has(id),
      hasBlocked: blockedTaskIds.has(id),
      isActive: task?.isActive ?? false,
    };
  });

  const edges: GraphEdge[] = allLinks
    .filter(
      (link) =>
        subgraph.nodes.has(link.predecessorId) && subgraph.nodes.has(link.successorId),
    )
    .map((link) => ({
      id: link.id,
      predecessorId: link.predecessorId,
      successorId: link.successorId,
      lagAmount: link.lagAmount,
      lagUnit: link.lagUnit as GraphEdge["lagUnit"],
      isBlocking: link.isBlocking,
    }));

  const toDetail = (
    link: (typeof allLinks)[number],
    otherId: string,
  ): DependencyDetail => {
    const other = titleById.get(otherId);
    return {
      id: link.id,
      taskId: otherId,
      taskTitle: other?.title ?? "(삭제된 업무)",
      isActive: other?.isActive ?? false,
      lagAmount: link.lagAmount,
      lagUnit: link.lagUnit as DependencyDetail["lagUnit"],
      matchStrategy: link.matchStrategy as DependencyDetail["matchStrategy"],
      isBlocking: link.isBlocking,
      note: link.note,
    };
  };

  return {
    nodes,
    edges,
    directPredecessors: allLinks
      .filter((link) => link.successorId === taskId)
      .map((link) => toDetail(link, link.predecessorId)),
    directSuccessors: allLinks
      .filter((link) => link.predecessorId === taskId)
      .map((link) => toDetail(link, link.successorId)),
  };
}

// ---------------------------------------------------------------------------
// 다가올 알림
// ---------------------------------------------------------------------------

export interface UpcomingNotificationDto {
  plannedAt: string;
  targetDate: PlainDate;
  channels: string[];
  kind: "SCHEDULED" | "OVERDUE_REMINDER";
  occurrenceId: string;
  occurrenceDate: PlainDate;
}

/**
 * 이 업무의 다가올 알림 목록.
 *
 * 발송 계획을 DB 에 materialize 하지 않는 설계이므로(DECISIONS D-015),
 * 이런 조회는 온디맨드로 계산한다.
 */
export async function getUpcomingNotifications(
  taskId: string,
  options: { now?: Date; limit?: number } = {},
): Promise<UpcomingNotificationDto[]> {
  const now = options.now ?? new Date();
  const limit = options.limit ?? 10;

  const [rules, occurrences, calendar] = await Promise.all([
    prisma.notificationRule.findMany({ where: { taskId, isActive: true } }),
    prisma.occurrence.findMany({
      where: { taskId, status: { in: ["PENDING", "IN_PROGRESS"] } },
      select: { id: true, taskId: true, scheduledDate: true, status: true },
      orderBy: { scheduledDate: "asc" },
      // 앞으로 몇 회차만 보면 충분하다.
      take: 12,
    }),
    getHolidayCalendar(),
  ]);

  if (rules.length === 0 || occurrences.length === 0) return [];

  const ruleSpecs = rules.map((rule) => ({
    id: rule.id,
    offsetDays: rule.offsetDays,
    timeOfDay: rule.timeOfDay,
    offsetUnit: rule.offsetUnit as "CALENDAR_DAY" | "BUSINESS_DAY",
    channels: parseChannels(rule.channels),
    isOverdueReminder: rule.isOverdueReminder,
    repeatIntervalHours: rule.repeatIntervalHours,
    maxRepeats: rule.maxRepeats,
    isActive: rule.isActive,
  }));

  const result: UpcomingNotificationDto[] = [];

  for (const occurrence of occurrences) {
    const scheduledDate = toPlainDate(occurrence.scheduledDate);
    const upcoming = previewUpcomingNotifications({
      occurrence: {
        id: occurrence.id,
        taskId: occurrence.taskId,
        scheduledDate,
        status: occurrence.status as "PENDING" | "IN_PROGRESS",
      },
      rules: ruleSpecs,
      now,
      calendar,
    });

    for (const item of upcoming) {
      result.push({
        plannedAt: item.plannedAt.toISOString(),
        targetDate: item.targetDate,
        channels: item.channels,
        kind: item.kind,
        occurrenceId: occurrence.id,
        occurrenceDate: scheduledDate,
      });
    }
  }

  return result
    .sort((a, b) => a.plannedAt.localeCompare(b.plannedAt))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// 통합 조회
// ---------------------------------------------------------------------------

export interface TaskHistoryStats {
  /** 생성된 전체 회차 수 (미래 포함) */
  total: number;
  /** 마감일이 이미 지난 회차 수 — 완료율의 분모가 된다 */
  elapsed: number;
  done: number;
  overdue: number;
  skipped: number;
  /** 아직 마감일이 오지 않은 회차 수 */
  upcoming: number;
  completionRate: number;
  /** 마감일 대비 평균 완료 지연 일수 (음수면 평균적으로 미리 끝냄) */
  averageDelayDays: number | null;
  /** 마감일을 넘겨 완료한 회차 수 */
  lateCompletions: number;
}

/**
 * 발생 이력 통계.
 *
 * [완료율의 분모]
 *   아직 마감일이 오지 않은 회차는 "미완료"가 아니라 "아직 차례가 아닌" 것이다.
 *   롤링 윈도우가 18개월치를 미리 생성하기 때문에, 미래 회차를 분모에 넣으면
 *   완료율이 실제보다 크게 낮게 나온다.
 *   따라서 **마감일이 이미 지난 회차**만 분모로 삼고, 건너뛴 회차는 제외한다.
 */
export function computeHistoryStats(
  occurrences: OccurrenceDto[],
  today: PlainDate = todayInSeoul(),
): TaskHistoryStats {
  const total = occurrences.length;

  // 마감일이 오늘 이전인 회차 = 평가 대상. 오늘 마감분은 아직 시간이 남았으므로 제외한다.
  const elapsedList = occurrences.filter((o) => o.scheduledDate < today);
  const skipped = elapsedList.filter((o) => o.storedStatus === "SKIPPED").length;
  const doneList = elapsedList.filter((o) => o.storedStatus === "DONE");
  const overdue = occurrences.filter((o) => o.derived.status === "OVERDUE").length;

  // 완료 시각과 마감일의 차이를 일 단위로 집계
  const delays: number[] = [];
  for (const occurrence of doneList) {
    if (!occurrence.completedAt) continue;
    const completedDate = todayInSeoul(new Date(occurrence.completedAt));
    const diff =
      (new Date(`${completedDate}T00:00:00Z`).getTime() -
        new Date(`${occurrence.scheduledDate}T00:00:00Z`).getTime()) /
      86_400_000;
    delays.push(diff);
  }

  const denominator = elapsedList.length - skipped;

  return {
    total,
    elapsed: elapsedList.length,
    done: doneList.length,
    overdue,
    skipped,
    upcoming: total - elapsedList.length,
    completionRate:
      denominator > 0 ? Math.round((doneList.length / denominator) * 100) : 0,
    averageDelayDays:
      delays.length > 0
        ? Math.round((delays.reduce((a, b) => a + b, 0) / delays.length) * 10) / 10
        : null,
    lateCompletions: delays.filter((d) => d > 0).length,
  };
}

export { getTaskOccurrenceHistory };
