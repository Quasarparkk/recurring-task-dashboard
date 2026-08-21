"use client";

/**
 * 회차 상세 패널 — 체크리스트 / 메모 / 담당자 / 마감일 변경 / 알림 이력
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Clock,
  Loader2,
  Save,
} from "lucide-react";

import { StatusBadge } from "@/components/status-badge";
import { OccurrenceQuickActions } from "@/components/occurrence-quick-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatInstantKst } from "@/lib/date/kst";
import { formatKoreanFull } from "@/lib/date/plain-date";
import type { DerivedStatus } from "@/lib/dependency/status";
import { SHIFT_REASON_LABELS, type ShiftReason } from "@/lib/recurrence/engine";
import { cn } from "@/lib/utils";

export interface ChecklistItemDto {
  id: string;
  title: string;
  isRequired: boolean;
  isChecked: boolean;
}

export interface NotificationLogDto {
  id: string;
  channel: string;
  kind: string;
  status: string;
  plannedAt: string;
  sentAt: string | null;
  title: string;
  error: string | null;
}

export interface OccurrenceDetailData {
  id: string;
  sequenceIndex: number;
  scheduledDate: string;
  originalDate: string;
  shiftReason: ShiftReason | null;
  storedStatus: "PENDING" | "IN_PROGRESS" | "DONE" | "SKIPPED";
  derived: DerivedStatus;
  assigneeId: string | null;
  memo: string | null;
  completedAt: string | null;
  startedAt: string | null;
  checklist: ChecklistItemDto[];
  notificationLogs: NotificationLogDto[];
  /** 선행 회차 정보 (차단 원인 표시용) */
  blockedByDetails: {
    occurrenceId: string;
    taskId: string;
    taskTitle: string;
    scheduledDate: string;
    projectedReadyDate: string;
  }[];
}

const NONE = "__none__";

export function OccurrenceDetailPanel({
  occurrence,
  users,
}: {
  occurrence: OccurrenceDetailData;
  users: { id: string; name: string; department: string | null }[];
}) {
  const router = useRouter();
  const [checklist, setChecklist] = useState(occurrence.checklist);
  const [memo, setMemo] = useState(occurrence.memo ?? "");
  const [assigneeId, setAssigneeId] = useState(occurrence.assigneeId);
  const [scheduledDate, setScheduledDate] = useState(occurrence.scheduledDate);
  const [isSaving, setIsSaving] = useState(false);

  const doneCount = checklist.filter((item) => item.isChecked).length;
  const requiredPending = checklist.filter(
    (item) => item.isRequired && !item.isChecked,
  ).length;

  const isDirty =
    memo !== (occurrence.memo ?? "") ||
    assigneeId !== occurrence.assigneeId ||
    scheduledDate !== occurrence.scheduledDate;

  const toggleChecklistItem = async (item: ChecklistItemDto) => {
    const next = !item.isChecked;
    // 낙관적 업데이트
    setChecklist((prev) =>
      prev.map((c) => (c.id === item.id ? { ...c, isChecked: next } : c)),
    );

    const response = await fetch(`/api/checklist/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isChecked: next }),
    });

    if (!response.ok) {
      // 실패 시 롤백
      setChecklist((prev) =>
        prev.map((c) => (c.id === item.id ? { ...c, isChecked: !next } : c)),
      );
      toast.error("체크리스트를 저장하지 못했습니다.");
    }
  };

  const save = async () => {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/occurrences/${occurrence.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          memo: memo.trim() === "" ? null : memo,
          assigneeId,
          ...(scheduledDate !== occurrence.scheduledDate ? { scheduledDate } : {}),
        }),
      });
      const json = await response.json();

      if (!response.ok) {
        toast.error(json.error ?? "저장에 실패했습니다.");
        return;
      }

      toast.success(
        json.exceptionRecorded
          ? "저장했습니다. 마감일 변경이 반복 규칙의 예외로 기록되어 이후 배치가 되돌리지 않습니다."
          : "저장했습니다.",
      );
      router.refresh();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4">
      {/* ---------- 헤더 ---------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">
              {occurrence.sequenceIndex + 1}회차
            </span>
            <StatusBadge status={occurrence.derived.status} />
          </div>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {formatKoreanFull(occurrence.scheduledDate)}
          </p>

          {occurrence.originalDate !== occurrence.scheduledDate && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              원래 예정일{" "}
              <span className="line-through">{occurrence.originalDate}</span>
              {occurrence.shiftReason && (
                <span className="ml-1.5 rounded bg-muted px-1.5 py-0.5">
                  {SHIFT_REASON_LABELS[occurrence.shiftReason]}
                </span>
              )}
            </p>
          )}

          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {occurrence.derived.daysUntilDue !== null && (
              <span className={cn(occurrence.derived.isOverdue && "text-status-overdue-fg")}>
                {occurrence.derived.daysUntilDue > 0
                  ? `마감까지 ${occurrence.derived.daysUntilDue}일`
                  : occurrence.derived.daysUntilDue === 0
                    ? "오늘 마감"
                    : `마감 ${Math.abs(occurrence.derived.daysUntilDue)}일 초과`}
              </span>
            )}
            {occurrence.startedAt && (
              <span>착수 {formatInstantKst(occurrence.startedAt)}</span>
            )}
            {occurrence.completedAt && (
              <span className="text-status-done-fg">
                완료 {formatInstantKst(occurrence.completedAt)}
              </span>
            )}
          </div>
        </div>

        <OccurrenceQuickActions
          occurrenceId={occurrence.id}
          status={occurrence.storedStatus}
        />
      </div>

      {/* ---------- 차단 / 지연 경고 ---------- */}
      {occurrence.blockedByDetails.length > 0 && (
        <div className="space-y-1.5 rounded-md border border-status-blocked-line/50 bg-status-blocked-bg/40 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-status-blocked-fg">
            <Clock className="size-4" />
            선행 업무 {occurrence.blockedByDetails.length}건이 완료되지 않았습니다
          </p>
          <ul className="space-y-1 text-xs">
            {occurrence.blockedByDetails.map((blocker) => (
              <li key={blocker.occurrenceId} className="flex flex-wrap gap-x-2">
                <a
                  href={`/tasks/${blocker.taskId}?occurrence=${blocker.occurrenceId}`}
                  className="font-medium underline"
                >
                  {blocker.taskTitle}
                </a>
                <span className="text-muted-foreground tabular-nums">
                  마감 {blocker.scheduledDate}
                </span>
                <span className="text-muted-foreground">
                  → 착수 예상 {blocker.projectedReadyDate}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {occurrence.derived.delayImpact && (
        <div className="rounded-md border border-status-overdue-line/50 bg-status-overdue-bg/40 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-status-overdue-fg">
            <AlertTriangle className="size-4" />
            선행 지연으로 이 회차의 마감일 초과가 예상됩니다
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            가장 빠른 착수 가능일{" "}
            <strong className="tabular-nums">
              {occurrence.derived.delayImpact.earliestStartDate}
            </strong>{" "}
            — 마감일보다 {occurrence.derived.delayImpact.overshootDays}일 늦습니다.
          </p>
        </div>
      )}

      {/* ---------- 체크리스트 ---------- */}
      {checklist.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">
              체크리스트
              <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">
                {doneCount}/{checklist.length}
              </span>
            </h3>
            {requiredPending > 0 && (
              <span className="text-xs text-status-blocked-fg">
                필수 항목 {requiredPending}건 미완료
              </span>
            )}
          </div>

          {/* 진행률 바 */}
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-status-done-line transition-all"
              style={{ width: `${(doneCount / checklist.length) * 100}%` }}
            />
          </div>

          <ul className="space-y-1">
            {checklist.map((item) => (
              <li key={item.id}>
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent/50",
                    item.isChecked && "text-muted-foreground",
                  )}
                >
                  <Checkbox
                    checked={item.isChecked}
                    onCheckedChange={() => void toggleChecklistItem(item)}
                    className="mt-0.5"
                  />
                  <span className={cn(item.isChecked && "line-through")}>
                    {item.title}
                    {item.isRequired && (
                      <span className="ml-1.5 text-[10px] text-status-overdue-fg">
                        필수
                      </span>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---------- 편집 영역 ---------- */}
      <div className="space-y-3 border-t pt-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="occ-assignee" className="text-xs">
              이 회차 담당자
            </Label>
            <Select
              value={assigneeId ?? NONE}
              onValueChange={(v) => setAssigneeId(v === NONE ? null : v)}
            >
              <SelectTrigger id="occ-assignee" className="h-8">
                <SelectValue placeholder="미지정" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>미지정</SelectItem>
                {users.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                    {user.department ? ` · ${user.department}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="occ-date" className="text-xs">
              마감일
              <span className="ml-1.5 font-normal text-muted-foreground">
                변경 시 반복 규칙의 예외로 기록됩니다
              </span>
            </Label>
            <Input
              id="occ-date"
              type="date"
              value={scheduledDate}
              onChange={(event) => {
                if (event.target.value) setScheduledDate(event.target.value);
              }}
              className="h-8"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="occ-memo" className="text-xs">
            메모
            <span className="ml-1.5 font-normal text-muted-foreground">
              이 회차에만 기록됩니다
            </span>
          </Label>
          <Textarea
            id="occ-memo"
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            placeholder="특이사항, 지연 사유, 다음 회차에 반영할 개선점 등"
            className="min-h-[70px] text-sm"
          />
        </div>

        <div className="flex justify-end">
          <Button size="sm" onClick={() => void save()} disabled={!isDirty || isSaving}>
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            변경 저장
          </Button>
        </div>
      </div>

      {/* ---------- 알림 이력 ---------- */}
      {occurrence.notificationLogs.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <h3 className="flex items-center gap-1.5 text-sm font-medium">
            <CalendarClock className="size-4 text-muted-foreground" />
            알림 발송 이력 ({occurrence.notificationLogs.length}건)
          </h3>
          <ul className="space-y-1">
            {occurrence.notificationLogs.map((log) => (
              <li
                key={log.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs"
              >
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-1.5 py-0 text-[10px] font-medium",
                    log.status === "SENT" && "bg-status-done-bg text-status-done-fg",
                    log.status === "FAILED" &&
                      "bg-status-overdue-bg text-status-overdue-fg",
                    log.status === "SKIPPED_STALE" &&
                      "bg-status-skipped-bg text-status-skipped-fg",
                  )}
                >
                  {log.status === "SENT" && <Check className="size-2.5" />}
                  {LOG_STATUS_LABEL[log.status] ?? log.status}
                </span>

                <span className="rounded bg-background px-1.5 py-0 text-[10px]">
                  {CHANNEL_LABEL[log.channel] ?? log.channel}
                </span>

                <span className="text-muted-foreground">
                  {KIND_LABEL[log.kind] ?? log.kind}
                </span>

                <span className="tabular-nums text-muted-foreground">
                  예정 {formatInstantKst(log.plannedAt)}
                  {log.sentAt && ` · 발송 ${formatInstantKst(log.sentAt)}`}
                </span>

                {log.error && (
                  <span className="w-full text-[11px] text-status-overdue-fg">
                    {log.error}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const LOG_STATUS_LABEL: Record<string, string> = {
  SENT: "발송",
  FAILED: "실패",
  SKIPPED_STALE: "폐기(기한 초과)",
};

const CHANNEL_LABEL: Record<string, string> = {
  WEB_PUSH: "브라우저",
  EMAIL: "이메일",
  SLACK: "Slack",
  TEAMS: "Teams",
};

const KIND_LABEL: Record<string, string> = {
  SCHEDULED: "정기 알림",
  OVERDUE_REMINDER: "지연 리마인더",
  DEPENDENCY_UNBLOCKED: "선행 완료 알림",
};
