"use client";

/**
 * 발생 건 리스트 — 월간 뷰의 리스트 모드 및 업무 상세 이력에서 사용
 */

import Link from "next/link";
import { AlertTriangle, ChevronRight, Clock } from "lucide-react";

import {
  CategoryBadge,
  PriorityBadge,
  StatusBadge,
  TagBadge,
} from "@/components/status-badge";
import { OccurrenceQuickActions } from "@/components/occurrence-quick-actions";
import { formatKoreanShort } from "@/lib/date/plain-date";
import type { OccurrenceDto } from "@/lib/services/dashboard-service";
import { PRIORITY_BAR } from "@/lib/ui/status-style";
import { cn } from "@/lib/utils";

export function OccurrenceList({
  occurrences,
  showTaskLink = true,
  emptyMessage = "표시할 발생 건이 없습니다.",
}: {
  occurrences: OccurrenceDto[];
  showTaskLink?: boolean;
  emptyMessage?: string;
}) {
  if (occurrences.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <ul className="divide-y overflow-hidden rounded-lg border">
      {occurrences.map((occurrence) => (
        <OccurrenceRow
          key={occurrence.id}
          occurrence={occurrence}
          showTaskLink={showTaskLink}
        />
      ))}
    </ul>
  );
}

function OccurrenceRow({
  occurrence,
  showTaskLink,
}: {
  occurrence: OccurrenceDto;
  showTaskLink: boolean;
}) {
  const { derived } = occurrence;

  return (
    <li className="group flex items-stretch bg-card transition-colors hover:bg-accent/30">
      <span
        className={cn("w-1 shrink-0", PRIORITY_BAR[occurrence.priority])}
        aria-hidden
      />

      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2.5">
        {/* ---------- 날짜 ---------- */}
        <div className="w-[7.5rem] shrink-0">
          <div className="text-sm font-medium tabular-nums">
            {formatKoreanShort(occurrence.scheduledDate)}
          </div>
          {occurrence.originalDate !== occurrence.scheduledDate && (
            <div className="text-[10px] text-muted-foreground line-through">
              {formatKoreanShort(occurrence.originalDate)}
            </div>
          )}
        </div>

        {/* ---------- 상태 ---------- */}
        <div className="w-[4.5rem] shrink-0">
          <StatusBadge status={derived.status} />
        </div>

        {/* ---------- 업무 정보 ---------- */}
        <div className="min-w-[14rem] flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {showTaskLink ? (
              <Link
                href={`/tasks/${occurrence.taskId}?occurrence=${occurrence.id}`}
                className="text-sm font-medium hover:underline"
              >
                {occurrence.taskTitle}
              </Link>
            ) : (
              <span className="text-sm font-medium">
                {occurrence.sequenceIndex + 1}회차
              </span>
            )}
            <PriorityBadge priority={occurrence.priority} />
            {occurrence.category && (
              <CategoryBadge
                name={occurrence.category.name}
                color={occurrence.category.color}
              />
            )}
            {occurrence.tags.slice(0, 3).map((tag) => (
              <TagBadge key={tag.id} name={tag.name} color={tag.color} />
            ))}
          </div>

          {/* ---------- 경고 ---------- */}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {occurrence.assignee && <span>{occurrence.assignee.name}</span>}

            {occurrence.checklistTotal > 0 && (
              <span className="tabular-nums">
                체크리스트 {occurrence.checklistDone}/{occurrence.checklistTotal}
              </span>
            )}

            {derived.daysUntilDue !== null && (
              <span
                className={cn(
                  derived.isOverdue && "font-medium text-status-overdue-fg",
                )}
              >
                {derived.daysUntilDue > 0
                  ? `D-${derived.daysUntilDue}`
                  : derived.daysUntilDue === 0
                    ? "오늘 마감"
                    : `${Math.abs(derived.daysUntilDue)}일 초과`}
              </span>
            )}

            {derived.blockedBy.length > 0 && (
              <span className="inline-flex items-center gap-1 text-status-blocked-fg">
                <Clock className="size-3" />
                선행 {derived.blockedBy.length}건 대기 (착수 예상{" "}
                {derived.blockedBy[0].projectedReadyDate})
              </span>
            )}

            {derived.delayImpact && (
              <span className="inline-flex items-center gap-1 font-medium text-status-overdue-fg">
                <AlertTriangle className="size-3" />
                선행 지연으로 마감 {derived.delayImpact.overshootDays}일 초과 예상
              </span>
            )}
          </div>

          {occurrence.memo && (
            <p className="mt-1 line-clamp-2 rounded bg-muted/60 px-2 py-1 text-xs text-muted-foreground">
              {occurrence.memo}
            </p>
          )}
        </div>

        {/* ---------- 액션 ---------- */}
        <div className="flex shrink-0 items-center gap-1">
          <OccurrenceQuickActions
            occurrenceId={occurrence.id}
            status={occurrence.storedStatus}
          />
          <Link
            href={`/tasks/${occurrence.taskId}?occurrence=${occurrence.id}`}
            className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
            aria-label="상세 보기"
          >
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </div>
    </li>
  );
}
