/**
 * 발생 건(Occurrence) 생성·동기화 서비스
 * ============================================================================
 *
 * 반복 규칙(순수 함수 엔진)의 계산 결과를 DB 에 반영하는 계층이다.
 *
 * [불변 규칙 — 과거 이력 보존]
 *   반복 규칙을 수정해도 다음 회차는 절대 변경/삭제하지 않는다:
 *     1. status 가 DONE 또는 SKIPPED (사용자가 확정한 회차)
 *     2. scheduledDate 가 오늘보다 이전 (이미 지난 회차 = 이력)
 *   즉 규칙 변경은 **미래의 미확정 회차에만** 반영된다.
 *
 * [롤링 윈도우]
 *   "오늘부터 N개월치는 항상 존재한다"를 유지한다. 사용자가 생성 기간을
 *   신경 쓰지 않아도 되게 하면서 DB 가 무한히 커지는 것을 막는다.
 */

import type { HolidayCalendar } from "@/lib/date/business-day";
import {
  addMonths,
  toDbDate,
  toPlainDate,
  type PlainDate,
} from "@/lib/date/plain-date";
import { todayInSeoul } from "@/lib/date/kst";
import { prisma } from "@/lib/db";
import {
  generateOccurrences,
  isRecurrenceExhausted,
  type GeneratedOccurrence,
} from "@/lib/recurrence/engine";
import { parseRecurrenceConfig } from "@/lib/recurrence/types";
import { getHolidayCalendar } from "./holiday-service";
import {
  getRollingWindowMonths,
  recordRunTimestamp,
  SETTING_KEYS,
} from "./settings-service";

export interface SyncResult {
  taskId: string;
  taskTitle: string;
  created: number;
  updated: number;
  deleted: number;
  /** 보호 규칙에 걸려 건드리지 않은 회차 수 */
  preserved: number;
  /** 생성이 완료된 마지막 날짜 */
  generatedUntil: PlainDate;
  /** 반복이 완전히 끝났는지 */
  exhausted: boolean;
  error?: string;
}

/** 롤링 윈도우의 끝 날짜를 계산한다. */
export function computeWindowEnd(
  today: PlainDate,
  rollingWindowMonths: number,
): PlainDate {
  return addMonths(today, rollingWindowMonths);
}

/**
 * 단일 Task 의 Occurrence 를 반복 규칙과 동기화한다.
 *
 * @param taskId 대상 Task
 * @param options.today 기준일 (테스트에서 고정 가능)
 */
export async function syncOccurrencesForTask(
  taskId: string,
  options: {
    today?: PlainDate;
    calendar?: HolidayCalendar;
    rollingWindowMonths?: number;
  } = {},
): Promise<SyncResult> {
  const today = options.today ?? todayInSeoul();
  const calendar = options.calendar ?? (await getHolidayCalendar());
  const globalWindow = options.rollingWindowMonths ?? (await getRollingWindowMonths());

  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      checklistTemplate: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!task) {
    throw new Error(`업무를 찾을 수 없습니다: ${taskId}`);
  }

  const base: Omit<SyncResult, "created" | "updated" | "deleted" | "preserved"> = {
    taskId: task.id,
    taskTitle: task.title,
    generatedUntil: today,
    exhausted: false,
  };

  // --- 반복 규칙 파싱 -----------------------------------------------------
  let config;
  try {
    config = parseRecurrenceConfig(task.recurrenceConfig);
  } catch (error) {
    return {
      ...base,
      created: 0,
      updated: 0,
      deleted: 0,
      preserved: 0,
      error: `반복 규칙을 해석할 수 없습니다: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  const windowMonths = config.rollingWindowMonths ?? globalWindow;
  const windowEnd = computeWindowEnd(today, windowMonths);

  // --- 계산: 반복 규칙이 산출하는 회차 -----------------------------------
  // 생성 범위는 [반복 시작일, 윈도우 끝]. 원본 날짜(ORIGINAL) 기준으로 나눠야
  // 구간 경계에서 누락도 중복도 발생하지 않는다. (DECISIONS D-011)
  const computed = task.isActive
    ? generateOccurrences({
        config,
        calendar,
        from: config.startDate,
        to: windowEnd,
        boundBy: "ORIGINAL",
      })
    : [];

  const computedBySequence = new Map<number, GeneratedOccurrence>(
    computed.map((o) => [o.sequenceIndex, o]),
  );

  // --- 현재 DB 상태 -------------------------------------------------------
  const existing = await prisma.occurrence.findMany({
    where: { taskId: task.id },
    select: {
      id: true,
      sequenceIndex: true,
      originalDate: true,
      scheduledDate: true,
      shiftReason: true,
      status: true,
    },
  });

  const existingBySequence = new Map(existing.map((row) => [row.sequenceIndex, row]));

  // --- 보호 판정 ----------------------------------------------------------
  /** 이 회차를 변경/삭제해도 되는가? */
  function isMutable(row: { status: string; scheduledDate: Date }): boolean {
    if (row.status === "DONE" || row.status === "SKIPPED") return false;
    // 이미 지난 회차는 이력이므로 손대지 않는다.
    if (toPlainDate(row.scheduledDate) < today) return false;
    return true;
  }

  let created = 0;
  let updated = 0;
  let deleted = 0;
  let preserved = 0;

  const toCreate: GeneratedOccurrence[] = [];
  const toUpdate: { id: string; occurrence: GeneratedOccurrence }[] = [];
  const toDelete: string[] = [];

  // --- 계산 결과 → DB 반영 대상 분류 -------------------------------------
  for (const occurrence of computed) {
    const row = existingBySequence.get(occurrence.sequenceIndex);

    if (!row) {
      toCreate.push(occurrence);
      continue;
    }

    if (!isMutable(row)) {
      preserved += 1;
      continue;
    }

    const dateChanged =
      toPlainDate(row.scheduledDate) !== occurrence.scheduledDate ||
      toPlainDate(row.originalDate) !== occurrence.originalDate ||
      (row.shiftReason ?? null) !== occurrence.shiftReason;

    if (dateChanged) toUpdate.push({ id: row.id, occurrence });
  }

  // --- 규칙에서 사라진 회차 정리 ------------------------------------------
  for (const row of existing) {
    if (computedBySequence.has(row.sequenceIndex)) continue;
    if (!isMutable(row)) {
      preserved += 1;
      continue;
    }
    toDelete.push(row.id);
  }

  // --- 트랜잭션 실행 ------------------------------------------------------
  const checklistTemplate = task.checklistTemplate;

  await prisma.$transaction(async (tx) => {
    if (toDelete.length > 0) {
      const result = await tx.occurrence.deleteMany({
        where: { id: { in: toDelete } },
      });
      deleted = result.count;
    }

    for (const { id, occurrence } of toUpdate) {
      await tx.occurrence.update({
        where: { id },
        data: {
          originalDate: toDbDate(occurrence.originalDate),
          scheduledDate: toDbDate(occurrence.scheduledDate),
          shiftReason: occurrence.shiftReason,
        },
      });
      updated += 1;
    }

    for (const occurrence of toCreate) {
      await tx.occurrence.create({
        data: {
          taskId: task.id,
          sequenceIndex: occurrence.sequenceIndex,
          originalDate: toDbDate(occurrence.originalDate),
          scheduledDate: toDbDate(occurrence.scheduledDate),
          shiftReason: occurrence.shiftReason,
          status: "PENDING",
          // 기본 담당자를 복사해 둔다. 이후 회차별로 변경 가능.
          assigneeId: task.defaultAssigneeId,
          // 체크리스트 템플릿을 복제한다. 템플릿이 나중에 바뀌어도
          // 이미 생성된 회차의 체크리스트는 영향받지 않는다.
          checklist: {
            create: checklistTemplate.map((item, index) => ({
              title: item.title,
              isRequired: item.isRequired,
              sortOrder: item.sortOrder ?? index,
            })),
          },
        },
      });
      created += 1;
    }

    // 워터마크 갱신
    const maxSequence = computed.length > 0
      ? Math.max(...computed.map((o) => o.sequenceIndex))
      : -1;

    await tx.task.update({
      where: { id: task.id },
      data: {
        generatedUntil: toDbDate(windowEnd),
        nextSequenceIndex: Math.max(task.nextSequenceIndex, maxSequence + 1),
      },
    });
  });

  const exhausted = task.isActive
    ? isRecurrenceExhausted(config, calendar, windowEnd)
    : true;

  return {
    ...base,
    created,
    updated,
    deleted,
    preserved,
    generatedUntil: windowEnd,
    exhausted,
  };
}

/**
 * 모든 활성 Task 의 Occurrence 를 동기화한다.
 * 서버 시작 시 / 매일 새벽 배치 / 수동 실행에서 호출한다.
 */
export async function syncAllOccurrences(
  options: { today?: PlainDate; includeInactive?: boolean } = {},
): Promise<SyncResult[]> {
  const today = options.today ?? todayInSeoul();
  const calendar = await getHolidayCalendar();
  const rollingWindowMonths = await getRollingWindowMonths();

  const tasks = await prisma.task.findMany({
    where: options.includeInactive ? {} : { isActive: true },
    select: { id: true, title: true },
    orderBy: { createdAt: "asc" },
  });

  const results: SyncResult[] = [];

  for (const task of tasks) {
    try {
      results.push(
        await syncOccurrencesForTask(task.id, {
          today,
          calendar,
          rollingWindowMonths,
        }),
      );
    } catch (error) {
      // 한 업무의 실패가 전체 배치를 중단시키지 않도록 개별 처리한다.
      results.push({
        taskId: task.id,
        taskTitle: task.title,
        created: 0,
        updated: 0,
        deleted: 0,
        preserved: 0,
        generatedUntil: today,
        exhausted: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await recordRunTimestamp(SETTING_KEYS.lastGenerationRunAt);

  return results;
}

/** 동기화 결과 요약 (로그 출력용). */
export function summarizeSyncResults(results: readonly SyncResult[]): string {
  const total = results.reduce(
    (acc, r) => ({
      created: acc.created + r.created,
      updated: acc.updated + r.updated,
      deleted: acc.deleted + r.deleted,
      preserved: acc.preserved + r.preserved,
      errors: acc.errors + (r.error ? 1 : 0),
    }),
    { created: 0, updated: 0, deleted: 0, preserved: 0, errors: 0 },
  );

  const parts = [
    `업무 ${results.length}건`,
    `생성 ${total.created}`,
    `수정 ${total.updated}`,
    `삭제 ${total.deleted}`,
    `보존 ${total.preserved}`,
  ];
  if (total.errors > 0) parts.push(`실패 ${total.errors}`);

  return parts.join(" · ");
}
