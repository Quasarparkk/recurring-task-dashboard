import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { TaskForm, type TaskFormValues } from "@/components/task-form/task-form";
import { todayInSeoul } from "@/lib/date/kst";
import { listChannelOptions } from "@/lib/notification/registry";
import { createDefaultRecurrenceConfig } from "@/lib/recurrence/types";
import { loadFilterOptions } from "@/lib/services/options-service";

/**
 * 담당자·카테고리·태그 목록과 "오늘" 날짜를 DB/런타임에서 읽으므로 정적 생성하지 않는다.
 * (정적 생성되면 새로 추가한 담당자가 폼에 나타나지 않고 시작일 기본값이 빌드일로 고정된다)
 */
export const dynamic = "force-dynamic";

export default async function NewTaskPage() {
  const options = await loadFilterOptions();
  const today = todayInSeoul();

  const initialValues: TaskFormValues = {
    title: "",
    descriptionMd: "",
    categoryId: null,
    tagNames: [],
    defaultAssigneeId: null,
    priority: "MEDIUM",
    estimatedHours: null,
    recurrenceConfig: createDefaultRecurrenceConfig(today),
    referenceLinks: [],
    checklistTemplate: [],
    notificationRules: [
      // 기본 알림 하나를 미리 넣어 둔다 (알림 없이 등록되는 실수 방지).
      {
        offsetDays: -3,
        timeOfDay: "09:00",
        offsetUnit: "CALENDAR_DAY",
        channels: ["WEB_PUSH"],
        isOverdueReminder: false,
        repeatIntervalHours: null,
        maxRepeats: null,
        isActive: true,
      },
    ],
    isActive: true,
  };

  return (
    <div className="mx-auto max-w-[1500px] space-y-5 px-4 py-5">
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          연간 대시보드
        </Link>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">업무 등록</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          반복 규칙을 설정하면 오른쪽에 다음 10회 발생 예정일이 즉시 표시됩니다.
        </p>
      </div>

      <TaskForm
        mode="create"
        initialValues={initialValues}
        options={{ ...options, channels: listChannelOptions() }}
      />
    </div>
  );
}
