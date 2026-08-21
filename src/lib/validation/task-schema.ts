/**
 * API 입력 검증 스키마
 * ============================================================================
 * 클라이언트가 보낸 데이터를 DB 에 넣기 전 반드시 이 스키마를 통과시킨다.
 */

import { z } from "zod";

import { plainDateSchema, recurrenceConfigSchema } from "@/lib/recurrence/types";

export const prioritySchema = z.enum(["HIGH", "MEDIUM", "LOW"]);
export type Priority = z.infer<typeof prioritySchema>;

export const PRIORITY_LABELS: Record<Priority, string> = {
  HIGH: "높음",
  MEDIUM: "보통",
  LOW: "낮음",
};

export const PRIORITY_ORDER: Record<Priority, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
};

export const storedStatusSchema = z.enum(["PENDING", "IN_PROGRESS", "DONE", "SKIPPED"]);
export const displayStatusSchema = z.enum([
  "PENDING",
  "IN_PROGRESS",
  "DONE",
  "SKIPPED",
  "BLOCKED",
  "OVERDUE",
]);

export const referenceLinkSchema = z.object({
  label: z.string().trim().min(1, "링크 이름을 입력하세요.").max(100),
  url: z.string().trim().url("올바른 URL 형식이 아닙니다."),
});

export const checklistTemplateItemSchema = z.object({
  title: z.string().trim().min(1, "체크리스트 항목을 입력하세요.").max(200),
  isRequired: z.boolean().default(false),
});

export const notificationRuleSchema = z
  .object({
    /** 마감일 기준 오프셋(일). 음수 = 마감 전, 0 = 당일 */
    offsetDays: z.number().int().min(-365).max(365).default(-1),
    /** KST 벽시계 시각 */
    timeOfDay: z
      .string()
      .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "HH:mm 형식으로 입력하세요.")
      .default("09:00"),
    offsetUnit: z.enum(["CALENDAR_DAY", "BUSINESS_DAY"]).default("CALENDAR_DAY"),
    channels: z.array(z.string().min(1)).min(1, "발송 채널을 최소 1개 선택하세요."),

    /** 마감 초과 후 미완료 리마인더 반복 발송 */
    isOverdueReminder: z.boolean().default(false),
    repeatIntervalHours: z.number().int().min(1).max(720).nullable().default(null),
    maxRepeats: z.number().int().min(1).max(100).nullable().default(null),

    isActive: z.boolean().default(true),
  })
  .refine(
    (rule) => !rule.isOverdueReminder || rule.repeatIntervalHours !== null,
    {
      message: "지연 리마인더를 사용하려면 반복 간격(시간)을 지정해야 합니다.",
      path: ["repeatIntervalHours"],
    },
  );

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, "업무 제목을 입력하세요.").max(200),
  descriptionMd: z.string().max(20_000).default(""),

  categoryId: z.string().nullable().default(null),
  /** 태그 이름 목록. 없는 태그는 자동 생성한다. */
  tagNames: z.array(z.string().trim().min(1).max(50)).default([]),

  defaultAssigneeId: z.string().nullable().default(null),
  priority: prioritySchema.default("MEDIUM"),
  estimatedHours: z.number().min(0).max(10_000).nullable().default(null),

  recurrenceConfig: recurrenceConfigSchema,

  referenceLinks: z.array(referenceLinkSchema).max(30).default([]),
  checklistTemplate: z.array(checklistTemplateItemSchema).max(100).default([]),
  notificationRules: z.array(notificationRuleSchema).max(20).default([]),

  isActive: z.boolean().default(true),
});

export type TaskInput = z.infer<typeof taskInputSchema>;
export type TaskInputRaw = z.input<typeof taskInputSchema>;

// ---------------------------------------------------------------------------
// 의존 관계
// ---------------------------------------------------------------------------

export const matchStrategySchema = z.enum([
  "SAME_SEQUENCE",
  "NEAREST_PRECEDING",
  "SAME_PERIOD",
]);

export const lagUnitSchema = z.enum(["BUSINESS_DAY", "CALENDAR_DAY"]);

export const LAG_UNIT_LABELS = {
  BUSINESS_DAY: "영업일",
  CALENDAR_DAY: "달력일",
} as const;

export const taskDependencyInputSchema = z.object({
  predecessorId: z.string().min(1, "선행 업무를 선택하세요."),
  successorId: z.string().min(1, "후행 업무를 선택하세요."),
  lagAmount: z.number().int().min(0).max(365).default(0),
  lagUnit: lagUnitSchema.default("BUSINESS_DAY"),
  matchStrategy: matchStrategySchema.default("NEAREST_PRECEDING"),
  isBlocking: z.boolean().default(true),
  note: z.string().max(500).nullable().default(null),
});

export type TaskDependencyInput = z.infer<typeof taskDependencyInputSchema>;

export const occurrenceOverrideInputSchema = z.object({
  predecessorOccurrenceId: z.string().min(1),
  successorOccurrenceId: z.string().min(1),
  lagAmount: z.number().int().min(0).max(365).default(0),
  lagUnit: lagUnitSchema.default("BUSINESS_DAY"),
  isBlocking: z.boolean().default(true),
  note: z.string().max(500).nullable().default(null),
});

// ---------------------------------------------------------------------------
// 발생 건 수정
// ---------------------------------------------------------------------------

export const occurrenceUpdateSchema = z.object({
  status: storedStatusSchema.optional(),
  assigneeId: z.string().nullable().optional(),
  memo: z.string().max(5_000).nullable().optional(),
  /** 마감일 직접 변경. 반복 규칙의 1회성 예외로도 기록된다. */
  scheduledDate: plainDateSchema.optional(),
});

export const checklistItemUpdateSchema = z.object({
  isChecked: z.boolean(),
});

// ---------------------------------------------------------------------------
// 조회 필터
// ---------------------------------------------------------------------------

export const occurrenceFilterSchema = z.object({
  assigneeId: z.string().optional(),
  categoryId: z.string().optional(),
  tagId: z.string().optional(),
  priority: prioritySchema.optional(),
  /** 파생 상태 기준 필터 (BLOCKED / OVERDUE 포함) */
  status: displayStatusSchema.optional(),
  /** 제목 검색 */
  q: z.string().trim().max(100).optional(),
});

export type OccurrenceFilter = z.infer<typeof occurrenceFilterSchema>;

/** URLSearchParams → 필터 객체 */
export function parseOccurrenceFilter(
  params: URLSearchParams | Record<string, string | string[] | undefined>,
): OccurrenceFilter {
  const get = (key: string): string | undefined => {
    if (params instanceof URLSearchParams) return params.get(key) ?? undefined;
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const raw = {
    assigneeId: get("assigneeId"),
    categoryId: get("categoryId"),
    tagId: get("tagId"),
    priority: get("priority"),
    status: get("status"),
    q: get("q"),
  };

  // 빈 문자열은 "필터 없음"으로 취급한다.
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== undefined && value !== ""),
  );

  const result = occurrenceFilterSchema.safeParse(cleaned);
  return result.success ? result.data : {};
}
