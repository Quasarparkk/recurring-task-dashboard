"use client";

/**
 * 연간 대시보드 그리드 (12개월 × 업무)
 * ============================================================================
 * 각 셀에 해당 월의 발생 건을 상태 색상으로 표시한다.
 * 셀을 클릭하면 그 달의 월간 뷰로 이동한다.
 */

import Link from "next/link";
import { AlertTriangle, ArrowUpRight, Ban, Clock } from "lucide-react";

import { CategoryBadge, PriorityBadge, StatusBadge } from "@/components/status-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { formatCompact, getMonth } from "@/lib/date/plain-date";
import type { OccurrenceDto, YearlyDashboard } from "@/lib/services/dashboard-service";
import { PRIORITY_BAR, STATUS_LABEL, STATUS_STYLE } from "@/lib/ui/status-style";
import { cn } from "@/lib/utils";

const MONTH_LABELS = [
  "1월", "2월", "3월", "4월", "5월", "6월",
  "7월", "8월", "9월", "10월", "11월", "12월",
] as const;

export function YearGrid({
  dashboard,
  searchQuery,
}: {
  dashboard: YearlyDashboard;
  /** 현재 필터 쿼리스트링 (월간 뷰 링크에 이어 붙임) */
  searchQuery: string;
}) {
  const currentMonthIndex = getMonth(dashboard.today) - 1;
  const isCurrentYear = dashboard.today.startsWith(String(dashboard.year));

  if (dashboard.rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center">
        <p className="text-sm font-medium">표시할 업무가 없습니다.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          필터를 해제하거나 다른 연도를 선택해 보세요.
        </p>
      </div>
    );
  }

  return (
    <div className="year-grid-scroll overflow-x-auto rounded-lg border">
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead>
          <tr>
            <th className="sticky left-0 z-20 min-w-[280px] border-b border-r bg-muted/50 px-3 py-2 text-left text-xs font-medium text-muted-foreground backdrop-blur">
              업무
            </th>
            {MONTH_LABELS.map((label, index) => (
              <th
                key={label}
                className={cn(
                  "min-w-[86px] border-b px-1 py-2 text-center text-xs font-medium",
                  index < 11 && "border-r",
                  isCurrentYear && index === currentMonthIndex
                    ? "bg-primary/10 text-foreground"
                    : "bg-muted/50 text-muted-foreground",
                )}
              >
                <div>{label}</div>
                {dashboard.monthlyTotals[index].total > 0 && (
                  <div className="mt-0.5 flex items-center justify-center gap-1 text-[10px] font-normal">
                    <span className="text-muted-foreground">
                      {dashboard.monthlyTotals[index].done}/
                      {dashboard.monthlyTotals[index].total}
                    </span>
                    {dashboard.monthlyTotals[index].overdue > 0 && (
                      <span className="text-status-overdue-fg">
                        ⚠{dashboard.monthlyTotals[index].overdue}
                      </span>
                    )}
                  </div>
                )}
              </th>
            ))}
            <th className="min-w-[76px] border-b border-l bg-muted/50 px-2 py-2 text-center text-xs font-medium text-muted-foreground">
              연간
            </th>
          </tr>
        </thead>

        <tbody>
          {dashboard.rows.map((row) => (
            <tr key={row.taskId} className="group">
              {/* ---------- 업무 정보 (고정 열) ---------- */}
              <th
                scope="row"
                className="sticky left-0 z-10 border-b border-r bg-background px-0 py-0 text-left align-top group-hover:bg-accent/40"
              >
                <div className="flex items-stretch">
                  <span
                    className={cn("w-1 shrink-0", PRIORITY_BAR[row.priority])}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1 px-2.5 py-2">
                    <Link
                      href={`/tasks/${row.taskId}`}
                      className="flex items-start gap-1 font-medium leading-snug hover:underline"
                    >
                      <span className="min-w-0">{row.taskTitle}</span>
                      <ArrowUpRight className="mt-0.5 size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
                    </Link>

                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {row.category && (
                        <CategoryBadge
                          name={row.category.name}
                          color={row.category.color}
                        />
                      )}
                      <PriorityBadge priority={row.priority} />
                      {!row.isActive && (
                        <span className="rounded border px-1.5 py-0 text-[10px] text-muted-foreground">
                          보관
                        </span>
                      )}
                    </div>

                    <p className="mt-1 truncate text-[11px] text-muted-foreground">
                      {row.recurrenceSummary}
                    </p>
                    {row.defaultAssignee && (
                      <p className="text-[11px] text-muted-foreground">
                        {row.defaultAssignee.name}
                        {row.defaultAssignee.department
                          ? ` · ${row.defaultAssignee.department}`
                          : ""}
                      </p>
                    )}
                  </div>
                </div>
              </th>

              {/* ---------- 12개월 셀 ---------- */}
              {row.months.map((occurrences, monthIndex) => (
                <td
                  key={monthIndex}
                  className={cn(
                    "border-b p-1 align-top",
                    monthIndex < 11 && "border-r",
                    isCurrentYear && monthIndex === currentMonthIndex && "bg-primary/5",
                  )}
                >
                  {occurrences.length === 0 ? (
                    <div className="h-full min-h-[28px]" />
                  ) : (
                    <div className="flex flex-col gap-1">
                      {occurrences.map((occurrence) => (
                        <OccurrenceCell
                          key={occurrence.id}
                          occurrence={occurrence}
                          searchQuery={searchQuery}
                        />
                      ))}
                    </div>
                  )}
                </td>
              ))}

              {/* ---------- 연간 합계 ---------- */}
              <td className="border-b border-l px-2 py-2 align-top text-center">
                <div className="text-xs font-medium tabular-nums">
                  {row.totals.done}/{row.totals.total - row.totals.skipped}
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-center gap-1 text-[10px]">
                  {row.totals.overdue > 0 && (
                    <span className="text-status-overdue-fg">
                      지연 {row.totals.overdue}
                    </span>
                  )}
                  {row.totals.blocked > 0 && (
                    <span className="text-status-blocked-fg">
                      대기 {row.totals.blocked}
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 개별 셀
// ---------------------------------------------------------------------------

function OccurrenceCell({
  occurrence,
  searchQuery,
}: {
  occurrence: OccurrenceDto;
  searchQuery: string;
}) {
  const { derived } = occurrence;
  const style = STATUS_STYLE[derived.status];
  const monthParam = getMonth(occurrence.scheduledDate);
  const yearParam = occurrence.scheduledDate.slice(0, 4);

  const params = new URLSearchParams(searchQuery);
  params.set("year", yearParam);
  params.set("month", String(monthParam));

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={`/month?${params.toString()}`}
          className={cn(
            "flex items-center justify-between gap-1 rounded border px-1.5 py-1 text-[11px] leading-tight transition-transform hover:scale-[1.03]",
            style.cell,
            style.text,
          )}
        >
          <span className="font-medium tabular-nums">
            {formatCompact(occurrence.scheduledDate)}
          </span>
          <span className="flex items-center gap-0.5">
            {derived.status === "OVERDUE" && (
              <AlertTriangle className="size-3" aria-hidden />
            )}
            {derived.status === "BLOCKED" && <Clock className="size-3" aria-hidden />}
            {derived.status === "SKIPPED" && <Ban className="size-3" aria-hidden />}
            {occurrence.checklistTotal > 0 && derived.status !== "DONE" && (
              <span className="tabular-nums opacity-70">
                {occurrence.checklistDone}/{occurrence.checklistTotal}
              </span>
            )}
          </span>
        </Link>
      </TooltipTrigger>

      <TooltipContent side="top" className="max-w-xs">
        <div className="space-y-1.5">
          <p className="font-medium">{occurrence.taskTitle}</p>

          <div className="flex items-center gap-1.5">
            <StatusBadge status={derived.status} size="xs" />
            <span className="text-xs tabular-nums">
              {occurrence.scheduledDate}
              {occurrence.shiftReason && occurrence.originalDate !== occurrence.scheduledDate && (
                <span className="ml-1 opacity-70">
                  (원래 {occurrence.originalDate})
                </span>
              )}
            </span>
          </div>

          {derived.daysUntilDue !== null && derived.status !== "DONE" && (
            <p className="text-xs">
              {derived.daysUntilDue > 0
                ? `마감까지 ${derived.daysUntilDue}일`
                : derived.daysUntilDue === 0
                  ? "오늘 마감"
                  : `마감 ${Math.abs(derived.daysUntilDue)}일 초과`}
            </p>
          )}

          {occurrence.assignee && (
            <p className="text-xs opacity-80">담당: {occurrence.assignee.name}</p>
          )}

          {derived.blockedBy.length > 0 && (
            <p className="text-xs">
              선행 {derived.blockedBy.length}건 미완료 → 착수 예상{" "}
              {derived.blockedBy[0].projectedReadyDate}
            </p>
          )}

          {derived.delayImpact && (
            <p className="text-xs text-status-overdue-fg">
              ⚠ 선행 지연으로 마감 {derived.delayImpact.overshootDays}일 초과 예상
            </p>
          )}

          {occurrence.checklistTotal > 0 && (
            <p className="text-xs opacity-80">
              체크리스트 {occurrence.checklistDone}/{occurrence.checklistTotal}
            </p>
          )}

          <p className="pt-0.5 text-[10px] opacity-60">
            클릭하면 {monthParam}월 월간 뷰로 이동합니다
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

/** 상태 라벨을 외부에서도 쓸 수 있게 재노출 */
export { STATUS_LABEL };
