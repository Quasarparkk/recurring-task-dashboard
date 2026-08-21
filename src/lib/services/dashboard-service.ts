/**
 * 대시보드 조회 서비스
 * ============================================================================
 *
 * 연간 그리드 / 월간 뷰 / 목록에 필요한 데이터를 조립한다.
 * 파생 상태(BLOCKED/OVERDUE)는 DB 에 없으므로 여기서 계산해 붙인다.
 */

import { EMPTY_HOLIDAY_CALENDAR, type HolidayCalendar } from "@/lib/date/business-day";
import { todayInSeoul } from "@/lib/date/kst";
import {
  addMonths,
  endOfMonth,
  getMonth,
  plainDateOf,
  startOfMonth,
  toDbDate,
  toPlainDate,
  type PlainDate,
} from "@/lib/date/plain-date";
import { prisma } from "@/lib/db";
import {
  computeDerivedStatuses,
  type DerivedStatus,
  type OccurrenceNode,
  type OccurrenceOverrideLink,
  type StoredOccurrenceStatus,
  type TaskDependencyLink,
} from "@/lib/dependency/status";
import { describeConfig } from "@/lib/recurrence/describe";
import type { ShiftReason } from "@/lib/recurrence/engine";
import { safeParseRecurrenceConfig } from "@/lib/recurrence/types";
import type { OccurrenceFilter, Priority } from "@/lib/validation/task-schema";
import { PRIORITY_ORDER } from "@/lib/validation/task-schema";
import { getHolidayCalendar } from "./holiday-service";

// ---------------------------------------------------------------------------
// DTO
// ---------------------------------------------------------------------------

export interface UserRef {
  id: string;
  name: string;
  department: string | null;
}

export interface CategoryRef {
  id: string;
  name: string;
  color: string | null;
}

export interface TagRef {
  id: string;
  name: string;
  color: string | null;
}

export interface OccurrenceDto {
  id: string;
  taskId: string;
  taskTitle: string;
  sequenceIndex: number;

  scheduledDate: PlainDate;
  originalDate: PlainDate;
  shiftReason: ShiftReason | null;

  storedStatus: StoredOccurrenceStatus;
  derived: DerivedStatus;

  assignee: UserRef | null;
  priority: Priority;
  category: CategoryRef | null;
  tags: TagRef[];

  memo: string | null;
  completedAt: string | null;

  checklistTotal: number;
  checklistDone: number;
}

// ---------------------------------------------------------------------------
// 내부 로딩
// ---------------------------------------------------------------------------

/**
 * 의존관계 계산을 위한 컨텍스트 범위 확장 폭(개월).
 * 선행 회차가 조회 범위 밖에 있을 수 있으므로 넉넉히 잡는다.
 */
const DEPENDENCY_CONTEXT_MONTHS = 12;

function toOccurrenceNode(row: {
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
    // completedAt 은 실제 시각이므로 서울 기준 달력 날짜로 환산한다.
    completedDate: row.completedAt ? todayInSeoul(row.completedAt) : null,
  };
}

async function loadDependencyContext(): Promise<{
  links: TaskDependencyLink[];
  overrides: OccurrenceOverrideLink[];
}> {
  const [linkRows, overrideRows] = await Promise.all([
    prisma.taskDependency.findMany(),
    prisma.occurrenceDependencyOverride.findMany(),
  ]);

  return {
    links: linkRows.map((row) => ({
      id: row.id,
      predecessorTaskId: row.predecessorId,
      successorTaskId: row.successorId,
      lagAmount: row.lagAmount,
      lagUnit: row.lagUnit as TaskDependencyLink["lagUnit"],
      matchStrategy: row.matchStrategy as TaskDependencyLink["matchStrategy"],
      isBlocking: row.isBlocking,
    })),
    overrides: overrideRows.map((row) => ({
      id: row.id,
      predecessorOccurrenceId: row.predecessorOccurrenceId,
      successorOccurrenceId: row.successorOccurrenceId,
      lagAmount: row.lagAmount,
      lagUnit: row.lagUnit as OccurrenceOverrideLink["lagUnit"],
      isBlocking: row.isBlocking,
    })),
  };
}

/** Prisma include 로 함께 읽어오는 필드 집합 */
const occurrenceInclude = {
  task: {
    select: {
      id: true,
      title: true,
      priority: true,
      isActive: true,
      category: { select: { id: true, name: true, color: true } },
      tags: { select: { id: true, name: true, color: true }, orderBy: { name: "asc" } },
    },
  },
  assignee: { select: { id: true, name: true, department: true } },
  checklist: { select: { isChecked: true } },
} as const;

// ---------------------------------------------------------------------------
// 범위 조회 (핵심)
// ---------------------------------------------------------------------------

export interface LoadOccurrencesOptions {
  from: PlainDate;
  to: PlainDate;
  filter?: OccurrenceFilter;
  today?: PlainDate;
  calendar?: HolidayCalendar;
}

/**
 * 지정 범위의 발생 건을 파생 상태와 함께 조회한다.
 *
 * 필터 적용 순서가 중요하다:
 *   1. Task/담당자 등 DB 로 걸 수 있는 조건 → SQL WHERE
 *   2. 파생 상태(BLOCKED/OVERDUE) → 계산 후 메모리에서 필터
 */
export async function loadOccurrences(
  options: LoadOccurrencesOptions,
): Promise<OccurrenceDto[]> {
  const { from, to, filter = {} } = options;
  const today = options.today ?? todayInSeoul();
  const calendar =
    options.calendar ?? (await getHolidayCalendar().catch(() => EMPTY_HOLIDAY_CALENDAR));

  // --- SQL 단계 필터 -----------------------------------------------------
  // 주의: Task.isActive 로는 걸지 않는다. "보관"은 신규 회차 생성을 멈추는 개념이므로
  //       보관된 업무의 과거 회차도 대시보드에 계속 보여야 한다.
  const taskWhere: Record<string, unknown> = {};
  if (filter.categoryId) taskWhere.categoryId = filter.categoryId;
  if (filter.priority) taskWhere.priority = filter.priority;
  if (filter.tagId) taskWhere.tags = { some: { id: filter.tagId } };
  if (filter.q) taskWhere.title = { contains: filter.q };

  const rows = await prisma.occurrence.findMany({
    where: {
      scheduledDate: { gte: toDbDate(from), lte: toDbDate(to) },
      ...(filter.assigneeId ? { assigneeId: filter.assigneeId } : {}),
      ...(Object.keys(taskWhere).length > 0 ? { task: taskWhere } : {}),
    },
    include: occurrenceInclude,
    orderBy: [{ scheduledDate: "asc" }, { taskId: "asc" }],
  });

  if (rows.length === 0) return [];

  // --- 의존관계 계산용 컨텍스트 ------------------------------------------
  // 선행 회차가 조회 범위 밖에 있을 수 있으므로 넓게 읽는다.
  const contextFrom = addMonths(from, -DEPENDENCY_CONTEXT_MONTHS);
  const contextTo = addMonths(to, DEPENDENCY_CONTEXT_MONTHS);

  const [contextRows, dependencyContext] = await Promise.all([
    prisma.occurrence.findMany({
      where: { scheduledDate: { gte: toDbDate(contextFrom), lte: toDbDate(contextTo) } },
      select: {
        id: true,
        taskId: true,
        sequenceIndex: true,
        scheduledDate: true,
        status: true,
        completedAt: true,
      },
    }),
    loadDependencyContext(),
  ]);

  const allOccurrences = contextRows.map(toOccurrenceNode);
  const targetNodes = rows.map(toOccurrenceNode);

  const derivedMap = computeDerivedStatuses({
    occurrences: targetNodes,
    allOccurrences,
    links: dependencyContext.links,
    overrides: dependencyContext.overrides,
    today,
    calendar,
  });

  // --- DTO 변환 ----------------------------------------------------------
  let result: OccurrenceDto[] = rows.map((row) => {
    const derived = derivedMap.get(row.id)!;
    return {
      id: row.id,
      taskId: row.taskId,
      taskTitle: row.task.title,
      sequenceIndex: row.sequenceIndex,
      scheduledDate: toPlainDate(row.scheduledDate),
      originalDate: toPlainDate(row.originalDate),
      shiftReason: (row.shiftReason as ShiftReason | null) ?? null,
      storedStatus: row.status as StoredOccurrenceStatus,
      derived,
      assignee: row.assignee
        ? {
            id: row.assignee.id,
            name: row.assignee.name,
            department: row.assignee.department,
          }
        : null,
      priority: row.task.priority as Priority,
      category: row.task.category ?? null,
      tags: row.task.tags,
      memo: row.memo,
      completedAt: row.completedAt?.toISOString() ?? null,
      checklistTotal: row.checklist.length,
      checklistDone: row.checklist.filter((item) => item.isChecked).length,
    };
  });

  // --- 파생 상태 필터 ----------------------------------------------------
  if (filter.status) {
    result = result.filter((dto) => dto.derived.status === filter.status);
  }

  return result;
}

// ---------------------------------------------------------------------------
// 연간 대시보드
// ---------------------------------------------------------------------------

export interface YearlyTaskRow {
  taskId: string;
  taskTitle: string;
  priority: Priority;
  category: CategoryRef | null;
  tags: TagRef[];
  defaultAssignee: UserRef | null;
  isActive: boolean;
  recurrenceSummary: string;
  /** 인덱스 0 = 1월 ... 11 = 12월 */
  months: OccurrenceDto[][];
  /** 연간 합계 */
  totals: {
    total: number;
    done: number;
    overdue: number;
    blocked: number;
    inProgress: number;
    pending: number;
    skipped: number;
  };
}

export interface YearlyDashboard {
  year: number;
  today: PlainDate;
  rows: YearlyTaskRow[];
  /** 월별 합계 (인덱스 0 = 1월) */
  monthlyTotals: {
    total: number;
    done: number;
    overdue: number;
    blocked: number;
  }[];
  summary: {
    total: number;
    done: number;
    overdue: number;
    blocked: number;
    inProgress: number;
    pending: number;
    /**
     * 완료율. 분모는 **마감일이 이미 지난 회차 중 건너뛰지 않은 것**이다.
     * 롤링 윈도우가 미래 회차를 미리 생성하므로, 미래 회차를 분모에 넣으면
     * 연초·연중에 완료율이 실제보다 크게 낮게 나온다.
     */
    completionRate: number;
    /** 완료율 분모 (지난 회차 중 건너뛰지 않은 수) */
    completionBase: number;
  };
}

function emptyTotals(): YearlyTaskRow["totals"] {
  return {
    total: 0,
    done: 0,
    overdue: 0,
    blocked: 0,
    inProgress: 0,
    pending: 0,
    skipped: 0,
  };
}

function accumulate(totals: YearlyTaskRow["totals"], dto: OccurrenceDto): void {
  totals.total += 1;
  switch (dto.derived.status) {
    case "DONE":
      totals.done += 1;
      break;
    case "OVERDUE":
      totals.overdue += 1;
      break;
    case "BLOCKED":
      totals.blocked += 1;
      break;
    case "IN_PROGRESS":
      totals.inProgress += 1;
      break;
    case "SKIPPED":
      totals.skipped += 1;
      break;
    default:
      totals.pending += 1;
  }
}

export async function getYearlyDashboard(
  year: number,
  filter: OccurrenceFilter = {},
  options: { today?: PlainDate } = {},
): Promise<YearlyDashboard> {
  const today = options.today ?? todayInSeoul();
  const from = plainDateOf(year, 1, 1);
  const to = plainDateOf(year, 12, 31);

  const [occurrences, tasks] = await Promise.all([
    loadOccurrences({ from, to, filter, today }),
    prisma.task.findMany({
      select: {
        id: true,
        title: true,
        priority: true,
        isActive: true,
        recurrenceConfig: true,
        category: { select: { id: true, name: true, color: true } },
        tags: { select: { id: true, name: true, color: true }, orderBy: { name: "asc" } },
        defaultAssignee: { select: { id: true, name: true, department: true } },
      },
    }),
  ]);

  // 필터 결과에 회차가 하나라도 있는 업무만 행으로 표시한다.
  const byTask = new Map<string, OccurrenceDto[]>();
  for (const dto of occurrences) {
    const list = byTask.get(dto.taskId);
    if (list) list.push(dto);
    else byTask.set(dto.taskId, [dto]);
  }

  const taskById = new Map(tasks.map((task) => [task.id, task]));

  const rows: YearlyTaskRow[] = [];

  for (const [taskId, list] of byTask) {
    const task = taskById.get(taskId);
    if (!task) continue;

    const months: OccurrenceDto[][] = Array.from({ length: 12 }, () => []);
    const totals = emptyTotals();

    for (const dto of list) {
      const monthIndex = getMonth(dto.scheduledDate) - 1;
      if (monthIndex >= 0 && monthIndex < 12) months[monthIndex].push(dto);
      accumulate(totals, dto);
    }

    rows.push({
      taskId,
      taskTitle: task.title,
      priority: task.priority as Priority,
      category: task.category ?? null,
      tags: task.tags,
      defaultAssignee: task.defaultAssignee ?? null,
      isActive: task.isActive,
      recurrenceSummary: summarizeRecurrence(task.recurrenceConfig),
      months,
      totals,
    });
  }

  // 정렬: 중요도 → 카테고리 → 제목
  rows.sort((a, b) => {
    const byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (byPriority !== 0) return byPriority;
    const catA = a.category?.name ?? "";
    const catB = b.category?.name ?? "";
    if (catA !== catB) return catA.localeCompare(catB, "ko");
    return a.taskTitle.localeCompare(b.taskTitle, "ko");
  });

  // 월별 합계
  const monthlyTotals = Array.from({ length: 12 }, (_, monthIndex) => {
    let total = 0;
    let done = 0;
    let overdue = 0;
    let blocked = 0;
    for (const row of rows) {
      for (const dto of row.months[monthIndex]) {
        total += 1;
        if (dto.derived.status === "DONE") done += 1;
        else if (dto.derived.status === "OVERDUE") overdue += 1;
        else if (dto.derived.status === "BLOCKED") blocked += 1;
      }
    }
    return { total, done, overdue, blocked };
  });

  const summaryTotals = emptyTotals();
  for (const dto of occurrences) accumulate(summaryTotals, dto);

  // 완료율의 분모: 마감일이 이미 지난 회차 중 건너뛰지 않은 것.
  //   - 미래 회차는 "미완료"가 아니라 "아직 차례가 아닌" 것이므로 제외한다.
  //   - 건너뛴 회차는 의도적으로 하지 않은 것이므로 제외한다.
  const elapsed = occurrences.filter((dto) => dto.scheduledDate < today);
  const completionBase = elapsed.filter(
    (dto) => dto.storedStatus !== "SKIPPED",
  ).length;
  const completedElapsed = elapsed.filter(
    (dto) => dto.storedStatus === "DONE",
  ).length;

  return {
    year,
    today,
    rows,
    monthlyTotals,
    summary: {
      total: summaryTotals.total,
      done: summaryTotals.done,
      overdue: summaryTotals.overdue,
      blocked: summaryTotals.blocked,
      inProgress: summaryTotals.inProgress,
      pending: summaryTotals.pending,
      completionBase,
      completionRate:
        completionBase > 0
          ? Math.round((completedElapsed / completionBase) * 100)
          : 0,
    },
  };
}

/** 반복 규칙 요약 문자열. 파싱 실패 시 안전한 대체 문구를 준다. */
function summarizeRecurrence(raw: string): string {
  const parsed = safeParseRecurrenceConfig(raw);
  return parsed.ok ? describeConfig(parsed.config) : "반복 규칙 해석 실패";
}

// ---------------------------------------------------------------------------
// 월간 뷰
// ---------------------------------------------------------------------------

export interface MonthlyView {
  year: number;
  month: number;
  today: PlainDate;
  from: PlainDate;
  to: PlainDate;
  occurrences: OccurrenceDto[];
  /** 날짜별 그룹 (캘린더 렌더용). 키는 "YYYY-MM-DD" */
  byDate: Record<string, OccurrenceDto[]>;
  /** 이 달의 공휴일 */
  holidays: { date: PlainDate; name: string; type: string }[];
}

export async function getMonthlyView(
  year: number,
  month: number,
  filter: OccurrenceFilter = {},
  options: { today?: PlainDate } = {},
): Promise<MonthlyView> {
  const today = options.today ?? todayInSeoul();
  const anchor = plainDateOf(year, month, 1);
  const from = startOfMonth(anchor);
  const to = endOfMonth(anchor);

  const [occurrences, holidayRows] = await Promise.all([
    loadOccurrences({ from, to, filter, today }),
    prisma.holiday.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: "asc" },
      select: { date: true, name: true, type: true },
    }),
  ]);

  const byDate: Record<string, OccurrenceDto[]> = {};
  for (const dto of occurrences) {
    const list = byDate[dto.scheduledDate];
    if (list) list.push(dto);
    else byDate[dto.scheduledDate] = [dto];
  }

  return {
    year,
    month,
    today,
    from,
    to,
    occurrences,
    byDate,
    holidays: holidayRows.map((row) => ({
      date: row.date as PlainDate,
      name: row.name,
      type: row.type,
    })),
  };
}

// ---------------------------------------------------------------------------
// 업무별 이력
// ---------------------------------------------------------------------------

/** 특정 업무의 전체 회차 이력 (상세 화면용). */
export async function getTaskOccurrenceHistory(
  taskId: string,
  options: { today?: PlainDate; limit?: number } = {},
): Promise<OccurrenceDto[]> {
  const today = options.today ?? todayInSeoul();

  const rows = await prisma.occurrence.findMany({
    where: { taskId },
    include: occurrenceInclude,
    orderBy: { scheduledDate: "desc" },
    ...(options.limit ? { take: options.limit } : {}),
  });

  if (rows.length === 0) return [];

  const [contextRows, dependencyContext, calendar] = await Promise.all([
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
    loadDependencyContext(),
    getHolidayCalendar().catch(() => EMPTY_HOLIDAY_CALENDAR),
  ]);

  const targetNodes = rows.map(toOccurrenceNode);
  const derivedMap = computeDerivedStatuses({
    occurrences: targetNodes,
    allOccurrences: contextRows.map(toOccurrenceNode),
    links: dependencyContext.links,
    overrides: dependencyContext.overrides,
    today,
    calendar,
  });

  return rows.map((row) => ({
    id: row.id,
    taskId: row.taskId,
    taskTitle: row.task.title,
    sequenceIndex: row.sequenceIndex,
    scheduledDate: toPlainDate(row.scheduledDate),
    originalDate: toPlainDate(row.originalDate),
    shiftReason: (row.shiftReason as ShiftReason | null) ?? null,
    storedStatus: row.status as StoredOccurrenceStatus,
    derived: derivedMap.get(row.id)!,
    assignee: row.assignee
      ? {
          id: row.assignee.id,
          name: row.assignee.name,
          department: row.assignee.department,
        }
      : null,
    priority: row.task.priority as Priority,
    category: row.task.category ?? null,
    tags: row.task.tags,
    memo: row.memo,
    completedAt: row.completedAt?.toISOString() ?? null,
    checklistTotal: row.checklist.length,
    checklistDone: row.checklist.filter((item) => item.isChecked).length,
  }));
}
