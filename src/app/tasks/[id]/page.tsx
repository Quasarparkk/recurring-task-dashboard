/**
 * 업무 상세
 * ============================================================================
 * 설명(Markdown) · 체크리스트 · 의존 그래프 · 과거 이력 · 알림 설정
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Bell,
  CalendarClock,
  ChevronLeft,
  Clock,
  ExternalLink,
  GitBranch,
  History,
  Pencil,
} from "lucide-react";

import { DependencyEditor } from "@/components/dependency-editor";
import {
  DependencyGraph,
  DependencyGraphLegend,
} from "@/components/dependency-graph";
import { MarkdownView } from "@/components/markdown-view";
import { OccurrenceDetailPanel } from "@/components/occurrence-detail-panel";
import { OccurrenceList } from "@/components/occurrence-list";
import { CategoryBadge, PriorityBadge, TagBadge } from "@/components/status-badge";
import { TaskArchiveToggle } from "@/components/task-archive-toggle";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { formatInstantKst, todayInSeoul } from "@/lib/date/kst";
import { formatKoreanShort } from "@/lib/date/plain-date";
import { prisma } from "@/lib/db";
import { MATCH_STRATEGY_LABELS } from "@/lib/dependency/status";
import { describeConfigParts } from "@/lib/recurrence/describe";
import { safeParseRecurrenceConfig } from "@/lib/recurrence/types";
import { getTaskOccurrenceHistory } from "@/lib/services/dashboard-service";
import { loadFilterOptions } from "@/lib/services/options-service";
import {
  computeHistoryStats,
  getTaskGraphData,
  getUpcomingNotifications,
} from "@/lib/services/task-detail-service";
import { getTaskDetail, listTaskOptions } from "@/lib/services/task-service";
import { parseChannels } from "@/lib/notification/registry";
import { LAG_UNIT_LABELS } from "@/lib/validation/task-schema";
import { cn } from "@/lib/utils";

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const CHANNEL_LABEL: Record<string, string> = {
  WEB_PUSH: "브라우저",
  EMAIL: "이메일",
  SLACK: "Slack",
  TEAMS: "Teams",
};

export default async function TaskDetailPage({ params, searchParams }: PageProps) {
  const { id } = await params;
  const query = await searchParams;
  const today = todayInSeoul();

  const task = await getTaskDetail(id);
  if (!task) notFound();

  const [history, graph, upcoming, options, taskOptions] = await Promise.all([
    getTaskOccurrenceHistory(id, { today }),
    getTaskGraphData(id, today),
    getUpcomingNotifications(id),
    loadFilterOptions(),
    listTaskOptions(),
  ]);

  const stats = computeHistoryStats(history, today);
  const parsedConfig = safeParseRecurrenceConfig(task.recurrenceConfig);

  // ---------- 표시할 회차 선택 ----------
  const requestedOccurrenceId = Array.isArray(query.occurrence)
    ? query.occurrence[0]
    : query.occurrence;

  // 기본값: 오늘 이후 첫 미완료 회차 → 없으면 가장 최근 회차
  const upcomingOccurrence =
    [...history]
      .reverse()
      .find(
        (occurrence) =>
          occurrence.scheduledDate >= today &&
          occurrence.storedStatus !== "DONE" &&
          occurrence.storedStatus !== "SKIPPED",
      ) ?? history[0];

  const selectedSummary =
    history.find((occurrence) => occurrence.id === requestedOccurrenceId) ??
    upcomingOccurrence;

  const selectedDetail = selectedSummary
    ? await loadOccurrenceDetail(selectedSummary.id)
    : null;

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 px-4 py-5">
      {/* ================= 헤더 ================= */}
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          연간 대시보드
        </Link>

        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">{task.title}</h1>

            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <PriorityBadge priority={task.priority as "HIGH" | "MEDIUM" | "LOW"} />
              {task.category && (
                <CategoryBadge name={task.category.name} color={task.category.color} />
              )}
              {task.tags.map((tag) => (
                <TagBadge key={tag.id} name={tag.name} color={tag.color} />
              ))}
              {!task.isActive && (
                <span className="rounded border px-1.5 py-0 text-[10px] text-muted-foreground">
                  보관 (신규 회차 생성 중지)
                </span>
              )}
            </div>

            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
              {task.defaultAssignee && (
                <span>
                  기본 담당자 {task.defaultAssignee.name}
                  {task.defaultAssignee.department
                    ? ` · ${task.defaultAssignee.department}`
                    : ""}
                </span>
              )}
              {task.estimatedHours !== null && (
                <span>예상 {task.estimatedHours}시간</span>
              )}
              <span>등록 {formatInstantKst(task.createdAt)}</span>
            </div>
          </div>

          <div className="flex shrink-0 gap-2">
            <TaskArchiveToggle taskId={task.id} isActive={task.isActive} />
            <Button asChild size="sm">
              <Link href={`/tasks/${task.id}/edit`}>
                <Pencil className="size-4" />
                수정
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* ================= 반복 규칙 요약 ================= */}
      <div className="rounded-lg border bg-card p-3">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <CalendarClock className="size-4 text-muted-foreground" />
          반복 규칙
        </h2>
        {parsedConfig.ok ? (
          <>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {describeConfigParts(parsedConfig.config).map((part, index) => (
                <span
                  key={index}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-xs",
                    index === 0
                      ? "bg-primary/10 font-medium text-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {part}
                </span>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              반복 시작 {parsedConfig.config.startDate}
              {parsedConfig.config.endDate && ` · 종료 ${parsedConfig.config.endDate}`}
              {task.generatedUntil &&
                ` · 회차 생성 완료 ${todayInSeoul(task.generatedUntil)} 까지`}
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-status-overdue-fg">
            반복 규칙을 해석할 수 없습니다: {parsedConfig.error}
          </p>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_460px]">
        {/* ================= 왼쪽 ================= */}
        <div className="space-y-5">
          {/* ---------- 상세 설명 ---------- */}
          <section>
            <h2 className="mb-2 text-sm font-semibold">상세 설명</h2>
            <div className="rounded-lg border bg-card p-4">
              {task.descriptionMd.trim() ? (
                <MarkdownView content={task.descriptionMd} />
              ) : (
                <p className="text-sm text-muted-foreground">
                  작성된 설명이 없습니다.{" "}
                  <Link href={`/tasks/${task.id}/edit`} className="underline">
                    수정
                  </Link>
                  에서 업무 절차와 주의사항을 기록해 두면 담당자가 바뀌어도 인수인계가
                  쉬워집니다.
                </p>
              )}
            </div>
          </section>

          {/* ---------- 참고 링크 ---------- */}
          {task.referenceLinks.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">참고 링크</h2>
              <ul className="flex flex-wrap gap-2">
                {task.referenceLinks.map((link) => (
                  <li key={link.id}>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-sm transition-colors hover:bg-accent"
                    >
                      {link.label}
                      <ExternalLink className="size-3.5 text-muted-foreground" />
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ---------- 의존 관계 ---------- */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <GitBranch className="size-4 text-muted-foreground" />
                선행 / 후행 업무
              </h2>
            </div>

            <div className="space-y-3">
              <DependencyGraph nodes={graph.nodes} edges={graph.edges} />
              {graph.nodes.length > 1 && <DependencyGraphLegend />}

              <div className="grid gap-3 sm:grid-cols-2">
                <DependencyTable
                  title="선행 업무"
                  emptyText="선행 업무가 없습니다."
                  items={graph.directPredecessors}
                />
                <DependencyTable
                  title="후행 업무"
                  emptyText="후행 업무가 없습니다."
                  items={graph.directSuccessors}
                />
              </div>

              <DependencyEditor
                taskId={task.id}
                taskTitle={task.title}
                taskOptions={taskOptions}
                existingPredecessorIds={graph.directPredecessors.map((d) => d.taskId)}
                existingSuccessorIds={graph.directSuccessors.map((d) => d.taskId)}
              />
            </div>
          </section>

          {/* ---------- 과거 이력 ---------- */}
          <section>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-1.5 text-sm font-semibold">
                <History className="size-4 text-muted-foreground" />
                발생 이력 ({history.length}건)
              </h2>

              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <span>
                  완료율 {stats.completionRate}%
                  <span className="ml-1 opacity-70">
                    ({stats.done}/{stats.elapsed - stats.skipped} 지난 회차 기준)
                  </span>
                </span>
                {stats.upcoming > 0 && <span>예정 {stats.upcoming}건</span>}
                {stats.averageDelayDays !== null && (
                  <span>
                    평균 완료{" "}
                    {stats.averageDelayDays > 0
                      ? `마감 +${stats.averageDelayDays}일`
                      : stats.averageDelayDays < 0
                        ? `마감 ${stats.averageDelayDays}일`
                        : "마감 당일"}
                  </span>
                )}
                {stats.lateCompletions > 0 && (
                  <span>지연 완료 {stats.lateCompletions}건</span>
                )}
                {stats.overdue > 0 && (
                  <span className="text-status-overdue-fg">
                    현재 지연 {stats.overdue}건
                  </span>
                )}
              </div>
            </div>

            <OccurrenceList
              occurrences={history}
              showTaskLink={false}
              emptyMessage="아직 생성된 회차가 없습니다."
            />
          </section>
        </div>

        {/* ================= 오른쪽 ================= */}
        <div className="space-y-5">
          {/* ---------- 선택된 회차 ---------- */}
          {selectedDetail ? (
            <section>
              <h2 className="mb-2 text-sm font-semibold">
                회차 상세
                {selectedSummary && selectedSummary.id === upcomingOccurrence?.id && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    (다가오는 회차)
                  </span>
                )}
              </h2>
              <OccurrenceDetailPanel
                occurrence={selectedDetail}
                users={options.users}
              />
            </section>
          ) : null}

          {/* ---------- 알림 설정 ---------- */}
          <section>
            <h2 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
              <Bell className="size-4 text-muted-foreground" />
              알림 설정
            </h2>

            <div className="space-y-2 rounded-lg border bg-card p-3">
              {task.notificationRules.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  알림이 설정되지 않았습니다.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {task.notificationRules.map((rule) => (
                    <li
                      key={rule.id}
                      className={cn(
                        "flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-2 py-1.5 text-xs",
                        rule.isOverdueReminder
                          ? "bg-status-overdue-bg/40"
                          : "bg-muted/50",
                        !rule.isActive && "opacity-50",
                      )}
                    >
                      <span className="font-medium">
                        {rule.isOverdueReminder
                          ? `지연 리마인더 ${rule.repeatIntervalHours}시간마다`
                          : rule.offsetDays === 0
                            ? "마감 당일"
                            : rule.offsetDays < 0
                              ? `D-${Math.abs(rule.offsetDays)}`
                              : `마감 +${rule.offsetDays}일`}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {rule.timeOfDay}
                      </span>
                      {rule.offsetUnit === "BUSINESS_DAY" && (
                        <span className="rounded bg-background px-1 text-[10px]">
                          영업일 기준
                        </span>
                      )}
                      {rule.maxRepeats !== null && rule.isOverdueReminder && (
                        <span className="text-muted-foreground">
                          최대 {rule.maxRepeats}회
                        </span>
                      )}
                      <span className="ml-auto flex gap-1">
                        {parseChannels(rule.channels).map((channel) => (
                          <span
                            key={channel}
                            className="rounded bg-background px-1.5 text-[10px]"
                          >
                            {CHANNEL_LABEL[channel] ?? channel}
                          </span>
                        ))}
                      </span>
                      {!rule.isActive && (
                        <span className="text-[10px] text-muted-foreground">비활성</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* 다가올 알림 */}
              {upcoming.length > 0 && (
                <>
                  <Separator />
                  <div>
                    <h3 className="text-xs font-medium text-muted-foreground">
                      다가올 알림
                    </h3>
                    <ul className="mt-1 space-y-1">
                      {upcoming.slice(0, 6).map((item, index) => (
                        <li
                          key={`${item.occurrenceId}-${index}`}
                          className="flex flex-wrap items-center gap-x-2 text-xs"
                        >
                          <Clock className="size-3 text-muted-foreground" />
                          <span className="tabular-nums">
                            {formatInstantKst(item.plannedAt)}
                          </span>
                          <span className="text-muted-foreground">
                            ({formatKoreanShort(item.occurrenceDate)} 마감분
                            {item.kind === "OVERDUE_REMINDER" && ", 지연 시"})
                          </span>
                          <span className="flex gap-1">
                            {item.channels.map((channel) => (
                              <span
                                key={channel}
                                className="rounded bg-muted px-1 text-[10px]"
                              >
                                {CHANNEL_LABEL[channel] ?? channel}
                              </span>
                            ))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* ---------- 체크리스트 템플릿 ---------- */}
          {task.checklistTemplate.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">
                체크리스트 템플릿
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  ({task.checklistTemplate.length}개 · 새 회차마다 복제)
                </span>
              </h2>
              <ul className="space-y-1 rounded-lg border bg-card p-3">
                {task.checklistTemplate.map((item) => (
                  <li key={item.id} className="flex items-start gap-2 text-sm">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                    <span>
                      {item.title}
                      {item.isRequired && (
                        <span className="ml-1.5 text-[10px] text-status-overdue-fg">
                          필수
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 의존 관계 표
// ---------------------------------------------------------------------------

function DependencyTable({
  title,
  emptyText,
  items,
}: {
  title: string;
  emptyText: string;
  items: {
    id: string;
    taskId: string;
    taskTitle: string;
    isActive: boolean;
    lagAmount: number;
    lagUnit: "BUSINESS_DAY" | "CALENDAR_DAY";
    matchStrategy: "SAME_SEQUENCE" | "NEAREST_PRECEDING" | "SAME_PERIOD";
    isBlocking: boolean;
    note: string | null;
  }[];
}) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>

      {items.length === 0 ? (
        <p className="mt-1.5 text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="mt-1.5 space-y-2">
          {items.map((item) => (
            <li key={item.id} className="text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <Link href={`/tasks/${item.taskId}`} className="font-medium hover:underline">
                  {item.taskTitle}
                </Link>
                {!item.isBlocking && (
                  <span className="rounded border px-1.5 py-0 text-[10px] text-muted-foreground">
                    참고용
                  </span>
                )}
                {!item.isActive && (
                  <span className="rounded border px-1.5 py-0 text-[10px] text-muted-foreground">
                    보관
                  </span>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                {item.lagAmount > 0
                  ? `완료 후 ${item.lagAmount}${LAG_UNIT_LABELS[item.lagUnit]} 뒤`
                  : "즉시"}
                {" · "}
                {MATCH_STRATEGY_LABELS[item.matchStrategy]} 매칭
              </p>

              {item.note && (
                <p className="mt-0.5 text-xs text-muted-foreground/80">{item.note}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 회차 상세 로딩
// ---------------------------------------------------------------------------

async function loadOccurrenceDetail(occurrenceId: string) {
  const today = todayInSeoul();

  const row = await prisma.occurrence.findUnique({
    where: { id: occurrenceId },
    include: {
      checklist: { orderBy: { sortOrder: "asc" } },
      notificationLogs: { orderBy: { plannedAt: "desc" }, take: 20 },
    },
  });

  if (!row) return null;

  // 파생 상태와 차단 정보는 이력 조회와 같은 경로로 계산해 일관성을 유지한다.
  const history = await getTaskOccurrenceHistory(row.taskId, { today });
  const summary = history.find((occurrence) => occurrence.id === occurrenceId);
  if (!summary) return null;

  // 차단 원인 회차의 업무 제목을 붙인다.
  const blockerTaskIds = summary.derived.blockedBy.map((b) => b.taskId);
  const blockerTasks =
    blockerTaskIds.length > 0
      ? await prisma.task.findMany({
          where: { id: { in: blockerTaskIds } },
          select: { id: true, title: true },
        })
      : [];
  const blockerTitleById = new Map(blockerTasks.map((t) => [t.id, t.title]));

  return {
    id: row.id,
    sequenceIndex: row.sequenceIndex,
    scheduledDate: summary.scheduledDate,
    originalDate: summary.originalDate,
    shiftReason: summary.shiftReason,
    storedStatus: summary.storedStatus,
    derived: summary.derived,
    assigneeId: row.assigneeId,
    memo: row.memo,
    completedAt: row.completedAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    checklist: row.checklist.map((item) => ({
      id: item.id,
      title: item.title,
      isRequired: item.isRequired,
      isChecked: item.isChecked,
    })),
    notificationLogs: row.notificationLogs.map((log) => ({
      id: log.id,
      channel: log.channel,
      kind: log.kind,
      status: log.status,
      plannedAt: log.plannedAt.toISOString(),
      sentAt: log.sentAt?.toISOString() ?? null,
      title: log.title,
      error: log.error,
    })),
    blockedByDetails: summary.derived.blockedBy.map((blocker) => ({
      occurrenceId: blocker.occurrenceId,
      taskId: blocker.taskId,
      taskTitle: blockerTitleById.get(blocker.taskId) ?? "(업무)",
      scheduledDate: blocker.scheduledDate,
      projectedReadyDate: blocker.projectedReadyDate,
    })),
  };
}
