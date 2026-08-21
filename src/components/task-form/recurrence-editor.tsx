"use client";

/**
 * 반복 규칙 편집기
 * ============================================================================
 * RecurrenceConfig 의 각 필드를 UI 로 노출한다.
 * 규칙 종류(type)에 따라 필요한 입력만 보여주는 것이 핵심이다.
 */

import { Info } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WEEKDAY_LABELS_KO } from "@/lib/date/plain-date";
import {
  createDefaultRule,
  HOLIDAY_POLICY_LABELS,
  ON_MISSING_DAY_LABELS,
  RECURRENCE_TYPE_LABELS,
  ruleCanMissTargetDay,
  SHIFT_TARGET_LABELS,
  type DayOfMonth,
  type Nth,
  type RecurrenceConfig,
  type RecurrenceRule,
  type RecurrenceRuleType,
} from "@/lib/recurrence/types";
import { cn } from "@/lib/utils";

const RULE_TYPES = Object.keys(RECURRENCE_TYPE_LABELS) as RecurrenceRuleType[];

const NTH_OPTIONS: { value: Nth; label: string }[] = [
  { value: 1, label: "첫째 주" },
  { value: 2, label: "둘째 주" },
  { value: 3, label: "셋째 주" },
  { value: 4, label: "넷째 주" },
  { value: 5, label: "다섯째 주" },
  { value: -1, label: "마지막" },
];

export function RecurrenceEditor({
  config,
  onChange,
}: {
  config: RecurrenceConfig;
  onChange: (config: RecurrenceConfig) => void;
}) {
  const patch = (partial: Partial<RecurrenceConfig>) =>
    onChange({ ...config, ...partial });

  const patchRule = (rule: RecurrenceRule) => onChange({ ...config, rule });

  /** 규칙 종류를 바꿀 때는 그 종류의 기본 파라미터로 초기화한다. */
  const changeType = (type: RecurrenceRuleType) => {
    patchRule(createDefaultRule(type, config.startDate));
  };

  return (
    <div className="space-y-4">
      {/* ---------- 규칙 종류 ---------- */}
      <Field label="반복 주기" htmlFor="rule-type">
        <Select value={config.rule.type} onValueChange={(v) => changeType(v as RecurrenceRuleType)}>
          <SelectTrigger id="rule-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RULE_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {RECURRENCE_TYPE_LABELS[type]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {/* ---------- 종류별 파라미터 ---------- */}
      <div className="rounded-lg border bg-muted/30 p-3">
        <RuleParams rule={config.rule} onChange={patchRule} />
      </div>

      {/* ---------- 기간 / 횟수 ---------- */}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="반복 시작일" htmlFor="start-date" required>
          <Input
            id="start-date"
            type="date"
            value={config.startDate}
            onChange={(event) => {
              const value = event.target.value;
              if (value) patch({ startDate: value });
            }}
          />
        </Field>

        <Field
          label="반복 종료일"
          htmlFor="end-date"
          hint="비우면 무한 반복"
        >
          <Input
            id="end-date"
            type="date"
            value={config.endDate ?? ""}
            min={config.startDate}
            onChange={(event) => patch({ endDate: event.target.value || null })}
          />
        </Field>

        <Field
          label="총 반복 횟수"
          htmlFor="max-occurrences"
          hint="비우면 제한 없음"
        >
          <Input
            id="max-occurrences"
            type="number"
            min={1}
            max={10000}
            placeholder="제한 없음"
            value={config.maxOccurrences ?? ""}
            onChange={(event) => {
              const value = event.target.value;
              patch({ maxOccurrences: value === "" ? null : Number(value) });
            }}
          />
        </Field>
      </div>

      {/* ---------- 공휴일 정책 ---------- */}
      <div className="space-y-3 rounded-lg border p-3">
        <div className="flex items-center gap-1.5">
          <h4 className="text-sm font-medium">주말·공휴일 처리</h4>
          <span className="text-xs text-muted-foreground">(Asia/Seoul 기준)</span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="마감일이 휴일인 경우" htmlFor="holiday-policy">
            <Select
              value={config.holidayPolicy}
              onValueChange={(v) =>
                patch({ holidayPolicy: v as RecurrenceConfig["holidayPolicy"] })
              }
            >
              <SelectTrigger id="holiday-policy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(HOLIDAY_POLICY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field
            label="무엇을 피할지"
            htmlFor="shift-target"
            hint="공휴일에도 실행되는 업무는 '주말만'"
          >
            <Select
              value={config.shiftTarget}
              onValueChange={(v) =>
                patch({ shiftTarget: v as RecurrenceConfig["shiftTarget"] })
              }
              disabled={config.holidayPolicy === "KEEP"}
            >
              <SelectTrigger id="shift-target">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(SHIFT_TARGET_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        {ruleCanMissTargetDay(config.rule) && (
          <Field
            label="지정한 날짜가 없는 달"
            htmlFor="on-missing-day"
            hint="예: '매월 31일' 규칙의 2월"
          >
            <Select
              value={config.onMissingDay}
              onValueChange={(v) =>
                patch({ onMissingDay: v as RecurrenceConfig["onMissingDay"] })
              }
            >
              <SelectTrigger id="on-missing-day">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ON_MISSING_DAY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>

      {/* ---------- 1회성 예외 ---------- */}
      <ExceptionsEditor config={config} onChange={onChange} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 규칙별 파라미터 입력
// ---------------------------------------------------------------------------

function RuleParams({
  rule,
  onChange,
}: {
  rule: RecurrenceRule;
  onChange: (rule: RecurrenceRule) => void;
}) {
  switch (rule.type) {
    case "ONCE":
      return (
        <Field label="실행 날짜" htmlFor="once-date" required>
          <Input
            id="once-date"
            type="date"
            value={rule.date}
            onChange={(event) => {
              if (event.target.value) onChange({ ...rule, date: event.target.value });
            }}
          />
        </Field>
      );

    case "YEARLY":
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="월" htmlFor="yearly-month">
            <MonthSelect
              value={rule.month}
              onChange={(month) => onChange({ ...rule, month })}
            />
          </Field>
          <Field label="일" htmlFor="yearly-day">
            <DayOfMonthSelect
              value={rule.day}
              onChange={(day) => onChange({ ...rule, day })}
            />
          </Field>
          <Field label="주기" htmlFor="yearly-interval">
            <IntervalSelect
              value={rule.intervalYears}
              unit="년"
              max={10}
              onChange={(intervalYears) => onChange({ ...rule, intervalYears })}
            />
          </Field>
        </div>
      );

    case "MONTHLY_DAY":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="일" htmlFor="monthly-day">
            <DayOfMonthSelect
              value={rule.day}
              onChange={(day) => onChange({ ...rule, day })}
            />
          </Field>
          <Field label="주기" htmlFor="monthly-interval">
            <IntervalSelect
              value={rule.intervalMonths}
              unit="개월"
              max={24}
              onChange={(intervalMonths) => onChange({ ...rule, intervalMonths })}
            />
          </Field>
        </div>
      );

    case "MONTHLY_NTH_WEEKDAY":
      return (
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="몇 번째 주" htmlFor="nth">
            <NthSelect value={rule.nth} onChange={(nth) => onChange({ ...rule, nth })} />
          </Field>
          <Field label="요일" htmlFor="weekday">
            <WeekdaySelect
              value={rule.weekday}
              onChange={(weekday) => onChange({ ...rule, weekday })}
            />
          </Field>
          <Field label="주기" htmlFor="nth-interval">
            <IntervalSelect
              value={rule.intervalMonths}
              unit="개월"
              max={24}
              onChange={(intervalMonths) => onChange({ ...rule, intervalMonths })}
            />
          </Field>
        </div>
      );

    case "SPECIFIC_MONTHS_DAY":
      return (
        <div className="space-y-3">
          <Field label="대상 월 (복수 선택)">
            <MonthCheckboxes
              value={rule.months}
              onChange={(months) => onChange({ ...rule, months })}
            />
          </Field>
          <Field label="일" htmlFor="specific-day">
            <div className="max-w-[12rem]">
              <DayOfMonthSelect
                value={rule.day}
                onChange={(day) => onChange({ ...rule, day })}
              />
            </div>
          </Field>
        </div>
      );

    case "SPECIFIC_MONTHS_NTH_WEEKDAY":
      return (
        <div className="space-y-3">
          <Field label="대상 월 (복수 선택)">
            <MonthCheckboxes
              value={rule.months}
              onChange={(months) => onChange({ ...rule, months })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="몇 번째 주" htmlFor="sm-nth">
              <NthSelect value={rule.nth} onChange={(nth) => onChange({ ...rule, nth })} />
            </Field>
            <Field label="요일" htmlFor="sm-weekday">
              <WeekdaySelect
                value={rule.weekday}
                onChange={(weekday) => onChange({ ...rule, weekday })}
              />
            </Field>
          </div>
        </div>
      );

    case "QUARTERLY":
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="기준점" htmlFor="q-anchor">
              <Select
                value={rule.anchor}
                onValueChange={(v) => onChange({ ...rule, anchor: v as "START" | "END" })}
              >
                <SelectTrigger id="q-anchor">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="START">분기 시작일</SelectItem>
                  <SelectItem value="END">분기 종료일</SelectItem>
                </SelectContent>
              </Select>
            </Field>

            <Field label="오프셋" htmlFor="q-offset" hint="음수 = 기준점 이전">
              <Input
                id="q-offset"
                type="number"
                min={-90}
                max={90}
                value={rule.offsetAmount}
                onChange={(event) =>
                  onChange({ ...rule, offsetAmount: Number(event.target.value) || 0 })
                }
              />
            </Field>

            <Field label="오프셋 단위" htmlFor="q-unit">
              <Select
                value={rule.offsetUnit}
                onValueChange={(v) =>
                  onChange({ ...rule, offsetUnit: v as "CALENDAR_DAY" | "BUSINESS_DAY" })
                }
              >
                <SelectTrigger id="q-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BUSINESS_DAY">영업일</SelectItem>
                  <SelectItem value="CALENDAR_DAY">달력일</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="회계연도 시작 월"
              htmlFor="q-fiscal"
              hint="1월이면 역년 기준 분기"
            >
              <MonthSelect
                value={rule.fiscalYearStartMonth}
                onChange={(fiscalYearStartMonth) =>
                  onChange({ ...rule, fiscalYearStartMonth })
                }
              />
            </Field>

            <Field label="대상 분기" hint="비우면 전 분기">
              <div className="flex gap-1.5 pt-1">
                {([1, 2, 3, 4] as const).map((quarter) => {
                  const checked = rule.quarters.includes(quarter);
                  return (
                    <button
                      key={quarter}
                      type="button"
                      onClick={() =>
                        onChange({
                          ...rule,
                          quarters: checked
                            ? rule.quarters.filter((q) => q !== quarter)
                            : [...rule.quarters, quarter].sort(),
                        })
                      }
                      className={cn(
                        "h-8 flex-1 rounded-md border text-sm transition-colors",
                        checked
                          ? "border-primary bg-primary text-primary-foreground"
                          : "hover:bg-accent",
                      )}
                    >
                      {quarter}분기
                    </button>
                  );
                })}
              </div>
            </Field>
          </div>
        </div>
      );

    case "WEEKLY":
      return (
        <div className="space-y-3">
          <Field label="요일 (복수 선택)">
            <div className="flex gap-1.5">
              {/* 월요일부터 표시 (한국 업무 관행) */}
              {[1, 2, 3, 4, 5, 6, 0].map((weekday) => {
                const checked = rule.weekdays.includes(weekday);
                return (
                  <button
                    key={weekday}
                    type="button"
                    onClick={() =>
                      onChange({
                        ...rule,
                        weekdays: checked
                          ? rule.weekdays.filter((w) => w !== weekday)
                          : [...rule.weekdays, weekday],
                      })
                    }
                    className={cn(
                      "size-9 rounded-md border text-sm transition-colors",
                      checked
                        ? "border-primary bg-primary text-primary-foreground"
                        : "hover:bg-accent",
                      weekday === 0 && !checked && "text-status-overdue-fg",
                      weekday === 6 && !checked && "text-status-progress-fg",
                    )}
                  >
                    {WEEKDAY_LABELS_KO[weekday]}
                  </button>
                );
              })}
            </div>
            {rule.weekdays.length === 0 && (
              <p className="mt-1 text-xs text-status-overdue-fg">
                요일을 최소 1개 선택하세요.
              </p>
            )}
          </Field>

          <Field label="주기" htmlFor="weekly-interval">
            <div className="max-w-[12rem]">
              <IntervalSelect
                value={rule.intervalWeeks}
                unit="주"
                max={12}
                onChange={(intervalWeeks) => onChange({ ...rule, intervalWeeks })}
              />
            </div>
          </Field>
        </div>
      );

    case "EVERY_N_DAYS":
      return (
        <Field label="간격 (일)" htmlFor="every-n-days" required>
          <div className="max-w-[12rem]">
            <Input
              id="every-n-days"
              type="number"
              min={1}
              max={3650}
              value={rule.days}
              onChange={(event) =>
                onChange({ ...rule, days: Math.max(1, Number(event.target.value) || 1) })
              }
            />
          </div>
        </Field>
      );
  }
}

// ---------------------------------------------------------------------------
// 1회성 예외
// ---------------------------------------------------------------------------

function ExceptionsEditor({
  config,
  onChange,
}: {
  config: RecurrenceConfig;
  onChange: (config: RecurrenceConfig) => void;
}) {
  if (config.exceptions.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <p>
          특정 회차만 날짜를 바꾸거나 건너뛰려면, 저장 후{" "}
          <strong>월간 뷰나 업무 상세에서 해당 회차를 직접 수정</strong>하세요. 변경 내용이
          이 반복 규칙의 예외로 자동 기록되어, 이후 규칙이 날짜를 되돌리지 않습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <h4 className="text-sm font-medium">
        1회성 예외 ({config.exceptions.length}건)
      </h4>
      <ul className="space-y-1.5">
        {config.exceptions.map((exception, index) => (
          <li
            key={`${exception.originalDate}-${index}`}
            className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs"
          >
            <span className="tabular-nums">
              <span className="text-muted-foreground">{exception.originalDate}</span>
              {exception.kind === "SKIP" ? (
                <span className="ml-2 font-medium text-status-skipped-fg">건너뛰기</span>
              ) : (
                <span className="ml-2 font-medium text-status-progress-fg">
                  → {exception.newDate}
                </span>
              )}
              {exception.reason && (
                <span className="ml-2 text-muted-foreground">({exception.reason})</span>
              )}
            </span>
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...config,
                  exceptions: config.exceptions.filter((_, i) => i !== index),
                })
              }
              className="shrink-0 text-muted-foreground hover:text-status-overdue-fg"
            >
              해제
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 공통 입력 컴포넌트
// ---------------------------------------------------------------------------

function Field({
  label,
  htmlFor,
  hint,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} className="text-xs font-medium">
        {label}
        {required && <span className="ml-0.5 text-status-overdue-fg">*</span>}
        {hint && (
          <span className="ml-1.5 font-normal text-muted-foreground">{hint}</span>
        )}
      </Label>
      {children}
    </div>
  );
}

function MonthSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
          <SelectItem key={month} value={String(month)}>
            {month}월
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DayOfMonthSelect({
  value,
  onChange,
}: {
  value: DayOfMonth;
  onChange: (value: DayOfMonth) => void;
}) {
  return (
    <Select
      value={value === "LAST" ? "LAST" : String(value)}
      onValueChange={(v) => onChange(v === "LAST" ? "LAST" : Number(v))}
    >
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="LAST">말일</SelectItem>
        {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
          <SelectItem key={day} value={String(day)}>
            {day}일
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NthSelect({
  value,
  onChange,
}: {
  value: Nth;
  onChange: (value: Nth) => void;
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v) as Nth)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {NTH_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={String(option.value)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function WeekdaySelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
          <SelectItem key={weekday} value={String(weekday)}>
            {WEEKDAY_LABELS_KO[weekday]}요일
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** 주기 단위별 라벨. "매개월"처럼 어색한 표현이 나오지 않게 1·2회차는 별도로 둔다. */
const INTERVAL_LABELS: Record<string, { every: string; second?: string }> = {
  년: { every: "매년", second: "격년" },
  개월: { every: "매월", second: "격월" },
  주: { every: "매주", second: "격주" },
};

function IntervalSelect({
  value,
  unit,
  max,
  onChange,
}: {
  value: number;
  unit: "년" | "개월" | "주";
  max: number;
  onChange: (value: number) => void;
}) {
  const labels = INTERVAL_LABELS[unit];

  const labelFor = (n: number) => {
    if (n === 1) return labels.every;
    if (n === 2 && labels.second) return labels.second;
    return `${n}${unit}마다`;
  };

  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Array.from({ length: max }, (_, i) => i + 1).map((n) => (
          <SelectItem key={n} value={String(n)}>
            {labelFor(n)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MonthCheckboxes({
  value,
  onChange,
}: {
  value: number[];
  onChange: (value: number[]) => void;
}) {
  return (
    <div>
      <div className="grid grid-cols-6 gap-1.5">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => {
          const checked = value.includes(month);
          return (
            <button
              key={month}
              type="button"
              onClick={() =>
                onChange(
                  checked
                    ? value.filter((m) => m !== month)
                    : [...value, month].sort((a, b) => a - b),
                )
              }
              className={cn(
                "h-8 rounded-md border text-sm transition-colors",
                checked
                  ? "border-primary bg-primary text-primary-foreground"
                  : "hover:bg-accent",
              )}
            >
              {month}
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {[
          { label: "분기말 (3·6·9·12)", months: [3, 6, 9, 12] },
          { label: "반기 (6·12)", months: [6, 12] },
          { label: "부가세 (1·4·7·10)", months: [1, 4, 7, 10] },
        ].map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => onChange(preset.months)}
            className="rounded border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent"
          >
            {preset.label}
          </button>
        ))}
      </div>
      {value.length === 0 && (
        <p className="mt-1 text-xs text-status-overdue-fg">
          월을 최소 1개 선택하세요.
        </p>
      )}
    </div>
  );
}

export { Field as RecurrenceField };
