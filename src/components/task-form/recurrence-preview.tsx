"use client";

/**
 * "다음 10회 발생 예정일" 실시간 미리보기
 * ============================================================================
 *
 * 요구사항에서 **사용성의 핵심**으로 지목된 기능이다.
 * 반복 규칙을 조작하는 즉시 결과를 확인할 수 있어야, 사용자가 규칙을
 * 잘못 이해한 채로 저장하는 사고를 막을 수 있다.
 *
 * 계산은 서버 API(/api/recurrence/preview)에 위임한다. 공휴일 데이터가
 * DB 에 있기 때문이며, 덕분에 실제 저장 후 생성되는 회차와 미리보기가
 * **완전히 동일한 코드 경로**로 계산된다 (엔진이 같은 순수 함수).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CalendarCheck, Loader2, MoveRight } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { formatKoreanFull, WEEKDAY_LABELS_KO, getWeekday } from "@/lib/date/plain-date";
import { SHIFT_REASON_LABELS, type ShiftReason } from "@/lib/recurrence/engine";
import type { RecurrenceConfig } from "@/lib/recurrence/types";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 300;
const PREVIEW_COUNT = 10;

interface PreviewItem {
  sequenceIndex: number;
  originalDate: string;
  scheduledDate: string;
  shiftReason: ShiftReason | null;
  holidayName: string | null;
  isWeekendOriginal: boolean;
}

interface PreviewResponse {
  description: string;
  baseDate: string;
  today: string;
  occurrences: PreviewItem[];
  isExhausted: boolean;
}

export function RecurrencePreview({ config }: { config: RecurrenceConfig }) {
  const [data, setData] = useState<PreviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [fromStartDate, setFromStartDate] = useState(false);

  // 규칙 객체를 문자열로 직렬화해 의존성으로 쓴다 (깊은 비교 대용).
  const configKey = useMemo(() => JSON.stringify(config), [config]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setIsLoading(true);
      setError(null);

      fetch("/api/recurrence/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config, count: PREVIEW_COUNT, fromStartDate }),
        signal: controller.signal,
      })
        .then(async (response) => {
          const json = await response.json();
          if (!response.ok) {
            throw new Error(json.error ?? "미리보기를 계산할 수 없습니다.");
          }
          return json as PreviewResponse;
        })
        .then((json) => {
          setData(json);
          setIsLoading(false);
        })
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          setError(caught instanceof Error ? caught.message : "미리보기 오류");
          setIsLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // configKey 로 변경을 감지한다 (config 객체 참조가 매 렌더 바뀌므로).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configKey, fromStartDate]);

  return (
    <div className="space-y-3 rounded-lg border bg-card p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <CalendarCheck className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">다음 {PREVIEW_COUNT}회 발생 예정일</h3>
          {isLoading && (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Switch
            id="from-start"
            checked={fromStartDate}
            onCheckedChange={setFromStartDate}
            className="scale-90"
          />
          <Label htmlFor="from-start" className="text-xs text-muted-foreground">
            시작일부터 보기
          </Label>
        </div>
      </div>

      {/* ---------- 규칙 요약 ---------- */}
      {data && !error && (
        <p className="rounded-md bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground">
          {data.description}
        </p>
      )}

      {/* ---------- 오류 ---------- */}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-status-overdue-line/50 bg-status-overdue-bg/50 px-2.5 py-2 text-xs">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-status-overdue-fg" />
          <p className="text-status-overdue-fg">{error}</p>
        </div>
      )}

      {/* ---------- 목록 ---------- */}
      {data && !error && (
        <>
          {data.occurrences.length === 0 ? (
            <p className="rounded-md border border-dashed px-2.5 py-6 text-center text-xs text-muted-foreground">
              {fromStartDate
                ? "이 규칙으로는 발생 회차가 없습니다. 반복 시작일과 종료 조건을 확인하세요."
                : "앞으로 발생할 회차가 없습니다. 반복이 이미 종료되었거나 종료 조건에 걸렸습니다."}
            </p>
          ) : (
            <ol className="space-y-1">
              {data.occurrences.map((item) => (
                <PreviewRow key={item.sequenceIndex} item={item} today={data.today} />
              ))}
            </ol>
          )}

          {data.isExhausted && data.occurrences.length > 0 && (
            <p className="text-xs text-muted-foreground">
              ↑ 이후로는 발생하지 않습니다 (종료일 또는 총 반복 횟수 도달).
            </p>
          )}
        </>
      )}

      {!data && !error && !isLoading && (
        <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">
          반복 규칙을 설정하면 예정일이 표시됩니다.
        </p>
      )}
    </div>
  );
}

function PreviewRow({ item, today }: { item: PreviewItem; today: string }) {
  const wasShifted = item.originalDate !== item.scheduledDate;
  const weekday = getWeekday(item.scheduledDate);
  const isWeekendResult = weekday === 0 || weekday === 6;
  const isToday = item.scheduledDate === today;

  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-2.5 py-1.5 text-xs",
        isToday ? "bg-status-progress-bg/60" : "bg-muted/30",
      )}
    >
      <span className="w-6 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
        {item.sequenceIndex + 1}
      </span>

      <span
        className={cn(
          "shrink-0 font-medium tabular-nums",
          isWeekendResult && "text-status-overdue-fg",
        )}
      >
        {formatKoreanFull(item.scheduledDate)}
      </span>

      {isToday && (
        <span className="rounded-sm bg-status-progress-line px-1 py-0 text-[10px] font-medium text-white">
          오늘
        </span>
      )}

      {wasShifted && (
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <MoveRight className="size-3" />
          <span className="line-through">
            {item.originalDate.slice(5).replace("-", "/")} (
            {WEEKDAY_LABELS_KO[getWeekday(item.originalDate)]})
          </span>
          <span className="rounded-sm bg-muted px-1 py-0">
            {item.holidayName
              ? item.holidayName
              : item.isWeekendOriginal
                ? "주말"
                : item.shiftReason
                  ? SHIFT_REASON_LABELS[item.shiftReason]
                  : "이동"}
          </span>
        </span>
      )}
    </li>
  );
}
