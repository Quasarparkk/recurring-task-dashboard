/**
 * 업무(Task) 서비스 — 등록/수정/삭제 및 의존관계 관리
 */

import { prisma } from "@/lib/db";
import {
  assertNoCycle,
  type DependencyEdge,
} from "@/lib/dependency/graph";
import { serializeRecurrenceConfig } from "@/lib/recurrence/types";
import type {
  TaskDependencyInput,
  TaskInput,
} from "@/lib/validation/task-schema";
import { syncOccurrencesForTask } from "./occurrence-service";

// ---------------------------------------------------------------------------
// 태그 처리
// ---------------------------------------------------------------------------

/** 태그 이름 목록을 ID 목록으로 바꾼다. 없는 태그는 생성한다. */
async function resolveTagIds(tagNames: readonly string[]): Promise<string[]> {
  const unique = [...new Set(tagNames.map((name) => name.trim()).filter(Boolean))];
  if (unique.length === 0) return [];

  const ids: string[] = [];
  for (const name of unique) {
    const tag = await prisma.tag.upsert({
      where: { name },
      create: { name },
      update: {},
      select: { id: true },
    });
    ids.push(tag.id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// 등록 / 수정
// ---------------------------------------------------------------------------

export async function createTask(input: TaskInput): Promise<{ id: string }> {
  const tagIds = await resolveTagIds(input.tagNames);

  const task = await prisma.task.create({
    data: {
      title: input.title,
      descriptionMd: input.descriptionMd,
      categoryId: input.categoryId,
      defaultAssigneeId: input.defaultAssigneeId,
      priority: input.priority,
      estimatedHours: input.estimatedHours,
      recurrenceConfig: serializeRecurrenceConfig(input.recurrenceConfig),
      isActive: input.isActive,
      tags: { connect: tagIds.map((id) => ({ id })) },
      referenceLinks: {
        create: input.referenceLinks.map((link, index) => ({
          label: link.label,
          url: link.url,
          sortOrder: index,
        })),
      },
      checklistTemplate: {
        create: input.checklistTemplate.map((item, index) => ({
          title: item.title,
          isRequired: item.isRequired,
          sortOrder: index,
        })),
      },
      notificationRules: {
        create: input.notificationRules.map((rule) => ({
          offsetDays: rule.offsetDays,
          timeOfDay: rule.timeOfDay,
          offsetUnit: rule.offsetUnit,
          channels: JSON.stringify(rule.channels),
          isOverdueReminder: rule.isOverdueReminder,
          repeatIntervalHours: rule.repeatIntervalHours,
          maxRepeats: rule.maxRepeats,
          isActive: rule.isActive,
        })),
      },
    },
    select: { id: true },
  });

  // 등록 즉시 Occurrence 를 생성해 대시보드에 바로 나타나게 한다.
  await syncOccurrencesForTask(task.id);

  return task;
}

export async function updateTask(taskId: string, input: TaskInput): Promise<void> {
  const tagIds = await resolveTagIds(input.tagNames);

  await prisma.$transaction(async (tx) => {
    // 자식 레코드는 전량 교체한다.
    // 주의: checklistTemplate 교체는 **이미 생성된 Occurrence 의 체크리스트에
    //       영향을 주지 않는다** (생성 시 복제되므로). 의도된 동작이다.
    await tx.referenceLink.deleteMany({ where: { taskId } });
    await tx.checklistTemplateItem.deleteMany({ where: { taskId } });
    await tx.notificationRule.deleteMany({ where: { taskId } });

    await tx.task.update({
      where: { id: taskId },
      data: {
        title: input.title,
        descriptionMd: input.descriptionMd,
        categoryId: input.categoryId,
        defaultAssigneeId: input.defaultAssigneeId,
        priority: input.priority,
        estimatedHours: input.estimatedHours,
        recurrenceConfig: serializeRecurrenceConfig(input.recurrenceConfig),
        isActive: input.isActive,
        tags: { set: tagIds.map((id) => ({ id })) },
        referenceLinks: {
          create: input.referenceLinks.map((link, index) => ({
            label: link.label,
            url: link.url,
            sortOrder: index,
          })),
        },
        checklistTemplate: {
          create: input.checklistTemplate.map((item, index) => ({
            title: item.title,
            isRequired: item.isRequired,
            sortOrder: index,
          })),
        },
        notificationRules: {
          create: input.notificationRules.map((rule) => ({
            offsetDays: rule.offsetDays,
            timeOfDay: rule.timeOfDay,
            offsetUnit: rule.offsetUnit,
            channels: JSON.stringify(rule.channels),
            isOverdueReminder: rule.isOverdueReminder,
            repeatIntervalHours: rule.repeatIntervalHours,
            maxRepeats: rule.maxRepeats,
            isActive: rule.isActive,
          })),
        },
      },
    });
  });

  // 규칙이 바뀌었을 수 있으므로 미래 회차를 재동기화한다.
  // (과거·확정 회차는 occurrence-service 의 보호 규칙이 지킨다)
  await syncOccurrencesForTask(taskId);
}

export async function deleteTask(taskId: string): Promise<void> {
  // Occurrence, 링크, 체크리스트, 알림 규칙은 onDelete: Cascade 로 함께 삭제된다.
  await prisma.task.delete({ where: { id: taskId } });
}

/** 보관 처리 — 신규 회차 생성을 멈추되 기존 이력은 유지한다. */
export async function setTaskActive(taskId: string, isActive: boolean): Promise<void> {
  await prisma.task.update({ where: { id: taskId }, data: { isActive } });
  await syncOccurrencesForTask(taskId);
}

// ---------------------------------------------------------------------------
// 의존 관계
// ---------------------------------------------------------------------------

/** 현재 등록된 모든 Task 레벨 의존 간선. */
export async function loadDependencyEdges(): Promise<DependencyEdge[]> {
  const rows = await prisma.taskDependency.findMany({
    select: { predecessorId: true, successorId: true },
  });
  return rows;
}

/**
 * 의존 관계를 추가한다. 순환이 생기면 `DependencyCycleError` 를 던진다.
 */
export async function createTaskDependency(
  input: TaskDependencyInput,
): Promise<{ id: string }> {
  const [predecessor, successor] = await Promise.all([
    prisma.task.findUnique({ where: { id: input.predecessorId }, select: { title: true } }),
    prisma.task.findUnique({ where: { id: input.successorId }, select: { title: true } }),
  ]);

  if (!predecessor) throw new Error("선행 업무를 찾을 수 없습니다.");
  if (!successor) throw new Error("후행 업무를 찾을 수 없습니다.");

  const existingEdges = await loadDependencyEdges();

  // 에러 메시지에 업무 제목이 나오도록 라벨 맵을 준비한다.
  const titles = new Map<string, string>();
  const allTasks = await prisma.task.findMany({ select: { id: true, title: true } });
  for (const task of allTasks) titles.set(task.id, task.title);

  assertNoCycle(
    existingEdges,
    { predecessorId: input.predecessorId, successorId: input.successorId },
    (id) => titles.get(id) ?? id,
  );

  return prisma.taskDependency.create({
    data: {
      predecessorId: input.predecessorId,
      successorId: input.successorId,
      lagAmount: input.lagAmount,
      lagUnit: input.lagUnit,
      matchStrategy: input.matchStrategy,
      isBlocking: input.isBlocking,
      note: input.note,
    },
    select: { id: true },
  });
}

export async function updateTaskDependency(
  id: string,
  input: Partial<Omit<TaskDependencyInput, "predecessorId" | "successorId">>,
): Promise<void> {
  await prisma.taskDependency.update({
    where: { id },
    data: {
      ...(input.lagAmount !== undefined ? { lagAmount: input.lagAmount } : {}),
      ...(input.lagUnit !== undefined ? { lagUnit: input.lagUnit } : {}),
      ...(input.matchStrategy !== undefined ? { matchStrategy: input.matchStrategy } : {}),
      ...(input.isBlocking !== undefined ? { isBlocking: input.isBlocking } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    },
  });
}

export async function deleteTaskDependency(id: string): Promise<void> {
  await prisma.taskDependency.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// 조회
// ---------------------------------------------------------------------------

/** 업무 목록 (선택 박스, 의존관계 등록 등에 사용) */
export async function listTaskOptions() {
  return prisma.task.findMany({
    select: {
      id: true,
      title: true,
      isActive: true,
      category: { select: { id: true, name: true, color: true } },
    },
    orderBy: [{ isActive: "desc" }, { title: "asc" }],
  });
}

/** 업무 상세 (연관 데이터 전체) */
export async function getTaskDetail(taskId: string) {
  return prisma.task.findUnique({
    where: { id: taskId },
    include: {
      category: true,
      tags: { orderBy: { name: "asc" } },
      defaultAssignee: true,
      referenceLinks: { orderBy: { sortOrder: "asc" } },
      checklistTemplate: { orderBy: { sortOrder: "asc" } },
      notificationRules: { orderBy: [{ isOverdueReminder: "asc" }, { offsetDays: "asc" }] },
      predecessorLinks: {
        include: {
          predecessor: {
            select: { id: true, title: true, isActive: true, priority: true },
          },
        },
      },
      successorLinks: {
        include: {
          successor: {
            select: { id: true, title: true, isActive: true, priority: true },
          },
        },
      },
    },
  });
}
