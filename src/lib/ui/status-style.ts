/**
 * 상태별 표시 스타일 매핑
 * ============================================================================
 * 색상 토큰은 globals.css 에 정의되어 있다. 이 파일은 상태값 → 클래스 매핑만 담당한다.
 */

import type { DisplayOccurrenceStatus } from "@/lib/dependency/status";
import type { Priority } from "@/lib/validation/task-schema";

export const STATUS_LABEL: Record<DisplayOccurrenceStatus, string> = {
  PENDING: "예정",
  IN_PROGRESS: "진행중",
  DONE: "완료",
  BLOCKED: "대기",
  OVERDUE: "지연",
  SKIPPED: "건너뜀",
};

/** 표시 순서 (범례, 요약 카드) */
export const STATUS_ORDER: DisplayOccurrenceStatus[] = [
  "OVERDUE",
  "BLOCKED",
  "IN_PROGRESS",
  "PENDING",
  "DONE",
  "SKIPPED",
];

interface StatusStyle {
  /** 배지 (텍스트 + 배경 + 테두리) */
  badge: string;
  /** 점 표시 (연간 그리드 셀) */
  dot: string;
  /** 셀 배경 */
  cell: string;
  /** 텍스트만 */
  text: string;
}

export const STATUS_STYLE: Record<DisplayOccurrenceStatus, StatusStyle> = {
  PENDING: {
    badge:
      "bg-status-pending-bg text-status-pending-fg border-status-pending-line/40",
    dot: "bg-status-pending-line",
    cell: "bg-status-pending-bg/60 border-status-pending-line/30",
    text: "text-status-pending-fg",
  },
  IN_PROGRESS: {
    badge:
      "bg-status-progress-bg text-status-progress-fg border-status-progress-line/40",
    dot: "bg-status-progress-line",
    cell: "bg-status-progress-bg/70 border-status-progress-line/40",
    text: "text-status-progress-fg",
  },
  DONE: {
    badge: "bg-status-done-bg text-status-done-fg border-status-done-line/40",
    dot: "bg-status-done-line",
    cell: "bg-status-done-bg/70 border-status-done-line/40",
    text: "text-status-done-fg",
  },
  BLOCKED: {
    badge:
      "bg-status-blocked-bg text-status-blocked-fg border-status-blocked-line/50",
    dot: "bg-status-blocked-line",
    cell: "bg-status-blocked-bg/80 border-status-blocked-line/50",
    text: "text-status-blocked-fg",
  },
  OVERDUE: {
    badge:
      "bg-status-overdue-bg text-status-overdue-fg border-status-overdue-line/50",
    dot: "bg-status-overdue-line",
    cell: "bg-status-overdue-bg/80 border-status-overdue-line/50",
    text: "text-status-overdue-fg",
  },
  SKIPPED: {
    badge:
      "bg-status-skipped-bg text-status-skipped-fg border-status-skipped-line/40",
    dot: "bg-status-skipped-line",
    cell: "bg-status-skipped-bg/60 border-status-skipped-line/30",
    text: "text-status-skipped-fg",
  },
};

// ---------------------------------------------------------------------------
// 중요도
// ---------------------------------------------------------------------------

export const PRIORITY_LABEL: Record<Priority, string> = {
  HIGH: "높음",
  MEDIUM: "보통",
  LOW: "낮음",
};

export const PRIORITY_STYLE: Record<Priority, string> = {
  HIGH: "bg-status-overdue-bg text-status-overdue-fg border-status-overdue-line/40",
  MEDIUM: "bg-muted text-muted-foreground border-border",
  LOW: "bg-muted/50 text-muted-foreground border-border",
};

/** 중요도 표시용 좌측 세로 막대 */
export const PRIORITY_BAR: Record<Priority, string> = {
  HIGH: "bg-status-overdue-line",
  MEDIUM: "bg-status-pending-line",
  LOW: "bg-border",
};
