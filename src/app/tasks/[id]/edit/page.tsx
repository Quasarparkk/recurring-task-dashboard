import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ChevronLeft } from "lucide-react";

import { TaskForm, type TaskFormValues } from "@/components/task-form/task-form";
import { todayInSeoul } from "@/lib/date/kst";
import { listChannelOptions, parseChannels } from "@/lib/notification/registry";
import {
  createDefaultRecurrenceConfig,
  safeParseRecurrenceConfig,
} from "@/lib/recurrence/types";
import { loadFilterOptions } from "@/lib/services/options-service";
import { getTaskDetail } from "@/lib/services/task-service";
import type { Priority } from "@/lib/validation/task-schema";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditTaskPage({ params }: PageProps) {
  const { id } = await params;

  const [task, options] = await Promise.all([getTaskDetail(id), loadFilterOptions()]);
  if (!task) notFound();

  const parsed = safeParseRecurrenceConfig(task.recurrenceConfig);
  const today = todayInSeoul();

  const initialValues: TaskFormValues = {
    title: task.title,
    descriptionMd: task.descriptionMd,
    categoryId: task.categoryId,
    tagNames: task.tags.map((tag) => tag.name),
    defaultAssigneeId: task.defaultAssigneeId,
    priority: task.priority as Priority,
    estimatedHours: task.estimatedHours,
    // 규칙을 파싱할 수 없으면 기본값으로 대체하고 사용자에게 알린다.
    recurrenceConfig: parsed.ok
      ? parsed.config
      : createDefaultRecurrenceConfig(today),
    referenceLinks: task.referenceLinks.map((link) => ({
      label: link.label,
      url: link.url,
    })),
    checklistTemplate: task.checklistTemplate.map((item) => ({
      title: item.title,
      isRequired: item.isRequired,
    })),
    notificationRules: task.notificationRules.map((rule) => ({
      offsetDays: rule.offsetDays,
      timeOfDay: rule.timeOfDay,
      offsetUnit: rule.offsetUnit as "CALENDAR_DAY" | "BUSINESS_DAY",
      channels: parseChannels(rule.channels),
      isOverdueReminder: rule.isOverdueReminder,
      repeatIntervalHours: rule.repeatIntervalHours,
      maxRepeats: rule.maxRepeats,
      isActive: rule.isActive,
    })),
    isActive: task.isActive,
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 px-4 py-5">
      <div>
        <Link
          href={`/tasks/${task.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          {task.title}
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">업무 수정</h1>
      </div>

      {/* ---------- 과거 이력 보존 안내 ---------- */}
      <div className="flex items-start gap-2 rounded-lg border border-status-blocked-line/40 bg-status-blocked-bg/30 px-3 py-2.5 text-sm">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-status-blocked-fg" />
        <div>
          <p className="font-medium text-status-blocked-fg">
            반복 규칙 변경은 미래 회차에만 반영됩니다
          </p>
          <p className="mt-0.5 text-muted-foreground">
            이미 <strong>완료·건너뜀 처리된 회차</strong>와{" "}
            <strong>마감일이 지난 회차</strong>는 변경되지 않습니다. 체크리스트 템플릿을
            수정해도 이미 생성된 회차의 체크리스트는 그대로 유지됩니다.
          </p>
        </div>
      </div>

      {!parsed.ok && (
        <div className="rounded-lg border border-status-overdue-line/50 bg-status-overdue-bg/40 px-3 py-2.5 text-sm">
          <p className="font-medium text-status-overdue-fg">
            저장된 반복 규칙을 해석할 수 없어 기본값으로 초기화했습니다
          </p>
          <p className="mt-0.5 text-muted-foreground">{parsed.error}</p>
        </div>
      )}

      <TaskForm
        mode="edit"
        taskId={task.id}
        initialValues={initialValues}
        options={{ ...options, channels: listChannelOptions() }}
      />
    </div>
  );
}
