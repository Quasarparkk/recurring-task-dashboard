/**
 * 발생 건(Occurrence) 변경 서비스
 * ============================================================================
 * 완료 처리, 담당자 변경, 메모, 체크리스트, 개별 마감일 변경을 담당한다.
 */

import { toDbDate, toPlainDate, type PlainDate } from "@/lib/date/plain-date";
import { prisma } from "@/lib/db";
import { notifyUnblockedSuccessors } from "@/lib/notification/dispatcher";
import {
  parseRecurrenceConfig,
  serializeRecurrenceConfig,
  type RecurrenceException,
} from "@/lib/recurrence/types";
import type { StoredOccurrenceStatus } from "@/lib/dependency/status";

export interface UpdateOccurrenceInput {
  status?: StoredOccurrenceStatus;
  assigneeId?: string | null;
  memo?: string | null;
  /** 이 회차만 마감일 변경. 반복 규칙의 1회성 예외로도 기록된다. */
  scheduledDate?: PlainDate;
}

export interface UpdateOccurrenceResult {
  id: string;
  statusChanged: boolean;
  /** 선행 완료로 차단이 풀린 후행 회차 수 */
  unblockedCount: number;
  /** 반복 규칙에 예외가 기록되었는지 */
  exceptionRecorded: boolean;
}

/**
 * 회차를 수정한다.
 *
 * 마감일을 변경하면 **Task 의 반복 규칙에 RESCHEDULE 예외로 함께 기록**한다.
 * 그러지 않으면 다음 롤링 생성 배치가 규칙대로 날짜를 되돌려 버린다.
 */
export async function updateOccurrence(
  occurrenceId: string,
  input: UpdateOccurrenceInput,
): Promise<UpdateOccurrenceResult> {
  const current = await prisma.occurrence.findUnique({
    where: { id: occurrenceId },
    select: {
      id: true,
      taskId: true,
      status: true,
      originalDate: true,
      scheduledDate: true,
      task: { select: { recurrenceConfig: true } },
    },
  });

  if (!current) throw new Error("발생 건을 찾을 수 없습니다.");

  const statusChanged =
    input.status !== undefined && input.status !== current.status;
  const nowInstant = new Date();

  // --- 상태 전이에 따른 타임스탬프 -------------------------------------
  const data: Record<string, unknown> = {};

  if (input.status !== undefined) {
    data.status = input.status;

    if (input.status === "DONE") {
      data.completedAt = nowInstant;
      // 진행중을 거치지 않고 바로 완료한 경우도 착수 시각을 남긴다.
      data.startedAt = current.status === "IN_PROGRESS" ? undefined : nowInstant;
    } else if (input.status === "IN_PROGRESS") {
      data.startedAt = nowInstant;
      data.completedAt = null;
    } else {
      // PENDING 또는 SKIPPED 로 되돌리면 완료 기록을 지운다.
      data.completedAt = null;
    }
  }

  if (input.assigneeId !== undefined) data.assigneeId = input.assigneeId;
  if (input.memo !== undefined) data.memo = input.memo;

  let exceptionRecorded = false;
  const newDate = input.scheduledDate;
  const dateChanged = newDate !== undefined && newDate !== toPlainDate(current.scheduledDate);

  if (dateChanged) {
    data.scheduledDate = toDbDate(newDate!);
    data.shiftReason = "EXCEPTION";
  }

  await prisma.$transaction(async (tx) => {
    await tx.occurrence.update({ where: { id: occurrenceId }, data });

    if (dateChanged) {
      // 반복 규칙에 예외를 기록해 다음 동기화가 날짜를 되돌리지 못하게 한다.
      exceptionRecorded = await recordRescheduleException(
        tx,
        current.taskId,
        current.task.recurrenceConfig,
        toPlainDate(current.originalDate),
        newDate!,
      );
    }
  });

  // --- 선행 완료 알림 ---------------------------------------------------
  let unblockedCount = 0;
  if (statusChanged && input.status === "DONE") {
    try {
      const summary = await notifyUnblockedSuccessors(occurrenceId);
      unblockedCount = summary.sent;
    } catch (error) {
      // 알림 실패가 완료 처리를 되돌리지 않게 한다.
      console.error("[occurrence] 후행 알림 발송 실패:", error);
    }
  }

  return { id: occurrenceId, statusChanged, unblockedCount, exceptionRecorded };
}

/** 반복 규칙에 RESCHEDULE 예외를 추가(또는 갱신)한다. */
async function recordRescheduleException(
  tx: Pick<typeof prisma, "task">,
  taskId: string,
  rawConfig: string,
  originalDate: PlainDate,
  newDate: PlainDate,
): Promise<boolean> {
  try {
    const config = parseRecurrenceConfig(rawConfig);

    // 같은 원본 날짜의 기존 예외를 제거하고 새 예외를 넣는다.
    const exceptions: RecurrenceException[] = [
      ...config.exceptions.filter((e) => e.originalDate !== originalDate),
      {
        kind: "RESCHEDULE",
        originalDate,
        newDate,
        reason: "회차 상세에서 직접 변경",
      },
    ];

    await tx.task.update({
      where: { id: taskId },
      data: {
        recurrenceConfig: serializeRecurrenceConfig({ ...config, exceptions }),
      },
    });
    return true;
  } catch (error) {
    // 규칙을 파싱할 수 없어도 회차의 날짜 변경 자체는 유효하다.
    console.error("[occurrence] 반복 규칙에 예외를 기록하지 못했습니다:", error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// 체크리스트
// ---------------------------------------------------------------------------

export async function setChecklistItemChecked(
  itemId: string,
  isChecked: boolean,
): Promise<{ occurrenceId: string; total: number; done: number }> {
  const item = await prisma.checklistItem.update({
    where: { id: itemId },
    data: { isChecked, checkedAt: isChecked ? new Date() : null },
    select: { occurrenceId: true },
  });

  const siblings = await prisma.checklistItem.findMany({
    where: { occurrenceId: item.occurrenceId },
    select: { isChecked: true },
  });

  return {
    occurrenceId: item.occurrenceId,
    total: siblings.length,
    done: siblings.filter((s) => s.isChecked).length,
  };
}

/** 회차의 체크리스트 전체 조회 (상세 화면용) */
export async function getChecklist(occurrenceId: string) {
  return prisma.checklistItem.findMany({
    where: { occurrenceId },
    orderBy: { sortOrder: "asc" },
  });
}

// ---------------------------------------------------------------------------
// 회차 레벨 의존관계 오버라이드
// ---------------------------------------------------------------------------

export async function createOccurrenceOverride(input: {
  predecessorOccurrenceId: string;
  successorOccurrenceId: string;
  lagAmount: number;
  lagUnit: "BUSINESS_DAY" | "CALENDAR_DAY";
  isBlocking: boolean;
  note: string | null;
}): Promise<{ id: string }> {
  if (input.predecessorOccurrenceId === input.successorOccurrenceId) {
    throw new Error("같은 회차를 선행과 후행으로 동시에 지정할 수 없습니다.");
  }

  return prisma.occurrenceDependencyOverride.create({
    data: input,
    select: { id: true },
  });
}

export async function deleteOccurrenceOverride(id: string): Promise<void> {
  await prisma.occurrenceDependencyOverride.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// 회차 상세 조회
// ---------------------------------------------------------------------------

export async function getOccurrenceDetail(occurrenceId: string) {
  return prisma.occurrence.findUnique({
    where: { id: occurrenceId },
    include: {
      task: {
        include: {
          category: true,
          tags: true,
          referenceLinks: { orderBy: { sortOrder: "asc" } },
          notificationRules: true,
        },
      },
      assignee: true,
      checklist: { orderBy: { sortOrder: "asc" } },
      notificationLogs: { orderBy: { plannedAt: "desc" }, take: 50 },
      overridesAsSuccessor: {
        include: {
          predecessorOccurrence: {
            include: { task: { select: { id: true, title: true } } },
          },
        },
      },
      overridesAsPredecessor: {
        include: {
          successorOccurrence: {
            include: { task: { select: { id: true, title: true } } },
          },
        },
      },
    },
  });
}
