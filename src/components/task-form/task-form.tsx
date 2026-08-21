"use client";

/**
 * 업무 등록/수정 폼
 * ============================================================================
 * 반복 규칙 편집기 + 실시간 미리보기를 좌우로 배치해, 규칙을 만지는 즉시
 * 결과를 확인할 수 있게 한다.
 */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { GripVertical, Link2, ListChecks, Loader2, Plus, Trash2 } from "lucide-react";

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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownView } from "@/components/markdown-view";
import { RecurrenceEditor } from "@/components/task-form/recurrence-editor";
import { RecurrencePreview } from "@/components/task-form/recurrence-preview";
import type { RecurrenceConfig } from "@/lib/recurrence/types";
import { PRIORITY_LABELS, type Priority } from "@/lib/validation/task-schema";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// 폼 상태 타입
// ---------------------------------------------------------------------------

export interface NotificationRuleDraft {
  offsetDays: number;
  timeOfDay: string;
  offsetUnit: "CALENDAR_DAY" | "BUSINESS_DAY";
  channels: string[];
  isOverdueReminder: boolean;
  repeatIntervalHours: number | null;
  maxRepeats: number | null;
  isActive: boolean;
}

export interface TaskFormValues {
  title: string;
  descriptionMd: string;
  categoryId: string | null;
  tagNames: string[];
  defaultAssigneeId: string | null;
  priority: Priority;
  estimatedHours: number | null;
  recurrenceConfig: RecurrenceConfig;
  referenceLinks: { label: string; url: string }[];
  checklistTemplate: { title: string; isRequired: boolean }[];
  notificationRules: NotificationRuleDraft[];
  isActive: boolean;
}

export interface TaskFormOptions {
  users: { id: string; name: string; department: string | null }[];
  categories: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  channels: { id: string; label: string; description: string }[];
}

const NONE = "__none__";

export function TaskForm({
  mode,
  taskId,
  initialValues,
  options,
}: {
  mode: "create" | "edit";
  taskId?: string;
  initialValues: TaskFormValues;
  options: TaskFormOptions;
}) {
  const router = useRouter();
  const [values, setValues] = useState<TaskFormValues>(initialValues);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const [showPreviewMarkdown, setShowPreviewMarkdown] = useState(false);

  const patch = (partial: Partial<TaskFormValues>) =>
    setValues((prev) => ({ ...prev, ...partial }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);
    setFieldErrors({});

    try {
      const response = await fetch(
        mode === "create" ? "/api/tasks" : `/api/tasks/${taskId}`,
        {
          method: mode === "create" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        },
      );

      const json = await response.json();

      if (!response.ok) {
        if (json.fieldErrors) setFieldErrors(json.fieldErrors);
        toast.error(json.error ?? "저장에 실패했습니다.");
        return;
      }

      toast.success(
        mode === "create"
          ? "업무를 등록했습니다. 발생 회차가 생성되었습니다."
          : "업무를 수정했습니다. 미래 회차가 새 규칙으로 갱신되었습니다.",
      );
      router.push(`/tasks/${json.id}`);
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "네트워크 오류가 발생했습니다.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const errorFor = (field: string) => fieldErrors[field]?.[0];

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* ================= 왼쪽: 기본 정보 ================= */}
        <div className="space-y-6">
          <Section title="기본 정보">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="title">
                  업무 제목<span className="ml-0.5 text-status-overdue-fg">*</span>
                </Label>
                <Input
                  id="title"
                  value={values.title}
                  onChange={(event) => patch({ title: event.target.value })}
                  placeholder="예: 월 결산 전표 마감"
                  aria-invalid={Boolean(errorFor("title"))}
                  required
                />
                {errorFor("title") && (
                  <p className="text-xs text-status-overdue-fg">{errorFor("title")}</p>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="category">카테고리</Label>
                  <Select
                    value={values.categoryId ?? NONE}
                    onValueChange={(v) => patch({ categoryId: v === NONE ? null : v })}
                  >
                    <SelectTrigger id="category">
                      <SelectValue placeholder="선택" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>없음</SelectItem>
                      {options.categories.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="assignee">기본 담당자</Label>
                  <Select
                    value={values.defaultAssigneeId ?? NONE}
                    onValueChange={(v) =>
                      patch({ defaultAssigneeId: v === NONE ? null : v })
                    }
                  >
                    <SelectTrigger id="assignee">
                      <SelectValue placeholder="선택" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>미지정</SelectItem>
                      {options.users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.name}
                          {user.department ? ` · ${user.department}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="priority">중요도</Label>
                  <Select
                    value={values.priority}
                    onValueChange={(v) => patch({ priority: v as Priority })}
                  >
                    <SelectTrigger id="priority">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["HIGH", "MEDIUM", "LOW"] as const).map((priority) => (
                        <SelectItem key={priority} value={priority}>
                          {PRIORITY_LABELS[priority]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <TagInput
                  value={values.tagNames}
                  suggestions={options.tags.map((t) => t.name)}
                  onChange={(tagNames) => patch({ tagNames })}
                />

                <div className="space-y-1.5">
                  <Label htmlFor="estimated-hours">
                    예상 소요 시간
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      (시간, 선택)
                    </span>
                  </Label>
                  <Input
                    id="estimated-hours"
                    type="number"
                    min={0}
                    step={0.5}
                    value={values.estimatedHours ?? ""}
                    onChange={(event) =>
                      patch({
                        estimatedHours:
                          event.target.value === "" ? null : Number(event.target.value),
                      })
                    }
                    placeholder="예: 8"
                  />
                </div>
              </div>
            </div>
          </Section>

          {/* ================= 상세 설명 (Markdown) ================= */}
          <Section
            title="상세 설명"
            description="Markdown 을 지원합니다. 업무 절차, 주의사항, 담당 부서 연락처 등을 자유롭게 작성하세요."
            action={
              <div className="flex items-center gap-1.5">
                <Switch
                  id="md-preview"
                  checked={showPreviewMarkdown}
                  onCheckedChange={setShowPreviewMarkdown}
                  className="scale-90"
                />
                <Label htmlFor="md-preview" className="text-xs text-muted-foreground">
                  미리보기
                </Label>
              </div>
            }
          >
            {showPreviewMarkdown ? (
              <div className="min-h-[280px] rounded-md border bg-card p-4">
                {values.descriptionMd.trim() ? (
                  <MarkdownView content={values.descriptionMd} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    작성한 내용이 없습니다.
                  </p>
                )}
              </div>
            ) : (
              <Textarea
                value={values.descriptionMd}
                onChange={(event) => patch({ descriptionMd: event.target.value })}
                placeholder={PLACEHOLDER_MARKDOWN}
                className="min-h-[280px] font-mono text-[13px] leading-relaxed"
              />
            )}
          </Section>

          {/* ================= 참고 링크 ================= */}
          <Section title="참고 링크" description="관련 시스템·문서 URL 을 여러 개 첨부할 수 있습니다.">
            <div className="space-y-2">
              {values.referenceLinks.map((link, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    value={link.label}
                    onChange={(event) => {
                      const next = [...values.referenceLinks];
                      next[index] = { ...link, label: event.target.value };
                      patch({ referenceLinks: next });
                    }}
                    placeholder="이름 (예: 홈택스)"
                    className="w-1/3"
                  />
                  <Input
                    value={link.url}
                    onChange={(event) => {
                      const next = [...values.referenceLinks];
                      next[index] = { ...link, url: event.target.value };
                      patch({ referenceLinks: next });
                    }}
                    placeholder="https://..."
                    className="flex-1"
                    type="url"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      patch({
                        referenceLinks: values.referenceLinks.filter((_, i) => i !== index),
                      })
                    }
                    aria-label="링크 삭제"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  patch({
                    referenceLinks: [...values.referenceLinks, { label: "", url: "" }],
                  })
                }
              >
                <Link2 className="size-4" />
                링크 추가
              </Button>
            </div>
          </Section>

          {/* ================= 체크리스트 템플릿 ================= */}
          <Section
            title="체크리스트 템플릿"
            description="각 발생 회차마다 이 목록이 복제되어 새로 생성됩니다. 이미 생성된 회차의 체크리스트는 템플릿을 수정해도 바뀌지 않습니다."
          >
            <div className="space-y-2">
              {values.checklistTemplate.map((item, index) => (
                <div key={index} className="flex items-center gap-2">
                  <GripVertical className="size-4 shrink-0 text-muted-foreground" />
                  <Input
                    value={item.title}
                    onChange={(event) => {
                      const next = [...values.checklistTemplate];
                      next[index] = { ...item, title: event.target.value };
                      patch({ checklistTemplate: next });
                    }}
                    placeholder="예: 미결 전표 전량 처리"
                    className="flex-1"
                  />
                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <Checkbox
                      checked={item.isRequired}
                      onCheckedChange={(checked) => {
                        const next = [...values.checklistTemplate];
                        next[index] = { ...item, isRequired: checked === true };
                        patch({ checklistTemplate: next });
                      }}
                    />
                    필수
                  </label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      patch({
                        checklistTemplate: values.checklistTemplate.filter(
                          (_, i) => i !== index,
                        ),
                      })
                    }
                    aria-label="항목 삭제"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  patch({
                    checklistTemplate: [
                      ...values.checklistTemplate,
                      { title: "", isRequired: false },
                    ],
                  })
                }
              >
                <ListChecks className="size-4" />
                항목 추가
              </Button>
            </div>
          </Section>

          {/* ================= 알림 ================= */}
          <NotificationRulesEditor
            rules={values.notificationRules}
            channels={options.channels}
            onChange={(notificationRules) => patch({ notificationRules })}
          />
        </div>

        {/* ================= 오른쪽: 반복 규칙 + 미리보기 ================= */}
        <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <Section title="반복 주기 설정">
            <RecurrenceEditor
              config={values.recurrenceConfig}
              onChange={(recurrenceConfig) => patch({ recurrenceConfig })}
            />
          </Section>

          <RecurrencePreview config={values.recurrenceConfig} />
        </div>
      </div>

      <Separator />

      {/* ================= 하단 액션 ================= */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={values.isActive}
            onCheckedChange={(isActive) => patch({ isActive })}
          />
          <span>
            활성 상태
            <span className="ml-1.5 text-xs text-muted-foreground">
              끄면 신규 회차 생성을 멈춥니다 (기존 이력은 유지)
            </span>
          </span>
        </label>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isSubmitting}
          >
            취소
          </Button>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <Loader2 className="size-4 animate-spin" />}
            {mode === "create" ? "업무 등록" : "변경 저장"}
          </Button>
        </div>
      </div>

      {fieldErrors._ && (
        <p className="text-sm text-status-overdue-fg">{fieldErrors._[0]}</p>
      )}
    </form>
  );
}

// ---------------------------------------------------------------------------
// 알림 규칙 편집기
// ---------------------------------------------------------------------------

function NotificationRulesEditor({
  rules,
  channels,
  onChange,
}: {
  rules: NotificationRuleDraft[];
  channels: { id: string; label: string; description: string }[];
  onChange: (rules: NotificationRuleDraft[]) => void;
}) {
  const update = (index: number, partial: Partial<NotificationRuleDraft>) => {
    const next = [...rules];
    next[index] = { ...next[index], ...partial };
    onChange(next);
  };

  const addScheduled = () =>
    onChange([
      ...rules,
      {
        offsetDays: -1,
        timeOfDay: "09:00",
        offsetUnit: "CALENDAR_DAY",
        channels: [channels[0]?.id ?? "WEB_PUSH"],
        isOverdueReminder: false,
        repeatIntervalHours: null,
        maxRepeats: null,
        isActive: true,
      },
    ]);

  const addOverdue = () =>
    onChange([
      ...rules,
      {
        offsetDays: 0,
        timeOfDay: "18:00",
        offsetUnit: "CALENDAR_DAY",
        channels: [channels[0]?.id ?? "WEB_PUSH"],
        isOverdueReminder: true,
        repeatIntervalHours: 24,
        maxRepeats: 5,
        isActive: true,
      },
    ]);

  return (
    <Section
      title="알림 설정"
      description="알림 시점을 여러 개 지정할 수 있습니다. 발송 시각은 Asia/Seoul 기준입니다."
    >
      <div className="space-y-2">
        {rules.map((rule, index) => (
          <div
            key={index}
            className={cn(
              "space-y-2.5 rounded-lg border p-3",
              !rule.isActive && "opacity-60",
              rule.isOverdueReminder && "border-status-overdue-line/40 bg-status-overdue-bg/20",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">
                {rule.isOverdueReminder ? "지연 리마인더 (반복 발송)" : "정기 알림"}
              </span>
              <div className="flex items-center gap-2">
                <Switch
                  checked={rule.isActive}
                  onCheckedChange={(isActive) => update(index, { isActive })}
                  className="scale-90"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => onChange(rules.filter((_, i) => i !== index))}
                  aria-label="알림 삭제"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>

            {rule.isOverdueReminder ? (
              <div className="grid gap-2 sm:grid-cols-3">
                <MiniField label="시작 기준 시각">
                  <Input
                    type="time"
                    value={rule.timeOfDay}
                    onChange={(event) => update(index, { timeOfDay: event.target.value })}
                    className="h-8"
                  />
                </MiniField>
                <MiniField label="반복 간격 (시간)">
                  <Input
                    type="number"
                    min={1}
                    max={720}
                    value={rule.repeatIntervalHours ?? 24}
                    onChange={(event) =>
                      update(index, {
                        repeatIntervalHours: Math.max(1, Number(event.target.value) || 1),
                      })
                    }
                    className="h-8"
                  />
                </MiniField>
                <MiniField label="최대 반복 횟수">
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    placeholder="무제한"
                    value={rule.maxRepeats ?? ""}
                    onChange={(event) =>
                      update(index, {
                        maxRepeats:
                          event.target.value === "" ? null : Number(event.target.value),
                      })
                    }
                    className="h-8"
                  />
                </MiniField>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-3">
                <MiniField label="시점">
                  <Select
                    value={String(rule.offsetDays)}
                    onValueChange={(v) => update(index, { offsetDays: Number(v) })}
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[-30, -14, -10, -7, -5, -3, -2, -1, 0, 1, 3, 7].map((offset) => (
                        <SelectItem key={offset} value={String(offset)}>
                          {offset === 0
                            ? "마감 당일"
                            : offset < 0
                              ? `마감 ${Math.abs(offset)}일 전 (D-${Math.abs(offset)})`
                              : `마감 ${offset}일 후`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </MiniField>

                <MiniField label="발송 시각 (KST)">
                  <Input
                    type="time"
                    value={rule.timeOfDay}
                    onChange={(event) => update(index, { timeOfDay: event.target.value })}
                    className="h-8"
                  />
                </MiniField>

                <MiniField label="오프셋 단위">
                  <Select
                    value={rule.offsetUnit}
                    onValueChange={(v) =>
                      update(index, {
                        offsetUnit: v as "CALENDAR_DAY" | "BUSINESS_DAY",
                      })
                    }
                  >
                    <SelectTrigger className="h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CALENDAR_DAY">달력일</SelectItem>
                      <SelectItem value="BUSINESS_DAY">영업일</SelectItem>
                    </SelectContent>
                  </Select>
                </MiniField>
              </div>
            )}

            <MiniField label="발송 채널">
              <div className="flex flex-wrap gap-2 pt-0.5">
                {channels.map((channel) => {
                  const checked = rule.channels.includes(channel.id);
                  return (
                    <label
                      key={channel.id}
                      title={channel.description}
                      className={cn(
                        "flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
                        checked ? "border-primary bg-primary/10" : "hover:bg-accent",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(isChecked) =>
                          update(index, {
                            channels: isChecked
                              ? [...rule.channels, channel.id]
                              : rule.channels.filter((id) => id !== channel.id),
                          })
                        }
                        className="size-3.5"
                      />
                      {channel.label}
                    </label>
                  );
                })}
              </div>
              {rule.channels.length === 0 && (
                <p className="mt-1 text-xs text-status-overdue-fg">
                  채널을 최소 1개 선택하세요.
                </p>
              )}
            </MiniField>
          </div>
        ))}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={addScheduled}>
            <Plus className="size-4" />
            정기 알림 추가
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={addOverdue}>
            <Plus className="size-4" />
            지연 리마인더 추가
          </Button>
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// 태그 입력
// ---------------------------------------------------------------------------

function TagInput({
  value,
  suggestions,
  onChange,
}: {
  value: string[];
  suggestions: string[];
  onChange: (value: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setDraft("");
  };

  const unused = suggestions.filter((name) => !value.includes(name));

  return (
    <div className="space-y-1.5">
      <Label htmlFor="tags">
        태그
        <span className="ml-1.5 text-xs font-normal text-muted-foreground">
          Enter 로 추가
        </span>
      </Label>

      <div className="flex flex-wrap gap-1.5">
        {value.map((name) => (
          <span
            key={name}
            className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs"
          >
            #{name}
            <button
              type="button"
              onClick={() => onChange(value.filter((n) => n !== name))}
              className="text-muted-foreground hover:text-foreground"
              aria-label={`${name} 태그 제거`}
            >
              ×
            </button>
          </span>
        ))}
      </div>

      <Input
        id="tags"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add(draft);
          }
        }}
        placeholder="태그 입력"
      />

      {unused.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {unused.slice(0, 8).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => add(name)}
              className="rounded border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
            >
              + {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 레이아웃 헬퍼
// ---------------------------------------------------------------------------

function Section({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function MiniField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <span className="block text-[11px] text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

const PLACEHOLDER_MARKDOWN = `## 업무 개요

이 업무가 무엇인지 한두 문장으로 적습니다.

## 절차

1. 첫 번째 단계
2. 두 번째 단계

## ⚠️ 주의사항

- 놓치기 쉬운 부분
- 과거에 사고가 났던 지점

## 담당 부서 연락처

| 구분 | 담당 | 연락처 |
|---|---|---|
| 시스템 문의 | IT팀 | 내선 0000 |`;
