"use client";

/**
 * 월간 캘린더
 * ============================================================================
 * 주 시작을 월요일로 두고(한국 업무 관행) 6주 그리드를 그린다.
 * 공휴일은 이름과 함께 표시해 마감일 이동 이유를 바로 알 수 있게 한다.
 */

import Link from "next/link";
import { AlertTriangle, Clock } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { StatusBadge } from "@/components/status-badge";
import {
  addDays,
  endOfMonth,
  getDayOfMonth,
  getMonth,
  getWeekday,
  plainDateOf,
  startOfWeekMonday,
  WEEKDAY_LABELS_KO,
  type PlainDate,
} from "@/lib/date/plain-date";
import type { MonthlyView, OccurrenceDto } from "@/lib/services/dashboard-service";
import { STATUS_STYLE } from "@/lib/ui/status-style";
import { cn } from "@/lib/utils";

/** 월요일 시작 요일 헤더 */
const WEEKDAY_HEADERS = [1, 2, 3, 4, 5, 6, 0] as const;

export function MonthCalendar({ view }: { view: MonthlyView }) {
  const monthStart = plainDateOf(view.year, view.month, 1);
  const monthEnd = endOfMonth(monthStart);
  const gridStart = startOfWeekMonday(monthStart);

  // 6주 = 42일 그리드. 마지막 주가 비면 렌더에서 제외한다.
  const days: PlainDate[] = [];
  for (let i = 0; i < 42; i += 1) days.push(addDays(gridStart, i));

  const weeks: PlainDate[][] = [];
  for (let i = 0; i < 6; i += 1) {
    const week = days.slice(i * 7, i * 7 + 7);
    // 이 주 전체가 다음 달이면 렌더하지 않는다.
    if (week[0] > monthEnd) break;
    weeks.push(week);
  }

  const holidayByDate = new Map(view.holidays.map((h) => [h.date, h]));

  return (
    <div className="overflow-hidden rounded-lg border">
      {/* ---------- 요일 헤더 ---------- */}
      <div className="grid grid-cols-7 border-b bg-muted/50">
        {WEEKDAY_HEADERS.map((weekday) => (
          <div
            key={weekday}
            className={cn(
              "px-2 py-1.5 text-center text-xs font-medium",
              weekday === 0
                ? "text-status-overdue-fg"
                : weekday === 6
                  ? "text-status-progress-fg"
                  : "text-muted-foreground",
            )}
          >
            {WEEKDAY_LABELS_KO[weekday]}
          </div>
        ))}
      </div>

      {/* ---------- 날짜 셀 ---------- */}
      <div className="grid grid-cols-7">
        {weeks.flat().map((date, index) => {
          const isCurrentMonth = getMonth(date) === view.month;
          const isToday = date === view.today;
          const holiday = holidayByDate.get(date);
          const weekday = getWeekday(date);
          const occurrences = view.byDate[date] ?? [];

          return (
            <div
              key={date}
              className={cn(
                "min-h-[110px] border-b border-r p-1.5",
                index % 7 === 6 && "border-r-0",
                !isCurrentMonth && "bg-muted/30",
                isToday && "bg-status-progress-bg/40 ring-1 ring-inset ring-status-progress-line/50",
              )}
            >
              {/* --- 날짜 라벨 --- */}
              <div className="mb-1 flex items-baseline justify-between gap-1">
                <span
                  className={cn(
                    "text-xs font-medium tabular-nums",
                    !isCurrentMonth && "text-muted-foreground/50",
                    isCurrentMonth && holiday && "text-holiday-fg",
                    isCurrentMonth && !holiday && weekday === 0 && "text-status-overdue-fg",
                    isCurrentMonth && !holiday && weekday === 6 && "text-status-progress-fg",
                    isToday && "rounded bg-status-progress-line px-1.5 text-white",
                  )}
                >
                  {getDayOfMonth(date)}
                </span>

                {holiday && isCurrentMonth && (
                  <span className="truncate rounded-sm bg-holiday-bg px-1 text-[9px] leading-4 text-holiday-fg">
                    {holiday.name}
                  </span>
                )}
              </div>

              {/* --- 발생 건 --- */}
              <div className="space-y-1">
                {occurrences.slice(0, 4).map((occurrence) => (
                  <CalendarItem key={occurrence.id} occurrence={occurrence} />
                ))}
                {occurrences.length > 4 && (
                  <p className="pl-0.5 text-[10px] text-muted-foreground">
                    +{occurrences.length - 4}건 더
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CalendarItem({ occurrence }: { occurrence: OccurrenceDto }) {
  const style = STATUS_STYLE[occurrence.derived.status];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={`/tasks/${occurrence.taskId}?occurrence=${occurrence.id}`}
          className={cn(
            "flex items-center gap-1 rounded border px-1 py-0.5 text-[10px] leading-tight",
            style.cell,
            style.text,
            "hover:brightness-95",
          )}
        >
          {occurrence.derived.status === "OVERDUE" && (
            <AlertTriangle className="size-2.5 shrink-0" aria-hidden />
          )}
          {occurrence.derived.status === "BLOCKED" && (
            <Clock className="size-2.5 shrink-0" aria-hidden />
          )}
          <span className="truncate">{occurrence.taskTitle}</span>
        </Link>
      </TooltipTrigger>

      <TooltipContent side="right" className="max-w-xs">
        <div className="space-y-1.5">
          <p className="font-medium">{occurrence.taskTitle}</p>
          <div className="flex items-center gap-1.5">
            <StatusBadge status={occurrence.derived.status} size="xs" />
            {occurrence.assignee && (
              <span className="text-xs opacity-80">{occurrence.assignee.name}</span>
            )}
          </div>
          {occurrence.originalDate !== occurrence.scheduledDate && (
            <p className="text-xs opacity-80">
              원래 예정일 {occurrence.originalDate} → 휴일이라 이동
            </p>
          )}
          {occurrence.derived.blockedBy.length > 0 && (
            <p className="text-xs">
              선행 {occurrence.derived.blockedBy.length}건 미완료
            </p>
          )}
          {occurrence.checklistTotal > 0 && (
            <p className="text-xs opacity-80">
              체크리스트 {occurrence.checklistDone}/{occurrence.checklistTotal}
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
