/**
 * 업무 목록 (템플릿 관리)
 * ============================================================================
 * 연간 대시보드가 "회차"를 보여주는 화면이라면, 이 페이지는 "업무 정의" 자체를
 * 관리하는 화면이다. 보관된 업무나 회차가 아직 없는 업무도 여기서 보인다.
 */

import Link from "next/link";
import { Suspense } from "react";
import { Bell, GitBranch, ListChecks, Plus } from "lucide-react";

import { FilterBar } from "@/components/filter-bar";
import {
  CategoryBadge,
  PriorityBadge,
  TagBadge,
} from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { todayInSeoul } from "@/lib/date/kst";
import { toPlainDate } from "@/lib/date/plain-date";
import { prisma } from "@/lib/db";
import { describeConfig } from "@/lib/recurrence/describe";
import { safeParseRecurrenceConfig } from "@/lib/recurrence/types";
import { loadFilterOptions } from "@/lib/services/options-service";
import { PRIORITY_BAR } from "@/lib/ui/status-style";
import {
  parseOccurrenceFilter,
  PRIORITY_ORDER,
  type Priority,
} from "@/lib/validation/task-schema";
import { cn } from "@/lib/utils";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TaskListPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filter = parseOccurrenceFilter(params);
  const today = todayInSeoul();

  const where: Record<string, unknown> = {};
  if (filter.categoryId) where.categoryId = filter.categoryId;
  if (filter.priority) where.priority = filter.priority;
  if (filter.assigneeId) where.defaultAssigneeId = filter.assigneeId;
  if (filter.tagId) where.tags = { some: { id: filter.tagId } };
  if (filter.q) where.title = { contains: filter.q };

  const [tasks, options] = await Promise.all([
    prisma.task.findMany({
      where,
      include: {
        category: { select: { id: true, name: true, color: true } },
        tags: { select: { id: true, name: true, color: true }, orderBy: { name: "asc" } },
        defaultAssignee: { select: { id: true, name: true, department: true } },
        _count: {
          select: {
            occurrences: true,
            notificationRules: true,
            checklistTemplate: true,
            predecessorLinks: true,
            successorLinks: true,
          },
        },
      },
    }),
    loadFilterOptions(),
  ]);

  // 다음 예정 회차를 함께 표시한다.
  const nextOccurrences = await prisma.occurrence.groupBy({
    by: ["taskId"],
    where: {
      scheduledDate: { gte: new Date(`${today}T00:00:00.000Z`) },
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
    _min: { scheduledDate: true },
  });
  const nextByTask = new Map(
    nextOccurrences.map((row) => [row.taskId, row._min.scheduledDate]),
  );

  const sorted = [...tasks].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    const byPriority =
      PRIORITY_ORDER[a.priority as Priority] - PRIORITY_ORDER[b.priority as Priority];
    if (byPriority !== 0) return byPriority;
    return a.title.localeCompare(b.title, "ko");
  });

  const activeCount = tasks.filter((task) => task.isActive).length;

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 px-4 py-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">업무 목록</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            등록된 반복 업무 {tasks.length}건 (활성 {activeCount} · 보관{" "}
            {tasks.length - activeCount})
          </p>
        </div>

        <Button asChild size="sm">
          <Link href="/tasks/new">
            <Plus className="size-4" />
            업무 등록
          </Link>
        </Button>
      </div>

      <Suspense fallback={<div className="h-8" />}>
        <FilterBar options={options} />
      </Suspense>

      {sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center">
          <p className="text-sm font-medium">등록된 업무가 없습니다.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            필터를 해제하거나 새 업무를 등록해 보세요.
          </p>
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {sorted.map((task) => {
            const parsed = safeParseRecurrenceConfig(task.recurrenceConfig);
            const nextDate = nextByTask.get(task.id);

            return (
              <li
                key={task.id}
                className={cn(
                  "flex items-stretch bg-card transition-colors hover:bg-accent/30",
                  !task.isActive && "opacity-60",
                )}
              >
                <span
                  className={cn(
                    "w-1 shrink-0",
                    PRIORITY_BAR[task.priority as Priority],
                  )}
                  aria-hidden
                />

                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-3">
                  <div className="min-w-[16rem] flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link
                        href={`/tasks/${task.id}`}
                        className="font-medium hover:underline"
                      >
                        {task.title}
                      </Link>
                      <PriorityBadge priority={task.priority as Priority} />
                      {task.category && (
                        <CategoryBadge
                          name={task.category.name}
                          color={task.category.color}
                        />
                      )}
                      {task.tags.map((tag) => (
                        <TagBadge key={tag.id} name={tag.name} color={tag.color} />
                      ))}
                      {!task.isActive && (
                        <span className="rounded border px-1.5 py-0 text-[10px] text-muted-foreground">
                          보관
                        </span>
                      )}
                    </div>

                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {parsed.ok ? describeConfig(parsed.config) : "반복 규칙 해석 실패"}
                    </p>
                  </div>

                  <div className="w-[10rem] shrink-0 text-xs">
                    {task.defaultAssignee ? (
                      <>
                        <div className="font-medium">{task.defaultAssignee.name}</div>
                        <div className="text-muted-foreground">
                          {task.defaultAssignee.department}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">담당자 미지정</span>
                    )}
                  </div>

                  <div className="w-[8rem] shrink-0 text-xs">
                    <div className="text-muted-foreground">다음 회차</div>
                    <div className="font-medium tabular-nums">
                      {nextDate ? toPlainDate(nextDate) : "-"}
                    </div>
                  </div>

                  <div className="flex shrink-0 gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1" title="생성된 회차 수">
                      <span className="tabular-nums">{task._count.occurrences}</span>회차
                    </span>
                    <span
                      className="inline-flex items-center gap-1"
                      title="체크리스트 항목 수"
                    >
                      <ListChecks className="size-3.5" />
                      {task._count.checklistTemplate}
                    </span>
                    <span className="inline-flex items-center gap-1" title="알림 규칙 수">
                      <Bell className="size-3.5" />
                      {task._count.notificationRules}
                    </span>
                    <span
                      className="inline-flex items-center gap-1"
                      title="선행/후행 연결 수"
                    >
                      <GitBranch className="size-3.5" />
                      {task._count.predecessorLinks + task._count.successorLinks}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
